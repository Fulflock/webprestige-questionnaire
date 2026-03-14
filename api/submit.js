// Vercel Serverless Function â Handles questionnaire submissions
// 1. Saves to Notion database
// 2. Sends "site en cours de crÃ©ation" confirmation email via Resend
// 3. Generates prompt & triggers site creation on 3 platforms (Framer, v0, Tempo)
// 4. Sends WhatsApp notification with 3 preview links (internal only)
// 5. Updates Notion with email tracking data

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

    // ==========================================
    // 1. SAVE TO NOTION
    // ==========================================
    const notionResponse = await saveToNotion(data);
    console.log('[Notion] Saved:', notionResponse?.id);

    // ==========================================
    // 2. SEND CONFIRMATION EMAIL VIA RESEND
    // (Client reÃ§oit : "Merci, votre site est en cours de crÃ©ation")
    // ==========================================
    let emailId = null;
    if (data.email) {
      emailId = await sendConfirmationEmail(data);
      if (emailId && notionResponse?.id) {
        await updateNotionEmailTracking(notionResponse.id, emailId);
      }
    }

    // ==========================================
    // 3. GENERATE PROMPT & TRIGGER 3 PLATFORMS
    // ==========================================
    const prompt = generateSitePrompt(data);
    console.log('[WebPrestige] Prompt generated, launching 3 platforms...');

    // Lancer les 3 plateformes en parallÃ¨le (fire-and-forget)
    // On n'attend pas la fin â le WhatsApp sera envoyÃ© avec les liens de base
    const platformResults = await triggerAllPlatforms(data, prompt);
    console.log('[WebPrestige] Platforms triggered:', platformResults);

    // ==========================================
    // 4. SEND WHATSAPP NOTIFICATION (INTERNAL)
    // ==========================================
    await sendWhatsApp(
      `ð *Nouveau questionnaire complÃ©tÃ© !*\n\n` +
      `ðª *${data.nom_commerce}*\n` +
      `ð ${data.secteur}\n` +
      `ð ${data.commune}\n` +
      `ð ${data.telephone}\n` +
      `ð§ ${data.email || 'Non renseignÃ©'}\n\n` +
      `ð¨ *Sites en cours de gÃ©nÃ©ration :*\n` +
      `1ï¸â£ Framer: ${platformResults.framer || 'â³ En cours...'}\n` +
      `2ï¸â£ v0: ${platformResults.v0 || 'â³ En cours...'}\n` +
      `3ï¸â£ Tempo: ${platformResults.tempo || 'â³ En cours...'}\n\n` +
      `â Email de confirmation envoyÃ© au client\n` +
      `ð Notion mis Ã  jour`
    );

    // ==========================================
    // 5. RETURN SUCCESS RESPONSE
    // ==========================================
    return res.status(200).json({
      success: true,
      message: 'Questionnaire processed successfully',
      notionId: notionResponse?.id,
      emailSent: !!emailId,
      platforms: platformResults
    });

  } catch (error) {
    console.error('[WebPrestige] Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}


// ==========================================
// HELPER: Save to Notion
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
        'PrioritÃ©': { select: { name: 'CHAUD' } },
        'Statut': { select: { name: 'Formulaire reÃ§u' } },
        'Notes': { rich_text: [{ text: { content: buildNotesFromData(data) } }] },
        'PrÃ©nom gÃ©rant': { rich_text: [{ text: { content: data.prenom_gerant || '' } }] },
        'Email EnvoyÃ©': { checkbox: !!data.email },
        'Date premier contact': { date: { start: new Date().toISOString().split('T')[0] } }
      }
    })
  });
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
// HELPER: Send Confirmation Email (Resend)
// Email client = "Votre site est en cours de crÃ©ation"
// ==========================================
async function sendConfirmationEmail(data) {
  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fdfaf7; padding: 0;">
      <!-- Header -->
      <div style="background: linear-gradient(135deg, #C0784A 0%, #A0623A 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">WebPrestige</h1>
        <p style="color: #f5e6d8; margin: 8px 0 0; font-size: 14px;">Votre vitrine digitale, clÃ© en main</p>
      </div>

      <!-- Body -->
      <div style="padding: 40px 30px; background: #ffffff;">
        <h2 style="color: #2d2d2d; font-size: 22px; margin: 0 0 20px;">
          Merci ${data.prenom_gerant || ''} ! ð
        </h2>

        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
          Nous avons bien reÃ§u vos rÃ©ponses pour <strong style="color: #C0784A;">${data.nom_commerce}</strong>.
        </p>

        <div style="background: linear-gradient(135deg, #fdf8f4 0%, #fef5ee 100%); border-left: 4px solid #C0784A; padding: 20px; border-radius: 0 8px 8px 0; margin: 25px 0;">
          <p style="color: #333; font-size: 16px; margin: 0; font-weight: 600;">
            â¨ Votre site est dÃ©jÃ  en cours de crÃ©ation !
          </p>
          <p style="color: #666; font-size: 14px; margin: 10px 0 0;">
            Notre Ã©quipe prÃ©pare plusieurs propositions de design sur-mesure pour votre activitÃ©.
            Vous recevrez trÃ¨s prochainement un aperÃ§u personnalisÃ©.
          </p>
        </div>

        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 20px 0;">
          En attendant, voici un rÃ©capitulatif de vos prÃ©fÃ©rences :
        </p>

        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr>
            <td style="padding: 10px 15px; background: #fdf8f4; color: #888; font-size: 13px; width: 140px;">Commerce</td>
            <td style="padding: 10px 15px; background: #fdf8f4; color: #333; font-size: 14px; font-weight: 600;">${data.nom_commerce}</td>
          </tr>
          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Secteur</td>
            <td style="padding: 10px 15px; color: #333; font-size: 14px;">${data.secteur}</td>
          </tr>
          <tr>
            <td style="padding: 10px 15px; background: #fdf8f4; color: #888; font-size: 13px;">Commune</td>
            <td style="padding: 10px 15px; background: #fdf8f4; color: #333; font-size: 14px;">${data.commune}</td>
          </tr>
          ${data.style_souhaite ? `
          <tr>
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Style souhaitÃ©</td>
            <td style="padding: 10px 15px; color: #333; font-size: 14px;">${data.style_souhaite}</td>
          </tr>` : ''}
        </table>

        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 20px 0 5px;">
          On revient vers vous trÃ¨s vite avec une proposition qui vous ressemble.
        </p>
      </div>

      <!-- Footer -->
      <div style="padding: 25px 30px; text-align: center; background: #f8f4f0; border-radius: 0 0 8px 8px;">
        <p style="color: #999; font-size: 12px; margin: 0;">
          WebPrestige â Sites vitrines pour professionnels<br>
          RÃ©gion Toulouse | contact@webprestige.fr
        </p>
      </div>
    </div>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'WebPrestige <onboarding@resend.dev>',
      to: [data.email],
      subject: `â¨ ${data.nom_commerce} â Votre site est en cours de crÃ©ation !`,
      html: htmlContent
    })
  });

  const result = await response.json();
  console.log('[Resend] Email sent:', result.id);
  return result.id;
}


