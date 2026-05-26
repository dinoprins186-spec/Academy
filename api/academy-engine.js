// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE  v4.1  —  Vercel Serverless Function  (PROFISSIONAL)
// File    : api/academy-engine.js
// Route   : POST /api/academy-engine
// Contract: { action, payload, userId, userToken } → { ok, action, data, error, meta }
// ══════════════════════════════════════════════════════════════════════════════
// v4.1 — MELHORIAS PROFISSIONAIS
//   • Rate limiting por usuário (5 prompts/chat)
//   • Validação de créditos ANTES de gerar (páginas)
//   • Rastreamento de consumo (páginas por geração)
//   • Paywall seguro no backend
//   • Modelos baratos para chat (economia)
//   • Logs síncronos (saber o que acontece)
//   • Quotas por usuário
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════════════════════════

const VERSION  = '4.1.0';
const OR_BASE  = 'https://openrouter.ai/api/v1';
const SITE_URL = process.env.ACADEMY_URL ?? 'https://academy.vercel.app';

// LIMITES PROFISSIONAIS
const LIMITS = {
  chat_prompts_per_day: 5,           // 5 prompts de chat por dia
  chat_tokens_per_prompt: 3000,      // Máximo tokens por prompt
  gerar_max_pages_per_day: 50,       // Máximo 50 páginas/dia por usuário pago
  gerar_cost_per_page: 1,            // 1 crédito = 1 página
  rate_limit_window: 3600,           // 1 hora
  rate_limit_requests: 20,           // 20 requests/hora
};

// ══════════════════════════════════════════════════════════════════════════════
// CAMADA DB — SUPABASE (inline)
// ══════════════════════════════════════════════════════════════════════════════

const SB_URL = process.env.SUPABASE_URL ?? 'https://ivvkxgqmvolrrjwfxtzy.supabase.co';
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null;

async function sbPost(table, data) {
  if (!SB_KEY) return true;
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        'apikey':        SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.error(`[DB] Supabase ${res.status} [${table}]: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[DB] sbPost falhou [${table}]: ${e.message}`);
    return false;
  }
}

