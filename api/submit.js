// Vercel Serverless Function â WebPrestige Pipeline
// 1. Sauvegarde dans Notion
// 2. Email de confirmation au prospect (via Resend)
// 3. GÃ©nÃ©ration de 2 sites en parallÃ¨le :
//    - v0 by Vercel (Platform API â lien de prÃ©view cliquable)
//    - Claude API (HTML complet â piÃ¨ce jointe email)
// 3b. Email admin IMMÃDIAT Ã  benjamin31.mathias@gmail.com (avant gÃ©nÃ©ration)
// 4. GÃ©nÃ©ration sites en arriÃ¨re-plan (v0 + Claude)
// 5. WhatsApp si CALLMEBOT_API_KEY configurÃ©

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const data = req.body;
    console.log('[WebPrestige] Nouvelle soumission:', data.nom_commerce);

    // ==========================================
    // 1. SAUVEGARDE NOTION
    // ==========================================
    let notionPageId = null;
    try {
      const notionResponse = await saveToNotion(data);
      notionPageId = notionResponse?.id;
      console.log('[Notion] â SauvegardÃ©:', notionPageId);
    } catch (e) {
      console.error('[Notion] â Erreur:', e.message);
    }

    // ==========================================
    // 2. EMAIL CONFIRMATION PROSPECT
    // ==========================================
    let emailId = null;
    if (data.email) {
      try {
        emailId = await sendConfirmationEmail(data);
        console.log('[Resend] â Email prospect envoyÃ©:', emailId);
        if (emailId && notionPageId) {
          await updateNotionEmailTracking(notionPageId, emailId).catch(() => {});
        }
      } catch (e) {
        console.error('[Resend] â Email prospect Ã©chouÃ©:', e.message);
      }
    }

    // ==========================================
    // 3. EMAIL ADMIN IMMÃDIAT (avant gÃ©nÃ©ration)
    // EnvoyÃ© tout de suite pour Ã©viter le timeout Vercel (10s Hobby)
    // Resend Free : onboarding@resend.dev â only to account email
    // TODO: changer vers benoit31.mathias@gmail.com aprÃ¨s vÃ©rif domaine Resend
    // ==========================================
    try {
      await sendAdminEmail(data, { v0Url: null, claudeHtml: null, notionPageId });
      console.log('[Admin Email] â EnvoyÃ© immÃ©diatement (avant gÃ©nÃ©ration)');
    } catch (e) {
      console.error('[Admin Email] â Erreur:', e.message);
    }

    // ==========================================
    // 4. RÃPONSE IMMÃDIATE (avant gÃ©nÃ©ration longue)
    // Vercel continue d'exÃ©cuter aprÃ¨s res.json() â no timeout cÃ´tÃ© client
    // ==========================================
    res.status(200).json({
      success: true,
      notionId: notionPageId,
      emailSent: !!emailId,
      processing: true
    });

    // ==========================================
    // 5. GÃNÃRATION DES SITES EN ARRIÃRE-PLAN
    // (la fonction continue aprÃ¨s res.json())
    // ==========================================
    const prompt = generateSitePrompt(data);
    console.log('[WebPrestige] Lancement gÃ©nÃ©ration v0 + Claude...');

    const [v0Result, claudeResult] = await Promise.allSettled([
      triggerV0(data, prompt),
      generateWithClaude(data, prompt)
    ]);

    const v0Url = v0Result.status === 'fulfilled' ? v0Result.value : null;
    const claudeHtml = claudeResult.status === 'fulfilled' ? claudeResult.value : null;

    if (v0Result.status === 'rejected') console.error('[v0] â', v0Result.reason?.message);
    if (claudeResult.status === 'rejected') console.error('[Claude] â', claudeResult.reason?.message);

    console.log('[v0] URL:', v0Url || 'null');
    console.log('[Claude] HTML gÃ©nÃ©rÃ©:', claudeHtml ? `${claudeHtml.length} chars` : 'null');

    // ==========================================
    // 6. WHATSAPP (optionnel)
    // ==========================================
    if (process.env.CALLMEBOT_API_KEY) {
      await sendWhatsApp(
        `ð¥ *Nouveau prospect WebPrestige !*\n\n` +
        `ðª *${data.nom_commerce}* (${data.secteur})\n` +
        `ð ${data.commune}\n` +
        `ð ${data.telephone}\n\n` +
        `${v0Url ? `â² v0: ${v0Url}\n` : ''}` +
        `${claudeHtml ? `ð¤ Claude HTML: joint en email\n` : ''}` +
        `ð§ Email admin envoyÃ© â`
      ).catch(e => console.error('[WhatsApp] â', e.message));
    }

  } catch (error) {
    console.error('[WebPrestige] Erreur globale:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
}


// ==========================================
// NOTION â Sauvegarde prospect
// ==========================================
async function saveToNotion(data) {
  const response = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      parent: { database_id: process.env.NOTION_DATABASE_ID },
      properties: {
        'Commerce': { title: [{ text: { content: data.nom_commerce || '' } }] },
        'Secteur': { select: { name: data.secteur || 'Restaurant' } },
        'Commune': { rich_text: [{ text: { content: data.commune || '' } }] },
        'Adresse': { rich_text: [{ text: { content: data.adresse || '' } }] },
        'TÃ©lÃ©phone': { phone_number: data.telephone || '' },
        'Email': { email: data.email || null },
        'Note Google': { rich_text: [{ text: { content: data.note_google || '' } }] },
        'PrioritÃ©': { select: { name: 'ð¥ Chaud' } },
        'Statut': { select: { name: 'ð Nouveau' } },
        'Notes': { rich_text: [{ text: { content: buildNotesFromData(data) } }] },
        'PrÃ©nom gÃ©rant': { rich_text: [{ text: { content: data.prenom_gerant || '' } }] },
        'Budget': { rich_text: [{ text: { content: data.budget || '' } }] },
        'Date contact': { date: { start: new Date().toISOString().split('T')[0] } }
      }
    })
  });
  if (!response.ok) throw new Error(`Notion ${response.status}: ${await response.text()}`);
  return response.json();
}

