// WebPrestige — Pipeline automatisé
// 1. Sauvegarde Notion
// 2. Email prospect (Resend)
// 3. Génération v0 + Claude HTML (parallèle)
// 4. Email admin avec liens

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const data = req.body;
        console.log('[WebPrestige] Nouvelle soumission:', data.nom_commerce);

        // ============================================
        // ÉTAPE 1 — Sauvegarde Notion
        // ============================================
        const notionPage = await saveToNotion(data);
        const pageId = notionPage?.id;
        console.log('[Notion] Sauvegardé:', pageId);

        // ============================================
        // ÉTAPE 2 — Email prospect (immédiat)
        // ============================================
        const emailResult = await sendProspectEmail(data);
        console.log('[Resend] Email prospect:', emailResult?.id || 'skipped');

        // Tracker l'email dans Notion
        if (pageId && emailResult?.id) {
            await updateNotionEmailTracking(pageId, emailResult.id).catch(e =>
                console.error('[Notion] Tracking error:', e.message)
            );
        }

        // ============================================
        // ÉTAPE 3 — Génération sites (parallèle)
        // ============================================
        const prompt = await buildGenerationPrompt(data);
        console.log('[Prompt] Construit, longueur:', prompt.length);

        const [v0Result, claudeResult] = await Promise.allSettled([
            generateV0Site(prompt),
            generateClaudeHTML(prompt, data)
        ]);

        const v0Url = v0Result.status === 'fulfilled' ? v0Result.value : null;
        const claudeHtml = claudeResult.status === 'fulfilled' ? claudeResult.value : null;

        console.log('[v0] Résultat:', v0Url || 'échec');
        console.log('[Claude] HTML généré:', claudeHtml ? `${claudeHtml.length} chars` : 'échec');

        // Stocker le HTML Claude dans Notion
        let claudePreviewUrl = null;
        if (pageId && claudeHtml) {
            await storeHtmlInNotion(pageId, claudeHtml).catch(e =>
                console.error('[Notion] Store HTML error:', e.message)
            );
            // L'URL de preview pointe vers notre endpoint
            const baseUrl = process.env.VERCEL_URL
                ? `https://${process.env.VERCEL_URL}`
                : 'https://webprestige-questionnaire.vercel.app';
            claudePreviewUrl = `${baseUrl}/api/preview?id=${pageId}`;
        }

        // Stocker les liens dans Notion (Lien démo Lovable)
        if (pageId && (claudePreviewUrl || v0Url)) {
            await updateNotionWithLinks(pageId, { v0Url, claudePreviewUrl }).catch(e =>
                console.error('[Notion] Links update error:', e.message)
            );
        }

        // ============================================
        // ÉTAPE 4 — Email admin à Benji
        // ============================================
        await sendAdminEmail(data, { v0Url, claudePreviewUrl }).catch(e =>
            console.error('[Admin] Email error:', e.message)
        );

        // ============================================
        // Notification WhatsApp (bonus)
        // ============================================
        await sendWhatsApp(
            `🔔 *Nouveau prospect !*\n` +
            `📍 *${data.nom_commerce}* (${data.secteur})\n` +
            `📍 ${data.commune}\n` +
            `📞 ${data.telephone}\n` +
            `🌐 v0: ${v0Url || '❌'}\n` +
            `🌐 Claude: ${claudePreviewUrl || '❌'}`
        ).catch(e => console.error('[WhatsApp] Error:', e.message));

        return res.status(200).json({
            success: true,
            message: 'Questionnaire reçu ! Votre site est en cours de création.',
            notion_page: pageId,
            sites: { v0: v0Url, claude: claudePreviewUrl }
        });

    } catch (error) {
        console.error('[Error] Pipeline:', error);
        return res.status(500).json({ error: 'Erreur serveur', details: error.message });
    }
}

