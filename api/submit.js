// Vercel Serverless Function — WebPrestige Pipeline
// 1. Sauvegarde dans Notion
// 2. Email de confirmation au prospect (via Resend)
// 3. Génération de 2 sites en parallèle :
//    - v0 by Vercel (Platform API → lien de préview cliquable)
//    - Claude API (HTML complet → pièce jointe email)
// 4. Email admin à benjamin31.mathias@gmail.com avec les 2 résultats
// 5. WhatsApp si CALLMEBOT_API_KEY configuré

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
      console.log('[Notion] ✅ Sauvegardé:', notionPageId);
    } catch (e) {
      console.error('[Notion] ❌ Erreur:', e.message);
    }

    // ==========================================
    // 2. EMAIL CONFIRMATION PROSPECT
    // ==========================================
    let emailId = null;
    if (data.email) {
      try {
        emailId = await sendConfirmationEmail(data);
        console.log('[Resend] ✅ Email prospect envoyé:', emailId);
        if (emailId && notionPageId) {
          await updateNotionEmailTracking(notionPageId, emailId).catch(() => {});
        }
      } catch (e) {
        console.error('[Resend] ❌ Email prospect échoué:', e.message);
      }
    }

    // ==========================================
    // 3. GÉNÉRATION DES SITES EN PARALLÈLE
    // ==========================================
    const prompt = generateSitePrompt(data);
    console.log('[WebPrestige] Lancement génération v0 + Claude...');

    const [v0Result, claudeResult] = await Promise.allSettled([
      triggerV0(data, prompt),
      generateWithClaude(data, prompt)
    ]);

    const v0Url = v0Result.status === 'fulfilled' ? v0Result.value : null;
    const claudeHtml = claudeResult.status === 'fulfilled' ? claudeResult.value : null;

    if (v0Result.status === 'rejected') console.error('[v0] ❌', v0Result.reason?.message);
    if (claudeResult.status === 'rejected') console.error('[Claude] ❌', claudeResult.reason?.message);

    console.log('[v0] URL:', v0Url || 'null');
    console.log('[Claude] HTML généré:', claudeHtml ? `${claudeHtml.length} chars` : 'null');

    // ==========================================
    // 4. EMAIL ADMIN AVEC LES 2 SITES
    // ==========================================
    try {
      await sendAdminEmail(data, { v0Url, claudeHtml, notionPageId });
      console.log('[Admin Email] ✅ Envoyé à benjamin31.mathias@gmail.com');
    } catch (e) {
      console.error('[Admin Email] ❌ Erreur:', e.message);
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
        `${claudeHtml ? `🤖 Claude HTML: joint en email\n` : ''}` +
        `📧 Email admin envoyé ✅`
      ).catch(e => console.error('[WhatsApp] ❌', e.message));
    }

    // ==========================================
    // 6. RÉPONSE
    // ==========================================
    return res.status(200).json({
      success: true,
      notionId: notionPageId,
      emailSent: !!emailId,
      v0Url,
      claudeGenerated: !!claudeHtml
    });

  } catch (error) {
    console.error('[WebPrestige] Erreur globale:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}


// ==========================================
// NOTION — Sauvegarde prospect
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
        'Téléphone': { phone_number: data.telephone || '' },
        'Email': { email: data.email || null },
        'Note Google': { rich_text: [{ text: { content: data.note_google || '' } }] },
        'Priorité': { select: { name: 'CHAUD' } },
        'Statut': { select: { name: 'Formulaire reçu' } },
        'Notes': { rich_text: [{ text: { content: buildNotesFromData(data) } }] },
        'Prénom gérant': { rich_text: [{ text: { content: data.prenom_gerant || '' } }] },
        'Email Envoyé': { checkbox: !!data.email },
        'Date premier contact': { date: { start: new Date().toISOString().split('T')[0] } }
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
// RESEND — Email confirmation prospect
// ==========================================
async function sendConfirmationEmail(data) {
  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#C0784A,#A0623A);padding:40px 30px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:28px;font-weight:700;">WebPrestige</h1>
        <p style="color:#f5e6d8;margin:8px 0 0;font-size:14px;">Votre vitrine digitale, clé en main</p>
      </div>
      <div style="padding:40px 30px;background:#fff;">
        <h2 style="color:#2d2d2d;font-size:22px;margin:0 0 20px;">Merci ${data.prenom_gerant || ''} ! 🎉</h2>
        <p style="color:#555;font-size:16px;line-height:1.6;">
          Nous avons bien reçu vos réponses pour <strong style="color:#C0784A;">${data.nom_commerce}</strong>.
        </p>
        <div style="background:linear-gradient(135deg,#fdf8f4,#fef5ee);border-left:4px solid #C0784A;padding:20px;border-radius:0 8px 8px 0;margin:25px 0;">
          <p style="color:#333;font-size:16px;margin:0;font-weight:600;">✨ Votre site est déjà en cours de création !</p>
          <p style="color:#666;font-size:14px;margin:10px 0 0;">
            Notre équipe prépare plusieurs propositions de design sur-mesure pour votre activité.
            Vous recevrez très prochainement un aperçu personnalisé.
          </p>
        </div>
        <table style="width:100%;border-collapse:collapse;margin:15px 0;">
          <tr><td style="padding:10px 15px;background:#fdf8f4;color:#888;font-size:13px;width:140px;">Commerce</td><td style="padding:10px 15px;background:#fdf8f4;color:#333;font-size:14px;font-weight:600;">${data.nom_commerce}</td></tr>
          <tr><td style="padding:10px 15px;color:#888;font-size:13px;">Secteur</td><td style="padding:10px 15px;color:#333;font-size:14px;">${data.secteur}</td></tr>
          <tr><td style="padding:10px 15px;background:#fdf8f4;color:#888;font-size:13px;">Commune</td><td style="padding:10px 15px;background:#fdf8f4;color:#333;font-size:14px;">${data.commune}</td></tr>
          ${data.style_souhaite ? `<tr><td style="padding:10px 15px;color:#888;font-size:13px;">Style</td><td style="padding:10px 15px;color:#333;font-size:14px;">${data.style_souhaite}</td></tr>` : ''}
        </table>
        <p style="color:#555;font-size:15px;line-height:1.6;margin:20px 0 5px;">
          On revient vers vous très vite avec une proposition qui vous ressemble. 💪
        </p>
      </div>
      <div style="padding:25px 30px;text-align:center;background:#f8f4f0;border-radius:0 0 8px 8px;">
        <p style="color:#999;font-size:12px;margin:0;">WebPrestige — Sites vitrines pour professionnels<br>Région Toulouse | contact@webprestige.fr</p>
      </div>
    </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'WebPrestige <onboarding@resend.dev>',
      to: [data.email],
      subject: `✨ ${data.nom_commerce} — Votre site est en cours de création !`,
      html
    })
  });
  const result = await res.json();
  return result.id;
}


