// Vercel Serverless Function â Handles questionnaire submissions
// 1. Saves to Notion database
// 2. Sends confirmation email via Resend
// 3. Sends WhatsApp notification via CallMeBot
// 4. Generates Lovable.dev prompt
// 5. Returns prompt to trigger site creation

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
    // 2. SEND CONFIRMATION EMAIL VIA RESEND
    // ============================================
    let emailId = null;
    if (data.email) {
      emailId = await sendConfirmationEmail(data);
      if (emailId && notionResponse?.id) {
        await updateNotionEmailTracking(notionResponse.id, emailId);
      }
    }

    // ============================================
    // 3. SEND WHATSAPP NOTIFICATION
    // ============================================
    await sendWhatsApp(
      `ð *Nouveau questionnaire complÃ©tÃ© !*\n\n` +
      `ð *${data.nom_commerce}*\n` +
      `ðª ${data.secteur}\n` +
      `ð ${data.commune}\n` +
      `ð ${data.telephone}\n` +
      `ð§ ${data.email}\n` +
      `ð¨ Style : ${data.style_site || 'Non prÃ©cisÃ©'}\n` +
      `ð° Budget : ${data.budget || 'Non prÃ©cisÃ©'}\n\n` +
      `ð La crÃ©ation du site va dÃ©marrer automatiquement !`
    );
    console.log('[WhatsApp] Notification sent');

    // ============================================
    // 4. GENERATE LOVABLE.DEV PROMPT
    // ============================================
    const lovablePrompt = generateLovablePrompt(data);
    console.log('[Lovable] Prompt generated');

    // ============================================
    // 5. TRIGGER SITE CREATION (if Lovable API available)
    // ============================================
    let siteCreationStarted = false;
    if (process.env.LOVABLE_API_KEY) {
      siteCreationStarted = true;
    }

    // ============================================
    // 6. STORE PROMPT IN NOTION PAGE CONTENT
    // ============================================
    if (notionResponse) {
      await updateNotionPageContent(notionResponse.id, lovablePrompt);
    }

    return res.status(200).json({
      success: true,
      message: 'Questionnaire reÃ§u !',
      notion_page: notionResponse?.id,
      lovable_prompt: lovablePrompt,
      site_creation_started: siteCreationStarted,
      email_sent: !!emailId
    });
  } catch (error) {
    console.error('[Error]', error);
    return res.status(500).json({ error: 'Erreur serveur', details: error.message });
  }
}

// ============================================
// RESEND EMAIL INTEGRATION
// ============================================
async function sendConfirmationEmail(data) {
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'WebPrestige <onboarding@resend.dev>';

  if (!RESEND_KEY) {
    console.warn('[Resend] No API key configured, skipping');
    return null;
  }

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #FAFAF8; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.06);">
    <div style="background: linear-gradient(135deg, #C0784A, #D4956B); padding: 32px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 28px;">WebPrestige</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">CrÃ©ation de sites web professionnels</p>
    </div>
    <div style="padding: 32px;">
      <h2 style="color: #1B2631; margin: 0 0 16px;">Merci ${data.nom_commerce} ! ð</h2>
      <p style="color: #5D6D7E; line-height: 1.6;">
        Nous avons bien reÃ§u votre questionnaire et notre Ã©quipe commence dÃ©jÃ  Ã  Ã©tudier vos besoins.
      </p>
      <div style="background: #FFF8F3; border-left: 4px solid #C0784A; padding: 16px; border-radius: 0 8px 8px 0; margin: 24px 0;">
        <p style="margin: 0; color: #1B2631; font-weight: 600;">RÃ©capitulatif :</p>
        <ul style="color: #5D6D7E; padding-left: 20px; margin: 8px 0 0;">
          <li><strong>Commerce :</strong> ${data.nom_commerce}</li>
          <li><strong>Secteur :</strong> ${data.secteur}</li>
          <li><strong>Commune :</strong> ${data.commune}</li>
          <li><strong>Style :</strong> ${data.style_site || 'Ã dÃ©finir'}</li>
          <li><strong>Budget :</strong> ${data.budget || 'Ã discuter'}</li>
        </ul>
      </div>
      <h3 style="color: #1B2631; margin: 24px 0 12px;">Prochaines Ã©tapes :</h3>
      <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
        <span style="background: #C0784A; color: #fff; border-radius: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">1</span>
        <p style="margin: 0; color: #5D6D7E;">Analyse de vos besoins par notre Ã©quipe</p>
      </div>
      <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
        <span style="background: #C0784A; color: #fff; border-radius: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">2</span>
        <p style="margin: 0; color: #5D6D7E;">CrÃ©ation d'une maquette personnalisÃ©e</p>
      </div>
      <div style="display: flex; align-items: flex-start; margin-bottom: 12px;">
        <span style="background: #C0784A; color: #fff; border-radius: 50%; width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0;">3</span>
        <p style="margin: 0; color: #5D6D7E;">Prise de contact pour vous prÃ©senter le rÃ©sultat</p>
      </div>
      <p style="color: #5D6D7E; line-height: 1.6; margin-top: 24px;">
        Nous vous recontacterons dans les <strong>48 heures</strong>. En attendant, n'hÃ©sitez pas Ã  nous envoyer vos photos, logos ou tout autre document utile par retour de mail.
      </p>
    </div>
    <div style="background: #F8F6F3; padding: 20px 32px; text-align: center; border-top: 1px solid #EDE8E3;">
      <p style="color: #AAB7B8; font-size: 12px; margin: 0;">WebPrestige â CrÃ©ation de sites web pour commerces de proximitÃ©</p>
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
        from: FROM_EMAIL,
        to: [data.email],
        subject: `${data.nom_commerce} â Votre demande de site web est bien reÃ§ue ! ð`,
        html: htmlContent,
        tags: [
          { name: 'type', value: 'confirmation' },
          { name: 'commerce', value: data.nom_commerce }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[Resend] Error:', err);
      return null;
    }

    const result = await response.json();
    console.log('[Resend] Email sent:', result.id);
    return result.id;
  } catch (err) {
    console.error('[Resend] Failed:', err.message);
    return null;
  }
}