// ============================================
// NOTION — Sauvegarde prospect
// ============================================
async function saveToNotion(data) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const DATABASE_ID = process.env.NOTION_DATABASE_ID || '8f57d0df-ae99-4bd7-bd50-b30d5ac91538';

    if (!NOTION_TOKEN) {
        console.warn('[Notion] Pas de token configuré, skip');
        return null;
    }

    const properties = {
        "Commerce": { title: [{ text: { content: data.nom_commerce || '' } }] },
        "Secteur": { select: { name: data.secteur || 'Autre' } },
        "Commune": { rich_text: [{ text: { content: data.commune || '' } }] },
        "Adresse": { rich_text: [{ text: { content: data.adresse || '' } }] },
        "Téléphone": { phone_number: data.telephone || null },
        "Email": { email: data.email || null },
        "Note Google": { rich_text: [{ text: { content: data.note_google || '' } }] },
        "Priorité": { select: { name: "CHAUD" } },
        "Statut": { select: { name: "Formulaire reçu" } },
        "Prénom gérant": { rich_text: [{ text: { content: data.prenom_gerant || '' } }] },
        "Email Envoyé": { checkbox: false },
        "Date premier contact": { date: { start: new Date().toISOString().split('T')[0] } },
        "Notes": { rich_text: [{ text: { content: buildNotesFromForm(data) } }] }
    };

    try {
        const response = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Content-Type': 'application/json',
                'Notion-Version': '2022-06-28'
            },
            body: JSON.stringify({ parent: { database_id: DATABASE_ID }, properties })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[Notion] Save error:', err);
            return null;
        }
        return await response.json();
    } catch (e) {
        console.error('[Notion] Fetch error:', e.message);
        return null;
    }
}

function buildNotesFromForm(data) {
    const parts = [];
    if (data.horaires) parts.push(`Horaires: ${data.horaires}`);
    if (data.ambiance) parts.push(`Ambiance: ${data.ambiance}`);
    if (data.couleurs?.length) {
        const c = Array.isArray(data.couleurs) ? data.couleurs.join(', ') : data.couleurs;
        parts.push(`Couleurs: ${c}`);
    }
    if (data.points_forts) parts.push(`Points forts: ${data.points_forts}`);
    if (data.pages?.length) {
        const p = Array.isArray(data.pages) ? data.pages.join(', ') : data.pages;
        parts.push(`Pages: ${p}`);
    }
    if (data.style_site) parts.push(`Style: ${data.style_site}`);
    if (data.site_reference) parts.push(`Site référence: ${data.site_reference}`);
    if (data.facebook) parts.push(`Facebook: ${data.facebook}`);
    if (data.instagram) parts.push(`Instagram: ${data.instagram}`);
    if (data.contenu_important) parts.push(`Contenu: ${data.contenu_important}`);
    if (data.budget) parts.push(`Budget: ${data.budget}`);
    if (data.delai) parts.push(`Délai: ${data.delai}`);
    if (data.commentaires) parts.push(`Commentaires: ${data.commentaires}`);
    return parts.join('\n');
}

async function updateNotionEmailTracking(pageId, emailId) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    if (!NOTION_TOKEN) return;

    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
            properties: {
                "Email Envoyé": { checkbox: true },
                "Resend Email ID": { rich_text: [{ text: { content: emailId } }] },
                "Dernier Email": { date: { start: new Date().toISOString() } }
            }
        })
    });
}

async function updateNotionWithLinks(pageId, sites) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    if (!NOTION_TOKEN) return;

    const properties = {
        "Statut": { select: { name: "Démo envoyée" } }
    };

    // Stocker le meilleur lien disponible dans "Lien démo Lovable"
    const bestLink = sites.claudePreviewUrl || sites.v0Url;
    if (bestLink) {
        properties["Lien démo Lovable"] = { url: bestLink };
    }

    // Stocker l'autre lien dans Notes (append)
    if (sites.v0Url && sites.claudePreviewUrl) {
        properties["Prochaine action"] = {
            rich_text: [{ text: { content: `v0: ${sites.v0Url} | Claude: ${sites.claudePreviewUrl}` } }]
        };
    }

    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({ properties })
    });
    console.log('[Notion] Liens mis à jour dans la fiche prospect');
}

