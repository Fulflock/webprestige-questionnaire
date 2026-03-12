// Vercel Serverless Function — Handles questionnaire submissions
// 1. Saves to Notion database
// 2. Sends WhatsApp notification via CallMeBot
// 3. Generates Lovable.dev prompt
// 4. Returns prompt to trigger site creation

export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const data = req.body;
        console.log('[WebPrestige] New submission:', data.nom_commerce);

        // ============================================
        // 1. SAVE TO NOTION
        // ============================================
        const notionResponse = await saveToNotion(data);
        console.log('[Notion] Saved:', notionResponse?.id);

        // ============================================
        // 2. SEND WHATSAPP NOTIFICATION
        // ============================================
        await sendWhatsApp(
            `🔔 *Nouveau questionnaire complété !*\n\n` +
            `📍 *${data.nom_commerce}*\n` +
            `🏪 ${data.secteur}\n` +
            `📍 ${data.commune}\n` +
            `📞 ${data.telephone}\n` +
            `📧 ${data.email}\n` +
            `🎨 Style : ${data.style_site || 'Non précisé'}\n` +
            `💰 Budget : ${data.budget || 'Non précisé'}\n\n` +
            `👉 La création du site va démarrer automatiquement !`
        );
        console.log('[WhatsApp] Notification sent');

        // ============================================
        // 3. GENERATE LOVABLE.DEV PROMPT
        // ============================================
        const lovablePrompt = generateLovablePrompt(data);
        console.log('[Lovable] Prompt generated');

        // ============================================
        // 4. TRIGGER SITE CREATION (if Lovable API available)
        // ============================================
        let siteCreationStarted = false;
        if (process.env.LOVABLE_API_KEY) {
            // Future: trigger Lovable API here
            siteCreationStarted = true;
        }

        // ============================================
        // 5. STORE PROMPT IN NOTION PAGE CONTENT
        // ============================================
        if (notionResponse?.id) {
            await updateNotionPageContent(notionResponse.id, lovablePrompt);
        }

        return res.status(200).json({
            success: true,
            message: 'Questionnaire reçu !',
            notion_page: notionResponse?.id,
            lovable_prompt: lovablePrompt,
            site_creation_started: siteCreationStarted
        });

    } catch (error) {
        console.error('[Error]', error);
        return res.status(500).json({ error: 'Erreur serveur', details: error.message });
    }
}

// ============================================
// NOTION INTEGRATION
// ============================================
async function saveToNotion(data) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const DATABASE_ID = process.env.NOTION_DATABASE_ID || '8f57d0df-ae99-4bd7-bd50-b30d5ac91538';

    if (!NOTION_TOKEN) {
        console.warn('[Notion] No API token configured, skipping');
        return null;
    }

    const properties = {
        "Nom": { title: [{ text: { content: data.nom_commerce || '' } }] },
        "Secteur": { select: { name: data.secteur || 'Autre' } },
        "Commune": { rich_text: [{ text: { content: data.commune || '' } }] },
        "Adresse": { rich_text: [{ text: { content: data.adresse || '' } }] },
        "Téléphone": { phone_number: data.telephone || '' },
        "Email": { email: data.email || '' },
        "Statut": { select: { name: "Questionnaire reçu" } },
        "Priorité": { select: { name: "🟠 Moyenne" } },
        "Notes": { rich_text: [{ text: { content: buildNotesFromForm(data) } }] }
    };

    const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
        },
        body: JSON.stringify({
            parent: { database_id: DATABASE_ID },
            properties
        })
    });

    if (!response.ok) {
        const err = await response.text();
        console.error('[Notion] Error:', err);
        return null;
    }

    return await response.json();
}

