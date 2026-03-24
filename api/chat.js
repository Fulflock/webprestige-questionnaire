// Chatbot IA WebPrestige — Gemini API (gratuit)
// Aide les prospects à remplir le formulaire

export const config = { maxDuration: 30 };

const SYSTEM_PROMPT = `Tu es l'assistant virtuel de WebPrestige, une agence qui crée des sites vitrines professionnels pour les petits commerces autour de Toulouse.

TON RÔLE :
- Aider les prospects à remplir le questionnaire
- Répondre aux questions sur les services WebPrestige
- Être chaleureux, professionnel et rassurant
- Parler TOUJOURS en français
- Réponses courtes (2-3 phrases max)

INFOS CLÉS À CONNAÎTRE :
- WebPrestige crée des sites vitrines en 48h
- Tarifs : Starter 490€, Pro 790€, Premium 1190€
- Maintenance optionnelle : 49-99€/mois
- Tous les sites sont responsive (mobile + desktop)
- SEO local optimisé (Google Maps, référencement Toulouse)
- Le questionnaire prend 2-3 minutes
- Après le questionnaire, on génère automatiquement des propositions de design
- Un conseiller rappelle sous 24h pour présenter le site personnalisé
- Pas d'engagement, devis gratuit
- Paiement possible en 2 ou 3 fois

SECTEURS : Restaurant, Boulangerie, Coiffeur, Garage, Pizzeria, Kebab/Snack, Artisan/BTP, Commerce/Boutique, Santé/Bien-être, Sport/Loisirs, Service pro, Autre

SI LE PROSPECT DEMANDE :
- "C'est quoi ?" → Explique WebPrestige en 2 phrases
- "Combien ça coûte ?" → Donne les 3 tarifs, dis que le devis est gratuit
- "C'est long ?" → 48h pour la première proposition
- "J'ai déjà un site" → Propose une refonte, montre les avantages
- "Je ne sais pas quoi mettre" → Guide-le champ par champ
- Question hors sujet → Ramène gentiment vers le questionnaire

STYLE : Utilise des emoji avec parcimonie (1 par message max). Sois naturel, pas robotique. Tutoie le prospect.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { message, history = [], formContext = {} } = req.body;
  if (!message) return res.status(400).json({ error: 'Message requis' });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      reply: "Notre assistant est temporairement indisponible. N'hésite pas à remplir le formulaire, notre équipe te recontactera sous 24h ! 😊"
    });
  }

  try {
    // Construire le contexte du formulaire
    let contextInfo = '';
    if (formContext.currentStep) {
      const stepNames = { 1: 'Votre commerce', 2: 'Votre identité', 3: 'Votre site', 4: 'Finalisation' };
      contextInfo += `\n[Le prospect est à l'étape ${formContext.currentStep}/4 : "${stepNames[formContext.currentStep] || ''}"]\n`;
    }
    if (formContext.nom_commerce) contextInfo += `[Commerce : ${formContext.nom_commerce}]\n`;
    if (formContext.secteur) contextInfo += `[Secteur : ${formContext.secteur}]\n`;
    if (formContext.commune) contextInfo += `[Commune : ${formContext.commune}]\n`;

    // Construire les messages pour Gemini
    const contents = [];

    // Historique
    for (const msg of history.slice(-6)) {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }]
      });
    }

    // Message actuel
    contents.push({
      role: 'user',
      parts: [{ text: contextInfo ? `${contextInfo}\n${message}` : message }]
    });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: {
            maxOutputTokens: 200,
            temperature: 0.7
          }
        })
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('[Chat] Gemini erreur:', response.status, err.substring(0, 200));
      return res.status(200).json({
        reply: "Désolé, je rencontre un petit souci technique. Remplis le formulaire tranquillement, notre équipe te recontactera rapidement !"
      });
    }

    const result = await response.json();
    const reply = result.candidates?.[0]?.content?.parts?.[0]?.text || "Je n'ai pas compris, peux-tu reformuler ?";

    return res.status(200).json({ reply });

  } catch (error) {
    console.error('[Chat] Erreur:', error.message);
    return res.status(200).json({
      reply: "Oups, petit bug de mon côté ! Continue à remplir le formulaire, c'est rapide 😊"
    });
  }
}