// ==========================================
// NOTION — Mise à jour tracking email
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
        'Resend Email ID': { rich_text: [{ text: { content: emailId } }] },
        'Email Envoyé': { checkbox: true },
        'Dernier Email': { date: { start: new Date().toISOString() } }
      }
    })
  });
}


// ==========================================
// PROMPT — Adapté au secteur
// ==========================================
function generateSitePrompt(data) {
  const secteurTips = {
    'Restaurant': 'Mets en avant le menu, l\'ambiance, la terrasse, les réservations. CTA : "Réserver une table".',
    'Coiffeur': 'Montre la galerie avant/après, les tarifs, la prise de RDV. CTA : "Prendre rendez-vous".',
    'Plombier': 'Urgences 24h/24, zone d\'intervention, devis gratuit. CTA : "Appeler maintenant".',
    'Électricien': 'Certifications, types d\'interventions, devis rapide. CTA : "Demander un devis".',
    'Boulangerie': 'Produits phares, horaires, artisanat local. CTA : "Voir nos spécialités".',
    'Garage': 'Services auto, marques acceptées, prix transparents. CTA : "Prendre rendez-vous".',
    'Médecin': 'Spécialité, secteur, prise en charge. CTA : "Prendre rendez-vous".',
    'Avocat': 'Domaines d\'expertise, cabinet, premier contact. CTA : "Consulter".',
  };

  const tip = secteurTips[data.secteur] || `Mets en avant les services, l'expérience et la localisation. CTA principal bien visible.`;

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
// POST /v1/chats → retourne un lien de préview
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

  // v0 Platform API retourne : { id, url, demo_url, ... }
  const url = result.url || result.demo_url || (result.id ? `https://v0.dev/chat/${result.id}` : null);
  return url;
}