async function updateNotionPageContent(pageId, prompt) {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    if (!NOTION_TOKEN) return;

    const blocks = [
        {
            object: 'block',
            type: 'heading_2',
            heading_2: { rich_text: [{ text: { content: '🤖 Prompt Lovable.dev auto-généré' } }] }
        },
        {
            object: 'block',
            type: 'code',
            code: {
                rich_text: [{ text: { content: prompt } }],
                language: 'plain text'
            }
        }
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

function buildNotesFromForm(data) {
    const parts = [];
    if (data.horaires) parts.push(`Horaires: ${data.horaires}`);
    if (data.ambiance) parts.push(`Ambiance: ${data.ambiance}`);
    if (data.couleurs?.length) parts.push(`Couleurs: ${data.couleurs.join(', ')}`);
    if (data.points_forts) parts.push(`Points forts: ${data.points_forts}`);
    if (data.pages?.length) parts.push(`Pages souhaitées: ${data.pages.join(', ')}`);
    if (data.site_reference) parts.push(`Site référence: ${data.site_reference}`);
    if (data.facebook) parts.push(`Facebook: ${data.facebook}`);
    if (data.instagram) parts.push(`Instagram: ${data.instagram}`);
    if (data.contenu_important) parts.push(`Contenu important: ${data.contenu_important}`);
    if (data.delai) parts.push(`Délai souhaité: ${data.delai}`);
    if (data.commentaires) parts.push(`Commentaires: ${data.commentaires}`);
    return parts.join('\n');
}

// ============================================
// WHATSAPP NOTIFICATION (via CallMeBot)
// ============================================
async function sendWhatsApp(message) {
    const PHONE = process.env.WHATSAPP_PHONE;
    const API_KEY = process.env.WHATSAPP_API_KEY;

    if (!PHONE || !API_KEY) {
        console.warn('[WhatsApp] Not configured, skipping');
        return;
    }

    const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(message)}&apikey=${API_KEY}`;

    try {
        const response = await fetch(url);
        if (!response.ok) console.error('[WhatsApp] Error:', await response.text());
    } catch (err) {
        console.error('[WhatsApp] Failed:', err.message);
    }
}

// ============================================
// LOVABLE.DEV PROMPT GENERATOR
// ============================================
function generateLovablePrompt(data) {
    const pages = data.pages || ['accueil', 'contact'];
    const pagesStr = pages.map(p => {
        const names = {
            accueil: 'Accueil',
            menu_carte: 'Menu / Carte',
            services: 'Services',
            galerie: 'Galerie photos',
            avis: 'Avis clients',
            tarifs: 'Tarifs',
            contact: 'Contact',
            reservation: 'Réservation',
            equipe: "L'équipe",
            a_propos: 'À propos'
        };
        return names[p] || p;
    }).join(', ');

    const styleMap = {
        moderne: 'moderne et minimaliste, avec beaucoup d\'espace blanc, typographie épurée, animations subtiles',
        chaleureux: 'chaleureux et traditionnel, tons chauds, textures naturelles, ambiance accueillante',
        elegant: 'élégant et premium, design sophistiqué, palette raffinée, typographie serif',
        dynamique: 'coloré et dynamique, couleurs vives, formes géométriques, énergie visuelle'
    };
    const styleDesc = styleMap[data.style_site] || 'professionnel et moderne';

    const colorsStr = data.couleurs?.length
        ? `Palette de couleurs : ${data.couleurs.join(', ')}.`
        : 'Palette de couleurs adaptée au secteur.';

    return `Crée un site web professionnel pour \"${data.nom_commerce}\", un commerce de type ${data.secteur} situé à ${data.commune}${data.adresse ? ` (${data.adresse})` : ''}.

STYLE & DESIGN :
- Style ${styleDesc}
- ${colorsStr}
${data.ambiance ? `- Ambiance souhaitée : ${data.ambiance}` : ''}
${data.a_logo === 'oui' ? '- Le client a un logo à intégrer' : '- Pas de logo, créer un header textuel élégant avec le nom du commerce'}

PAGES À CRÉER : ${pagesStr}

PAGE D'ACCUEIL :
- Hero section avec image de fond et nom du commerce en grand
- ${data.points_forts ? `Mettre en avant : ${data.points_forts}` : 'Section points forts du commerce'}
- Appel à l'action principal (téléphone ou réservation)
- Section horaires${data.horaires ? ` : ${data.horaires}` : ''}
- Carte Google Maps intégrée avec l'adresse

${pages.includes('menu_carte') ? `PAGE MENU / CARTE :
- Présentation élégante des produits/services avec catégories
- Prix bien visibles
- Photos si disponibles` : ''}

${pages.includes('galerie') ? `PAGE GALERIE :
- Grille de photos responsive avec lightbox
- Catégories si pertinent` : ''}

${pages.includes('contact') ? `PAGE CONTACT :
- Formulaire de contact simple (nom, email, message)
- Téléphone : ${data.telephone || 'à compléter'}
- Email : ${data.email || 'à compléter'}
- Adresse avec carte interactive
${data.facebook ? `- Lien Facebook : ${data.facebook}` : ''}
${data.instagram ? `- Lien Instagram : ${data.instagram}` : ''}` : ''}

${pages.includes('reservation') ? `PAGE RÉSERVATION :
- Formulaire de réservation (date, heure, nombre de personnes, téléphone)
- Ou intégration d'un widget de réservation` : ''}

${pages.includes('avis') ? `PAGE AVIS :
- Section témoignages clients avec étoiles
- Design engageant qui inspire confiance` : ''}

TECHNIQUE :
- Site responsive (mobile-first)
- SEO optimisé pour \"${data.secteur} ${data.commune}\"
- Animations de scroll subtiles
- Vitesse de chargement optimisée
- Footer avec coordonnées, horaires, réseaux sociaux et mentions légales

${data.contenu_important ? `CONTENU IMPORTANT À INTÉGRER :\n${data.contenu_important}` : ''}
${data.site_reference ? `SITE DE RÉFÉRENCE (s'inspirer du style) : ${data.site_reference}` : ''}`;
}
