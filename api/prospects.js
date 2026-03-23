// API Endpoint — Retourne tous les prospects depuis Notion
// GET /api/prospects → JSON array

export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const key = req.query.key;
  if (key !== (process.env.ADMIN_KEY || 'webprestige2026')) {
    return res.status(401).json({ error: 'Clé admin requise' });
  }

  try {
    const response = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        sorts: [{ property: 'Date contact', direction: 'descending' }],
        page_size: 100
      })
    });

    if (!response.ok) throw new Error(`Notion ${response.status}: ${await response.text()}`);
    const data = await response.json();

    const prospects = data.results.map(page => {
      const p = page.properties;
      return {
        id: page.id,
        created: page.created_time,
        commerce: p['Commerce']?.title?.[0]?.text?.content || '',
        secteur: p['Secteur']?.select?.name || '',
        commune: p['Commune']?.rich_text?.[0]?.text?.content || '',
        adresse: p['Adresse']?.rich_text?.[0]?.text?.content || '',
        telephone: p['Téléphone']?.phone_number || '',
        email: p['Email']?.email || '',
        note_google: p['Note Google']?.rich_text?.[0]?.text?.content || '',
        statut: p['Statut']?.select?.name || '',
        priorite: p['Priorité']?.select?.name || '',
        prenom_gerant: p['Prénom gérant']?.rich_text?.[0]?.text?.content || '',
        budget: p['Budget']?.rich_text?.[0]?.text?.content || '',
        notes: p['Notes']?.rich_text?.[0]?.text?.content || '',
        date_contact: p['Date contact']?.date?.start || '',
        lien_demo: p['Lien démo']?.url || '',
        notion_url: page.url
      };
    });

    const stats = {
      total: prospects.length,
      nouveau: prospects.filter(p => p.statut?.includes('Nouveau')).length,
      contacte: prospects.filter(p => p.statut?.includes('Contacté')).length,
      rdv: prospects.filter(p => p.statut?.includes('RDV')).length,
      devis: prospects.filter(p => p.statut?.includes('Devis')).length,
      signe: prospects.filter(p => p.statut?.includes('Signé')).length,
      perdu: prospects.filter(p => p.statut?.includes('Perdu')).length,
    };

    return res.status(200).json({ prospects, stats });
  } catch (error) {
    console.error('[Prospects API] Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}
