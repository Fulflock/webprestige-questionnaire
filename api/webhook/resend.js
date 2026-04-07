// Webhook endpoint for Resend email events
// Tracks: email opened, clicked, bounced
// Updates Notion database accordingly

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const event = req.body;
    console.log('[Resend Webhook] Event:', event.type, event.data?.email_id);

    const emailId = event.data?.email_id;
    if (!emailId) {
      return res.status(200).json({ received: true });
    }

    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const DATABASE_ID = process.env.NOTION_DATABASE_ID || '8f57d0df-ae99-4bd7-bd50-b30d5ac91538';

    if (!NOTION_TOKEN) {
      console.warn('[Webhook] No Notion token, skipping');
      return res.status(200).json({ received: true });
    }

    // Find the Notion page with this Resend Email ID
    const searchResponse = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        filter: {
          property: 'Resend Email ID',
          rich_text: { equals: emailId }
        }
      })
    });

    if (!searchResponse.ok) {
      console.error('[Webhook] Notion search failed:', await searchResponse.text());
      return res.status(200).json({ received: true });
    }

    const searchResult = await searchResponse.json();
    const page = searchResult.results?.[0];

    if (!page) {
      console.log('[Webhook] No matching Notion page for email:', emailId);
      return res.status(200).json({ received: true });
    }

    // Handle different event types
    switch (event.type) {
      case 'email.opened':
        await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            properties: {
              "Email Ouvert": { checkbox: true },
              "Priorité": { select: { name: "CHAUD" } }
            }
          })
        });
        console.log('[Webhook] Marked as opened:', page.id);
        break;

      case 'email.bounced':
        await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${NOTION_TOKEN}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            properties: {
              "Notes": {
                rich_text: [{ text: { content: 'Email bounced - adresse invalide' } }]
              }
            }
          })
        });
        console.log('[Webhook] Marked as bounced:', page.id);
        break;

      default:
        console.log('[Webhook] Unhandled event type:', event.type);
    }

    return res.status(200).json({ received: true, processed: event.type });
  } catch (error) {
    console.error('[Webhook Error]', error);
    return res.status(200).json({ received: true, error: error.message });
  }
}
