/* =======================================================================
   ACADEMY ENGINE - SAAS BLINDADO (PRODUÇÃO)
======================================================================= */

/* ---------------- OPENROUTER ---------------- */
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODELS = [
  'openai/gpt-4o-mini',              // custo/benefício principal
  'meta-llama/llama-3.1-8b-instruct',// fallback rápido
  'anthropic/claude-3.5-sonnet'      // fallback inteligente
];

const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY';

/* ---------------- RATE LIMIT (simples SaaS) ---------------- */
const RATE = new Map(); // memória temporária (Vercel instance)

function rateLimit(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000; // 1 min
  const maxReq = 20;

  const data = RATE.get(ip) || { count: 0, start: now };

  if (now - data.start > windowMs) {
    RATE.set(ip, { count: 1, start: now });
    return true;
  }

  if (data.count >= maxReq) return false;

  data.count++;
  RATE.set(ip, data);
  return true;
}

/* ---------------- HANDLER ---------------- */
export default async function handler(req, res) {

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json(error('METHOD_NOT_ALLOWED'));

  const ip = req.headers['x-forwarded-for'] || 'unknown';

  if (!rateLimit(ip)) {
    return res.status(429).json(error('RATE_LIMIT_EXCEEDED'));
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json(error('INVALID_JSON'));
  }

  const action = normalizeAction(body?.action);
  const payload = body?.payload || {};

  try {

    switch (action) {

      case 'chat':
        return res.json(success('chat', await chat(payload)));

      case 'generate_lesson':
        return res.json(success('generate_lesson', await lesson(payload)));

      default:
        return res.status(400).json(error('UNKNOWN_ACTION', { action }));
    }

  } catch (err) {
    console.error('[ENGINE ERROR]', err);
    return res.status(500).json(error('INTERNAL_ERROR', err.message));
  }
}

/* ---------------- CHAT ---------------- */
async function chat(payload) {
  const { pedido, historico = [] } = payload;

  if (!pedido) throw new Error('pedido obrigatório');

  const messages = [
    { role: 'system', content: 'Assistente académico. Português Angola. Máx 200 palavras.' },
    ...historico.slice(-6),
    { role: 'user', content: pedido }
  ];

  const resposta = await callWithFallback(messages, { max_tokens: 800 });
  return { resposta };
}

/* ---------------- LESSON ---------------- */
async function lesson(payload) {
  const { tema, capTitulo, capNum = 1, capSubs = [] } = payload;

  if (!tema || !capTitulo) throw new Error('tema e capTitulo obrigatórios');

  const prompt = `
Capítulo ${capNum} - ${capTitulo}
Tema: ${tema}

Subtópicos:
${capSubs.join('\n')}

Regras:
- académico
- sem bullets
- português Angola
- 70-120 palavras por parágrafo
`;

  const resposta = await callWithFallback([
    { role: 'user', content: prompt }
  ], { max_tokens: 1200 });

  return { resposta };
}

/* ---------------- OPENROUTER FALLBACK ---------------- */
async function callWithFallback(messages, opts) {

  let lastError = null;

  for (const model of MODELS) {
    try {
      const res = await callOpenRouter(model, messages, opts);
      if (res && res.length > 20) return res;
    } catch (err) {
      lastError = err.message;
      console.warn('[MODEL FAIL]', model, err.message);
    }
  }

  throw new Error('Todos os modelos falharam: ' + lastError);
}

/* ---------------- CORE ---------------- */
async function callOpenRouter(model, messages, opts) {

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('API KEY missing');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {

    const resp = await fetch(OR_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer': OR_SITE,
        'X-Title': OR_TITLE,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.max_tokens ?? 800,
      }),
    });

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) throw new Error('Empty response');

    return text;

  } finally {
    clearTimeout(timeout);
  }
}

/* ---------------- NORMALIZER ---------------- */
function normalizeAction(action) {
  const map = {
    chat: 'chat',
    message: 'chat',

    generate_lesson: 'generate_lesson',
    generate_work: 'generate_lesson',
    create_work: 'generate_lesson',
    lesson: 'generate_lesson',
    criar_trabalho: 'generate_lesson'
  };

  return map[action] || action;
}

/* ---------------- RESPONSES ---------------- */
function success(action, data) {
  return { ok: true, action, data };
}

function error(code, detail = null) {
  return { ok: false, error: code, detail };
                                }