// ============================================
// RESEND — Email prospect
// ============================================
async function sendProspectEmail(data) {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
        console.warn('[Resend] Pas de clé API, skip email prospect');
        return null;
    }

    const prenom = data.prenom_gerant || data.nom_commerce;
    const nomCommerce = data.nom_commerce;

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FAF7F5;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#C0784A,#D4956B);padding:32px;text-align:center;">
            <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">WebPrestige</h1>
            <p style="color:rgba(255,255,255,0.9);margin:8px 0 0;font-size:14px;">Création de sites vitrines professionnels</p>
        </div>
        <!-- Body -->
        <div style="padding:32px;">
            <h2 style="color:#2D2D2D;margin:0 0 16px;font-size:22px;">
                Merci ${prenom} ! 🎉
            </h2>
            <p style="color:#555;line-height:1.7;font-size:15px;margin:0 0 20px;">
                Nous avons bien reçu votre questionnaire pour <strong style="color:#C0784A;">${nomCommerce}</strong>.
            </p>
            <div style="background:#FFF8F3;border-left:4px solid #C0784A;padding:16px 20px;border-radius:0 8px 8px 0;margin:0 0 20px;">
                <p style="color:#C0784A;font-weight:600;margin:0 0 4px;font-size:15px;">
                    ⚡ Votre site est déjà en cours de création !
                </p>
                <p style="color:#777;margin:0;font-size:14px;">
                    Notre équipe travaille dessus en ce moment même. Nous revenons vers vous très vite avec une proposition personnalisée.
                </p>
            </div>
            <p style="color:#555;line-height:1.7;font-size:14px;margin:0 0 24px;">
                D'ici là, n'hésitez pas à nous contacter si vous avez des questions ou des précisions à apporter.
            </p>
            <div style="text-align:center;margin:24px 0;">
                <a href="mailto:contact@webprestige.fr" style="display:inline-block;background:#C0784A;color:#fff;padding:12px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
                    Nous contacter
                </a>
            </div>
        </div>
        <!-- Footer -->
        <div style="background:#F5F0EB;padding:20px 32px;text-align:center;">
            <p style="color:#999;font-size:12px;margin:0;">
                WebPrestige — Création de sites vitrines pour commerces<br>
                Toulouse et environs
            </p>
        </div>
    </div>
</div>
</body>
</html>`;

    try {
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${RESEND_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: process.env.FROM_EMAIL || 'WebPrestige <onboarding@resend.dev>',
                to: [data.email],
                subject: `${prenom}, votre site ${nomCommerce} est en cours de création !`,
                html
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[Resend] Prospect email error:', err);
            return null;
        }
        return await response.json();
    } catch (e) {
        console.error('[Resend] Prospect fetch error:', e.message);
        return null;
    }
}

// ============================================
// PROMPT — Construction du prompt de génération
// ============================================
async function buildGenerationPrompt(data) {
    // Tenter de récupérer le prompt depuis Notion "Prompts par secteur"
    const notionPrompt = await fetchSectorPrompt(data.secteur).catch(() => null);

    if (notionPrompt) {
        // Enrichir le prompt Notion avec les données du prospect
        return enrichPromptWithData(notionPrompt, data);
    }

    // Fallback : générer le prompt en local
    return generateLocalPrompt(data);
}

async function fetchSectorPrompt(secteur) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const PROMPTS_DB_ID = process.env.NOTION_PROMPTS_DATABASE_ID;

    if (!NOTION_TOKEN || !PROMPTS_DB_ID) return null;

    const response = await fetch('https://api.notion.com/v1/databases/' + PROMPTS_DB_ID + '/query', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
            filter: {
                property: 'Secteur',
                title: { equals: secteur }
            }
        })
    });

    if (!response.ok) return null;
    const result = await response.json();
    const page = result.results?.[0];
    if (!page) return null;

    const promptText = page.properties?.['Prompt de base']?.rich_text?.[0]?.plain_text || '';
    const motsCles = page.properties?.['Mots clés SEO']?.rich_text?.[0]?.plain_text || '';
    const sections = page.properties?.['Sections recommandées']?.rich_text?.[0]?.plain_text || '';

    return { promptText, motsCles, sections };
}

function enrichPromptWithData(notionPrompt, data) {
    const pages = Array.isArray(data.pages) ? data.pages : ['accueil', 'contact'];
    const pagesStr = pages.join(', ');
    const colorsStr = data.couleurs?.length
        ? (Array.isArray(data.couleurs) ? data.couleurs.join(', ') : data.couleurs)
        : 'adaptées au secteur';

    return `${notionPrompt.promptText}