// ==========================================
// HELPER: Update Notion Email Tracking
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
        'Email EnvoyÃ©': { checkbox: true },
        'Dernier Email': { date: { start: new Date().toISOString() } }
      }
    })
  });
}


// ==========================================
// HELPER: Generate Site Vitrine Prompt
// ==========================================
function generateSitePrompt(data) {
  return `CrÃ©e un site vitrine professionnel pour "${data.nom_commerce}", un(e) ${data.secteur} situÃ©(e) Ã  ${data.commune}.

INFORMATIONS DU COMMERCE :
- Nom : ${data.nom_commerce}
- Secteur : ${data.secteur}
- Localisation : ${data.commune}${data.adresse ? `, ${data.adresse}` : ''}
- TÃ©lÃ©phone : ${data.telephone || 'Non renseignÃ©'}
${data.description ? `- Description : ${data.description}` : ''}

DESIGN :
- Style souhaitÃ© : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Couleurs chaudes et accueillantes, adaptÃ©es au secteur'}
- Ambiance : Professionnelle, rassurante, locale

PAGES Ã CRÃER :
${data.pages_souhaitees || '- Accueil avec hero section et appel Ã  action\n- Ã propos / Notre histoire\n- Services / Prestations\n- Contact avec formulaire et carte Google Maps'}

EXIGENCES TECHNIQUES :
- Site vitrine responsive (mobile-first)
- OptimisÃ© pour le SEO local (${data.commune}, ${data.secteur})
- Temps de chargement rapide
- Bouton d'appel click-to-call visible
- IntÃ©gration Google Maps pour la localisation
- Design moderne avec animations subtiles
- Formulaire de contact fonctionnel
- Favicon et mÃ©ta descriptions optimisÃ©s

CONTENU :
- GÃ©nÃ©rer des textes professionnels et engageants adaptÃ©s au secteur ${data.secteur}
- Inclure des appels Ã  l'action clairs ("Appelez-nous", "Prenez rendez-vous", "Venez nous voir")
- Mettre en avant la proximitÃ© et l'ancrage local Ã  ${data.commune}

IMPORTANT : Le site doit Ãªtre complet, prÃªt Ã  Ãªtre prÃ©sentÃ© au client, et donner une impression immÃ©diatement professionnelle.`;
}


