/* =========================================================
   ACADEMY ENGINE ELITE v2.1
   OpenRouter · Retry · Dual System Prompt · Produção
   Grupo AGEA Comercial — Luanda, Angola
========================================================= */

const OR_URL = 'https://openrouter.ai/api/v1/chat/completions';

/* ─────────────────────── MODELOS ─────────────────────── */
const MODEL_MAP = {
  chat:               'openai/gpt-4o-mini',
  generate_lesson:    'anthropic/claude-3-5-sonnet-20241022',
  gerar_capitulo:     'anthropic/claude-3-5-sonnet-20241022',
  regenerar_capitulo: 'anthropic/claude-3-5-sonnet-20241022',
  resumo:             'openai/gpt-4o-mini',
};

const PARAMS_MAP = {
  chat:               { temperature: 0.45, max_tokens: 800  },
  generate_lesson:    { temperature: 0.72, max_tokens: 3200 },
  gerar_capitulo:     { temperature: 0.72, max_tokens: 3200 },
  regenerar_capitulo: { temperature: 0.68, max_tokens: 3200 },
};

function getModel(action)  { return MODEL_MAP[action]  ?? 'openai/gpt-4o-mini'; }
function getParams(action) { return PARAMS_MAP[action] ?? { temperature: 0.5, max_tokens: 1200 }; }

/* ─────────────────────── SYSTEM PROMPTS ─────────────────────── */
const SYSTEM_CHAT = `\
És assistente académico ACADEMY.

REGRAS:
- Português de Angola
- Máximo 120 palavras por resposta
- Respostas directas, sem introduções longas
- Foco em ajudar o estudante rapidamente
- Proibido markdown, listas ou bullets`;

const SYSTEM_ACADEMIC = `\
És um assistente académico de elite.

REGRAS ABSOLUTAS DE ESCRITA:
- Língua: português de Angola, registo académico universitário
- Parágrafos de 4 a 6 linhas contínuas (OBRIGATÓRIO)
- Proibido: listas, bullets, numerações, tabelas, markdown de qualquer tipo
- Proibido: títulos com hashtags ou asteriscos
- Transições fluidas entre parágrafos
- Tom: rigoroso, claro, nunca condescendente
- Começa directamente com o desenvolvimento`;

/* ─────────────────────── SANITIZAÇÃO ─────────────────────── */
function sanitize(input = '') {
  if (typeof input !== 'string') input = String(input);
  return input
    .replace(/[—–]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\r\n/g, '\n')
    .trim()
    .slice(0, 8000);
}

/* ─────────────────────── VALIDAÇÃO ─────────────────────── */
function validatePayload(action, payload) {
  const required = {
    chat:               ['pedido'],
    generate_lesson:    ['tema', 'capTitulo'],
    gerar_capitulo:     ['tema', 'capTitulo'],
    regenerar_capitulo: ['tema', 'capTitulo'],
  };
  const fields = required[action] ?? [];
  for (const f of fields) {
    if (!payload[f] || String(payload[f]).trim() === '') {
      throw new Error(`Payload inválido: campo obrigatório ausente → "${f}"`);
    }
  }
}

/* ─────────────────────── ENTRY POINT ─────────────────────── */
export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ ok: false, error: 'Método não permitido' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return res.status(400).json({ ok: false, error: 'JSON malformado' });
  }

  const { action, payload = {} } = body;

  if (!action || typeof action !== 'string') {
    return res.status(400).json({ ok: false, error: 'Campo "action" obrigatório' });
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const log = (level, msg, extra = {}) =>
    console[level](`[ENGINE v2.1][${requestId}][${action}]`, msg, extra);

  try {
    validatePayload(action, payload);

    const model  = getModel(action);
    const params = getParams(action);

    log('info', 'Iniciando engine', { model, action });

    const result = await runEngine(action, payload, model, params);

    return res.status(200).json({
      ok: true,
      action,
      data: result,
      meta: {
        model,
        requestId,
        ts:     Date.now(),
        engine: 'elite-v2.1',
        chars:  result.length,
      }
    });

  } catch (e) {
    log('error', 'Falha no engine', { message: e.message });
    return res.status(500).json({ ok: false, error: e.message, requestId });
  }
}

/* ─────────────────────── ENGINE CORE ─────────────────────── */
async function runEngine(action, payload, model, params) {

  const system = action === 'chat' ? SYSTEM_CHAT : SYSTEM_ACADEMIC;

  let messages;

  switch (action) {
    case 'chat':
      messages = buildChat(payload, system);
      break;

    case 'generate_lesson':
    case 'gerar_capitulo':
    case 'regenerar_capitulo':
      messages = buildLesson(payload, system);
      break;

    default:
      messages = [{ role: 'user', content: sanitize(JSON.stringify(payload)) }];
  }

  const text = await callOpenRouterWithRetry(messages, model, params);
  return postProcess(text);
}

/* ─────────────────────── BUILDERS ─────────────────────── */
function buildChat(payload, system) {
  const history = Array.isArray(payload.historico)
    ? payload.historico.slice(-6)
    : [];

  return [
    { role: 'system', content: system },
    ...history.map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: sanitize(m.content),
    })),
    { role: 'user', content: sanitize(payload.pedido) },
  ];
}

function buildLesson(payload, system) {
  const context = payload.contextoAnterior
    ? `\n\nContexto do capítulo anterior:\n${sanitize(payload.contextoAnterior).slice(0, 600)}`
    : '';

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: sanitize(
`Escreve um capítulo académico completo:

Tema geral: ${payload.tema}
Título do capítulo: ${payload.capTitulo}${context}

Requisitos:
- Texto corrido, sem títulos internos, sem listas
- Mínimo de 5 parágrafos de 4 a 6 linhas cada
- Estilo académico rigoroso, português de Angola`)
    },
  ];
}

/* ─────────────────────── OPENROUTER COM RETRY ─────────────────────── */
async function callOpenRouterWithRetry(messages, model, params, maxRetries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await callOpenRouter(messages, model, params);
    } catch (e) {
      lastError = e;
      const isRetryable = e.message.includes('429') || e.message.includes('502') || e.message.includes('503');
      if (!isRetryable || attempt === maxRetries) break;

      const delay = Math.min(400 * 2 ** attempt, 4000);
      console.warn(`[ENGINE v2.1] Retry ${attempt}/${maxRetries} em ${delay}ms — ${e.message}`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

async function callOpenRouter(messages, model, params) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada no ambiente');

  const res = await fetch(OR_URL, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'X-Title':       'Academy Engine Elite',
    },
    body: JSON.stringify({ model, messages, ...params }),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '(sem corpo)');
    throw new Error(`OpenRouter ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content ?? '';

  if (!content) throw new Error('Resposta vazia do modelo');

  return content;
}

/* ─────────────────────── POST PROCESS ─────────────────────── */
function postProcess(text = '') {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