COMMERCE : "${data.nom_commerce}"
SECTEUR : ${data.secteur}
LOCALISATION : ${data.commune}${data.adresse ? ` — ${data.adresse}` : ''}
TÉLÉPHONE : ${data.telephone || 'N/A'}
EMAIL : ${data.email || 'N/A'}
STYLE SOUHAITÉ : ${data.style_site || 'moderne'}
COULEURS : ${colorsStr}
PAGES : ${pagesStr}
${data.points_forts ? `POINTS FORTS : ${data.points_forts}` : ''}
${data.ambiance ? `AMBIANCE : ${data.ambiance}` : ''}
${data.horaires ? `HORAIRES : ${data.horaires}` : ''}
${data.contenu_important ? `CONTENU IMPORTANT : ${data.contenu_important}` : ''}
${notionPrompt.motsCles ? `MOTS CLÉS SEO : ${notionPrompt.motsCles}` : ''}
${notionPrompt.sections ? `SECTIONS RECOMMANDÉES : ${notionPrompt.sections}` : ''}
${data.facebook ? `FACEBOOK : ${data.facebook}` : ''}
${data.instagram ? `INSTAGRAM : ${data.instagram}` : ''}`;
}

function generateLocalPrompt(data) {
    const pages = Array.isArray(data.pages) ? data.pages : ['accueil', 'contact'];
    const pagesNames = {
        accueil: 'Accueil', menu_carte: 'Menu / Carte', services: 'Services',
        galerie: 'Galerie photos', avis: 'Avis clients', tarifs: 'Tarifs',
        contact: 'Contact', reservation: 'Réservation', equipe: "L'équipe", a_propos: 'À propos'
    };
    const pagesStr = pages.map(p => pagesNames[p] || p).join(', ');

    const styleMap = {
        'moderne': 'moderne et minimaliste, espace blanc généreux, typographie épurée, animations subtiles',
        'Moderne & Minimaliste': 'moderne et minimaliste, espace blanc généreux, typographie épurée, animations subtiles',
        'chaleureux': 'chaleureux et traditionnel, tons chauds, textures naturelles, ambiance accueillante',
        'Chaleureux & Traditionnel': 'chaleureux et traditionnel, tons chauds, textures naturelles, ambiance accueillante',
        'elegant': 'élégant et premium, design sophistiqué, palette raffinée, typographie serif',
        'Élégant & Premium': 'élégant et premium, design sophistiqué, palette raffinée, typographie serif',
        'dynamique': 'coloré et dynamique, couleurs vives, formes géométriques, énergie visuelle',
        'Coloré & Dynamique': 'coloré et dynamique, couleurs vives, formes géométriques, énergie visuelle'
    };
    const styleDesc = styleMap[data.style_site] || data.style_site || 'professionnel et moderne';

    const colorsStr = data.couleurs?.length
        ? `Palette : ${Array.isArray(data.couleurs) ? data.couleurs.join(', ') : data.couleurs}`
        : 'Palette adaptée au secteur';

    // Prompts spécifiques par secteur
    const sectorHints = {
        'Pizzeria': 'Mettre en avant le four à bois, les ingrédients frais, ambiance italienne. Hero avec une belle pizza en fond.',
        'Kebab / Snack': 'Ambiance street food moderne, mettre en avant les formules, les livraisons. Photos de plats appétissants.',
        'Restaurant': 'Ambiance gastronomique, mettre en avant le chef, la carte, la salle. Réservation en ligne.',
        'Boulangerie': 'Ambiance artisanale, tons chauds, mettre en avant les produits phares, les horaires matinaux.',
        'Commerce / Boutique': 'Vitrine de produits, promotions, ambiance shopping. Mettre en avant les nouveautés.',
        'Coiffure / Beauté': 'Ambiance zen et élégante, galerie avant/après, tarifs clairs, prise de RDV.',
        'Garage / Auto': 'Design robuste et professionnel, services clairs, devis en ligne, confiance.',
        'Artisan / BTP': 'Portfolio de réalisations, devis gratuit, zones d\'intervention, certifications.',
        'Santé / Bien-être': 'Ambiance apaisante, services détaillés, prise de RDV, équipe.',
        'Sport / Loisirs': 'Énergie et dynamisme, planning des cours, tarifs, photos d\'action.',
        'Service pro': 'Professionnel et corporate, services B2B, témoignages clients, contact rapide.'
    };
    const sectorHint = sectorHints[data.secteur] || 'Design professionnel adapté à l\'activité.';

    return `Crée un site web vitrine professionnel complet pour "${data.nom_commerce}", ${data.secteur} à ${data.commune}${data.adresse ? ` (${data.adresse})` : ''}.

