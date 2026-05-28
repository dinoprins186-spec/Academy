/* =======================================================================
   ACADEMY - /api/engine (Vercel Serverless Function)
======================================================================= */

const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL = 'google/gemini-flash-1.5';
const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY - Grupo AGEA';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

export default async function handler(req, res) {

  if (req.method === 'OPTIONS') {
    Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'JSON inválido' });
  }

  const { action, payload = {} } = body;

  if (!action) {
    return res.status(400).json({ ok: false, error: 'action é obrigatório' });
  }

  try {
    switch (action) {
      case 'chat':
        return res.status(200).json(await chat(payload));

      case 'generate_lesson':
        return res.status(200).json(await generateLesson(payload));

      default:
        return res.status(400).json({ ok: false, error: 'ação desconhecida' });
    }

  } catch (err) {
    console.error('[engine error]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function chat(payload) {
  const { pedido, historico = [] } = payload;

  if (!pedido) throw new Error('pedido é obrigatório');

  const messages = [
    { role: 'system', content: 'Assistente académico. Português de Angola. Máx 200 palavras.' },
    ...(Array.isArray(historico) ? historico.slice(-6) : []),
    { role: 'user', content: pedido }
  ];

  const resposta = await callOpenRouter(messages, {
    max_tokens: 800,
    temperature: 0.7
  });

  return { ok: true, action: 'chat', data: { resposta } };
}

async function generateLesson(payload) {
  const { tema, capTitulo, capNum = 1, capSubs = [] } = payload;

  if (!tema || !capTitulo) throw new Error('tema e capTitulo são obrigatórios');

  const prompt = `
Capítulo ${capNum} - "${capTitulo}" sobre "${tema}"

Subtópicos:
${capSubs.join('\n')}

Regras:
- académico
- sem bullets
- 70–120 palavras por parágrafo
- português de Angola
`;

  const resposta = await callOpenRouter([
    { role: 'user', content: prompt }
  ], {
    max_tokens: 1400,
    temperature: 0.7
  });

  return { ok: true, action: 'generate_lesson', data: { resposta } };
}

async function callOpenRouter(messages, opts = {}) {

  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error('OPENROUTER_API_KEY não configurada na Vercel');
  }

  const resp = await fetch(OR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': OR_SITE,
      'X-Title': OR_TITLE,
    },
    body: JSON.stringify({
      model: OR_MODEL,
      messages,
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.max_tokens ?? 1000,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`OpenRouter error: ${err}`);
  }

  const data = await resp.json();

  const text = data?.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error('Resposta vazia do modelo');
  }

  return text;
}