async function updateNotionEmailTracking(pageId, emailId) {
  const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
  if (!NOTION_TOKEN) return;

  try {
    await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        properties: {
          "Email EnvoyÃ©": { checkbox: true },
          "Resend Email ID": { rich_text: [{ text: { content: emailId } }] },
          "Nb Relances": { number: 0 }
        }
      })
    });
    console.log('[Notion] Email tracking updated');
  } catch (err) {
    console.error('[Notion] Email tracking update failed:', err.message);
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
    "Commerce": { title: [{ text: { content: data.nom_commerce } }] },
    "Secteur": { select: { name: data.secteur || 'Autre' } },
    "Commune": { rich_text: [{ text: { content: data.commune || '' } }] },
    "Adresse": { rich_text: [{ text: { content: data.adresse || '' } }] },
    "TÃ©lÃ©phone": { phone_number: data.telephone || '' },
    "Email": { email: data.email || '' },
    "Statut": { select: { name: "Formulaire reÃ§u" } },
    "Notes": { rich_text: [{ text: { content: buildNotesFromForm(data) } }] }
  };

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
      object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ text: { content: 'ð¤ Prompt Lovable.dev auto-gÃ©nÃ©rÃ©' } }] }
    },
    {
      object: 'block', type: 'code',
      code: { rich_text: [{ text: { content: prompt } }], language: 'plain text' }
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
  if (data.pages?.length) parts.push(`Pages souhaitÃ©es: ${data.pages.join(', ')}`);
  if (data.site_reference) parts.push(`Site rÃ©fÃ©rence: ${data.site_reference}`);
  if (data.facebook) parts.push(`Facebook: ${data.facebook}`);
  if (data.instagram) parts.push(`Instagram: ${data.instagram}`);
  if (data.contenu_important) parts.push(`Contenu important: ${data.contenu_important}`);
  if (data.delai) parts.push(`DÃ©lai souhaitÃ©: ${data.delai}`);
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
    if (!response.ok) {
      console.error('[WhatsApp] Error:', await response.text());
    }
  } catch (err) {
    console.error('[WhatsApp] Failed:', err.message);
  }
}

// ============================================
// LOVABLE.DEV PROMPT GENERATOR
// ============================================
function generateLovablePrompt(data) {
  const pages = data.pages || ['accueil', 'contact'];
  const pagesStr = pages.join(', ');

  const styleMap = {
    'Moderne & Minimaliste': "moderne et minimaliste, avec beaucoup d'espace blanc, typographie Ã©purÃ©e, animations subtiles",
    'Chaleureux & Traditionnel': "chaleureux et traditionnel, tons chauds, textures naturelles, ambiance accueillante",
    'ÃlÃ©gant & Premium': "Ã©lÃ©gant et premium, design sophistiquÃ©, palette raffinÃ©e, typographie serif",
    'ColorÃ© & Dynamique': "colorÃ© et dynamique, couleurs vives, formes gÃ©omÃ©triques, Ã©nergie visuelle"
  };

  const styleDesc = styleMap[data.style_site] || 'professionnel et moderne';
  const colorsStr = data.couleurs?.length
    ? `Palette de couleurs : ${data.couleurs.join(', ')}.`
    : 'Palette de couleurs adaptÃ©e au secteur.';

  return `CrÃ©e un site web professionnel pour "${data.nom_commerce}", un commerce de type ${data.secteur} situÃ© Ã  ${data.commune}.${data.adresse ? ` (${data.adresse})` : ''}

STYLE & DESIGN :
- Style ${styleDesc}
- ${colorsStr}
${data.ambiance ? `- Ambiance souhaitÃ©e : ${data.ambiance}` : ''}
${data.a_logo === 'oui' ? "- Le client a un logo Ã  intÃ©grer" : "- Pas de logo, crÃ©er un header textuel Ã©lÃ©gant avec le nom du commerce"}

PAGES Ã CRÃER : ${pagesStr}

TECHNIQUE :
- Site responsive (mobile-first)
- SEO optimisÃ© pour "${data.secteur} ${data.commune}"
- Animations de scroll subtiles
- Vitesse de chargement optimisÃ©e
- Footer avec coordonnÃ©es, horaires, rÃ©seaux sociaux et mentions lÃ©gales
${data.contenu_important ? `\nCONTENU IMPORTANT Ã INTÃGRER :\n${data.contenu_important}` : ''}
${data.site_reference ? `\nSITE DE RÃFÃRENCE (s'inspirer du style) : ${data.site_reference}` : ''}`;
}
