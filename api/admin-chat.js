// Chatbot IA Admin — aide le commercial à gérer ses prospects
// Utilise Gemini (gratuit) + contexte Notion en temps réel

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `Tu es l'assistant IA de gestion WebPrestige. Tu aides le commercial à gérer ses prospects et son pipeline de vente.

TON RÔLE :
- Aider le commercial à savoir quoi faire ensuite
- Analyser les données des prospects et donner des conseils
- Répondre aux questions sur le workflow, les process, les emails
- Être direct, concret et orienté action
- Parler en français, tutoyer

WORKFLOW WEBPRESTIGE :
1. Prospect remplit le formulaire → fiche créée auto dans le pipeline
2. 2 sites sont générés automatiquement (v0 React + Claude HTML)
3. Le commercial reçoit un email avec les 2 versions
4. Il choisit la meilleure, la personnalise si besoin
5. Il envoie la démo au prospect
6. Relances J+2 et J+7 si pas de réponse
7. RDV → Devis → Signature → Livraison

STATUTS : 🆕 Nouveau → 📧 Contacté → 📅 RDV fixé → 💰 Devis envoyé → ✅ Signé / ❌ Perdu

TARIFS :
- Starter : 490€ (1-3 pages, livraison 48h)
- Pro : 790€ (3-5 pages, galerie, formulaire, animations)
- Premium : 1190€ (site complet, réservation en ligne, SEO avancé)
- Maintenance : 49-99€/mois

CONSEILS COMMERCIAUX :
- Toujours rappeler dans les 24h après réception du formulaire
- La vidéo Loom personnalisée augmente le taux de conversion de 3x
- Proposer systématiquement la maintenance mensuelle
- Si budget serré → proposer le Starter avec upgrade possible plus tard
- Relancer max 2 fois, ne pas insister (garder une bonne image)

QUAND ON TE DONNE LE CONTEXTE DES PROSPECTS :
- Analyse les statuts et dis ce qu'il y a à faire en priorité
- Identifie les prospects à relancer (contactés depuis plus de 2 jours)
- Calcule des stats simples si demandé
- Suggère des actions concrètes

FORMAT : Réponses courtes (3-5 lignes max). Utilise des bullet points. Sois actionnable.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history = [], prospects = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      reply: "L'assistant IA n'est pas encore configuré. Ajoute GEMINI_API_KEY dans Vercel (gratuit sur aistudio.google.com)."
    });
  }

  try {
    // Construire le contexte des prospects
    let prospectContext = '';
    if (prospects.length > 0) {
      prospectContext = `\n\n[DONNÉES ACTUELLES DU PIPELINE — ${prospects.length} prospects]\n`;
      const stats = { total: prospects.length };
      const byStatus = {};
      prospects.forEach(p => {
        const s = p.statut || 'Inconnu';
        byStatus[s] = (byStatus[s] || 0) + 1;
      });
      prospectContext += `Stats : ${Object.entries(byStatus).map(([k,v]) => `${k}: ${v}`).join(', ')}\n\n`;
      // Détails des 20 derniers prospects
      prospects.slice(0, 20).forEach(p => {
        prospectContext += `- ${p.commerce} (${p.secteur}) | ${p.commune} | ${p.statut} | ${p.telephone || 'pas de tel'} | créé le ${p.date_contact || '?'} | ${p.lien_demo ? 'site: ' + p.lien_demo : 'pas de site'}\n`;
      });
    }

    const contents = [];
    for (const msg of history.slice(-8)) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }
    contents.push({
      role: 'user',
      parts: [{ text: prospectContext ? `${prospectContext}\n\nQuestion : ${message}` : message }]
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 }
        })
      }
    );

    if (!response.ok) {
      console.error('[AdminChat] Gemini erreur:', response.status);
      return res.status(200).json({ reply: "Erreur temporaire de l'IA. Réessaie dans quelques secondes." });
    }

    const result = await response.json();
    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text || "Je n'ai pas compris, reformule.";
    return res.status(200).json({ reply });

  } catch (error) {
    console.error('[AdminChat] Erreur:', error.message);
    return res.status(200).json({ reply: "Erreur technique. Réessaie." });
  }
}