CONTEXTE SECTEUR : ${sectorHint}

STYLE : ${styleDesc}
${colorsStr}
${data.ambiance ? `Ambiance : ${data.ambiance}` : ''}

PAGES : ${pagesStr}

PAGE D'ACCUEIL :
- Hero section plein écran avec nom du commerce et accroche percutante
- ${data.points_forts ? `Points forts : ${data.points_forts}` : 'Section avantages du commerce'}
- Appel à l'action (téléphone : ${data.telephone || 'à compléter'})
- ${data.horaires ? `Horaires : ${data.horaires}` : 'Section horaires'}
- Localisation / carte

${pages.includes('menu_carte') ? 'PAGE MENU/CARTE : Catégories, prix, descriptions appétissantes' : ''}
${pages.includes('services') ? 'PAGE SERVICES : Liste détaillée avec icônes et descriptions' : ''}
${pages.includes('galerie') ? 'PAGE GALERIE : Grille responsive avec effet hover' : ''}
${pages.includes('tarifs') ? 'PAGE TARIFS : Tableau de prix clair et attractif' : ''}
${pages.includes('avis') ? 'PAGE AVIS : Témoignages avec étoiles et photos' : ''}
${pages.includes('contact') ? `PAGE CONTACT : Formulaire, tél ${data.telephone || ''}, email ${data.email || ''}, adresse${data.facebook ? ', Facebook: ' + data.facebook : ''}${data.instagram ? ', Instagram: ' + data.instagram : ''}` : ''}
${pages.includes('reservation') ? 'PAGE RÉSERVATION : Formulaire date/heure/personnes/téléphone' : ''}
${pages.includes('equipe') ? "PAGE ÉQUIPE : Présentation de l'équipe avec photos et rôles" : ''}
${pages.includes('a_propos') ? "PAGE À PROPOS : Histoire, valeurs, engagement" : ''}

TECHNIQUE : Site responsive mobile-first, SEO optimisé "${data.secteur} ${data.commune}", animations scroll, chargement rapide, footer complet.

${data.contenu_important ? `CONTENU IMPORTANT : ${data.contenu_important}` : ''}
${data.site_reference ? `SITE RÉFÉRENCE : ${data.site_reference}` : ''}`;
}

// ============================================
// V0 — Génération via v0.dev Platform API
// ============================================
async function generateV0Site(prompt) {
    const V0_TOKEN = process.env.V0_API_TOKEN;
    if (!V0_TOKEN) {
        console.warn('[v0] Pas de token, skip');
        return null;
    }

    console.log('[v0] Lancement génération...');
    const response = await fetch('https://api.v0.dev/v1/chats', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${V0_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            message: prompt
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[v0] API error:', response.status, err);
        return null;
    }

    const result = await response.json();
    console.log('[v0] Réponse reçue:', JSON.stringify(result).substring(0, 200));

    // Extraire l'URL de preview (la structure peut varier)
    const url = result.url || result.demo_url || result.preview_url || result.data?.url || null;
    return url;
}

// ============================================
// CLAUDE — Génération HTML complète via Anthropic API
// ============================================
async function generateClaudeHTML(prompt, data) {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
    if (!ANTHROPIC_KEY) {
        console.warn('[Claude] Pas de clé API, skip');
        return null;
    }

    console.log('[Claude] Lancement génération HTML...');

    const systemPrompt = `Tu es un expert en création de sites web vitrines pour petits commerces français.
