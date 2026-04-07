// Vercel Serverless Function — WebPrestige Pipeline (Étape 2)
// Template-based generation + Gemini AI + v0 + QA auto
// Appelé par submit.js en fire-and-forget
// Timeout : 60s max (Vercel Hobby)

import { validateSite, autoFix } from './qa.js';

export const config = { maxDuration: 60 };

// Template mapping by sector
const TEMPLATE_MAP = {
  'Restaurant': 'restaurant',
  'Pizzeria': 'restaurant',
  'Kebab / Snack': 'restaurant',
  'Coiffeur': 'coiffeur',
  'Coiffure / Beauté': 'coiffeur',
  'Boulangerie': 'boulangerie',
  'Plombier': 'artisan',
  'Électricien': 'artisan',
  'Artisan / BTP': 'artisan',
  'Garage / Auto': 'artisan',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { notionPageId, data } = req.body;
  if (!notionPageId || !data) {
    return res.status(400).json({ error: 'notionPageId et data requis' });
  }

  // Auth: only accept calls from submit.js with internal secret
  const internalSecret = process.env.INTERNAL_SECRET || 'wp-internal-2026';
  if (req.headers['x-internal-secret'] !== internalSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log('[Generate] Démarrage pour', data.nom_commerce, '| Page:', notionPageId);

  try {
    // ==========================================
    // 1. GÉNÉRER LE PROMPT (avec template si dispo)
    // ==========================================
    const prompt = generateSitePrompt(data);
    const sectorTemplate = TEMPLATE_MAP[data.secteur] || 'commerce';

    // ==========================================
    // 2. GÉNÉRATION CLAUDE (prioritaire, plus rapide)
    //    + v0 en parallèle si le temps le permet
    // ==========================================
    let v0Url = null;
    let generatedHtml = null;

    // Lancer les 2 en parallèle avec un timeout de 50s
    const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), ms));

    // Gemini (gratuit, prioritaire) + v0 en parallèle
    const [geminiResult, v0Result] = await Promise.allSettled([
      Promise.race([generateWithGemini(data, prompt), timeout(35000)]),
      Promise.race([triggerV0(data, prompt), timeout(35000)])
    ]);

    generatedHtml = geminiResult.status === 'fulfilled' ? geminiResult.value : null;
    v0Url = v0Result.status === 'fulfilled' ? v0Result.value : null;

    if (generatedHtml) console.log('[Gemini] OK:', generatedHtml.length, 'chars');
    else console.error('[Gemini] FAIL:', geminiResult.status, geminiResult.reason?.message);

    if (v0Url) console.log('[v0] OK:', v0Url);
    else console.error('[v0] FAIL:', v0Result.status, v0Result.reason?.message);

    // ==========================================
    // 2.5 QA VALIDATION + AUTO-FIX
    // ==========================================
    if (generatedHtml) {
      const qa = validateSite(generatedHtml, data);
      console.log(`[QA] Score: ${qa.score}/100 | ${qa.issues.length} issues`);

      if (qa.score < 70) {
        console.log('[QA] Score too low, applying auto-fix...');
        generatedHtml = autoFix(generatedHtml, data);
        const qaFixed = validateSite(generatedHtml, data);
        console.log(`[QA] After fix: ${qaFixed.score}/100`);
      } else if (qa.issues.length > 0) {
        // Apply minor fixes even if score is OK
        generatedHtml = autoFix(generatedHtml, data);
      }
    }

    // ==========================================
    // 3. STOCKER DANS NOTION
    // ==========================================
    let claudePreviewUrl = null;
    try {
      if (generatedHtml) {
        await storeClaudeHtmlInNotion(notionPageId, generatedHtml);
        claudePreviewUrl = `https://webprestige-questionnaire.vercel.app/api/preview?id=${notionPageId}`;
        console.log('[Notion] HTML stocké, preview:', claudePreviewUrl);
      }
      await updateNotionWithSiteLinks(notionPageId, { v0Url, claudePreviewUrl });
      console.log('[Notion] Liens mis à jour');
    } catch (e) {
      console.error('[Notion] Erreur stockage:', e.message);
    }

    // ==========================================
    // 4. EMAIL ADMIN
    // ==========================================
    try {
      await sendAdminEmail(data, { v0Url, generatedHtml, claudePreviewUrl, notionPageId });
      console.log('[Admin Email] OK —', v0Url ? 'v0 OK' : 'v0 FAIL', '|', generatedHtml ? 'Claude OK' : 'Claude FAIL');
    } catch (e) {
      console.error('[Admin Email] Erreur:', e.message);
    }

    // ==========================================
    // 5. ALL PROMPTS (toujours générés)
    // ==========================================
    const lovablePrompt = generateLovablePrompt(data);
    const boltPrompt = generateBoltPrompt(data);
    const websimPrompt = generateWebsimPrompt(data);
    const cursorPrompt = generateCursorPrompt(data);
    const lovableUrl = `https://lovable.dev/projects/create#prompt=${encodeURIComponent(lovablePrompt.substring(0, 500))}`;

    // Store all prompts in Notion page
    try {
      await storeAllPromptsInNotion(notionPageId, lovablePrompt, boltPrompt, websimPrompt, cursorPrompt);
      console.log('[Prompts] 4 prompts stockés dans Notion (Lovable, Bolt, Websim, Cursor)');
    } catch (e) {
      console.error('[Prompts] Erreur stockage:', e.message);
    }

    // ==========================================
    // 6. WHATSAPP avec prompt Lovable
    // ==========================================
    await sendWhatsApp(
      `*Nouveau prospect !*\n\n` +
      `${data.nom_commerce} (${data.secteur})\n` +
      `${data.commune} | ${data.telephone}\n\n` +
      `${v0Url ? `v0: ${v0Url}\n` : ''}` +
      `${generatedHtml ? `HTML: genere\n` : ''}` +
      `\nLovable: ouvre lovable.dev et colle le prompt depuis Notion`
    ).catch(e => console.error('[WhatsApp] Erreur:', e.message));

    console.log('[Generate] Pipeline terminé pour', data.nom_commerce);
    return res.status(200).json({ success: true, v0: !!v0Url, gemini: !!generatedHtml, lovablePrompt: true });

  } catch (error) {
    console.error('[Generate] Erreur globale:', error);
    return res.status(500).json({ error: error.message });
  }
}


