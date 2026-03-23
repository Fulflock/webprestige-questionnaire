// Vercel Serverless Function — WebPrestige Pipeline (Étape 1)
// Rapide : Notion + email prospect + trigger génération en arrière-plan
// Timeout : 60s max (Vercel Hobby)

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

    // ==========================================
    // 1. NOTION — Sauvegarder le prospect
    // ==========================================
    let notionPageId = null;
    try {
      const notionResponse = await saveToNotion(data);
      notionPageId = notionResponse?.id;
      console.log('[Notion] Sauvegarde OK:', notionPageId);
    } catch (e) {
      console.error('[Notion] Erreur:', e.message);
    }

    // ==========================================
    // 2. EMAIL CONFIRMATION PROSPECT
    // ==========================================
    if (data.email) {
      try {
        const emailId = await sendConfirmationEmail(data);
        console.log('[Resend] Email prospect OK:', emailId);
        if (emailId && notionPageId) {
          await updateNotionEmailTracking(notionPageId, emailId).catch(() => {});
        }
      } catch (e) {
        console.error('[Resend] Email prospect erreur:', e.message);
      }
    }

    // ==========================================
    // 3. RÉPONSE AU CLIENT (immédiate)
    // ==========================================
    res.status(200).json({ success: true, notionId: notionPageId });

    // ==========================================
    // 4. TRIGGER GÉNÉRATION EN ARRIÈRE-PLAN
    // Appel fire-and-forget vers /api/generate
    // qui a ses propres 60s pour v0 + Claude
    // ==========================================
    if (notionPageId) {
      const baseUrl = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'https://webprestige-questionnaire.vercel.app';

      fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notionPageId, data })
      }).catch(e => console.error('[Generate] Trigger erreur:', e.message));

      console.log('[WebPrestige] Generation triggered pour', notionPageId);
    }

  } catch (error) {
    console.error('[WebPrestige] Erreur globale:', error);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, error: error.message });
    }
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

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'WebPrestige <onboarding@resend.dev>',
      to: [data.email],
      subject: `✨ ${data.nom_commerce} — Votre site est en cours de création !`,
      html
    })
  });
  const result = await r.json();
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
        'Email Envoyé': { checkbox: true },
        'Resend Email ID': { rich_text: [{ text: { content: emailId || '' } }] }
      }
    })
  });
}
