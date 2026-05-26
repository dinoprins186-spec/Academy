// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE — VERSÃO SIMPLES
// Apenas chamadas ao OpenRouter, sem validações complexas
// ══════════════════════════════════════════════════════════════════════════════

const OR_BASE = 'https://openrouter.ai/api/v1';
const SITE_URL = process.env.ACADEMY_URL ?? 'https://academy.vercel.app';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
};

// ══════════════════════════════════════════════════════════════════════════════
// MODELOS POR ACTION
// ══════════════════════════════════════════════════════════════════════════════

const MODELS = {
  chat: 'openai/gpt-4o-mini',
  gerar_capitulo: 'anthropic/claude-3.5-sonnet',
  create_work: 'anthropic/claude-3.5-sonnet',
  plano_academico: 'openai/gpt-4o-mini',
  estrutura_academica: 'openai/gpt-4o-mini',
  default: 'openai/gpt-4o-mini',
};

function getModel(action) {
  return MODELS[action] || MODELS.default;
}

// ══════════════════════════════════════════════════════════════════════════════
// OPENROUTER CALL
// ══════════════════════════════════════════════════════════════════════════════

async function callOpenRouter(messages, model, maxTokens = 4096) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  const response = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': SITE_URL,
      'X-Title': 'ACADEMY',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter ${response.status}: ${error}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE ENVELOPE
// ══════════════════════════════════════════════════════════════════════════════

function ok(action, resposta, model) {
  return {
    ok: true,
    action,
    data: { resposta },
    error: null,
    meta: {
      model,
      timestamp: new Date().toISOString(),
    },
  };
}

function err(action, message) {
  return {
    ok: false,
    action,
    data: null,
    error: message,
    meta: {
      timestamp: new Date().toISOString(),
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

async function hChat(payload) {
  const { pedido } = payload;
  if (!pedido) throw new Error('pedido obrigatório');

  const content = await callOpenRouter(
    [{ role: 'user', content: pedido }],
    getModel('chat'),
    3000
  );

  return { resposta: content };
}

async function hGerarCapitulo(payload) {
  const { capTitulo, tema, nivel } = payload;
  if (!capTitulo || !tema || !nivel) throw new Error('campos obrigatórios em falta');

  const content = await callOpenRouter(
    [
      {
        role: 'user',
        content: `Escreve um capítulo académico sobre "${capTitulo}" no tema "${tema}" (nível: ${nivel}). ~600 palavras, português europeu formal.`,
      },
    ],
    getModel('gerar_capitulo'),
    8192
  );

  return { resposta: content };
}

async function hCreateWork(payload) {
  const { topic } = payload;
  if (!topic) throw new Error('topic obrigatória');

  const content = await callOpenRouter(
    [
      {
        role: 'user',
        content: `Cria um trabalho académico completo sobre "${topic}". Estrutura: Introdução, Desenvolvimento, Conclusão, Referências (APA). Mínimo 800 palavras, português europeu.`,
      },
    ],
    getModel('create_work'),
    8192
  );

  return { resposta: content };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader(CORS).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' }).setHeader(CORS);
  }

  try {
    const { action, payload } = req.body || {};

    if (!action) {
      return res.status(400).json(err('unknown', 'action obrigatória')).setHeader(CORS);
    }

    let result;

    if (action === 'ping') {
      result = { resposta: 'pong' };
    } else if (action === 'chat') {
      result = await hChat(payload || {});
    } else if (action === 'gerar_capitulo') {
      result = await hGerarCapitulo(payload || {});
    } else if (action === 'create_work') {
      result = await hCreateWork(payload || {});
    } else {
      return res.status(400).json(err(action, `action "${action}" desconhecida`)).setHeader(CORS);
    }

    const model = getModel(action);
    return res.status(200).json(ok(action, result.resposta, model)).setHeader(CORS);

  } catch (e) {
    console.error('[ERROR]', e.message);
    return res.status(500).json(err(req.body?.action || 'unknown', e.message)).setHeader(CORS);
  }
}