function buildNotesFromData(data) {
  const parts = [];
  if (data.style_souhaite) parts.push(`Style: ${data.style_souhaite}`);
  if (data.couleurs) parts.push(`Couleurs: ${data.couleurs}`);
  if (data.pages_souhaitees) parts.push(`Pages: ${data.pages_souhaitees}`);
  if (data.description) parts.push(`Description: ${data.description}`);
  if (data.budget) parts.push(`Budget: ${data.budget}`);
  return parts.join(' | ') || 'Via questionnaire WebPrestige';
}


// ==========================================
// RESEND â Email confirmation prospect
// ==========================================
async function sendConfirmationEmail(data) {
  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#C0784A,#A0623A);padding:40px 30px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">WebPrestige</h1>
        <p style="color:#f5e6d8;margin:8px 0 0;font-size:14px;">Votre vitrine digitale, clÃ© en main</p>
      </div>
      <div style="padding:40px 30px;background:#fff;">
        <h2 style="color:#2d2d2d;font-size:22px;margin:0 0 20px;">Merci ${data.prenom_gerant || ''} ! ð</h2>
        <p style="color:#555;font-size:16px;line-height:1.6;">
          Nous avons bien reÃ§u vos rÃ©ponses pour <strong style="color:#C0784A;">${data.nom_commerce}</strong>.
        </p>
        <div style="background:linear-gradient(135deg,#fdf8f4,#fef5ee);border-left:4px solid #C0784A;padding:20px;border-radius:0 8px 8px 0;margin:25px 0;">
          <p style="color:#333;font-size:16px;margin:0;font-weight:600;">â¨ Votre site est dÃ©jÃ  en cours de crÃ©ation !</p>
          <p style="color:#666;font-size:14px;margin:10px 0 0;">
            Notre Ã©quipe prÃ©pare plusieurs propositions de design sur-mesure pour votre activitÃ©.
            Vous recevrez trÃ¨s prochainement un aperÃ§u personnalisÃ©.
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:15px 0;">
          <tr><td style="padding:10px 15px;background:#fdf8f4;color:#888;font-size:13px;width:140px;">Commerce</td><td style="padding:10px 15px;background:#fdf8f4;color:#333;font-size:14px;font-weight:600;">${data.nom_commerce}</td></tr>
          <tr><td style="padding:10px 15px;color:#888;font-size:13px;">Secteur</td><td style="padding:10px 15px;color:#333;font-size:14px;">${data.secteur}</td></tr>
          <tr><td style="padding:10px 15px;background:#fdf8f4;color:#888;font-size:13px;">Commune</td><td style="padding:10px 15px;background:#fdf8f4;color:#333;font-size:14px;">${data.commune}</td></tr>
          ${data.style_souhaite ? `<tr><td style="padding:10px 15px;color:#888;font-size:13px;">Style</td><td style="padding:10px 15px;color:#333;font-size:14px;">${data.style_souhaite}</td></tr>` : ''}
        </table>
        <p style="color:#555;font-size:15px;line-height:1.6;margin:20px 0 5px;">
          On revient vers vous trÃ¨s vite avec une proposition qui vous ressemble. ðª
        </p>
      </div>
      <div style="padding:25px 30px;text-align:center;background:#f8f4f0;border-radius:0 0 8px 8px;">
        <p style="color:#999;font-size:12px;margin:0;">WebPrestige â Sites vitrines pour professionnels<br>RÃ©gion Toulouse | contact@webprestige.fr</p>
      </div>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'WebPrestige <onboarding@resend.dev>',
      to: [data.email],
      subject: `â¨ ${data.nom_commerce} â Votre site est en cours de crÃ©ation !`,
      html
    })
  });
  const result = await res.json();
  return result.id;
}


