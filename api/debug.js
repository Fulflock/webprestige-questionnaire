// Endpoint de diagnostic — teste les clés API
// GET /api/debug?key=1125

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.query.key !== '1125') return res.status(401).json({ error: 'Unauthorized' });

  const results = {
    env: {
      NOTION_API_TOKEN: !!process.env.NOTION_API_TOKEN,
      NOTION_DATABASE_ID: !!process.env.NOTION_DATABASE_ID,
      RESEND_API_KEY: !!process.env.RESEND_API_KEY,
      V0_API_TOKEN: !!process.env.V0_API_TOKEN,
      ANTHROPIC_API_KEY: !!process.env.ANTHROPIC_API_KEY,
      ANTHROPIC_KEY_LENGTH: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.length : 0,
      ANTHROPIC_KEY_PREFIX: process.env.ANTHROPIC_API_KEY ? process.env.ANTHROPIC_API_KEY.substring(0, 8) + '...' : 'MISSING',
      V0_KEY_LENGTH: process.env.V0_API_TOKEN ? process.env.V0_API_TOKEN.length : 0,
      V0_KEY_PREFIX: process.env.V0_API_TOKEN ? process.env.V0_API_TOKEN.substring(0, 8) + '...' : 'MISSING',
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      GEMINI_KEY_LENGTH: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.length : 0,
      GEMINI_KEY_PREFIX: process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.substring(0, 8) + '...' : 'MISSING',
    },
    tests: {}
  };

  // Test Notion
  try {
    const r = await fetch(`https://api.notion.com/v1/databases/${process.env.NOTION_DATABASE_ID}`, {
      headers: { 'Authorization': `Bearer ${process.env.NOTION_API_TOKEN}`, 'Notion-Version': '2022-06-28' }
    });
    results.tests.notion = { status: r.status, ok: r.ok };
  } catch (e) {
    results.tests.notion = { error: e.message };
  }

  // Test Anthropic
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY || '',
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Réponds juste "OK"' }]
      })
    });
    const body = await r.json();
    results.tests.anthropic = { status: r.status, ok: r.ok, response: r.ok ? 'OK' : JSON.stringify(body).substring(0, 200) };
  } catch (e) {
    results.tests.anthropic = { error: e.message };
  }

  // Test v0
  try {
    const r = await fetch('https://api.v0.dev/v1/chats', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.V0_API_TOKEN || ''}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'Hello test' })
    });
    const body = await r.text();
    results.tests.v0 = { status: r.status, ok: r.ok, response: body.substring(0, 200) };
  } catch (e) {
    results.tests.v0 = { error: e.message };
  }

  // Test Gemini
  try {
    const gKey = process.env.GEMINI_API_KEY || '';
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${gKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Dis OK' }] }],
          generationConfig: { maxOutputTokens: 10 }
        })
      }
    );
    const body = await r.json();
    results.tests.gemini = { status: r.status, ok: r.ok, response: r.ok ? 'OK' : JSON.stringify(body).substring(0, 300) };
  } catch (e) {
    results.tests.gemini = { error: e.message };
  }

  // Test Resend
  try {
    const r = await fetch('https://api.resend.com/domains', {
      headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY || ''}` }
    });
    results.tests.resend = { status: r.status, ok: r.ok };
  } catch (e) {
    results.tests.resend = { error: e.message };
  }

  return res.status(200).json(results);
}