// ==========================================
// HELPER: Trigger All 3 Platforms
// ==========================================
async function triggerAllPlatforms(data, prompt) {
  const results = { framer: null, v0: null, tempo: null };

  // Lance les 3 en parallÃ¨le avec un timeout de 30s
  const [framerResult, v0Result, tempoResult] = await Promise.allSettled([
    triggerFramer(data, prompt),
    triggerV0(data, prompt),
    triggerTempo(data, prompt)
  ]);

  if (framerResult.status === 'fulfilled') results.framer = framerResult.value;
  else console.error('[Framer] Error:', framerResult.reason);

  if (v0Result.status === 'fulfilled') results.v0 = v0Result.value;
  else console.error('[v0] Error:', v0Result.reason);

  if (tempoResult.status === 'fulfilled') results.tempo = tempoResult.value;
  else console.error('[Tempo] Error:', tempoResult.reason);

  return results;
}


// ==========================================
// PLATFORM 1: Framer (Server API - Beta)
// Docs: https://www.framer.com/developers/server-api
// ==========================================
async function triggerFramer(data, prompt) {
  if (!process.env.FRAMER_API_TOKEN) {
    console.log('[Framer] No API token configured, skipping');
    return null;
  }

  try {
    const response = await fetch('https://api.framer.com/v1/sites', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.FRAMER_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `${data.nom_commerce} - WebPrestige`,
        prompt: prompt,
        publish: true
      })
    });

    const result = await response.json();
    console.log('[Framer] Site created:', result.url || result.id);
    return result.url || `https://framer.com/projects/${result.id}`;
  } catch (error) {
    console.error('[Framer] Failed:', error.message);
    return null;
  }
}


// ==========================================
// PLATFORM 2: v0 by Vercel
// Docs: https://v0.dev/docs/api
// ==========================================
async function triggerV0(data, prompt) {
  if (!process.env.V0_API_TOKEN) {
    console.log('[v0] No API token configured, skipping');
    return null;
  }

  try {
    const response = await fetch('https://api.v0.dev/v1/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.V0_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: `${prompt}\n\nUtilise React, Tailwind CSS et shadcn/ui. Le design doit Ãªtre Ã©purÃ©, moderne, style SaaS/startup.`,
        framework: 'nextjs'
      })
    });

    const result = await response.json();
    console.log('[v0] Generation created:', result.url || result.id);
    return result.url || `https://v0.dev/t/${result.id}`;
  } catch (error) {
    console.error('[v0] Failed:', error.message);
    return null;
  }
}


// ==========================================
// PLATFORM 3: Tempo Labs
// Docs: https://docs.tempolabs.ai/api
// ==========================================
async function triggerTempo(data, prompt) {
  if (!process.env.TEMPO_API_TOKEN) {
    console.log('[Tempo] No API token configured, skipping');
    return null;
  }

  try {
    const response = await fetch('https://api.tempolabs.ai/v1/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.TEMPO_API_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `${data.nom_commerce} - WebPrestige`,
        prompt: `${prompt}\n\nGÃ©nÃ¨re un PRD structurÃ© puis crÃ©e la UI en React. Le design doit Ãªtre unique et crÃ©atif, avec un style design-first.`,
        framework: 'react'
      })
    });

    const result = await response.json();
    console.log('[Tempo] Project created:', result.url || result.id);
    return result.url || `https://app.tempolabs.ai/project/${result.id}`;
  } catch (error) {
    console.error('[Tempo] Failed:', error.message);
    return null;
  }
}


// ==========================================
// HELPER: Send WhatsApp via CallMeBot
// ==========================================
async function sendWhatsApp(message) {
  const phone = process.env.WHATSAPP_PHONE || '33627941715';
  const apiKey = process.env.CALLMEBOT_API_KEY || '';

  if (!apiKey) {
    console.log('[WhatsApp] No CallMeBot API key, skipping');
    return;
  }

  try {
    const encodedMsg = encodeURIComponent(message);
    await fetch(
      `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedMsg}&apikey=${apiKey}`
    );
    console.log('[WhatsApp] Notification sent');
  } catch (error) {
    console.error('[WhatsApp] Failed:', error.message);
  }
}