// ==========================================
// NOTION â Mise Ã  jour tracking email
// ==========================================
async function updateNotionEmailTracking(pageId, emailId) {
  await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28'
    },
    body: JSON.stringify({
      properties: {
        'Statut': { select: { name: 'ð§ ContactÃ©' } },
        'Notes': { rich_text: [{ text: { content: `Email confirmation envoyÃ© (Resend: ${emailId})` } }] }
      }
    })
  });
}


// ==========================================
// PROMPT â AdaptÃ© au secteur
// ==========================================
function generateSitePrompt(data) {
  const secteurTips = {
    'Restaurant': 'Mets en avant le menu, l\'ambiance, la terrasse, les rÃ©servations. CTA : "RÃ©server une table".',
    'Coiffeur': 'Montre la galerie avant/aprÃ¨s, les tarifs, la prise de RDV. CTA : "Prendre rendez-vous".',
    'Plombier': 'Urgences 24h/24, zone d\'intervention, devis gratuit. CTA : "Appeler maintenant".',
    'Ãlectricien': 'Certifications, types d\'interventions, devis rapide. CTA : "Demander un devis".',
    'Boulangerie': 'Produits phares, horaires, artisanat local. CTA : "Voir nos spÃ©cialitÃ©s".',
    'Garage': 'Services auto, marques acceptÃ©es, prix transparents. CTA : "Prendre rendez-vous".',
    'MÃ©decin': 'SpÃ©cialitÃ©, secteur, prise en charge. CTA : "Prendre rendez-vous".',
    'Avocat': 'Domaines d\'expertise, cabinet, premier contact. CTA : "Consulter".',
  };

  const tip = secteurTips[data.secteur] || `Mets en avant les services, l'expÃ©rience et la localisation. CTA principal bien visible.`;

  return `CrÃ©e un site vitrine professionnel pour "${data.nom_commerce}", un(e) ${data.secteur} situÃ©(e) Ã  ${data.commune}.

INFORMATIONS :
- Nom : ${data.nom_commerce}
- GÃ©rant : ${data.prenom_gerant || 'Non renseignÃ©'}
- Secteur : ${data.secteur}
- Localisation : ${data.commune}${data.adresse ? `, ${data.adresse}` : ''}
- TÃ©lÃ©phone : ${data.telephone || 'Non renseignÃ©'}
${data.description ? `- Description : ${data.description}` : ''}

DESIGN :
- Style : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'AdaptÃ©es au secteur, chaleureuses et accueillantes'}

CONSEIL SECTEUR : ${tip}

PAGES :
${data.pages_souhaitees || '- Accueil avec hero section\n- Services / Prestations\n- Ã propos\n- Contact avec formulaire et carte'}

TECHNIQUE :
- Responsive mobile-first
- SEO local optimisÃ© (${data.commune}, ${data.secteur})
- Bouton click-to-call visible
- Animations subtiles
- Google Maps intÃ©grÃ©`;
}


