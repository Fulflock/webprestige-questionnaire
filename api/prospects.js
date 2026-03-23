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
  if (key !== (process.env.ADMIN_KEY || '1125')) {
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
        sorts: [{ property: 'Date premier contact', direction: 'descending' }],
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
        notes: p['Notes']?.rich_text?.[0]?.text?.content || '',
        date_contact: p['Date premier contact']?.date?.start || '',
        lien_demo: p['Lien démo Lovable']?.url || '',
        prochaine_action: p['Prochaine action']?.rich_text?.[0]?.text?.content || '',
        notion_url: page.url
      };
    });

    const stats = {
      total: prospects.length,
      identifie: prospects.filter(p => p.statut === 'Identifié').length,
      contacte: prospects.filter(p => p.statut === 'Contacté').length,
      formulaire_envoye: prospects.filter(p => p.statut === 'Formulaire envoyé').length,
      formulaire_recu: prospects.filter(p => p.statut === 'Formulaire reçu').length,
      demo: prospects.filter(p => p.statut === 'Démo envoyée').length,
      rdv: prospects.filter(p => p.statut === 'RDV fixé').length,
      devis: prospects.filter(p => p.statut === 'Devis envoyé').length,
      signe: prospects.filter(p => p.statut === 'Signé').length,
      perdu: prospects.filter(p => p.statut === 'Perdu' || p.statut === 'Hors cible').length,
    };

    return res.status(200).json({ prospects, stats });
  } catch (error) {
    console.error('[Prospects API] Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}