async function sbGet(path) {
  if (!SB_KEY) return [];
  try {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: {
        'apikey':        SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
      },
    });
    if (!res.ok) return [];
    return res.json().catch(() => []);
  } catch {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// VALIDAÇÃO & AUTENTICAÇÃO
// ══════════════════════════════════════════════════════════════════════════════

function getUserId(req) {
  try {
    return (
      req?.headers?.['x-user-id']      ||
      req?.headers?.['x-academy-user'] ||
      crypto.randomUUID()
    );
  } catch {
    return 'anonymous';
  }
}

async function validarCreditos(userId, paginasNecessarias = 1) {
  if (!SB_KEY) {
    // Sem DB, assume créditos infinitos (dev mode)
    return { pode_gerar: true, creditos_disponiveis: 999, plano: 'premium' };
  }

  try {
    const uid = encodeURIComponent(userId);
    // Usar tabela correta: creditos_users
    const creditos_data = await sbGet(`creditos_users?user_id=eq.${uid}&select=saldo,plano`);
    
    if (!creditos_data || creditos_data.length === 0) {
      return { pode_gerar: false, creditos_disponiveis: 0, motivo_bloqueio: 'usuario_nao_encontrado' };
    }

    const data = creditos_data[0];
    const saldo = data.saldo ?? 0;
    const plano = data.plano ?? 'gratuito';

    // Gratuito: sem créditos
    if (plano === 'gratuito') {
      return { pode_gerar: false, creditos_disponiveis: 0, motivo_bloqueio: 'plano_gratuito' };
    }

    // Pago: validar créditos
    if (saldo < paginasNecessarias) {
      return { pode_gerar: false, creditos_disponiveis: saldo, motivo_bloqueio: 'saldo_insuficiente' };
    }

    return { pode_gerar: true, creditos_disponiveis: saldo, plano };

  } catch (e) {
    console.error(`[PAYWALL] validarCreditos falhou: ${e.message}`);
    return { pode_gerar: false, creditos_disponiveis: 0, motivo_bloqueio: 'erro_validacao' };
  }
}

async function validarLimiteChat(userId) {
  if (!SB_KEY) return { pode_usar: true, prompts_restantes: LIMITS.chat_prompts_per_day };

  try {
    const uid = encodeURIComponent(userId);
    const hoje = new Date().toISOString().split('T')[0];
    
    const logs = await sbGet(
      `academy_ai_logs?user_id=eq.${uid}&action=eq.chat&created_at=gte.${hoje}T00:00:00Z&select=id`
    );

    const usados = logs ? logs.length : 0;
    const restantes = Math.max(0, LIMITS.chat_prompts_per_day - usados);

    return {
      pode_usar: usados < LIMITS.chat_prompts_per_day,
      prompts_usados: usados,
      prompts_restantes: restantes,
      limite_diario: LIMITS.chat_prompts_per_day,
    };

  } catch (e) {
    console.error(`[LIMITE] validarLimiteChat falhou: ${e.message}`);
    return { pode_usar: true, prompts_restantes: LIMITS.chat_prompts_per_day };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// RASTREAMENTO DE CONSUMO
// ══════════════════════════════════════════════════════════════════════════════

async function rastrearConsumo(userId, action, paginasConsumidas, modelUsed, requestId) {
  if (!SB_KEY) return true;

  try {
    await sbPost('academy_ai_logs', {
      id:                 crypto.randomUUID(),
      user_id:           userId,
      action,
      model_used:        modelUsed,
      request_id:        requestId,
      pages_consumed:    paginasConsumidas,
      created_at:        new Date().toISOString(),
    });

    // Se foi geração, debitar créditos
    if (['gerar_capitulo', 'create_work', 'gerar_capitulo_livro'].includes(action)) {
      await atualizarCreditos(userId, -paginasConsumidas);
    }

    return true;
  } catch (e) {
    console.error(`[RASTREAMENTO] falhou: ${e.message}`);
    return false;
  }
}

async function atualizarCreditos(userId, delta) {
  if (!SB_KEY) return true;

  try {
    const uid = encodeURIComponent(userId);
    const creditos_data = await sbGet(`creditos_users?user_id=eq.${uid}&select=saldo`);
    
    if (!creditos_data || creditos_data.length === 0) return false;

    const novoSaldo = Math.max(0, (creditos_data[0].saldo ?? 0) + delta);

    await fetch(`${SB_URL}/rest/v1/creditos_users?user_id=eq.${uid}`, {
      method: 'PATCH',
      headers: {
        'apikey':        SB_KEY,
        'Authorization': `Bearer ${SB_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ saldo: novoSaldo }),
    });

    return true;
  } catch (e) {
    console.error(`[CRÉDITOS] atualizarCreditos falhou: ${e.message}`);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CORS
// ══════════════════════════════════════════════════════════════════════════════

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-user-id, x-academy-user',
};

// ══════════════════════════════════════════════════════════════════════════════
// AI ROUTER — Modelos baratos para chat
// ══════════════════════════════════════════════════════════════════════════════

const AI_ROUTER = {
  
  // CHAT: Use modelos baratos (economia)
  chat: {
    primary:   'openai/gpt-4o-mini',        // BARATO
    secondary: 'openai/gpt-3.5-turbo',      // SUPER BARATO
    tertiary:  'anthropic/claude-3-haiku',  // RÁPIDO & BARATO
    maxTokens: 3000,
    temp:      0.7,
  },

  // GERAÇÕES: Use melhores modelos (qualidade)
  gerar_capitulo: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.4,
  },

  create_work: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.4,
  },

  plano_academico: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 2048,
    temp:      0.3,
  },

  estrutura_academica: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 2048,
    temp:      0.2,
  },

  default: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 4096,
    temp:      0.4,
  },
};

function modelSelector(action) {
  return AI_ROUTER[action] ?? AI_ROUTER.default;
}

// ══════════════════════════════════════════════════════════════════════════════
// RESPONSE ENVELOPE
// ══════════════════════════════════════════════════════════════════════════════

function okRes(action, resposta, modelUsed, requestId, meta = {}) {
  const data =
    resposta !== null && typeof resposta === 'object' && !Array.isArray(resposta)
      ? { ...resposta, resposta }
      : { resposta };

  return {
    ok:    true,
    action,
    data,
    error: null,
    meta: {
      provider:    'openrouter',
      model:       modelUsed ?? 'unknown',
      timestamp:   new Date().toISOString(),
      version:     VERSION,
      request_id:  requestId,
      ...meta,
    },
  };
}

function errRes(action, msg, requestId, statusCode = 400) {
  return {
    ok:    false,
    action,
    data:  null,
    error: msg,
    meta: {
      timestamp:    new Date().toISOString(),
      version:      VERSION,
      request_id:   requestId,
      status_code:  statusCode,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeRequestId() {
  return Math.random().toString(16).slice(2, 10).toUpperCase();
}

function requireFields(b, fields, action) {
  for (const f of fields) {
    if (b[f] === undefined || b[f] === null || b[f] === '') {
      throw new Error(`[${action}] Campo obrigatório em falta: "${f}"`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// OPENROUTER PROVIDER
// ══════════════════════════════════════════════════════════════════════════════

async function orCall(msgs, model, maxTokens, temp, requestId) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 45000);

  try {
    const res = await fetch(`${OR_BASE}/chat/completions`, {
      method:  'POST',
      signal:  ctrl.signal,
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  SITE_URL,
        'X-Title':       'ACADEMY',
      },
      body: JSON.stringify({
        model,
        max_tokens:  maxTokens,
        temperature: temp,
        messages:    msgs,
      }),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 400);
      const err = new Error(`OpenRouter ${res.status} [${model}]: ${errText}`);
      err.status = res.status;
      throw err;
    }

    const d = await res.json();
    const content = d?.choices?.[0]?.message?.content ?? '';

    if (!content) throw new Error(`[${model}]: resposta vazia`);
    return { content, model };

  } finally {
    clearTimeout(tid);
  }
}

async function orCallWithRetry(msgs, model, maxTokens, temp, requestId) {
  try {
    return await orCall(msgs, model, maxTokens, temp, requestId);
  } catch (e) {
    if (e.status === 429) {
      console.warn(`[${requestId}] ${model} rate-limited (429)`);
      throw e;
    }
    console.warn(`[${requestId}] ${model} retry após erro transiente`);
    await sleep(1000);
    return await orCall(msgs, model, maxTokens, temp, requestId);
  }
}

async function callWithFallback(action, msgs, maxTokensOverride, tempOverride, requestId) {
  const config    = modelSelector(action);
  const maxTokens = maxTokensOverride ?? config.maxTokens;
  const temp      = tempOverride != null ? tempOverride : config.temp;
  const chain     = [config.primary, config.secondary, config.tertiary].filter(Boolean);

  let lastError;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const result = await orCallWithRetry(msgs, model, maxTokens, temp, requestId);
      return result;
    } catch (e) {
      console.warn(`[${requestId}] ${model} falhou (${i + 1}/${chain.length})`);
      lastError = e;
      if (e.status === 429) await sleep(2000);
    }
  }

  throw new Error(`Todos os modelos falharam. Último: ${lastError?.message}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// LLM ABSTRACTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function llmText(action, sys, usr, requestId, maxTokensOverride = null) {
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user',   content: usr },
  ];

  const r = await callWithFallback(action, msgs, maxTokensOverride, null, requestId);
  return r;
}

async function llmJSON(action, sys, usr, requestId) {
  const sysJ = sys + '\n\nResponde APENAS com JSON válido.';
  const msgs = [
    { role: 'system', content: sysJ },
    { role: 'user',   content: usr },
  ];

  const r = await callWithFallback(action, msgs, null, null, requestId);
  const strip = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  try {
    return { data: JSON.parse(strip(r.content)), model: r.model };
  } catch (e) {
    console.error(`[${requestId}] JSON parse falhou`);
    throw e;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

function hPing() {
  return { resposta: 'pong' };
}

async function hChat(b, userId, requestId) {
  // VALIDAR LIMITE DE 5 PROMPTS
  const limite = await validarLimiteChat(userId);
  if (!limite.pode_usar) {
    throw new Error(`Atingiu o limite de ${LIMITS.chat_prompts_per_day} prompts diários para chat`);
  }

  requireFields(b, ['pedido'], 'chat');
  const pedido = String(b.pedido).trim().slice(0, 1000);

  const r = await llmText(
    'chat',
    'És um assistente académico ACADEMY. Ajudas com dúvidas de trabalhos académicos. Responde em português formal.',
    pedido,
    requestId,
    LIMITS.chat_tokens_per_prompt,
  );

  // Log com limite atualizado
  await rastrearConsumo(userId, 'chat', 0, r.model, requestId);

  return { resposta: r.content, prompts_restantes: limite.prompts_restantes - 1 };
}

async function hGerarCapitulo(b, userId, requestId) {
  // VALIDAR CRÉDITOS
  const validacao = await validarCreditos(userId, 3); // ~3 páginas por capítulo
  if (!validacao.pode_gerar) {
    throw new Error(`${validacao.motivo_bloqueio}: ${validacao.creditos_disponiveis} créditos`);
  }

  requireFields(b, ['capTitulo', 'tema', 'nivel'], 'gerar_capitulo');

  const r = await llmText(
    'gerar_capitulo',
    'Escreve um capítulo académico formal em português europeu. Texto completo, ~600 palavras.',
    `Capítulo: ${b.capTitulo}\nTema: ${b.tema}\nNível: ${b.nivel}`,
    requestId,
  );

  const paginasConsumidas = 3;
  await rastrearConsumo(userId, 'gerar_capitulo', paginasConsumidas, r.model, requestId);

  return { 
    resposta: r.content, 
    pages_consumed: paginasConsumidas,
    credits_remaining: validacao.creditos_disponiveis - paginasConsumidas,
  };
}

async function hCreateWork(b, userId, requestId) {
  // VALIDAR CRÉDITOS
  const validacao = await validarCreditos(userId, 5); // ~5 páginas por trabalho
  if (!validacao.pode_gerar) {
    throw new Error(`${validacao.motivo_bloqueio}: ${validacao.creditos_disponiveis} créditos`);
  }

  requireFields(b, ['topic'], 'create_work');

  const r = await llmText(
    'create_work',
    'Cria um trabalho académico completo e formal em português europeu.',
    `Tema: ${b.topic}\n\nEstrutura: Introdução, Desenvolvimento (com dados), Conclusão, Referências (APA).\n\nMínimo 800 palavras.`,
    requestId,
  );

  const paginasConsumidas = 5;
  await rastrearConsumo(userId, 'create_work', paginasConsumidas, r.model, requestId);

  return { 
    resposta: r.content,
    pages_consumed: paginasConsumidas,
    credits_remaining: validacao.creditos_disponiveis - paginasConsumidas,
  };
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

  const requestId = makeRequestId();
  const userId = getUserId(req);
  const startTime = Date.now();

  try {
    const { action, payload } = req.body ?? {};

    if (!action) {
      return res.status(400).json(errRes('unknown', 'action obrigatória', requestId, 400)).setHeader(CORS);
    }

    let resposta;

    // ROUTE por action
    if (action === 'ping') {
      resposta = hPing();
    } else if (action === 'chat') {
      resposta = await hChat(payload, userId, requestId);
    } else if (action === 'gerar_capitulo') {
      resposta = await hGerarCapitulo(payload, userId, requestId);
    } else if (action === 'create_work') {
      resposta = await hCreateWork(payload, userId, requestId);
    } else {
      return res.status(400).json(errRes(action, `action "${action}" não implementada`, requestId, 400)).setHeader(CORS);
    }

    const responseTime = Date.now() - startTime;
    const modelo = resposta.model || 'unknown';

    return res.status(200).json(
      okRes(action, resposta.resposta || resposta, modelo, requestId, { response_time_ms: responseTime })
    ).setHeader(CORS);

  } catch (e) {
    const msg = e.message || 'Erro desconhecido';
    console.error(`[${requestId}] Erro: ${msg}`);
    
    return res.status(500).json(
      errRes(req.body?.action || 'unknown', msg, requestId, 500)
    ).setHeader(CORS);
  }
}