// ==========================================
// v0 by Vercel â Platform API
// POST /v1/chats â retourne un lien de prÃ©view
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
      message: `${prompt}\n\nIMPORTANT : Utilise React avec Tailwind CSS. Design Ã©purÃ©, moderne, style startup. Textes en franÃ§ais.`
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`v0 API ${response.status}: ${err.substring(0, 200)}`);
  }

  const result = await response.json();
  console.log('[v0] RÃ©ponse brute:', JSON.stringify(result).substring(0, 300));

  // v0 Platform API retourne : { id, url, demo_url, ... }
  const url = result.url || result.demo_url || (result.id ? `https://v0.dev/chat/${result.id}` : null);
  return url;
}


// ==========================================
// Claude API â GÃ©nÃ¨re un site HTML complet
// Retourne le HTML brut (string)
// ==========================================
async function generateWithClaude(data, prompt) {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Claude] Pas de clÃ© API, skip');
    return null;
  }

  const systemPrompt = `Tu es un expert en crÃ©ation de sites web. Tu gÃ©nÃ¨res des sites HTML complets, beaux et fonctionnels en une seule rÃ©ponse.
RÃGLES ABSOLUES :
- RÃ©ponds UNIQUEMENT avec le code HTML (commence par <!DOCTYPE html>)
- Tout doit Ãªtre dans un seul fichier : CSS dans <style>, JS dans <script>
- Utilise Google Fonts pour la typographie
- Design professionnel, moderne, responsive (mobile-first)
- Textes de contenu rÃ©alistes en franÃ§ais (PAS de Lorem Ipsum)
- Couleurs harmonieuses et adaptÃ©es au secteur
- Animations CSS subtiles
- PAS de backticks, PAS de markdown, PAS d'explications â uniquement le HTML`;

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
      messages: [{
        role: 'user',
        content: `${prompt}

INSTRUCTIONS TECHNIQUES :
- Site complet en HTML/CSS/JS vanilla dans un seul fichier
- Header sticky avec logo + navigation
- Section Hero avec titre accrocheur, sous-titre et bouton CTA
- Section Services/Prestations avec icÃ´nes (utilise des emoji ou Font Awesome CDN)
- Section Ã propos avec histoire du commerce
- Section Contact avec formulaire + adresse + tÃ©lÃ©phone cliquable
- Footer avec infos lÃ©gales
- Bouton "Appel rapide" fixe en bas sur mobile
- Schema.org JSON-LD pour le SEO local
- Couleurs : ${data.couleurs || 'adapte au secteur'}
- TÃ©lÃ©phone Ã  intÃ©grer : ${data.telephone}
- Adresse : ${data.commune}${data.adresse ? ', ' + data.adresse : ''}

GÃ©nÃ¨re maintenant le HTML complet.`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.substring(0, 200)}`);
  }

  const result = await response.json();
  const htmlContent = result.content?.[0]?.text || '';

  // Nettoyage au cas oÃ¹ le modÃ¨le aurait ajoutÃ© des backticks
  const cleaned = htmlContent
    .replace(/^```html\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  if (!cleaned.includes('<!DOCTYPE') && !cleaned.includes('<html')) {
    throw new Error('Claude n\'a pas retournÃ© du HTML valide');
  }

  return cleaned;
}