// ==========================================
// PROMPT — Adapté au secteur
// ==========================================
function generateSitePrompt(data) {
  const secteurTips = {
    'Restaurant': "Mets en avant le menu, l'ambiance, la terrasse, les réservations. CTA : Réserver une table.",
    'Coiffeur': "Montre la galerie avant/après, les tarifs, la prise de RDV. CTA : Prendre rendez-vous.",
    'Coiffure / Beauté': "Montre la galerie avant/après, les tarifs, la prise de RDV. CTA : Prendre rendez-vous.",
    'Plombier': "Urgences 24h/24, zone d'intervention, devis gratuit. CTA : Appeler maintenant.",
    'Artisan / BTP': "Urgences, zone d'intervention, devis gratuit, réalisations. CTA : Demander un devis.",
    'Électricien': "Certifications, types d'interventions, devis rapide. CTA : Demander un devis.",
    'Boulangerie': "Produits phares, horaires, artisanat local. CTA : Voir nos spécialités.",
    'Garage / Auto': "Services auto, marques acceptées, prix transparents. CTA : Prendre rendez-vous.",
    'Pizzeria': "La carte des pizzas, ingrédients frais, livraison/emporter. CTA : Commander maintenant.",
    'Kebab / Snack': "Menu, produits frais, livraison rapide. CTA : Commander.",
    'Santé / Bien-être': "Spécialités, approche, prise de RDV. CTA : Prendre rendez-vous.",
    'Commerce / Boutique': "Produits phares, nouveautés, horaires. CTA : Découvrir nos produits.",
    'Service pro': "Expertise, réalisations, témoignages. CTA : Demander un devis.",
    'Sport / Loisirs': "Activités, planning, tarifs. CTA : Réserver une séance.",
    'Médecin': "Spécialité, secteur, prise en charge. CTA : Prendre rendez-vous.",
    'Avocat': "Domaines d'expertise, cabinet, premier contact. CTA : Consulter.",
  };
  const tip = secteurTips[data.secteur] || "Mets en avant les services, l'expérience et la localisation. CTA principal bien visible.";

  return `Crée un site vitrine professionnel pour "${data.nom_commerce}", un(e) ${data.secteur} situé(e) à ${data.commune}.

INFORMATIONS :
- Nom : ${data.nom_commerce}
- Gérant : ${data.prenom_gerant || 'Non renseigné'}
- Secteur : ${data.secteur}
- Localisation : ${data.commune}${data.adresse ? `, ${data.adresse}` : ''}
- Téléphone : ${data.telephone || 'Non renseigné'}
${data.description ? `- Description : ${data.description}` : ''}

DESIGN :
- Style : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Adaptées au secteur, chaleureuses et accueillantes'}

CONSEIL SECTEUR : ${tip}

PAGES :
${data.pages_souhaitees || '- Accueil avec hero section\n- Services / Prestations\n- À propos\n- Contact avec formulaire et carte'}

TECHNIQUE :
- Responsive mobile-first
- SEO local optimisé (${data.commune}, ${data.secteur})
- Bouton click-to-call visible
- Animations subtiles
- Google Maps intégré`;
}


// ==========================================
// v0 by Vercel — Platform API
// ==========================================
async function triggerV0(data, prompt) {
  const token = process.env.V0_API_TOKEN;
  console.log('[v0] Token présent:', !!token, '| Longueur:', token ? token.length : 0);
  if (!token) {
    console.log('[v0] Pas de token, skip');
    return null;
  }
  console.log('[v0] Envoi requête API...');
  const response = await fetch('https://api.v0.dev/v1/chats', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.V0_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: `${prompt}\n\nIMPORTANT : Utilise React avec Tailwind CSS. Design épuré, moderne, style startup. Textes en français.`
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`v0 API ${response.status}: ${err.substring(0, 200)}`);
  }
  const result = await response.json();
  console.log('[v0] Réponse brute:', JSON.stringify(result).substring(0, 300));
  return result.url || result.demo_url || (result.id ? `https://v0.dev/chat/${result.id}` : null);
}


