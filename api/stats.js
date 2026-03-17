// WebPrestige — Mise à jour auto du Tableau de Bord Notion
// Cron quotidien 8h + déclenché à chaque nouveau prospect

export const config = { maxDuration: 30 };

const DASHBOARD_PAGE_ID = '325be138-6371-817e-9523-ddd2b2853d11';

export default async function handler(req, res) {
  try {
    const NOTION_TOKEN = process.env.NOTION_API_TOKEN;
    const DATABASE_ID = process.env.NOTION_DATABASE_ID;

    if (!NOTION_TOKEN || !DATABASE_ID) {
      return res.status(500).json({ error: 'NOTION_API_TOKEN ou NOTION_DATABASE_ID manquant' });
    }

    console.log('[Stats] Démarrage mise à jour dashboard...');

    const allProspects = await queryAllProspects(NOTION_TOKEN, DATABASE_ID);
    console.log(`[Stats] ${allProspects.length} prospects trouvés`);

    const stats = computeStats(allProspects);
    console.log('[Stats] Résultats:', JSON.stringify(stats));

    await updateDashboardPage(NOTION_TOKEN, stats);
    console.log('[Stats] Dashboard mis à jour ✓');

    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error('[Stats] Erreur:', error);
    return res.status(500).json({ error: error.message });
  }
}

async function queryAllProspects(token, dbId) {
  let all = [];
  let cursor = undefined;

  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;

    const resp = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify(body)
    });

    if (!resp.ok) throw new Error(`Notion query failed: ${await resp.text()}`);
    const data = await resp.json();
    all = all.concat(data.results);
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);

  return all;
}

function computeStats(prospects) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const weekStart = getWeekStart(now);
  const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const counts = {
    total: prospects.length,
    byStatus: {},
    thisWeek: { prospects: 0, demos: 0, rdv: 0, devis: 0, signes: 0 },
    thisMonth: { prospects: 0, demos: 0, rdv: 0, devis: 0, signes: 0 },
    today: { prospects: 0 },
    funnel: { formulaire: 0, demo: 0, rdv: 0, devis: 0, signe: 0, perdu: 0 }
  };

  for (const page of prospects) {
    const props = page.properties || {};
    const statut = props['Statut']?.select?.name || '';
    const dateContact = props['Date contact']?.date?.start || props['Date premier contact']?.date?.start || '';

    counts.byStatus[statut] = (counts.byStatus[statut] || 0) + 1;

    // Funnel cumulatif
    if (statut.includes('Nouveau') || statut.includes('Formulaire')) counts.funnel.formulaire++;
    if (statut.includes('Contacté') || statut.includes('Démo')) { counts.funnel.formulaire++; counts.funnel.demo++; }
    if (statut.includes('RDV')) { counts.funnel.formulaire++; counts.funnel.demo++; counts.funnel.rdv++; }
    if (statut.includes('Devis')) { counts.funnel.formulaire++; counts.funnel.demo++; counts.funnel.rdv++; counts.funnel.devis++; }
    if (statut.includes('Signé')) { counts.funnel.formulaire++; counts.funnel.demo++; counts.funnel.rdv++; counts.funnel.devis++; counts.funnel.signe++; }
    if (statut.includes('Perdu')) counts.funnel.perdu++;

    if (dateContact) {
      const isThisWeek = dateContact >= weekStart;
      const isThisMonth = dateContact.startsWith(monthKey);
      const isToday = dateContact === today;

      if (isThisWeek) counts.thisWeek.prospects++;
      if (isThisMonth) counts.thisMonth.prospects++;
      if (isToday) counts.today.prospects++;
    }
  }

  const f = counts.funnel;
  counts.conversion = {
    formulaire_demo: f.formulaire > 0 ? Math.round((f.demo / f.formulaire) * 100) : 0,
    demo_rdv: f.demo > 0 ? Math.round((f.rdv / f.demo) * 100) : 0,
    rdv_devis: f.rdv > 0 ? Math.round((f.devis / f.rdv) * 100) : 0,
    devis_signe: f.devis > 0 ? Math.round((f.signe / f.devis) * 100) : 0
  };

  return counts;
}

function getWeekStart(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().split('T')[0];
}