// ==========================================
// RESEND â Email admin avec v0 URL + HTML Claude en piÃ¨ce jointe
// ==========================================
async function sendAdminEmail(data, { v0Url, claudeHtml, notionPageId }) {
  const now = new Date().toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const v0Block = v0Url
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #000;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#000;font-size:14px;">â² V0 BY VERCEL â AperÃ§u React</p>
        <a href="${v0Url}" style="color:#3b82f6;font-size:13px;word-break:break-all;text-decoration:none;">${v0Url}</a>
        <br><a href="${v0Url}" style="display:inline-block;margin-top:10px;padding:8px 16px;background:#000;color:#fff;border-radius:5px;text-decoration:none;font-size:13px;font-weight:600;">â Ouvrir le preview v0</a>
      </div>`
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">â² V0 â GÃ©nÃ©ration en cours ou Ã©chouÃ©e</div>`;

  const claudeBlock = claudeHtml
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #C0784A;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#C0784A;font-size:14px;">ð¤ CLAUDE AI â Site HTML complet</p>
        <p style="color:#555;font-size:13px;margin:0;">â Fichier HTML joint Ã  cet email (${Math.round(claudeHtml.length / 1024)} Ko)<br>Ouvre la piÃ¨ce jointe dans ton navigateur pour voir le site.</p>
      </div>`
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">ð¤ Claude â GÃ©nÃ©ration en cours ou Ã©chouÃ©e</div>`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;background:#fdfaf7;">
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 30px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">ð¥ WebPrestige â Admin</h1>
        <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">Nouveau prospect â¢ 2 sites gÃ©nÃ©rÃ©s</p>
      </div>

      <div style="padding:30px;background:#fff;">
        <h2 style="color:#2d2d2d;font-size:20px;margin:0 0 20px;">ð¯ ${data.nom_commerce}</h2>

        <div style="background:#fffbf5;padding:20px;border-radius:8px;border-left:4px solid #C0784A;margin-bottom:25px;">
          <table style="width:100%;font-size:14px;">
            <tr><td style="padding:6px 0;color:#888;width:130px;">Commerce</td><td style="color:#333;font-weight:600;">${data.nom_commerce}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">GÃ©rant</td><td style="color:#333;">${data.prenom_gerant || 'N/A'}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Email</td><td><a href="mailto:${data.email}" style="color:#C0784A;">${data.email || 'N/A'}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">TÃ©lÃ©phone</td><td><a href="tel:${data.telephone}" style="color:#C0784A;font-weight:600;">${data.telephone}</a></td></tr>
            <tr><td style="padding:6px 0;color:#888;">Secteur</td><td style="color:#333;">${data.secteur}</td></tr>
            <tr><td style="padding:6px 0;color:#888;">Commune</td><td style="color:#333;">${data.commune}</td></tr>
            ${data.budget ? `<tr><td style="padding:6px 0;color:#888;">Budget</td><td style="color:#333;font-weight:600;">${data.budget}</td></tr>` : ''}
            ${data.style_souhaite ? `<tr><td style="padding:6px 0;color:#888;">Style</td><td style="color:#333;">${data.style_souhaite}</td></tr>` : ''}
          </table>
        </div>

        <h3 style="color:#2d2d2d;font-size:16px;margin:0 0 15px;">ð¨ Sites gÃ©nÃ©rÃ©s â Choisis le meilleur :</h3>
        ${v0Block}
        ${claudeBlock}

        <div style="background:#f0fdf4;padding:16px;border-radius:8px;border-left:4px solid #22c55e;margin-top:20px;font-size:13px;color:#555;">
          â Fiche enregistrÃ©e dans Notion<br>
          â Email de confirmation envoyÃ© au prospect<br>
          ð§ C'est toi qui choisis quel site proposer au client
        </div>
      </div>

      <div style="padding:20px 30px;text-align:center;background:#f8f4f0;border-radius:0 0 8px 8px;font-size:12px;color:#999;">
        WebPrestige Admin â ${now}
      </div>
    </div>`;

  const emailPayload = {
    from: 'WebPrestige Admin <onboarding@resend.dev>',
    to: ['benjamin31.mathias@gmail.com'],
    subject: `ð¥ ${data.nom_commerce} (${data.secteur}) â 2 sites prÃªts Ã  vÃ©rifier`,
    html
  };

  // Ajouter le HTML Claude en piÃ¨ce jointe si disponible
  if (claudeHtml) {
    const filename = `${(data.nom_commerce || 'site').replace(/[^a-zA-Z0-9]/g, '-')}-claude.html`;
    emailPayload.attachments = [{
      filename,
      content: Buffer.from(claudeHtml).toString('base64'),
      content_type: 'text/html'
    }];
    console.log('[Admin Email] PiÃ¨ce jointe HTML ajoutÃ©e:', filename);
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(emailPayload)
  });

  const result = await res.json();
  if (!res.ok) throw new Error(`Resend admin: ${JSON.stringify(result)}`);
  return result.id;
}


// ==========================================
// WHATSAPP â CallMeBot (optionnel)
// ==========================================
async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE || '33627941715';
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) return;

  const encodedMsg = encodeURIComponent(message);
  await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`);
  console.log('[WhatsApp] â EnvoyÃ©');
}