// ==========================================
// Gemini 2.0 Flash — Génère un site HTML complet (GRATUIT)
// ==========================================
async function generateWithGemini(data, prompt) {
  const key = process.env.GEMINI_API_KEY;
  console.log('[Gemini] Clé API présente:', !!key);
  if (!key) {
    console.log('[Gemini] Pas de clé API, fallback Claude');
    return generateWithClaude(data, prompt);
  }

  const systemInstruction = `Tu es un expert en création de sites web vitrines pour des commerces locaux français.
Tu génères des sites de qualité agence, design 2025, qui donnent envie au commerçant de signer immédiatement.
Le template de référence pour ce secteur est "${TEMPLATE_MAP[data.secteur] || 'commerce'}". Inspire-toi de sa structure.
RÈGLES STRICTES :
- Réponds UNIQUEMENT avec le code HTML complet. Rien d'autre.
- Tout dans un seul fichier : CSS dans <style>, JS dans <script>
- Google Fonts (Inter ou Poppins)
- Mobile-first responsive
- Textes réalistes et professionnels en français
- PAS de backticks, PAS de markdown, PAS d'explication
- Design moderne, épuré, style 2025
- Animations CSS subtiles (fade-in, hover effects)
- SEO local optimisé (meta title, description, schema.org LocalBusiness)
- Bouton click-to-call fixe sur mobile
- Icônes via Unicode ou SVG inline (pas de CDN externe sauf Google Fonts)`;

  const userPrompt = `${prompt}

STRUCTURE DU SITE :
1. Header sticky avec logo texte + navigation + bouton CTA
2. Hero section plein écran avec titre accrocheur + sous-titre + CTA
3. Section services/prestations avec icônes et descriptions
4. Section à propos avec histoire du commerce
5. Section témoignages (3 avis fictifs réalistes avec prénoms locaux)
6. Section contact : formulaire + téléphone cliquable (${data.telephone}) + adresse + Google Maps embed
7. Footer avec horaires, liens, mentions légales

DESIGN : ${data.couleurs || 'Palette moderne adaptée au secteur, tons chauds'}
STYLE : ${data.style_souhaite || 'Moderne et professionnel'}
ADRESSE : ${data.commune}${data.adresse ? ', ' + data.adresse : ''}`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemInstruction }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 16384, temperature: 0.7 }
      })
    }
  );

  if (!response.ok) {
    const err = await response.text();
    console.error('[Gemini] Erreur API:', err.substring(0, 500));
    throw new Error(`Gemini API ${response.status}: ${err.substring(0, 200)}`);
  }

  const result = await response.json();
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('[Gemini] Contenu reçu:', text.length, 'chars');

  const cleaned = text
    .replace(/^```html\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/g, '')
    .trim();

  if (!cleaned.includes('<!DOCTYPE') && !cleaned.includes('<html')) {
    console.error('[Gemini] HTML invalide, début:', cleaned.substring(0, 200));
    throw new Error("Gemini n'a pas retourné du HTML valide");
  }
  return cleaned;
}

// ==========================================
// Claude API — Fallback si Gemini échoue
// ==========================================
async function generateWithClaude(data, prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.log('[Claude] Pas de clé API, skip');
    return null;
  }
  const systemPrompt = `Tu es un expert en création de sites web. Génère un site HTML complet en une seule réponse.
RÈGLES : Réponds UNIQUEMENT avec le HTML. Tout dans un fichier. CSS dans <style>, JS dans <script>. Google Fonts. Responsive. Textes réalistes en français. PAS de backticks ni markdown.`;

  const body = {
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: 'user', content: `${prompt}\n\nSite HTML complet avec : header sticky, hero section, services avec icônes, à propos, contact avec formulaire + téléphone cliquable (${data.telephone}), footer. Bouton appel fixe sur mobile. Couleurs : ${data.couleurs || 'adaptées au secteur'}. Adresse : ${data.commune}${data.adresse ? ', ' + data.adresse : ''}.` }]
  };

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.substring(0, 200)}`);
  }
  const result = await response.json();
  const cleaned = (result.content?.[0]?.text || '')
    .replace(/^```html\n?/i, '').replace(/^```\n?/, '').replace(/\n?```$/, '').trim();
  if (!cleaned.includes('<!DOCTYPE') && !cleaned.includes('<html')) {
    throw new Error("Claude n'a pas retourné du HTML valide");
  }
  return cleaned;
}


// ==========================================
// NOTION — Stocker le HTML Claude
// ==========================================
async function storeClaudeHtmlInNotion(pageId, html) {
  const chunks = [];
  for (let i = 0; i < html.length; i += 2000) {
    chunks.push(html.substring(i, i + 2000));
  }
  const blocks = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Site HTML généré par IA' } }] } },
    ...chunks.map(chunk => ({ object: 'block', type: 'code', code: { rich_text: [{ text: { content: chunk } }], language: 'html' } }))
  ];
  await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ children: blocks })
  });
}


// ==========================================
// NOTION — Mettre à jour les liens
// ==========================================
async function updateNotionWithSiteLinks(pageId, { v0Url, claudePreviewUrl }) {
  const properties = {};
  if (v0Url || claudePreviewUrl) {
    properties['Lien démo Lovable'] = { url: v0Url || claudePreviewUrl || null };
  }
  if (v0Url || claudePreviewUrl) {
    properties['Statut'] = { select: { name: 'Démo envoyée' } };
  }
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' },
    body: JSON.stringify({ properties })
  });
}


// ==========================================
// RESEND — Email admin
// ==========================================
function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendAdminEmail(data, { v0Url, generatedHtml, claudePreviewUrl, notionPageId }) {
  const s = { // sanitized data
    nom: esc(data.nom_commerce),
    gerant: esc(data.prenom_gerant),
    email: esc(data.email),
    tel: esc(data.telephone),
    secteur: esc(data.secteur),
    commune: esc(data.commune),
    budget: esc(data.budget),
    style: esc(data.style_souhaite),
  };
  const now = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const v0Block = v0Url
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #000;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#000;font-size:14px;">▲ V0 BY VERCEL — Aperçu React</p>
        <a href="${v0Url}" style="color:#3b82f6;font-size:13px;word-break:break-all;text-decoration:none;">${v0Url}</a>
        <br><a href="${v0Url}" style="display:inline-block;margin-top:10px;padding:8px 16px;background:#000;color:#fff;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600;">→ Ouvrir le preview v0</a>
       </div>`
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">▲ V0 — Non disponible</div>`;

  const claudeBlock = generatedHtml
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #C0784A;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#C0784A;font-size:14px;">🤖 CLAUDE AI — Site HTML complet</p>
        <p style="color:#555;font-size:13px;margin:0;">✅ ${Math.round(generatedHtml.length / 1024)} Ko</p>
        ${claudePreviewUrl ? `<a href="${claudePreviewUrl}" style="display:inline-block;margin-top:10px;padding:8px 16px;background:#C0784A;color:#fff;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600;">→ Ouvrir le preview Claude</a>` : ''}
      </div>`
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">🤖 Claude — Non disponible</div>`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;background:#fdfaf7;">
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 30px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">🔥 WebPrestige — Admin</h1>
        <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">Nouveau prospect • Sites générés</p>
      </div>
      <div style="padding:30px;background:#fff;">
        <h2 style="color:#2d2d2d;font-size:20px;margin:0 0 20px;">${s.nom}</h2>
        <div style="background:#fffbf5;padding:20px;border-radius:8px;border-left:4px solid #C0784A;margin-bottom:25px;">
          <table style="width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#888;width:130px;">Commerce</td><td style="color:#333;font-weight:600;">${s.nom}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Gérant</td><td style="color:#333;">${s.gerant || 'N/A'}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Email</td><td><a href="mailto:${s.email}" style="color:#C0784A;">${s.email || 'N/A'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Téléphone</td><td><a href="tel:${s.tel}" style="color:#C0784A;font-weight:600;">${s.tel}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Secteur</td><td style="color:#333;">${s.secteur}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Commune</td><td style="color:#333;">${s.commune}</td></tr>
            ${s.budget ? `<tr><td style="padding:6px 0;color:#888;">Budget</td><td style="color:#333;font-weight:600;">${s.budget}</td></tr>` : ''}
            ${s.style ? `<tr><td style="padding:6px 0;color:#888;">Style</td><td style="color:#333;">${s.style}</td></tr>` : ''}
          </table>
        </div>
        <h3 style="color:#2d2d2d;font-size:16px;margin:0 0 15px;">🎨 Sites générés :</h3>
        ${v0Block}
        ${claudeBlock}
        <div style="background:#f0fdf4;padding:16px;border-radius:8px;border-left:4px solid #22c55e;margin-top:20px;font-size:13px;color:#555;">
          ✅ Fiche enregistrée dans Notion<br>
          ✅ Email de confirmation envoyé au prospect<br>
          📧 Choisis le meilleur site et propose-le au client
        </div>
      </div>
      <div style="padding:20px 30px;text-align:center;background:#f8f4f0;border-radius:0 0 8px 8px;font-size:12px;color:#999;">
        WebPrestige Admin — ${now}
      </div>
    </div>`;

  const emailPayload = {
    from: 'WebPrestige Admin <onboarding@resend.dev>',
    to: ['benoit31.mathias@gmail.com'],
    subject: `${s.nom} (${s.secteur}) — Sites prets`,
    html
  };

  if (generatedHtml) {
    const filename = `${(data.nom_commerce || 'site').replace(/[^a-zA-Z0-9]/g, '-')}-claude.html`;
    emailPayload.attachments = [{
      filename,
      content: Buffer.from(generatedHtml).toString('base64'),
      content_type: 'text/html'
    }];
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(emailPayload)
  });
  const result = await r.json();
  if (!r.ok) throw new Error(`Resend admin: ${JSON.stringify(result)}`);
  return result.id;
}


// ==========================================
// WHATSAPP (optionnel)
// ==========================================
// ==========================================
// LOVABLE — Prompt optimisé
// ==========================================
function generateLovablePrompt(data) {
  const secteurDesigns = {
    'Restaurant': {
      style: 'warm dark theme, fond sombre #1a1a1a, accents cuivre #C0784A, ambiance tamisée',
      sections: 'menu avec catégories (entrées/plats/desserts) et prix, galerie photo ambiance, réservation click-to-call, horaires',
      cta: 'Réserver une table',
      images: 'photos de plats gastronomiques, intérieur de restaurant chaleureux, terrasse'
    },
    'Pizzeria': {
      style: 'warm red and cream theme, fond #FFF8F0, accents rouge #D32F2F et vert #388E3C italien',
      sections: 'carte des pizzas avec prix et ingrédients, formules midi, livraison/emporter, commande par téléphone',
      cta: 'Commander',
      images: 'pizzas artisanales, four à bois, ingrédients frais'
    },
    'Coiffeur': {
      style: 'elegant light theme, fond #FAFAF8, accents or #B8860B, typographie Playfair Display',
      sections: 'tarifs détaillés (coupe femme/homme, coloration, balayage, brushing), galerie avant/après, prise de RDV',
      cta: 'Prendre rendez-vous',
      images: 'coiffures élégantes, intérieur de salon moderne, outils de coiffure'
    },
    'Boulangerie': {
      style: 'warm artisan theme, fond crème #FDF8F0, accents brun #8B5E3C, typographie élégante',
      sections: 'nos pains (4 types avec prix), viennoiseries, pâtisseries, savoir-faire artisanal, horaires 6h30-19h30',
      cta: 'Découvrir nos produits',
      images: 'pains dorés, croissants, vitrine de pâtisserie, boulanger au travail'
    },
    'Plombier': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu confiance #1a56db, header sombre',
      sections: 'services (dépannage, installation, rénovation), zone intervention 20 villes autour, urgence 24h, devis gratuit, certifications RGE',
      cta: 'Devis gratuit',
      images: 'artisan au travail, outils professionnels, salle de bain rénovée'
    },
    'Artisan / BTP': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu #1a56db, bannière urgence rouge en haut',
      sections: 'services avec icônes, réalisations avec photos, zone intervention, devis gratuit, certifications',
      cta: 'Demander un devis',
      images: 'chantier propre, avant/après rénovation, équipe au travail'
    },
  };

  const design = secteurDesigns[data.secteur] || {
    style: 'modern clean theme, fond blanc, accents cuivre #C0784A',
    sections: 'services, à propos, témoignages, contact',
    cta: 'Nous contacter',
    images: 'photos professionnelles du commerce'
  };

  return `Crée un site vitrine professionnel et moderne pour "${data.nom_commerce}", un(e) ${data.secteur} situé(e) à ${data.commune}, France.

DESIGN :
- ${design.style}
- Mobile-first responsive
- Animations subtiles au scroll (fade-in)
- Header sticky avec navigation
- Bouton ${design.cta} bien visible dans le header et le hero
- Bouton click-to-call fixe en bas à droite sur mobile : tel:${data.telephone || '0600000000'}

SECTIONS DU SITE :
1. HERO plein écran : titre accrocheur "${data.nom_commerce}" + sous-titre "${data.secteur} à ${data.commune}" + bouton CTA "${design.cta}" + image de fond (utilise unsplash ou placeholder)
2. SERVICES : ${design.sections}
3. À PROPOS : histoire du commerce, ${data.prenom_gerant ? `géré par ${data.prenom_gerant}, ` : ''}passion et savoir-faire local à ${data.commune}
4. TÉMOIGNAGES : 3 avis clients réalistes avec prénoms français locaux (ex: Sophie L., Marc D., Claire B.) et 5 étoiles
5. CONTACT : téléphone cliquable ${data.telephone || '06 00 00 00 00'}, adresse ${data.commune}${data.adresse ? ' ' + data.adresse : ''}, horaires d'ouverture, formulaire simple (nom + tel + message), Google Maps embed placeholder
6. FOOTER : liens navigation, horaires résumés, mentions légales, "Site créé par WebPrestige"

INFORMATIONS COMMERCE :
- Nom : ${data.nom_commerce}
${data.prenom_gerant ? `- Gérant : ${data.prenom_gerant}` : ''}
- Secteur : ${data.secteur}
- Ville : ${data.commune}
${data.adresse ? `- Adresse : ${data.adresse}` : ''}
- Téléphone : ${data.telephone || 'Non renseigné'}
${data.description ? `- Description : ${data.description}` : ''}
- Style souhaité : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Adaptées au secteur'}

SEO :
- Title : "${data.nom_commerce} — ${data.secteur} à ${data.commune}"
- Meta description avec mots-clés locaux
- Schema.org LocalBusiness JSON-LD

IMPORTANT :
- Tous les textes en FRANÇAIS
- Utilise des images placeholder de haute qualité (unsplash)
- Le site doit donner envie au commerçant de l'acheter immédiatement
- Design professionnel niveau agence, pas un template basique
- ${design.images}`;
}

// ==========================================
// BOLT.NEW — Prompt optimisé
// ==========================================
function generateBoltPrompt(data) {
  const secteurDesigns = {
    'Restaurant': {
      style: 'warm dark theme, background #1a1a1a, copper accents #C0784A, cozy ambiance',
      sections: 'menu with categories (starters/mains/desserts) and prices, photo gallery, click-to-call reservation, hours',
      cta: 'Réserver une table',
      images: 'gastro food photos, warm restaurant interior, terrace'
    },
    'Pizzeria': {
      style: 'warm red and cream, background #FFF8F0, red #D32F2F and green #388E3C italian accents',
      sections: 'pizza menu with prices and ingredients, lunch deals, delivery/takeout, phone order',
      cta: 'Commander',
      images: 'artisan pizzas, wood-fired oven, fresh ingredients'
    },
    'Coiffeur': {
      style: 'elegant light theme, background #FAFAF8, gold accents #B8860B, Playfair Display font',
      sections: 'detailed pricing (women/men cut, coloring, highlights, blowdry), before/after gallery, booking',
      cta: 'Prendre rendez-vous',
      images: 'elegant hairstyles, modern salon interior, styling tools'
    },
    'Boulangerie': {
      style: 'warm artisan theme, cream background #FDF8F0, brown accents #8B5E3C',
      sections: 'breads (4 types with prices), pastries, artisan know-how, hours 6:30-19:30',
      cta: 'Découvrir nos produits',
      images: 'golden bread, croissants, pastry display, baker at work'
    },
    'Plombier': {
      style: 'professional trust theme, background #f8f9fa, blue accents #1a56db, dark header',
      sections: 'services (repair, installation, renovation), 20-city coverage, 24h emergency, free quote, RGE certified',
      cta: 'Devis gratuit',
      images: 'craftsman at work, professional tools, renovated bathroom'
    },
    'Artisan / BTP': {
      style: 'professional trust theme, background #f8f9fa, blue #1a56db, red emergency banner',
      sections: 'services with icons, project gallery, coverage area, free quote, certifications',
      cta: 'Demander un devis',
      images: 'clean worksite, before/after renovation, team at work'
    },
  };

  const design = secteurDesigns[data.secteur] || {
    style: 'modern clean theme, white background, copper accents #C0784A',
    sections: 'services, about, testimonials, contact',
    cta: 'Nous contacter',
    images: 'professional business photos'
  };

  return `Build a professional business website for "${data.nom_commerce}", a ${data.secteur} located in ${data.commune}, France.

Use React, Tailwind CSS, and shadcn/ui components.

DESIGN:
- ${design.style}
- Mobile-first responsive
- Subtle scroll animations (fade-in)
- Sticky header with navigation
- Visible "${design.cta}" button in header and hero
- Fixed click-to-call button bottom-right on mobile: tel:${data.telephone || '0600000000'}

SECTIONS:
1. HERO: full-screen, catchy title "${data.nom_commerce}", subtitle "${data.secteur} à ${data.commune}", CTA "${design.cta}", background image (unsplash placeholder)
2. SERVICES: ${design.sections}
3. ABOUT: business story, ${data.prenom_gerant ? `run by ${data.prenom_gerant}, ` : ''}local expertise in ${data.commune}
4. TESTIMONIALS: 3 realistic French reviews (Sophie L., Marc D., Claire B.) with 5 stars
5. CONTACT: clickable phone ${data.telephone || '06 00 00 00 00'}, address ${data.commune}${data.adresse ? ' ' + data.adresse : ''}, opening hours, simple form (name + phone + message), Google Maps embed
6. FOOTER: nav links, hours, legal, "Site créé par WebPrestige"

BUSINESS INFO:
- Name: ${data.nom_commerce}
${data.prenom_gerant ? `- Owner: ${data.prenom_gerant}` : ''}
- Sector: ${data.secteur}
- City: ${data.commune}
${data.adresse ? `- Address: ${data.adresse}` : ''}
- Phone: ${data.telephone || 'N/A'}
${data.description ? `- Description: ${data.description}` : ''}
- Style: ${data.style_souhaite || 'Modern and professional'}
- Colors: ${data.couleurs || 'Sector-appropriate'}

SEO:
- Title: "${data.nom_commerce} — ${data.secteur} à ${data.commune}"
- Meta description with local keywords
- Schema.org LocalBusiness JSON-LD

IMPORTANT:
- All text in FRENCH
- Use high-quality placeholder images (unsplash)
- Professional agency-level design
- ${design.images}`;
}


// ==========================================
// WEBSIM.AI — Prompt optimisé (HTML/CSS/JS pur)
// ==========================================
function generateWebsimPrompt(data) {
  const secteurDesigns = {
    'Restaurant': {
      style: 'warm dark theme, fond sombre #1a1a1a, accents cuivre #C0784A',
      sections: 'menu avec catégories et prix, galerie photo, réservation click-to-call, horaires',
      cta: 'Réserver une table'
    },
    'Pizzeria': {
      style: 'warm red and cream, fond #FFF8F0, accents rouge #D32F2F et vert #388E3C',
      sections: 'carte des pizzas avec prix, formules midi, livraison/emporter',
      cta: 'Commander'
    },
    'Coiffeur': {
      style: 'elegant light theme, fond #FAFAF8, accents or #B8860B',
      sections: 'tarifs détaillés, galerie avant/après, prise de RDV',
      cta: 'Prendre rendez-vous'
    },
    'Boulangerie': {
      style: 'warm artisan theme, fond crème #FDF8F0, accents brun #8B5E3C',
      sections: 'nos pains et viennoiseries avec prix, savoir-faire artisanal, horaires',
      cta: 'Découvrir nos produits'
    },
    'Plombier': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu #1a56db',
      sections: 'services, zone intervention, urgence 24h, devis gratuit',
      cta: 'Devis gratuit'
    },
    'Artisan / BTP': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu #1a56db',
      sections: 'services avec icônes, réalisations, zone intervention, devis gratuit',
      cta: 'Demander un devis'
    },
  };

  const design = secteurDesigns[data.secteur] || {
    style: 'modern clean theme, fond blanc, accents cuivre #C0784A',
    sections: 'services, à propos, témoignages, contact',
    cta: 'Nous contacter'
  };

  return `Single HTML file with inline CSS and JS. Site vitrine professionnel pour "${data.nom_commerce}", ${data.secteur} à ${data.commune}, France.

PAS de React, PAS de framework. HTML pur + CSS dans <style> + JS dans <script>. Google Fonts (Inter ou Poppins).

DESIGN : ${design.style}
- Responsive mobile-first avec media queries
- Animations CSS (fade-in au scroll avec IntersectionObserver)
- Header sticky avec navigation
- Bouton "${design.cta}" visible dans le header et le hero
- Bouton click-to-call fixe en bas à droite sur mobile : tel:${data.telephone || '0600000000'}

SECTIONS :
1. HERO plein écran : titre "${data.nom_commerce}" + sous-titre "${data.secteur} à ${data.commune}" + CTA "${design.cta}"
2. SERVICES : ${design.sections}
3. À PROPOS : histoire du commerce${data.prenom_gerant ? `, géré par ${data.prenom_gerant}` : ''}, savoir-faire local
4. TÉMOIGNAGES : 3 avis clients réalistes (Sophie L., Marc D., Claire B.) avec 5 étoiles
5. CONTACT : tel cliquable ${data.telephone || '06 00 00 00 00'}, adresse ${data.commune}${data.adresse ? ' ' + data.adresse : ''}, formulaire (nom + tel + message)
6. FOOTER : liens, horaires, mentions légales, "Site créé par WebPrestige"

INFOS :
- Nom : ${data.nom_commerce}
${data.prenom_gerant ? `- Gérant : ${data.prenom_gerant}` : ''}
- Secteur : ${data.secteur}
- Ville : ${data.commune}
${data.adresse ? `- Adresse : ${data.adresse}` : ''}
- Tél : ${data.telephone || 'Non renseigné'}
${data.description ? `- Description : ${data.description}` : ''}
- Style : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Adaptées au secteur'}

SEO : meta title "${data.nom_commerce} — ${data.secteur} à ${data.commune}", meta description, Schema.org LocalBusiness JSON-LD.

Textes en FRANÇAIS. Design pro niveau agence.`;
}


// ==========================================
// CURSOR / CLAUDE CODE — Prompt optimisé (spec technique détaillée)
// ==========================================
function generateCursorPrompt(data) {
  const secteurDesigns = {
    'Restaurant': {
      style: 'warm dark theme, fond sombre #1a1a1a, accents cuivre #C0784A, ambiance tamisée',
      sections: 'menu avec catégories (entrées/plats/desserts) et prix, galerie photo ambiance, réservation click-to-call, horaires',
      cta: 'Réserver une table',
      images: 'photos de plats gastronomiques, intérieur de restaurant chaleureux, terrasse'
    },
    'Pizzeria': {
      style: 'warm red and cream theme, fond #FFF8F0, accents rouge #D32F2F et vert #388E3C italien',
      sections: 'carte des pizzas avec prix et ingrédients, formules midi, livraison/emporter, commande par téléphone',
      cta: 'Commander',
      images: 'pizzas artisanales, four à bois, ingrédients frais'
    },
    'Coiffeur': {
      style: 'elegant light theme, fond #FAFAF8, accents or #B8860B, typographie Playfair Display',
      sections: 'tarifs détaillés (coupe femme/homme, coloration, balayage, brushing), galerie avant/après, prise de RDV',
      cta: 'Prendre rendez-vous',
      images: 'coiffures élégantes, intérieur de salon moderne, outils de coiffure'
    },
    'Boulangerie': {
      style: 'warm artisan theme, fond crème #FDF8F0, accents brun #8B5E3C, typographie élégante',
      sections: 'nos pains (4 types avec prix), viennoiseries, pâtisseries, savoir-faire artisanal, horaires 6h30-19h30',
      cta: 'Découvrir nos produits',
      images: 'pains dorés, croissants, vitrine de pâtisserie, boulanger au travail'
    },
    'Plombier': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu confiance #1a56db, header sombre',
      sections: 'services (dépannage, installation, rénovation), zone intervention 20 villes autour, urgence 24h, devis gratuit, certifications RGE',
      cta: 'Devis gratuit',
      images: 'artisan au travail, outils professionnels, salle de bain rénovée'
    },
    'Artisan / BTP': {
      style: 'professional trust theme, fond #f8f9fa, accents bleu #1a56db, bannière urgence rouge en haut',
      sections: 'services avec icônes, réalisations avec photos, zone intervention, devis gratuit, certifications',
      cta: 'Demander un devis',
      images: 'chantier propre, avant/après rénovation, équipe au travail'
    },
  };

  const design = secteurDesigns[data.secteur] || {
    style: 'modern clean theme, fond blanc, accents cuivre #C0784A',
    sections: 'services, à propos, témoignages, contact',
    cta: 'Nous contacter',
    images: 'photos professionnelles du commerce'
  };

  return `# Spec technique — Site vitrine "${data.nom_commerce}"

## Projet
Site vitrine professionnel pour "${data.nom_commerce}", ${data.secteur} à ${data.commune}, France.

## Structure des fichiers
\`\`\`
/
├── index.html          # Page principale, HTML sémantique
├── style.css           # Styles CSS (responsive mobile-first)
├── script.js           # JavaScript (animations, formulaire, navigation)
├── netlify.toml        # Configuration Netlify
└── assets/
    └── (images placeholder)
\`\`\`

## netlify.toml
\`\`\`toml
[build]
  publish = "."

[[headers]]
  for = "/*"
  [headers.values]
    X-Frame-Options = "DENY"
    X-Content-Type-Options = "nosniff"
    Referrer-Policy = "strict-origin-when-cross-origin"
\`\`\`

## Design
- ${design.style}
- Google Fonts : Inter (body) + Playfair Display (titres)
- Mobile-first responsive avec breakpoints : 768px, 1024px, 1280px
- Animations au scroll avec IntersectionObserver (fade-in, slide-up)
- Header sticky avec navigation smooth-scroll
- Bouton "${design.cta}" dans le header et le hero
- Bouton click-to-call fixe position:fixed bottom-right sur mobile : tel:${data.telephone || '0600000000'}

## Sections (index.html)
1. **Header** : logo texte "${data.nom_commerce}" + nav (Accueil, Services, À propos, Contact) + bouton CTA
2. **Hero** : plein écran, titre accrocheur + sous-titre "${data.secteur} à ${data.commune}" + CTA "${design.cta}" + image de fond
3. **Services** : ${design.sections}
4. **À propos** : histoire du commerce${data.prenom_gerant ? `, géré par ${data.prenom_gerant}` : ''}, savoir-faire local à ${data.commune}
5. **Témoignages** : 3 avis clients réalistes avec prénoms français (Sophie L., Marc D., Claire B.) et 5 étoiles
6. **Contact** : téléphone cliquable ${data.telephone || '06 00 00 00 00'}, adresse ${data.commune}${data.adresse ? ' ' + data.adresse : ''}, horaires, formulaire (nom + tel + message), Google Maps embed
7. **Footer** : liens navigation, horaires résumés, mentions légales, "Site créé par WebPrestige"

## Informations commerce
- Nom : ${data.nom_commerce}
${data.prenom_gerant ? `- Gérant : ${data.prenom_gerant}` : ''}
- Secteur : ${data.secteur}
- Ville : ${data.commune}
${data.adresse ? `- Adresse : ${data.adresse}` : ''}
- Téléphone : ${data.telephone || 'Non renseigné'}
${data.description ? `- Description : ${data.description}` : ''}
- Style : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Adaptées au secteur'}

## SEO
- \`<title>\` : "${data.nom_commerce} — ${data.secteur} à ${data.commune}"
- Meta description avec mots-clés locaux (${data.commune}, ${data.secteur})
- Schema.org LocalBusiness JSON-LD dans le \`<head>\`
- Balises Open Graph pour partage réseaux sociaux
- Sitemap.xml basique

## JavaScript (script.js)
- Navigation responsive (hamburger menu mobile)
- Smooth scroll vers les sections
- IntersectionObserver pour animations fade-in au scroll
- Formulaire de contact : validation côté client + envoi (Netlify Forms ou mailto fallback)
- Lazy loading des images

## CSS (style.css)
- CSS custom properties pour les couleurs du thème
- Mobile-first avec min-width media queries
- Flexbox et Grid pour les layouts
- Transitions et animations keyframes
- ${design.images}

## Déploiement Netlify
1. \`git init && git add . && git commit -m "Initial"\`
2. Push vers GitHub
3. Connecter le repo à Netlify
4. Build command : (aucune, site statique)
5. Publish directory : \`.\`
6. Configurer le domaine personnalisé

Textes en FRANÇAIS. Design professionnel niveau agence.`;
}


async function storeAllPromptsInNotion(pageId, lovablePrompt, boltPrompt, websimPrompt, cursorPrompt) {
  const prompts = [
    { heading: 'Prompt Lovable', text: lovablePrompt },
    { heading: 'Prompt Bolt.new', text: boltPrompt },
    { heading: 'Prompt Websim.ai', text: websimPrompt },
    { heading: 'Prompt Cursor/Claude', text: cursorPrompt },
  ];

  const blocks = [];
  for (const { heading, text } of prompts) {
    blocks.push({
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: heading } }] }
    });
    // Chunk prompt into 2000-char blocks for Notion limit
    for (let i = 0; i < text.length; i += 2000) {
      blocks.push({
        object: 'block', type: 'code',
        code: { rich_text: [{ text: { content: text.substring(i, i + 2000) } }], language: 'plain text' }
      });
    }
  }

  // Notion API accepts max 100 blocks per request, batch if needed
  for (let i = 0; i < blocks.length; i += 100) {
    const batch = blocks.slice(i, i + 100);
    const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ children: batch })
    });
    if (!response.ok) throw new Error('Notion store failed: ' + response.status);
  }
}

// Keep legacy function for backward compatibility
async function storeLovablePromptInNotion(pageId, prompt) {
  const chunks = [];
  for (let i = 0; i < prompt.length; i += 2000) {
    chunks.push(prompt.substring(i, i + 2000));
  }
  const blocks = [
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Prompt Lovable — Copier-coller dans lovable.dev' } }] } },
    ...chunks.map(chunk => ({
      object: 'block', type: 'code',
      code: { rich_text: [{ text: { content: chunk } }], language: 'plain text' }
    }))
  ];
  const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({ children: blocks })
  });
  if (!response.ok) throw new Error('Notion store failed: ' + response.status);
}

async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE;
  if (!phone) return;
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) return;
  const encodedMsg = encodeURIComponent(message);
  await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`);
}
