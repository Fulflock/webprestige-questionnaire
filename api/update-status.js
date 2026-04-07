// Update prospect status from admin dashboard
// POST /api/update-status { pageId, status, key }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { pageId, status, key, note } = req.body;
  const adminKey = process.env.ADMIN_KEY || '1125';
  if (key !== adminKey) return res.status(401).json({ error: 'Unauthorized' });
  if (!pageId || !status) return res.status(400).json({ error: 'pageId and status required' });

  const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
  if (!NOTION_TOKEN) return res.status(500).json({ error: 'Missing Notion config' });

  const validStatuses = [
    'Identifié', 'Contacté', 'Formulaire reçu', 'Démo envoyée',
    'RDV fixé', 'Devis envoyé', 'Signé', 'Perdu'
  ];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: 'Invalid status', valid: validStatuses });
  }

  try {
    const properties = {
      "Statut": { select: { name: status } }
    };

    // Add note if provided
    if (note) {
      properties["Prochaine action"] = {
        rich_text: [{ text: { content: note } }]
      };
    }

    // Set priority based on status
    if (status === 'RDV fixé' || status === 'Devis envoyé') {
      properties["Priorité"] = { select: { name: "CHAUD" } };
    } else if (status === 'Signé') {
      properties["Priorité"] = { select: { name: "CHAUD" } };
    }

    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ properties })
    });

    if (!response.ok) {
      const err = await response.text();
      return res.status(500).json({ error: 'Notion update failed', detail: err.substring(0, 200) });
    }

    return res.status(200).json({ success: true, pageId, newStatus: status });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
