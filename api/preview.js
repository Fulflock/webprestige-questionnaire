// Sert le HTML généré par Claude, stocké dans une page Notion
// URL : /api/preview?id=NOTION_PAGE_ID

export const config = { maxDuration: 10 };

export default async function handler(req, res) {
    const pageId = req.query.id;

    if (!pageId) {
        return res.status(400).send('Missing page ID');
    }

    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    if (!NOTION_TOKEN) {
        return res.status(500).send('Notion not configured');
    }

    try {
        // Récupérer les blocs enfants de la page Notion
        const response = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`, {
            headers: {
                'Authorization': `Bearer ${NOTION_TOKEN}`,
                'Notion-Version': '2022-06-28'
            }
        });

        if (!response.ok) {
            return res.status(404).send('Page not found');
        }

        const data = await response.json();

        // Trouver les blocs de code HTML (après le heading "Site HTML généré par Claude")
        let collecting = false;
        let htmlParts = [];

        for (const block of data.results) {
            if (block.type === 'heading_2') {
                const text = block.heading_2?.rich_text?.[0]?.plain_text || '';
                if (text.includes('Site HTML généré')) {
                    collecting = true;
                    continue;
                } else if (collecting) {
                    break; // Fin de la section HTML
                }
            }

            if (collecting && block.type === 'code') {
                const codeText = block.code?.rich_text?.map(r => r.plain_text).join('') || '';
                htmlParts.push(codeText);
            }
        }

        const html = htmlParts.join('');

        if (!html || (!html.includes('<!DOCTYPE') && !html.includes('<html'))) {
            return res.status(404).send(`
                <html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f5f5f5;">
                <div style="text-align:center;padding:40px;">
                    <h1>🚧 Site en cours de génération</h1>
                    <p>Le site n'est pas encore prêt. Réessayez dans quelques instants.</p>
                </div></body></html>
            `);
        }

        // Servir le HTML avec cache court
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        return res.status(200).send(html);

    } catch (error) {
        console.error('[Preview] Error:', error);
        return res.status(500).send('Erreur serveur');
    }
}
