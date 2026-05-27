// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE — VERSÃO FINAL OTIMIZADA
// ══════════════════════════════════════════════════════════════════════════════

const OR_BASE = 'https://openrouter.ai/api/v1';

// Correção Dinâmica: Detecta a origem da chamada automaticamente
const getSiteUrl = (req) => {
  const origin = req.headers['origin'] || req.headers['referer'] || 'https://academy.vercel.app';
  return origin;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization',
};

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

// Otimização: Função unificada com Referer dinâmico
async function callOpenRouter(messages, model, maxTokens, siteUrl) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');

  const response = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': siteUrl,
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
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).setHeader(CORS).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' }).setHeader(CORS);

  try {
    const { action, payload } = req.body || {};
    const siteUrl = getSiteUrl(req); // Origem dinâmica

    let result;
    const model = getModel(action);

    if (action === 'chat') {
      // Otimização: Historico limitado a 3 mensagens para economizar tokens
      const hist = (payload.historico || []).slice(-3);
      const content = await callOpenRouter([...hist, {role: 'user', content: payload.pedido}], model, 3000, siteUrl);
      result = { resposta: content };
    } 
    else if (action === 'gerar_capitulo') {
      const content = await callOpenRouter([{role: 'user', content: `Escreve capítulo sobre "${payload.capTitulo}" tema "${payload.tema}" (nível: ${payload.nivel}).`}], model, 8192, siteUrl);
      result = { resposta: content };
    }
    else {
      return res.status(400).json({ error: 'Action desconhecida' }).setHeader(CORS);
    }

    return res.status(200).json({ ok: true, data: result, meta: { model } }).setHeader(CORS);

  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message }).setHeader(CORS);
  }
}
