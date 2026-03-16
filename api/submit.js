// Vercel Serverless Function — Handles questionnaire submissions
// 1. Saves to Notion database
// 2. Sends "site en cours de création" confirmation email via Resend
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
    // (Client reçoit : "Merci, votre site est en cours de création")
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

    const platformResults = await triggerAllPlatforms(data, prompt);
    console.log('[WebPrestige] Platforms triggered:', platformResults);

    // ==========================================
    // 4. SEND ADMIN EMAIL WITH PREVIEW LINKS
    // ==========================================
    await sendAdminEmail(data, platformResults);

    // ==========================================
    // 5. SEND WHATSAPP NOTIFICATION (INTERNAL)
    // ==========================================
    await sendWhatsApp(
      `🚀 *Nouveau questionnaire complété !*\n\n` +
      `🏪 *${data.nom_commerce}*\n` +
      `📋 ${data.secteur}\n` +
      `📍 ${data.commune}\n` +
      `📞 ${data.telephone}\n` +
      `📧 ${data.email || 'Non renseigné'}\n\n` +
      `🎨 *Sites générés — à vérifier :*\n` +
      `${platformResults.framer ? `1️⃣ Framer: ${platformResults.framer}\n` : ''}` +
      `${platformResults.v0 ? `2️⃣ v0: ${platformResults.v0}\n` : ''}` +
      `${platformResults.tempo ? `3️⃣ Tempo: ${platformResults.tempo}\n` : ''}` +
      `\n📧 Email avec preview links envoyé à l'admin\n` +
      `✅ Notion mis à jour`
    );

    // ==========================================
    // 6. RETURN SUCCESS RESPONSE
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
// Email client = "Votre site est en cours de création"
// ==========================================
async function sendConfirmationEmail(data) {
  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #fdfaf7; padding: 0;">
      <div style="background: linear-gradient(135deg, #C0784A 0%, #A0623A 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">WebPrestige</h1>
        <p style="color: #f5e6d8; margin: 8px 0 0; font-size: 14px;">Votre vitrine digitale, clé en main</p>
      </div>
      <div style="padding: 40px 30px; background: #ffffff;">
        <h2 style="color: #2d2d2d; font-size: 22px; margin: 0 0 20px;">Merci ${data.prenom_gerant || ''} ! 🎉</h2>
        <p style="color: #555; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
          Nous avons bien reçu vos réponses pour <strong style="color: #C0784A;">${data.nom_commerce}</strong>.
        </p>
        <div style="background: linear-gradient(135deg, #fdf8f4 0%, #fef5ee 100%); border-left: 4px solid #C0784A; padding: 20px; border-radius: 0 8px 8px 0; margin: 25px 0;">
          <p style="color: #333; font-size: 16px; margin: 0; font-weight: 600;">✨ Votre site est déjà en cours de création !</p>
          <p style="color: #666; font-size: 14px; margin: 10px 0 0;">
            Notre équipe prépare plusieurs propositions de design sur-mesure pour votre activité.
            Vous recevrez très prochainement un aperçu personnalisé.
          </p>
        </div>
        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 20px 0;">En attendant, voici un récapitulatif de vos préférences :</p>
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
            <td style="padding: 10px 15px; color: #888; font-size: 13px;">Style souhaité</td>
            <td style="padding: 10px 15px; color: #333; font-size: 14px;">${data.style_souhaite}</td>
          </tr>` : ''}
        </table>
        <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 20px 0 5px;">On revient vers vous très vite avec une proposition qui vous ressemble.</p>
      </div>
      <div style="padding: 25px 30px; text-align: center; background: #f8f4f0; border-radius: 0 0 8px 8px;">
        <p style="color: #999; font-size: 12px; margin: 0;">
          WebPrestige — Sites vitrines pour professionnels<br>
          Région Toulouse | contact@webprestige.fr
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
      subject: `✨ ${data.nom_commerce} — Votre site est en cours de création !`,
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
        'Email Envoyé': { checkbox: true },
        'Dernier Email': { date: { start: new Date().toISOString() } }
      }
    })
  });
}


// ==========================================
// HELPER: Generate Site Vitrine Prompt
// ==========================================
function generateSitePrompt(data) {
  return `Crée un site vitrine professionnel pour "${data.nom_commerce}", un(e) ${data.secteur} situé(e) à ${data.commune}.

INFORMATIONS DU COMMERCE :
- Nom : ${data.nom_commerce}
- Secteur : ${data.secteur}
- Localisation : ${data.commune}${data.adresse ? `, ${data.adresse}` : ''}
- Téléphone : ${data.telephone || 'Non renseigné'}
${data.description ? `- Description : ${data.description}` : ''}

DESIGN :
- Style souhaité : ${data.style_souhaite || 'Moderne et professionnel'}
- Couleurs : ${data.couleurs || 'Couleurs chaudes et accueillantes, adaptées au secteur'}
- Ambiance : Professionnelle, rassurante, locale

PAGES À CRÉER :
${data.pages_souhaitees || '- Accueil avec hero section et appel à action\n- À propos / Notre histoire\n- Services / Prestations\n- Contact avec formulaire et carte Google Maps'}

EXIGENCES TECHNIQUES :
- Site vitrine responsive (mobile-first)
- Optimisé pour le SEO local (${data.commune}, ${data.secteur})
- Temps de chargement rapide
- Bouton d'appel click-to-call visible
- Intégration Google Maps pour la localisation
- Design moderne avec animations subtiles
- Formulaire de contact fonctionnel
- Favicon et méta descriptions optimisés

CONTENU :
- Générer des textes professionnels et engageants adaptés au secteur ${data.secteur}
- Inclure des appels à l'action clairs ("Appelez-nous", "Prenez rendez-vous", "Venez nous voir")
- Mettre en avant la proximité et l'ancrage local à ${data.commune}

IMPORTANT : Le site doit être complet, prêt à être présenté au client, et donner une impression immédiatement professionnelle.`;
}


// ==========================================
// HELPER: Trigger All 3 Platforms
// ==========================================
async function triggerAllPlatforms(data, prompt) {
  const results = { framer: null, v0: null, tempo: null };

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
        prompt: `${prompt}\n\nUtilise React, Tailwind CSS et shadcn/ui. Le design doit être épuré, moderne, style SaaS/startup.`,
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
        prompt: `${prompt}\n\nGénère un PRD structuré puis crée la UI en React. Le design doit être unique et créatif, avec un style design-first.`,
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
// HELPER: Send Admin Email with Preview Links
// ==========================================
async function sendAdminEmail(data, platformResults) {
  const previewLinksHTML = `
    <div style="margin: 25px 0; padding: 20px; background: #f0f9ff; border-left: 4px solid #3b82f6; border-radius: 0 8px 8px 0;">
      <h3 style="color: #1e40af; margin: 0 0 15px; font-size: 16px;">🔗 Preview Links — À vérifier :</h3>
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
        ${platformResults.framer ? `
        <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
          <p style="margin: 0 0 8px; font-weight: 600; color: #1e40af; font-size: 13px;">🎨 FRAMER</p>
          <a href="${platformResults.framer}" style="color: #3b82f6; font-size: 13px; text-decoration: none; word-break: break-all;">${platformResults.framer}</a>
        </div>
        ` : '<div style="background: #f9f9f9; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;"><p style="margin: 0; color: #999; font-size: 13px;">🎨 FRAMER — non disponible</p></div>'}
        ${platformResults.v0 ? `
        <div style="background: white; padding: 12px; border-radius: 6px; border: 1px solid #bfdbfe;">
          <p style="margin: 0 0 8px; font-weight: 600; color: #1e40af; font-size: 13px;">▲ V0 BY VERCEL</p>
          <a href="${platformResults.v0}" style="color: #3b82f6; font-size: 13px; text-decoration: none; word-break: break-all;">${platformResults.v0}</a>
        </div>
        ` : '<div style="background: #f9f9f9; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb;"><p style="margin: 0; color: #999; font-size: 13px;">▲ V0 — non disponible</p></div>'}
      </div>
    </div>
  `;

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 700px; margin: 0 auto; background: #fdfaf7; padding: 0;">
      <div style="background: linear-gradient(135deg, #C0784A 0%, #A0623A 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">WebPrestige — Admin Notification</h1>
        <p style="color: #f5e6d8; margin: 8px 0 0; font-size: 14px;">Nouveau prospect • Sites générés ✅</p>
      </div>
      <div style="padding: 40px 30px; background: #ffffff;">
        <h2 style="color: #2d2d2d; font-size: 22px; margin: 0 0 20px;">🎉 Nouveau Prospect : ${data.nom_commerce}</h2>
        <div style="background: #fff9f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #333; margin: 0 0 15px; font-size: 14px; font-weight: 600;">📋 Détails du Prospect :</h3>
          <table style="width: 100%; font-size: 14px;">
            <tr><td style="padding: 8px 0; color: #666; width: 140px;">Commerce :</td><td style="padding: 8px 0; color: #333; font-weight: 600;">${data.nom_commerce}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Gérant :</td><td style="padding: 8px 0; color: #333;">${data.prenom_gerant || 'N/A'}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Email :</td><td style="padding: 8px 0;"><a href="mailto:${data.email}" style="color: #C0784A;">${data.email}</a></td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Téléphone :</td><td style="padding: 8px 0;"><a href="tel:${data.telephone}" style="color: #C0784A;">${data.telephone}</a></td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Secteur :</td><td style="padding: 8px 0; color: #333;">${data.secteur}</td></tr>
            <tr><td style="padding: 8px 0; color: #666;">Commune :</td><td style="padding: 8px 0; color: #333;">${data.commune}</td></tr>
            ${data.budget ? `<tr><td style="padding: 8px 0; color: #666;">Budget :</td><td style="padding: 8px 0; color: #333;">${data.budget}</td></tr>` : ''}
          </table>
        </div>
        ${previewLinksHTML}
        <div style="background: #fff0f5; padding: 16px; border-radius: 6px; margin: 20px 0; font-size: 13px; color: #666;">
          ✅ Questionnaire enregistré dans Notion<br>
          ✅ Email de confirmation envoyé au prospect<br>
          ⏳ Sites en cours de génération sur les plateformes<br>
          📧 À toi de choisir et proposer au prospect
        </div>
      </div>
      <div style="padding: 25px 30px; text-align: center; background: #f8f4f0; border-radius: 0 0 8px 8px; font-size: 12px; color: #999;">
        WebPrestige — Pipeline d'automatisation<br>
        Notification envoyée le ${new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'WebPrestige Admin <onboarding@resend.dev>',
        to: ['benjamin31.mathias@gmail.com'],
        subject: `🔥 Nouveau prospect — ${data.nom_commerce} (${data.secteur})`,
        html: htmlContent
      })
    });

    const result = await response.json();
    console.log('[Admin Email] Sent to benjamin31.mathias@gmail.com:', result.id);
    return result.id;
  } catch (error) {
    console.error('[Admin Email] Failed:', error.message);
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