async function updateDashboardPage(token, stats) {
  const now = new Date();
  const moisNoms = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
    'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  const moisActuel = `${moisNoms[now.getMonth()]} ${now.getFullYear()}`;
  const dateStr = now.toLocaleString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const c = stats.conversion;
  const f = stats.funnel;
  const w = stats.thisWeek;
  const m = stats.thisMonth;
  const s = stats.byStatus;

  // Supprimer les anciens blocs
  const existing = await getBlockChildren(token, DASHBOARD_PAGE_ID);
  for (const block of existing) {
    await deleteBlock(token, block.id);
  }

  // Construire les nouveaux blocs
  const blocks = [
    heading1('Tableau de Bord WebPrestige'),
    callout(`Dernière mise à jour auto : ${dateStr}`, '🔄'),
    divider(),

    heading2('Vue d\'ensemble'),
    table(true, [
      ['Métrique', 'Nombre'],
      ['Total prospects', String(stats.total)],
      ['En attente de traitement', String(s['🆕 Nouveau'] || s['Formulaire reçu'] || 0)],
      ['Contactés / Démo envoyée', String((s['📧 Contacté'] || 0) + (s['Démo envoyée'] || 0))],
      ['RDV fixés', String(s['RDV fixé'] || s['📅 RDV fixé'] || 0)],
      ['Devis envoyés', String(s['Devis envoyé'] || s['💰 Devis envoyé'] || 0)],
      ['Signés', String(s['Signé'] || s['✅ Signé'] || 0)],
      ['Perdus', String(s['Perdu'] || s['❌ Perdu'] || 0)]
    ]),
    divider(),

    heading2('Cette semaine'),
    table(true, [
      ['Métrique', 'Nombre'],
      ['Nouveaux prospects', String(w.prospects)],
      ['Aujourd\'hui', String(stats.today.prospects)]
    ]),
    divider(),

    heading2(moisActuel),
    table(true, [
      ['Métrique', 'Nombre'],
      ['Nouveaux prospects', String(m.prospects)]
    ]),
    divider(),

    heading2('Funnel de conversion'),
    code(`Prospects : ${f.formulaire}\n       ↓ ${c.formulaire_demo}%\nContactés/Démos : ${f.demo}\n       ↓ ${c.demo_rdv}%\nRDV fixés : ${f.rdv}\n       ↓ ${c.rdv_devis}%\nDevis envoyés : ${f.devis}\n       ↓ ${c.devis_signe}%\nSignés : ${f.signe}\n\nPerdus : ${f.perdu}`),
    divider(),

    heading2('Taux de conversion'),
    table(true, [
      ['Étape', 'Taux', 'Objectif', 'OK ?'],
      ['Formulaire → Démo', `${c.formulaire_demo}%`, '100%', c.formulaire_demo >= 100 ? '✅' : '⚠️'],
      ['Démo → RDV', `${c.demo_rdv}%`, '30%', c.demo_rdv >= 30 ? '✅' : '❌'],
      ['RDV → Devis', `${c.rdv_devis}%`, '70%', c.rdv_devis >= 70 ? '✅' : '❌'],
      ['Devis → Signé', `${c.devis_signe}%`, '50%', c.devis_signe >= 50 ? '✅' : '❌']
    ]),
    divider(),

    heading2('Actions requises maintenant')
  ];

  // Actions dynamiques
  const nouveau = s['🆕 Nouveau'] || s['Formulaire reçu'] || 0;
  const contacte = (s['📧 Contacté'] || 0) + (s['Démo envoyée'] || 0);
  const rdv = s['RDV fixé'] || s['📅 RDV fixé'] || 0;
  const devis = s['Devis envoyé'] || s['💰 Devis envoyé'] || 0;

  if (nouveau > 0) blocks.push(bullet(`⚡ ${nouveau} prospect(s) en attente → Ouvre ta boîte mail`));
  else blocks.push(bullet('✅ Aucun formulaire en attente'));

  if (contacte > 0) blocks.push(bullet(`📞 ${contacte} prospect(s) en attente de réponse → Vérifier relances`));
  else blocks.push(bullet('✅ Aucune relance en attente'));

  if (rdv > 0) blocks.push(bullet(`📅 ${rdv} RDV à préparer`));
  if (devis > 0) blocks.push(bullet(`💰 ${devis} devis en attente de signature`));

  // Envoyer par batch de 100
  for (let i = 0; i < blocks.length; i += 100) {
    await fetch(`https://api.notion.com/v1/blocks/${DASHBOARD_PAGE_ID}/children`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({ children: blocks.slice(i, i + 100) })
    });
  }
}

async function getBlockChildren(token, blockId) {
  const resp = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?page_size=100`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
  });
  if (!resp.ok) return [];
  return (await resp.json()).results || [];
}

async function deleteBlock(token, blockId) {
  await fetch(`https://api.notion.com/v1/blocks/${blockId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${token}`, 'Notion-Version': '2022-06-28' }
  });
}

// Notion block helpers
function heading1(text) {
  return { object: 'block', type: 'heading_1', heading_1: { rich_text: [{ text: { content: text } }] } };
}
function heading2(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: text } }] } };
}
function divider() {
  return { object: 'block', type: 'divider', divider: {} };
}
function callout(text, emoji) {
  return { object: 'block', type: 'callout', callout: { icon: { type: 'emoji', emoji }, rich_text: [{ text: { content: text } }] } };
}
function bullet(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: parseRichText(text) } };
}
function code(text) {
  return { object: 'block', type: 'code', code: { rich_text: [{ text: { content: text } }], language: 'plain text' } };
}
function table(hasHeader, rows) {
  return {
    object: 'block', type: 'table',
    table: {
      table_width: rows[0].length,
      has_column_header: hasHeader,
      has_row_header: false,
      children: rows.map(row => ({
        object: 'block', type: 'table_row',
        table_row: { cells: row.map(cell => [{ type: 'text', text: { content: cell } }]) }
      }))
    }
  };
}
function parseRichText(text) {
  const parts = [];
  const regex = /\*\*(.*?)\*\*/g;
  let last = 0, match;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push({ text: { content: text.substring(last, match.index) } });
    parts.push({ text: { content: match[1] }, annotations: { bold: true } });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: { content: text.substring(last) } });
  return parts.length ? parts : [{ text: { content: text } }];
}