Tu génères du HTML/CSS/JS complet, prêt à afficher dans un navigateur.

RÈGLES :
- Génère UN SEUL fichier HTML complet avec CSS et JS intégrés (inline)
- Design professionnel, moderne, responsive (mobile-first)
- Utilise des Google Fonts (Inter, Playfair Display, ou similaire)
- Couleurs harmonieuses basées sur les préférences du client
- Images via placeholder (https://images.unsplash.com/photo-... ou picsum.photos)
- Animations CSS subtiles (fade-in au scroll, hover effects)
- Navigation sticky avec menu hamburger sur mobile
- Footer complet avec coordonnées et mentions légales
- SEO : balises meta, title, description, Open Graph
- Textes réalistes et engageants en français (pas de lorem ipsum)
- Le HTML doit être auto-suffisant — pas de fichiers externes sauf CDN publics
- NE PAS inclure de blocs markdown, juste le HTML brut

Réponds UNIQUEMENT avec le code HTML complet, sans explications.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 16000,
            system: systemPrompt,
            messages: [{
                role: 'user',
                content: `Génère le site vitrine HTML complet pour ce commerce :\n\n${prompt}`
            }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[Claude] API error:', response.status, err);
        return null;
    }

    const result = await response.json();
    let html = result.content?.[0]?.text || '';

    // Nettoyer si Claude a wrappé dans des backticks markdown
    html = html.replace(/^```html?\n?/i, '').replace(/\n?```$/i, '').trim();

    if (!html.includes('<!DOCTYPE') && !html.includes('<html')) {
        console.error('[Claude] HTML invalide généré');
        return null;
    }

    return html;
}

// ============================================
// NOTION — Stocker le HTML généré dans la page
// ============================================
async function storeHtmlInNotion(pageId, html) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    if (!NOTION_TOKEN) return;

    // Notion limite les blocs de code à 2000 chars, on découpe
    const chunks = [];
    for (let i = 0; i < html.length; i += 2000) {
        chunks.push(html.substring(i, i + 2000));
    }

    const blocks = [
        {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ text: { content: '🌐 Site HTML généré par Claude' } }] }
        },
        ...chunks.map(chunk => ({
            object: 'block',
            type: 'code',
            code: {
                rich_text: [{ text: { content: chunk } }],
                language: 'html'
            }
        }))
    ];

    await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({ children: blocks })
    });
}

