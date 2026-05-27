// ══════════════════════════════════════════════════════════════════════════
// ACADEMY — api/groq.js
// Proxy seguro para a API Groq (chave nunca exposta no frontend)
// ══════════════════════════════════════════════════════════════════════════

const GROQ_BASE  = 'https://api.groq.com/openai/v1';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  return res;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCORS(res);
    return res.status(200).end();
  }

  setCORS(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const key = process.env.GROQ_API_KEY;
  if (!key) {
    return res.status(500).json({ error: 'GROQ_API_KEY não configurada' });
  }

  try {
    const { model, messages, temperature = 0.7, max_tokens = 1024 } = req.body || {};

    if (!messages?.length) {
      return res.status(400).json({ error: 'messages obrigatório' });
    }

    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:       model || GROQ_MODEL,
        messages,
        temperature,
        max_tokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return res.status(response.status).json({ error: `Groq ${response.status}: ${error}` });
    }

    const data = await response.json();
    return res.status(200).json(data);

  } catch (e) {
    console.error('[GROQ ERROR]', e.message);
    return res.status(500).json({ error: e.message });
  }
}
