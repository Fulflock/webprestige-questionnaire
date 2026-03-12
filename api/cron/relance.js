// Cron job for automatic follow-up emails
// Runs daily - checks Notion for prospects needing follow-up
// Criteria: Email sent, not opened, < 3 follow-ups, last email > 3 days ago

export default async function handler(req, res) {
  // Verify cron secret (Vercel cron jobs send this header)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Also allow direct calls for testing
    if (req.method !== 'GET' && req.method !== 'POST') {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
  const DATABASE_ID = process.env.NOTION_DATABASE_ID || '8f57d0df-ae99-4bd7-bd50-b30d5ac91538';
  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM_EMAIL = process.env.FROM_EMAIL || 'WebPrestige <onboarding@resend.dev>';

  if (!NOTION_TOKEN || !RESEND_KEY) {
    return res.status(200).json({ message: 'Missing configuration', skipped: true });
  }

  try {
    // Query Notion for prospects needing follow-up
    // Criteria: Statut = "Formulaire reÃ§u", Email EnvoyÃ© = true, Email Ouvert = false
    const queryResponse = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Email EnvoyÃ©', checkbox: { equals: true } },
            { property: 'Email Ouvert', checkbox: { equals: false } },
            { property: 'Statut', select: { equals: 'Formulaire reÃ§u' } }
          ]
        }
      })
    });

    if (!queryResponse.ok) {
      const err = await queryResponse.text();
      console.error('[Relance] Notion query failed:', err);
      return res.status(500).json({ error: 'Notion query failed' });
    }

    const queryResult = await queryResponse.json();
    const prospects = queryResult.results || [];

    console.log(`[Relance] Found ${prospects.length} prospects to check`);

    let relancesSent = 0;
    const results = [];

    for (const page of prospects) {
      const props = page.properties;
      const nbRelances = props['Nb Relances']?.number || 0;
      const commerce = props['Commerce']?.title?.[0]?.text?.content || 'Commerce';
      const email = props['Email']?.email;
      const secteur = props['Secteur']?.select?.name || '';

      // Skip if already 3+ relances
      if (nbRelances >= 3) {
        results.push({ commerce, status: 'max_relances_reached' });
        continue;
      }

      // Skip if no email
      if (!email) {
        results.push({ commerce, status: 'no_email' });
        continue;
      }

      // Check created date - only relance if page is older than 3 days
      const createdDate = new Date(page.created_time);
      const daysSinceCreation = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);

      // Wait at least 3 days between relances
      const minDays = 3 + (nbRelances * 2); // 3 days, then 5, then 7
      if (daysSinceCreation < minDays) {
        results.push({ commerce, status: 'too_soon', days: Math.round(daysSinceCreation) });
        continue;
      }

      // Send follow-up email
      const relanceNum = nbRelances + 1;
      const emailSent = await sendRelanceEmail(email, commerce, secteur, relanceNum, RESEND_KEY, FROM_EMAIL);

      if (emailSent) {
        // Update Notion
        await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            properties: {
              "Nb Relances": { number: relanceNum },
              "Resend Email ID": { rich_text: [{ text: { content: emailSent } }] },
              "Prochaine action": {
                rich_text: [{ text: { content: relanceNum >= 3 ? 'Relance max atteinte - appeler' : `Relance ${relanceNum}/3 envoyÃ©e` } }]
              }
            }
          })
        });

        relancesSent++;
        results.push({ commerce, status: 'relance_sent', relance: relanceNum });
        console.log(`[Relance] Sent relance #${relanceNum} to ${commerce}`);
      } else {
        results.push({ commerce, status: 'email_failed' });
      }
    }

    // Send WhatsApp summary if any relances were sent
    if (relancesSent > 0) {
      await sendWhatsAppSummary(relancesSent, results);
    }

    return res.status(200).json({
      message: `Relance cron completed`,
      total_checked: prospects.length,
      relances_sent: relancesSent,
      results
    });
  } catch (error) {
    console.error('[Relance Error]', error);
    return res.status(500).json({ error: error.message });
  }
}

