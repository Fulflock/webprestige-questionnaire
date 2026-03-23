// Vercel Serverless Function — WebPrestige Pipeline (Étape 2)
// Génération des sites v0 + Claude + email admin
// Appelé par submit.js en fire-and-forget
// Timeout : 60s max (Vercel Hobby)

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { notionPageId, data } = req.body;
  if (!notionPageId || !data) {
    return res.status(400).json({ error: 'notionPageId et data requis' });
  }

  console.log('[Generate] Démarrage pour', data.nom_commerce, '| Page:', notionPageId);

  // Réponse immédiate — le travail continue après
  res.status(200).json({ started: true });

  try {
    // ==========================================
    // 1. GÉNÉRER LE PROMPT
    // ==========================================
    const prompt = generateSitePrompt(data);

    // ==========================================
    // 2. GÉNÉRATION EN PARALLÈLE : v0 + Claude
    // ==========================================
    const [v0Result, claudeResult] = await Promise.allSettled([
      triggerV0(data, prompt),
      generateWithClaude(data, prompt)
    ]);

    const v0Url = v0Result.status === 'fulfilled' ? v0Result.value : null;
    const claudeHtml = claudeResult.status === 'fulfilled' ? claudeResult.value : null;

    if (v0Url) console.log('[v0] OK:', v0Url);
    else console.error('[v0] Erreur:', v0Result.reason?.message);

    if (claudeHtml) console.log('[Claude] OK:', claudeHtml.length, 'chars');
    else console.error('[Claude] Erreur:', claudeResult.reason?.message);

    // ==========================================
    // 3. STOCKER DANS NOTION
    // ==========================================
    let claudePreviewUrl = null;
    try {
      if (claudeHtml) {
        await storeClaudeHtmlInNotion(notionPageId, claudeHtml);
        claudePreviewUrl = `https://webprestige-questionnaire.vercel.app/api/preview?id=${notionPageId}`;
        console.log('[Notion] Claude HTML stocké, preview:', claudePreviewUrl);
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
      await sendAdminEmail(data, { v0Url, claudeHtml, claudePreviewUrl, notionPageId });
      console.log('[Admin Email] OK —', v0Url ? 'v0 OK' : 'v0 FAIL', '|', claudeHtml ? 'Claude OK' : 'Claude FAIL');
    } catch (e) {
      console.error('[Admin Email] Erreur:', e.message);
    }

    // ==========================================
    // 5. WHATSAPP (optionnel)
    // ==========================================
    if (process.env.CALLMEBOT_API_KEY) {
      await sendWhatsApp(
        `🔥 *Nouveau prospect WebPrestige !*\n\n` +
        `🏪 *${data.nom_commerce}* (${data.secteur})\n` +
        `📍 ${data.commune}\n` +
        `📞 ${data.telephone}\n\n` +
        `${v0Url ? `▲ v0: ${v0Url}\n` : ''}` +
        `${claudeHtml ? `🤖 Claude: site HTML généré\n` : ''}` +
        `📧 Email admin envoyé`
      ).catch(e => console.error('[WhatsApp] Erreur:', e.message));
    }

    console.log('[Generate] Pipeline terminé pour', data.nom_commerce);

  } catch (error) {
    console.error('[Generate] Erreur globale:', error);
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
  if (!process.env.V0_API_TOKEN) {
    console.log('[v0] Pas de token, skip');
    return null;
  }
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
// Claude API — Génère un site HTML complet
// ==========================================
async function generateWithClaude(data, prompt) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Claude] Pas de clé API, skip');
    return null;
  }
  const systemPrompt = `Tu es un expert en création de sites web. Tu génères des sites HTML complets, beaux et fonctionnels en une seule réponse.

RÈGLES ABSOLUES :
- Réponds UNIQUEMENT avec le code HTML (commence par <!DOCTYPE html>)
- Tout doit être dans un seul fichier : CSS dans <style>, JS dans <script>
- Utilise Google Fonts pour la typographie
- Design professionnel, moderne, responsive (mobile-first)
- Textes de contenu réalistes en français (PAS de Lorem Ipsum)
- Couleurs harmonieuses et adaptées au secteur
- Animations CSS subtiles
- PAS de backticks, PAS de markdown, PAS d'explications — uniquement le HTML`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      system: systemPrompt,
      messages: [{ role: 'user', content: `${prompt}

INSTRUCTIONS TECHNIQUES :
- Site complet en HTML/CSS/JS vanilla dans un seul fichier
- Header sticky avec logo + navigation
- Section Hero avec titre accrocheur, sous-titre et bouton CTA
- Section Services/Prestations avec icônes (utilise des emoji ou Font Awesome CDN)
- Section À propos avec histoire du commerce
- Section Contact avec formulaire + adresse + téléphone cliquable
- Footer avec infos légales
- Bouton "Appel rapide" fixe en bas sur mobile
- Schema.org JSON-LD pour le SEO local
- Couleurs : ${data.couleurs || 'adapte au secteur'}
- Téléphone à intégrer : ${data.telephone}
- Adresse : ${data.commune}${data.adresse ? ', ' + data.adresse : ''}

Génère maintenant le HTML complet.` }]
    })
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.substring(0, 200)}`);
  }
  const result = await response.json();
  const htmlContent = result.content?.[0]?.text || '';
  const cleaned = htmlContent
    .replace(/^```html\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '')
    .trim();
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
    { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Site HTML généré par Claude' } }] } },
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
async function sendAdminEmail(data, { v0Url, claudeHtml, claudePreviewUrl, notionPageId }) {
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

  const claudeBlock = claudeHtml
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #C0784A;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#C0784A;font-size:14px;">🤖 CLAUDE AI — Site HTML complet</p>
        <p style="color:#555;font-size:13px;margin:0;">✅ ${Math.round(claudeHtml.length / 1024)} Ko</p>
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
        <h2 style="color:#2d2d2d;font-size:20px;margin:0 0 20px;">🎯 ${data.nom_commerce}</h2>
        <div style="background:#fffbf5;padding:20px;border-radius:8px;border-left:4px solid #C0784A;margin-bottom:25px;">
          <table style="width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#888;width:130px;">Commerce</td><td style="color:#333;font-weight:600;">${data.nom_commerce}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Gérant</td><td style="color:#333;">${data.prenom_gerant || 'N/A'}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Email</td><td><a href="mailto:${data.email}" style="color:#C0784A;">${data.email || 'N/A'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Téléphone</td><td><a href="tel:${data.telephone}" style="color:#C0784A;font-weight:600;">${data.telephone}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Secteur</td><td style="color:#333;">${data.secteur}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Commune</td><td style="color:#333;">${data.commune}</td></tr>
            ${data.budget ? `<tr><td style="padding:6px 0;color:#888;">Budget</td><td style="color:#333;font-weight:600;">${data.budget}</td></tr>` : ''}
            ${data.style_souhaite ? `<tr><td style="padding:6px 0;color:#888;">Style</td><td style="color:#333;">${data.style_souhaite}</td></tr>` : ''}
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
    subject: `🔥 ${data.nom_commerce} (${data.secteur}) — Sites prêts`,
    html
  };

  if (claudeHtml) {
    const filename = `${(data.nom_commerce || 'site').replace(/[^a-zA-Z0-9]/g, '-')}-claude.html`;
    emailPayload.attachments = [{
      filename,
      content: Buffer.from(claudeHtml).toString('base64'),
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
async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE || '33627941715';
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) return;
  const encodedMsg = encodeURIComponent(message);
  await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`);
}