// ============================================
// RESEND — Email admin (Benji)
// ============================================
async function sendAdminEmail(data, sites) {
    const RESEND_KEY = process.env.RESEND_API_KEY;
    if (!RESEND_KEY) {
        console.warn('[Admin] Pas de clé Resend, skip');
        return;
    }

    const prenom = data.prenom_gerant || 'N/A';
    const colorsStr = data.couleurs?.length
        ? (Array.isArray(data.couleurs) ? data.couleurs.join(', ') : data.couleurs)
        : 'Non précisé';

    const sitesHtml = [];
    if (sites.v0Url) {
        sitesHtml.push(`
            <a href="${sites.v0Url}" style="display:block;background:#000;color:#fff;padding:16px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;text-align:center;margin-bottom:12px;">
                ⚡ Voir le site v0.dev →
            </a>`);
    }
    if (sites.claudePreviewUrl) {
        sitesHtml.push(`
            <a href="${sites.claudePreviewUrl}" style="display:block;background:#C0784A;color:#fff;padding:16px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:15px;text-align:center;margin-bottom:12px;">
                🎨 Voir le site Claude →
            </a>`);
    }
    if (!sitesHtml.length) {
        sitesHtml.push(`
            <div style="background:#FEF2F2;border:1px solid #FECACA;padding:16px;border-radius:10px;text-align:center;color:#DC2626;">
                ⚠️ La génération automatique a échoué — génère manuellement les sites.
            </div>`);
    }

    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#F5F0EB;font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;">
<div style="max-width:600px;margin:0 auto;padding:40px 20px;">
    <div style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#C0784A,#8B5E3C);padding:24px 32px;">
            <h1 style="color:#fff;margin:0;font-size:20px;">🔥 Nouveau prospect — ${data.nom_commerce}</h1>
            <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px;">${data.secteur} — ${data.commune}</p>
        </div>

        <!-- Fiche prospect -->
        <div style="padding:24px 32px;">
            <h3 style="color:#2D2D2D;margin:0 0 16px;font-size:16px;border-bottom:2px solid #F0E6DD;padding-bottom:8px;">
                📋 Fiche prospect
            </h3>
            <table style="width:100%;font-size:14px;color:#555;">
                <tr><td style="padding:6px 0;font-weight:600;width:140px;">Commerce</td><td>${data.nom_commerce}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Gérant</td><td>${prenom}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Secteur</td><td>${data.secteur}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Commune</td><td>${data.commune}</td></tr>
                ${data.adresse ? `<tr><td style="padding:6px 0;font-weight:600;">Adresse</td><td>${data.adresse}</td></tr>` : ''}
                <tr><td style="padding:6px 0;font-weight:600;">Téléphone</td><td><a href="tel:${data.telephone}" style="color:#C0784A;">${data.telephone}</a></td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Email</td><td><a href="mailto:${data.email}" style="color:#C0784A;">${data.email}</a></td></tr>
                ${data.note_google ? `<tr><td style="padding:6px 0;font-weight:600;">Note Google</td><td>⭐ ${data.note_google}</td></tr>` : ''}
                <tr><td style="padding:6px 0;font-weight:600;">Style</td><td>${data.style_site || 'Non précisé'}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Couleurs</td><td>${colorsStr}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Budget</td><td>${data.budget || 'Non précisé'}</td></tr>
                <tr><td style="padding:6px 0;font-weight:600;">Délai</td><td>${data.delai || 'Non précisé'}</td></tr>
            </table>

            ${data.points_forts ? `<div style="background:#FFF8F3;padding:12px 16px;border-radius:8px;margin:16px 0;font-size:14px;"><strong>Points forts :</strong> ${data.points_forts}</div>` : ''}
            ${data.contenu_important ? `<div style="background:#FFF8F3;padding:12px 16px;border-radius:8px;margin:16px 0;font-size:14px;"><strong>Contenu important :</strong> ${data.contenu_important}</div>` : ''}
            ${data.commentaires ? `<div style="background:#FFF8F3;padding:12px 16px;border-radius:8px;margin:16px 0;font-size:14px;"><strong>Commentaires :</strong> ${data.commentaires}</div>` : ''}

            <!-- Sites générés -->
            <h3 style="color:#2D2D2D;margin:24px 0 16px;font-size:16px;border-bottom:2px solid #F0E6DD;padding-bottom:8px;">
                🌐 Sites générés
            </h3>
            <p style="color:#777;font-size:14px;margin:0 0 16px;">
                ${sitesHtml.length > 0 && (sites.v0Url || sites.claudePreviewUrl)
                    ? '2 propositions sont prêtes — va choisir laquelle proposer au client !'
                    : 'Vérifie les liens ci-dessous :'}
            </p>
            ${sitesHtml.join('')}
        </div>

        <!-- Footer -->
        <div style="background:#F5F0EB;padding:16px 32px;text-align:center;">
            <p style="color:#999;font-size:12px;margin:0;">Pipeline WebPrestige — email auto-généré</p>
        </div>
    </div>
</div>
</body>
</html>`;

    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            from: process.env.FROM_EMAIL || 'WebPrestige <onboarding@resend.dev>',
            to: ['benjamin31.mathias@gmail.com'],
            subject: `🔥 Nouveau prospect — ${data.nom_commerce} (${data.secteur})`,
            html
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[Admin] Email error:', err);
    } else {
        console.log('[Admin] Email envoyé à Benji');
    }
}

// ============================================
// WHATSAPP (via CallMeBot) — optionnel
// ============================================
async function sendWhatsApp(message) {
    const PHONE = process.env.WHATSAPP_PHONE;
    const API_KEY = process.env.WHATSAPP_API_KEY;
    if (!PHONE || !API_KEY) return;

    try {
        const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(message)}&apikey=${API_KEY}`;
        await fetch(url);
    } catch (e) {
        console.error('[WhatsApp] Failed:', e.message);
    }
}
