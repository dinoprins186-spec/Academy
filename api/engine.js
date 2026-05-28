/* =======================================================================
   ACADEMY - /api/engine (PRODUÇÃO ESTÁVEL)
======================================================================= */

/* ---------------- CONFIG OPENROUTER ---------------- */
const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

/* 🔥 MODELOS (ordem de custo/benefício) */
const MODELS = {
  primary: 'openai/gpt-4o-mini',                  // melhor custo/benefício
  fast: 'meta-llama/llama-3.1-8b-instruct',       // fallback rápido
  smart: 'anthropic/claude-3.5-sonnet'            // fallback qualidade
};

const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY - Grupo AGEA';

/* ---------------- CORS ---------------- */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

/* ==================================================================== */
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
    return res.status(400).json({ ok: false, error: 'action obrigatório' });
  }

  try {

    switch (action) {

      case 'chat':
        return res.json(await chat(payload));

      case 'generate_lesson':
        return res.json(await generateLesson(payload));

      default:
        return res.status(400).json({ ok: false, error: 'ação desconhecida' });
    }

  } catch (err) {
    console.error('[ENGINE ERROR]', err);
    return res.status(500).json({
      ok: false,
      error: 'Erro interno no servidor',
      detail: err.message
    });
  }
}

/* =================================================================== */
/* CHAT */
/* =================================================================== */
async function chat(payload) {
  const { pedido, historico = [], tema = '' } = payload;

  if (!pedido) {
    return { ok: false, error: 'pedido obrigatório' };
  }

  const messages = [
    {
      role: 'system',
      content: `Assistente académico. Português de Angola. Máx 200 palavras.`
    },
    ...(Array.isArray(historico) ? historico.slice(-6) : []),
    { role: 'user', content: pedido }
  ];

  const resposta = await callWithFallback(messages, {
    max_tokens: 800,
    temperature: 0.7
  });

  return {
    ok: true,
    action: 'chat',
    data: { resposta }
  };
}

/* =================================================================== */
/* LESSON */
/* =================================================================== */
async function generateLesson(payload) {
  const { tema, capTitulo, capNum = 1, capSubs = [] } = payload;

  if (!tema || !capTitulo) {
    return { ok: false, error: 'tema e capTitulo obrigatórios' };
  }

  const prompt = `
Capítulo ${capNum} - ${capTitulo}
Tema: ${tema}

Subtópicos:
${capSubs.join('\n')}

Regras:
- académico
- português Angola
- sem bullets
- 70-120 palavras por parágrafo
`;

  const resposta = await callWithFallback([
    { role: 'user', content: prompt }
  ], {
    max_tokens: 1200,
    temperature: 0.7
  });

  return {
    ok: true,
    action: 'generate_lesson',
    data: { resposta }
  };
}

/* =================================================================== */
/* OPENROUTER COM FALLBACK REAL */
/* =================================================================== */
async function callWithFallback(messages, opts) {

  const models = [
    MODELS.primary,
    MODELS.fast,
    MODELS.smart
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const result = await callOpenRouter(model, messages, opts);
      if (result && result.length > 10) return result;
    } catch (err) {
      lastError = err.message;
      console.warn(`[MODEL FAIL] ${model}:`, err.message);
    }
  }

  throw new Error(`Todos os modelos falharam: ${lastError}`);
}

/* =================================================================== */
/* CORE OPENROUTER */
/* =================================================================== */
async function callOpenRouter(model, messages, opts) {

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');

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
      const err = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${err}`);
    }

    const data = await resp.json();

    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
      throw new Error('Resposta vazia do modelo');
    }

    return text;

  } finally {
    clearTimeout(timeout);
  }
}