// ==========================================
// Claude API — Génère un site HTML complet
// Retourne le HTML brut (string)
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
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `${prompt}

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

Génère maintenant le HTML complet.`
      }]
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API ${response.status}: ${err.substring(0, 200)}`);
  }

  const result = await response.json();
  const htmlContent = result.content?.[0]?.text || '';

  // Nettoyage au cas où le modèle aurait ajouté des backticks
  const cleaned = htmlContent
    .replace(/^```html\n?/i, '')
    .replace(/^```\n?/, '')
    .replace(/\n?```$/, '')
    .trim();

  if (!cleaned.includes('<!DOCTYPE') && !cleaned.includes('<html')) {
    throw new Error('Claude n\'a pas retourné du HTML valide');
  }

  return cleaned;
}


// ==========================================
// RESEND — Email admin avec v0 URL + HTML Claude en pièce jointe
// ==========================================
async function sendAdminEmail(data, { v0Url, claudeHtml, notionPageId }) {
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
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">▲ V0 — Génération en cours ou échouée</div>`;

  const claudeBlock = claudeHtml
    ? `<div style="background:#fff;padding:16px;border-radius:8px;border:2px solid #C0784A;margin-bottom:12px;">
        <p style="margin:0 0 8px;font-weight:700;color:#C0784A;font-size:14px;">🤖 CLAUDE AI — Site HTML complet</p>
        <p style="color:#555;font-size:13px;margin:0;">✅ Fichier HTML joint à cet email (${Math.round(claudeHtml.length / 1024)} Ko)<br>Ouvre la pièce jointe dans ton navigateur pour voir le site.</p>
      </div>`
    : `<div style="background:#f9f9f9;padding:16px;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:12px;color:#999;font-size:13px;">🤖 Claude — Génération en cours ou échouée</div>`;

  const html = `
    <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:700px;margin:0 auto;background:#fdfaf7;">
      <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);padding:40px 30px;text-align:center;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:26px;font-weight:700;">🔥 WebPrestige — Admin</h1>
        <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">Nouveau prospect • 2 sites générés</p>
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

        <h3 style="color:#2d2d2d;font-size:16px;margin:0 0 15px;">🎨 Sites générés — Choisis le meilleur :</h3>
        ${v0Block}
        ${claudeBlock}

        <div style="background:#f0fdf4;padding:16px;border-radius:8px;border-left:4px solid #22c55e;margin-top:20px;font-size:13px;color:#555;">
          ✅ Fiche enregistrée dans Notion<br>
          ✅ Email de confirmation envoyé au prospect<br>
          📧 C'est toi qui choisis quel site proposer au client
        </div>
      </div>

      <div style="padding:20px 30px;text-align:center;background:#f8f4f0;border-radius:0 0 8px 8px;font-size:12px;color:#999;">
        WebPrestige Admin — ${now}
      </div>
    </div>`;

  const emailPayload = {
    from: 'WebPrestige Admin <onboarding@resend.dev>',
    to: ['benjamin31.mathias@gmail.com'],
    subject: `🔥 ${data.nom_commerce} (${data.secteur}) — 2 sites prêts à vérifier`,
    html
  };

  // Ajouter le HTML Claude en pièce jointe si disponible
  if (claudeHtml) {
    const filename = `${(data.nom_commerce || 'site').replace(/[^a-zA-Z0-9]/g, '-')}-claude.html`;
    emailPayload.attachments = [{
      filename,
      content: Buffer.from(claudeHtml).toString('base64'),
      content_type: 'text/html'
    }];
    console.log('[Admin Email] Pièce jointe HTML ajoutée:', filename);
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
// WHATSAPP — CallMeBot (optionnel)
// ==========================================
async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE || '33627941715';
  const apiKey = process.env.CALLMEBOT_API_KEY;
  if (!apiKey) return;

  const encodedMsg = encodeURIComponent(message);
  await fetch(`https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`);
  console.log('[WhatsApp] ✅ Envoyé');
}