async function sendRelanceEmail(to, commerce, secteur, relanceNum, apiKey, fromEmail) {
  const subjects = {
    1: `${commerce} â On a commencÃ© Ã  travailler sur votre site ! ð`,
    2: `${commerce} â Votre maquette est presque prÃªte ð¨`,
    3: `${commerce} â DerniÃ¨re chance de profiter de notre offre ð`
  };

  const bodies = {
    1: `
      <p>Bonjour,</p>
      <p>Suite Ã  votre demande pour <strong>${commerce}</strong>, nous avons commencÃ© Ã  prÃ©parer votre projet de site web.</p>
      <p>Nous avons quelques idÃ©es passionnantes pour votre ${secteur} et aimerions vous les prÃ©senter !</p>
      <p><strong>Vous avez 5 minutes pour un rapide Ã©change ?</strong> RÃ©pondez simplement Ã  cet email ou appelez-nous.</p>
      <p>Ã trÃ¨s bientÃ´t,<br><strong>L'Ã©quipe WebPrestige</strong></p>`,
    2: `
      <p>Bonjour,</p>
      <p>Bonne nouvelle ! La maquette de votre futur site pour <strong>${commerce}</strong> avance bien.</p>
      <p>Nous aimerions vous la montrer et recueillir vos retours avant de finaliser.</p>
      <p><strong>Un petit crÃ©neau de 10 minutes cette semaine ?</strong></p>
      <p>N'hÃ©sitez pas Ã  rÃ©pondre Ã  cet email, on s'adapte Ã  vos disponibilitÃ©s.</p>
      <p>Cordialement,<br><strong>L'Ã©quipe WebPrestige</strong></p>`,
    3: `
      <p>Bonjour,</p>
      <p>C'est notre dernier message concernant votre projet de site web pour <strong>${commerce}</strong>.</p>
      <p>Votre maquette est <strong>prÃªte Ã  Ãªtre prÃ©sentÃ©e</strong> et nous serions ravis de vous la montrer.</p>
      <p>Si vous Ãªtes toujours intÃ©ressÃ©, rÃ©pondez Ã  cet email. Sinon, pas de souci, nous comprenons que ce n'est peut-Ãªtre pas le bon moment.</p>
      <p>Nous vous souhaitons le meilleur pour votre activitÃ© ! ð</p>
      <p>Bien Ã  vous,<br><strong>L'Ã©quipe WebPrestige</strong></p>`
  };

  const htmlContent = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Helvetica Neue', Arial, sans-serif; background: #FAFAF8; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 20px rgba(0,0,0,0.06);">
    <div style="background: linear-gradient(135deg, #C0784A, #D4956B); padding: 24px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 24px;">WebPrestige</h1>
    </div>
    <div style="padding: 32px; color: #5D6D7E; line-height: 1.7;">
      ${bodies[relanceNum] || bodies[1]}
    </div>
    <div style="background: #F8F6F3; padding: 16px 32px; text-align: center; border-top: 1px solid #EDE8E3;">
      <p style="color: #AAB7B8; font-size: 11px; margin: 0;">WebPrestige â Sites web pour commerces de proximitÃ©</p>
    </div>
  </div>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [to],
        subject: subjects[relanceNum] || subjects[1],
        html: htmlContent,
        tags: [
          { name: 'type', value: `relance_${relanceNum}` },
          { name: 'commerce', value: commerce }
        ]
      })
    });

    if (!response.ok) {
      console.error('[Relance Email] Error:', await response.text());
      return null;
    }

    const result = await response.json();
    return result.id;
  } catch (err) {
    console.error('[Relance Email] Failed:', err.message);
    return null;
  }
}

async function sendWhatsAppSummary(count, results) {
  const PHONE = process.env.WHATSAPP_PHONE;
  const API_KEY = process.env.WHATSAPP_API_KEY;
  if (!PHONE || !API_KEY) return;

  const sent = results.filter(r => r.status === 'relance_sent');
  const details = sent.map(r => `- ${r.commerce} (relance #${r.relance})`).join('\n');

  const message = `ð¬ *Relances automatiques*\n\n${count} email(s) envoyÃ©(s) :\n${details}`;
  const url = `https://api.callmebot.com/whatsapp.php?phone=${PHONE}&text=${encodeURIComponent(message)}&apikey=${API_KEY}`;

  try {
    await fetch(url);
  } catch (err) {
    console.error('[WhatsApp Summary] Failed:', err.message);
  }
}
