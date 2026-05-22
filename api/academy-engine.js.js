// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE  v3.0  —  Vercel Serverless Function
// File    : api/academy-engine.js
// Route   : POST /api/academy-engine
// Contract: { action, payload } → { ok, action, data, error, meta }
// ──────────────────────────────────────────────────────────────────────────────
// v3.0 — Multi-Model AI Orchestrator + Supabase Persistence Layer
//   AI_ROUTER   : config declarativo por action (primary/secondary/tertiary)
//   Fallback    : primary → secondary → tertiary automático por erro
//   Retry       : 1× por modelo (erros transientes); skip imediato em 429
//   requestId   : UUID curto em todos os logs e meta de resposta
//   Modelos     : Claude 3.5 Sonnet (texto), GPT-4o (JSON complexo),
//                 GPT-4o-mini (JSON rápido), claude-3-haiku (chat rápido)
//   Fix ??/||   : operador nullish coalescing restaurado (ES2020 Node.js)
//   Validação   : guards de input em todos os handlers
// ──────────────────────────────────────────────────────────────────────────────
// ENV VARS (Vercel → Settings → Environment Variables):
//   OPENROUTER_API_KEY          — obrigatória
//   GEMINI_API_KEY              — opcional (gerar_capa)
//   ACADEMY_URL                 — opcional (default: https://academy.vercel.app)
//   SUPABASE_URL                — obrigatória para persistência
//   SUPABASE_SERVICE_ROLE_KEY   — obrigatória para persistência (NUNCA expor)
// ══════════════════════════════════════════════════════════════════════════════

// ── PERSISTÊNCIA ─────────────────────────────────────────────────────────────
// Importa camada de persistência Supabase.
// Se SUPABASE_SERVICE_ROLE_KEY não estiver configurada, a camada desactiva-se
// automaticamente — o engine continua a funcionar sem persistência.

import { getUserId, persistRequest } from './_lib/db.js';

// ── CONFIG ────────────────────────────────────────────────────────────────────

const VERSION  = '3.0.0';
const OR_BASE  = 'https://openrouter.ai/api/v1';
const SITE_URL = process.env.ACADEMY_URL ?? 'https://academy.vercel.app';

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-app-version, cache-control, pragma',
};

// ══════════════════════════════════════════════════════════════════════════════
// AI ROUTER  —  config declarativo por action
//
// Cada action define:
//   primary   : modelo preferido (melhor qualidade para a tarefa)
//   secondary : fallback 1 (se primary falha)
//   tertiary  : fallback 2 (último recurso)
//   maxTokens : limite padrão para a action
//   temp      : temperatura padrão para a action
//
// Filosofia de routing:
//   texto académico longo → Claude 3.5 Sonnet  (melhor em português formal e
//                           continuidade de argumentação)
//   JSON estruturado      → GPT-4o-mini        (rápido, fiável, barato)
//   JSON complexo/mea     → GPT-4o             (melhor reasoning estrutural)
//   chat conversacional   → Claude 3.5 Sonnet  (mais natural, menos "quadrado")
//   conteúdo criativo     → Claude 3.5 Sonnet  (melhor narrativa)
// ══════════════════════════════════════════════════════════════════════════════

const AI_ROUTER = {

  // ── Chat: Claude para conversação natural, não "quadrada" ─────────────────
  chat: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 3000,
    temp:      0.7,
  },

  // ── Geração de texto académico: Claude para rigor e coerência ────────────
  gerar_capitulo: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.4,
  },
  regenerar_capitulo: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.65,  // ligeiramente mais criativo para diferenciação real
  },
  editar_texto: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.4,
  },
  plano_academico: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 2048,
    temp:      0.3,
  },
  revisao_trabalho: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 4096,
    temp:      0.3,
  },
  verificar_coerencia: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 2048,
    temp:      0.2,
  },
  create_work: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.4,
  },

  // ── JSON estruturado simples: GPT-4o-mini (rápido e fiável) ──────────────
  estrutura_academica: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 2048,
    temp:      0.2,
  },

  // ── JSON complexo (MEA): GPT-4o para reasoning estrutural ────────────────
  gerar_mea: {
    primary:   'openai/gpt-4o',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 2048,
    temp:      0.3,
  },
  mea_grafico: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'openai/gpt-4o',
    tertiary:  'anthropic/claude-3.5-sonnet',
    maxTokens: 1024,
    temp:      0.2,
  },
  mea_tabela: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'openai/gpt-4o',
    tertiary:  'anthropic/claude-3.5-sonnet',
    maxTokens: 1024,
    temp:      0.2,
  },
  mea_esquema: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'openai/gpt-4o',
    tertiary:  'anthropic/claude-3.5-sonnet',
    maxTokens: 1024,
    temp:      0.2,
  },

  // ── Conteúdo criativo (livros): Claude para narrativa ────────────────────
  plano_livro: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 3000,
    temp:      0.5,
  },
  conceito_capa_livro: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 1024,
    temp:      0.7,
  },
  gerar_capitulo_livro: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 8192,
    temp:      0.7,
  },

  // ── Default (fallback para actions não mapeadas) ──────────────────────────
  default: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 4096,
    temp:      0.4,
  },
};

/**
 * modelSelector — devolve a config de routing para uma action.
 * Sempre devolve um objecto válido (fallback para 'default').
 */
function modelSelector(action) {
  return AI_ROUTER[action] ?? AI_ROUTER.default;
}

// ── RESPONSE ENVELOPE ─────────────────────────────────────────────────────────

/**
 * okRes — envelope de sucesso.
 * Para objectos: campos espalhados em data + alias data.resposta (compat frontend).
 * Para strings/primitivos: { resposta: value }.
 */
function okRes(action, resposta, modelUsed, requestId, documentId = null) {
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
      model:       modelUsed   ?? 'unknown',
      timestamp:   new Date().toISOString(),
      version:     VERSION,
      request_id:  requestId,
      document_id: documentId, // null se persistência não configurada
    },
  };
}

/** errRes — envelope de erro padronizado. */
function errRes(action, msg, requestId) {
  return {
    ok:    false,
    action,
    data:  null,
    error: msg,
    meta: {
      timestamp:  new Date().toISOString(),
      version:    VERSION,
      request_id: requestId,
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** P2 — Palavras → maxTokens (1 PT ≈ 1.4 tok × 1.5 buffer; min 4096, max 8192). */
const wordsToTokens = (w) => Math.min(Math.max(Math.ceil(w * 1.4 * 1.5), 4096), 8192);

/** I2 — Aviso se output < 70 % do mínimo. Nunca bloqueia. */
function validateMinWords(text, min, label, requestId) {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  if (n < Math.floor(min * 0.7))
    console.warn(`[${requestId}] WARN ${label}: ${n} palavras (esperado ≥ ${min})`);
  return text;
}

/** Gera requestId curto para logging (8 chars hex). */
function makeRequestId() {
  return Math.random().toString(16).slice(2, 10).toUpperCase();
}

/**
 * Guard de input — valida campos obrigatórios no payload.
 * Lança erro claro com o nome do campo em falta.
 */
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

/**
 * orCall — chamada raw ao OpenRouter Chat Completions.
 * Aceita qualquer modelo via parâmetro.
 * Retorna { content, finishReason, model }.
 */
async function orCall(msgs, model, maxTokens, temp, requestId) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada nas variáveis de ambiente Vercel');

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
        'X-Title':       'ACADEMY ScOS',
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

    const d           = await res.json();
    const content     = d?.choices?.[0]?.message?.content ?? '';
    const finishReason = String(d?.choices?.[0]?.finish_reason ?? 'stop');

    if (!content) throw new Error(`[${model}]: resposta com conteúdo vazio`);
    return { content, finishReason, model };

  } finally {
    clearTimeout(tid);
  }
}

/**
 * orCallWithRetry — 1 retry por modelo para erros transientes.
 * Não retenta em 429 (rate limit) — deixa o fallback chain passar para o próximo modelo.
 */
async function orCallWithRetry(msgs, model, maxTokens, temp, requestId) {
  try {
    return await orCall(msgs, model, maxTokens, temp, requestId);
  } catch (e) {
    // 429: não retenta — passa directo para o próximo modelo na chain
    if (e.status === 429 || String(e.message).includes('429')) {
      console.warn(`[${requestId}] ${model} rate-limited (429) — a passar para fallback`);
      throw e;
    }
    // Outros erros: 1 retry após 1 s
    console.warn(`[${requestId}] ${model} erro transiente (${e.message}) — retry 1 s`);
    await sleep(1000);
    return await orCall(msgs, model, maxTokens, temp, requestId);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FALLBACK CHAIN  —  coração do AI Orchestrator
// ══════════════════════════════════════════════════════════════════════════════

/**
 * callWithFallback — tenta primary → secondary → tertiary automaticamente.
 *
 * - Cada modelo tem 1 retry para erros transientes (via orCallWithRetry).
 * - Em 429: espera 2 s e tenta próximo modelo.
 * - Regista qual modelo respondeu em meta.
 * - Lança erro descritivo se toda a chain falha.
 *
 * @param {string} action       - nome da action (para AI_ROUTER lookup)
 * @param {Array}  msgs         - array de mensagens { role, content }
 * @param {number|null} maxTokensOverride - sobrepõe config do router
 * @param {number|null} tempOverride      - sobrepõe config do router
 * @param {string} requestId    - para logging
 */
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
      if (i > 0) {
        console.log(`[${requestId}] ↳ fallback bem-sucedido: ${model} (tentativa ${i + 1}/${chain.length})`);
      }
      return result; // { content, finishReason, model }
    } catch (e) {
      console.warn(`[${requestId}] ${model} falhou (${i + 1}/${chain.length}): ${e.message}`);
      lastError = e;
      if (e.status === 429 || String(e.message).includes('429')) {
        await sleep(2000); // backoff extra antes de tentar próximo modelo
      }
    }
  }

  throw new Error(
    `Todos os modelos falharam para action "${action}". ` +
    `Chain: [${chain.join(' → ')}]. Último erro: ${lastError?.message}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LLM ABSTRACTIONS  —  action-aware, usam callWithFallback
// ══════════════════════════════════════════════════════════════════════════════

/**
 * llmText — geração de texto livre com auto-continuação (C1).
 * Usa o modelo definido no AI_ROUTER para a action.
 */
async function llmText(action, sys, usr, requestId, maxTokensOverride = null, tempOverride = null) {
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user',   content: usr },
  ];

  const r1 = await callWithFallback(action, msgs, maxTokensOverride, tempOverride, requestId);

  if (r1.finishReason !== 'length') return r1; // { content, model }

  // C1 — auto-continuação round 1
  console.warn(`[${requestId}] finish_reason=length — continuação round 1 (${r1.model})`);
  const config    = modelSelector(action);
  const maxTokens = maxTokensOverride ?? config.maxTokens;
  const temp      = tempOverride != null ? tempOverride : config.temp;

  try {
    const r2 = await orCallWithRetry(
      [
        ...msgs,
        { role: 'assistant', content: r1.content },
        { role: 'user',      content: 'Continua exactamente de onde paraste. Não repitas nada do que já escreveste.' },
      ],
      r1.model, maxTokens, temp, requestId,
    );
    const full1 = r1.content + r2.content;
    if (r2.finishReason !== 'length') return { content: full1, model: r1.model };

    // C1 — round 2 (máximo)
    console.warn(`[${requestId}] finish_reason=length — continuação round 2 (${r1.model})`);
    try {
      const r3 = await orCallWithRetry(
        [
          ...msgs,
          { role: 'assistant', content: r1.content },
          { role: 'user',      content: 'Continua.' },
          { role: 'assistant', content: r2.content },
          { role: 'user',      content: 'Conclui o texto agora. Fecha todos os parágrafos em aberto.' },
        ],
        r1.model, maxTokens, temp, requestId,
      );
      if (r3.finishReason === 'length')
        console.warn(`[${requestId}] Texto incompleto após 2 rounds — a entregar o que existe.`);
      return { content: full1 + r3.content, model: r1.model };
    } catch (e3) {
      console.warn(`[${requestId}] Cont-round-2 falhou: ${e3.message}`);
      return { content: full1, model: r1.model };
    }
  } catch (e2) {
    console.warn(`[${requestId}] Cont-round-1 falhou: ${e2.message}`);
    return { content: r1.content, model: r1.model };
  }
}

/**
 * llmJSON — JSON estruturado com até 2 reparações de SyntaxError (C3).
 */
async function llmJSON(action, sys, usr, requestId) {
  const sysJ = sys + '\n\nResponde APENAS com JSON válido. Sem ```json. Sem texto fora do JSON.';
  const msgs  = [
    { role: 'system', content: sysJ },
    { role: 'user',   content: usr },
  ];

  const r = await callWithFallback(action, msgs, null, null, requestId);

  const strip = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  let raw = r.content;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return { data: JSON.parse(strip(raw)), model: r.model };
    } catch (parseErr) {
      if (attempt === 2) throw parseErr;
      console.warn(`[${requestId}] JSON repair attempt ${attempt + 1} (${r.model})`);
      try {
        const fix = await orCallWithRetry(
          [
            { role: 'system', content: 'Devolves APENAS JSON válido. Sem texto adicional.' },
            { role: 'user',   content: `JSON inválido:\n${raw}\n\nCorrige e devolve JSON válido.` },
          ],
          r.model,
          modelSelector(action).maxTokens,
          0.2,
          requestId,
        );
        raw = fix.content;
      } catch { throw parseErr; }
    }
  }

  throw new Error(`llmJSON: JSON inválido após 3 tentativas [${r.model}]`);
}

/**
 * llmChat — multi-turn conversacional.
 * Usa Claude por defeito (configurado no AI_ROUTER para 'chat').
 */
async function llmChat(action, sys, history, userMsg, requestId) {
  const msgs = [
    { role: 'system', content: sys },
    ...history,
    { role: 'user', content: userMsg },
  ];
  return callWithFallback(action, msgs, null, null, requestId);
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// Cada handler recebe (b = payload, requestId).
// Devolve { resposta, model } — o router envolve em okRes().
// ══════════════════════════════════════════════════════════════════════════════

// ── ping ──────────────────────────────────────────────────────────────────────
function hPing() {
  return { resposta: 'pong', model: 'none' };
}

// ── create_work ───────────────────────────────────────────────────────────────
async function hCreateWork(b, requestId) {
  requireFields(b, ['topic'], 'create_work');
  const topic = String(b.topic).trim();

  const r = await llmText(
    'create_work',
    'És um assistente académico especializado em trabalhos científicos formais. ' +
    'Escreves em português europeu formal com rigor, precisão e estrutura clara.',
    `Cria um trabalho académico estruturado e completo sobre: ${topic}

Estrutura obrigatória:
1. Introdução (contexto, objectivos, justificativa do tema)
2. Desenvolvimento (análise, argumentação fundamentada, evidências e dados)
3. Conclusão (síntese dos pontos principais, contribuição e implicações)
4. Referências Bibliográficas (mínimo 5 referências, formato APA 7.ª ed.)

Texto corrido académico. Parágrafos separados por linha em branco. Mínimo 600 palavras.`,
    requestId,
  );

  return { resposta: { topic, content: r.content }, model: r.model };
}

// ── plano_academico ───────────────────────────────────────────────────────────
async function hPlanoAcademico(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'nivel'], 'plano_academico');

  const r = await llmJSON(
    'plano_academico',
    'És um especialista académico do sistema universitário angolano. Respondes em português formal.',
    `Gera um plano académico de investigação para:
Tema: ${b.tema} | Tipo: ${b.tipoTrabalho} | Nível: ${b.nivel}

JSON obrigatório:
{
  "problema": "enunciado claro do problema",
  "objetivo": "objetivo geral",
  "objetivosEspecificos": ["obj1","obj2","obj3"],
  "hipotese": "hipótese principal",
  "metodologia": "abordagem metodológica",
  "justificativa": "relevância do estudo",
  "limitacoes": "limitações previstas"
}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── estrutura_academica ───────────────────────────────────────────────────────
async function hEstruturaAcademica(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'nivel'], 'estrutura_academica');

  const ep =
    Array.isArray(b.estruturaPadrao) && b.estruturaPadrao.length > 0
      ? `\nReferência de estrutura: ${JSON.stringify(b.estruturaPadrao)}`
      : '';

  const r = await llmJSON(
    'estrutura_academica',
    'És especialista em estruturação de trabalhos académicos angolanos. Segues normas das universidades de Angola.',
    `Gera estrutura de capítulos para:
Tema: ${b.tema} | Tipo: ${b.tipoTrabalho} | Nível: ${b.nivel} | Páginas: ${b.pags ?? 15}
Sugestão do professor: ${b.estruturaProf ?? 'nenhuma'}${ep}

JSON obrigatório:
{
  "capitulos": [
    {"num":1,"titulo":"Introdução","subs":["1.1 Contextualização","1.2 Justificativa","1.3 Objectivos"]},
    {"num":2,"titulo":"...","subs":["2.1 ...","2.2 ..."]}
  ]
}
Inclui obrigatoriamente: Introdução, 2-4 caps de desenvolvimento, Conclusão, Referências Bibliográficas.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── gerar_capitulo ────────────────────────────────────────────────────────────
async function hGerarCapitulo(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'capNum', 'capTitulo'], 'gerar_capitulo');

  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap ?? 600);

  const r = await llmText(
    'gerar_capitulo',
    'És um escritor académico de excelência. Escreves em português formal angolano com rigor científico, ' +
    'argumentação coesa e transições fluidas entre parágrafos.',
    `Escreve o Capítulo ${b.capNum} — "${b.capTitulo}" para um ${b.tipoTrabalho} sobre "${b.tema}".
Sub-secções: ${subs || 'livre'} | Nível: ${b.nivel ?? 'universitário'} | Palavras alvo: ${minWords}
Objectivo geral: ${b.objetivo ?? ''}
Hipótese: ${b.hipotese ?? ''}
Metodologia: ${b.metodologia ?? ''}

Regras: texto académico corrido, parágrafos separados por linha em branco, sem # ou bullets.`,
    requestId,
    wordsToTokens(minWords),
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Cap ${b.capNum} — ${b.capTitulo}`, requestId),
    model: r.model,
  };
}

// ── regenerar_capitulo ────────────────────────────────────────────────────────
async function hRegerarCapitulo(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'capNum', 'capTitulo'], 'regenerar_capitulo');

  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap ?? 600);

  const r = await llmText(
    'regenerar_capitulo',
    'Regeneras capítulos académicos com nova perspectiva, novos exemplos e ângulo diferente, mas igual rigor.',
    `Regenera o Capítulo ${b.capNum} — "${b.capTitulo}" para um ${b.tipoTrabalho} sobre "${b.tema}".
Sub-secções: ${subs || 'livre'}

IMPORTANTE: Esta deve ser uma versão claramente diferente da anterior.
Usa novos exemplos, nova ordem de argumentos, perspectiva diferente.
Texto académico formal. Parágrafos com linha em branco.`,
    requestId,
    wordsToTokens(minWords),
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Regen Cap ${b.capNum}`, requestId),
    model: r.model,
  };
}

// ── editar_texto ──────────────────────────────────────────────────────────────
async function hEditarTexto(b, requestId) {
  requireFields(b, ['texto'], 'editar_texto');

  const ops = {
    melhorar: 'Melhora o estilo académico, fluidez e precisão linguística. Mantém o conteúdo original intacto.',
    resumir:  'Resume mantendo todas as ideias principais. Estilo académico formal.',
    expandir: 'Expande com mais desenvolvimento, exemplos concretos e profundidade académica.',
  };
  const instrucao = ops[String(b.subacao ?? 'melhorar')] ?? ops.melhorar;
  const texto     = String(b.texto).slice(0, 3000);

  const r = await llmText(
    'editar_texto',
    'És um editor académico de excelência, especializado em português formal de Angola.',
    `${instrucao}\n\nTEXTO A EDITAR:\n${texto}`,
    requestId,
  );

  return { resposta: r.content, model: r.model };
}

// ── verificar_coerencia ───────────────────────────────────────────────────────
async function hVerificarCoerencia(b, requestId) {
  requireFields(b, ['problema', 'objetivo'], 'verificar_coerencia');

  const r = await llmJSON(
    'verificar_coerencia',
    'Revisor académico especializado em coerência estrutural de trabalhos universitários angolanos.',
    `Verifica coerência entre problema, objectivo, introdução e conclusão:
Problema: ${b.problema}
Objectivo: ${b.objetivo}
Introdução (excerto): ${b.introTexto ?? '(não fornecida)'}
Conclusão (excerto): ${b.concTexto ?? '(não fornecida)'}

JSON obrigatório:
{"coerente":true,"alertas":["alerta se existir"],"sugestoes":["sugestão"],"pontuacaoCoerencia":85}
Se tudo correcto: alertas e sugestoes são arrays vazios.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── gerar_mea ─────────────────────────────────────────────────────────────────
async function hGerarMEA(b, requestId) {
  requireFields(b, ['tema'], 'gerar_mea');

  const r = await llmJSON(
    'gerar_mea',
    'Especialista em enriquecimento académico visual. Decides onde gráficos/tabelas/esquemas acrescentam valor real ao argumento.',
    `Trabalho sobre "${b.tema}". Capítulos: ${JSON.stringify(b.capitulos ?? [])}

JSON obrigatório (máx 4 elementos, escolhe apenas onde há valor real):
{"elementos":[{"tipo":"grafico","capitulo":1,"titulo":"..."},{"tipo":"tabela","capitulo":2,"titulo":"..."}]}
"tipo" é exactamente: "grafico", "tabela" ou "esquema".`,
    requestId,
  );

  // S2: garantir ≤ 4 elementos
  const data = r.data;
  if (Array.isArray(data?.elementos) && data.elementos.length > 4) {
    data.elementos.splice(4);
  }

  return { resposta: data, model: r.model };
}

// ── mea_grafico ───────────────────────────────────────────────────────────────
async function hMEAGrafico(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_grafico');

  const r = await llmJSON(
    'mea_grafico',
    'Geras dados realistas e academicamente plausíveis para gráficos de trabalhos universitários.',
    `Gráfico para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}
JSON: {"titulo":"...","tipo":"bar","labels":["A","B","C","D"],"dados":[40,65,52,78],"unidade":"%"}
"tipo" pode ser: "bar", "line" ou "pie". Dados devem ser realistas para o contexto académico.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── mea_tabela ────────────────────────────────────────────────────────────────
async function hMEATabela(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_tabela');

  const r = await llmJSON(
    'mea_tabela',
    'Geras tabelas académicas realistas e informativas para trabalhos universitários.',
    `Tabela para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}
JSON: {"titulo":"...","cabecalhos":["Col1","Col2","Col3"],"linhas":[["v1","v2","v3"],["v1","v2","v3"]]}
Máx 4 colunas e 5 linhas. Dados devem ser realistas e úteis para o argumento académico.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── mea_esquema ───────────────────────────────────────────────────────────────
async function hMEAEsquema(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_esquema');

  const r = await llmJSON(
    'mea_esquema',
    'Geras esquemas de processos claros e academicamente rigorosos.',
    `Esquema para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}
JSON: {"titulo":"...","etapas":[{"num":1,"titulo":"Etapa 1","descricao":"desc breve e objectiva"}]}
3 a 5 etapas sequenciais. Títulos concisos, descrições informativas.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── gerar_capa ────────────────────────────────────────────────────────────────
// S1: contrato normalizado { imagem, fallback, conceito }
// S4: erros nunca silenciosos
// Fallback melhorado: gera conceito tipográfico rico via LLM
async function hGerarCapa(b, requestId) {
  requireFields(b, ['tema'], 'gerar_capa');

  const geminiKey = process.env.GEMINI_API_KEY;

  // Tentativa 1: Gemini Imagen (requer Vertex AI / Google Cloud)
  if (geminiKey) {
    try {
      const t0  = Date.now();
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${geminiKey}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{
              prompt:
                `Academic document cover. Theme: ${b.tema}. Type: ${b.tipoTrabalho ?? 'Trabalho Académico'}. ` +
                `Professional, elegant, dark background, gold/white typography. Angola university aesthetic. Minimalist.`,
            }],
            parameters: { sampleCount: 1 },
          }),
        },
      );

      if (res.ok) {
        const d   = await res.json();
        const b64 = d?.predictions?.[0]?.bytesBase64Encoded;
        console.log(`[${requestId}] gerar_capa Gemini — ${Date.now() - t0} ms — ${b64 ? 'ok' : 'vazio'}`);
        if (b64) {
          return { resposta: { imagem: `data:image/png;base64,${b64}`, fallback: false, conceito: null }, model: 'gemini-imagen' };
        }
      } else {
        console.warn(`[${requestId}] gerar_capa Gemini ${res.status} — a usar fallback`);
      }
    } catch (e) {
      console.warn(`[${requestId}] gerar_capa Gemini excepção: ${e.message}`);
    }
  }

  // Fallback: gera conceito tipográfico rico via LLM (S1 melhorado)
  // O frontend pode usar este conceito para renderizar uma capa CSS/tipográfica
  console.log(`[${requestId}] gerar_capa — a gerar conceito tipográfico via LLM`);
  try {
    const r = await llmText(
      'conceito_capa_livro',
      'És um designer gráfico especializado em capas académicas formais para universidades africanas lusófonas.',
      `Cria um conceito detalhado de capa para este trabalho académico:
Tema: ${b.tema}
Tipo: ${b.tipoTrabalho ?? 'Trabalho Académico'}
Autor: ${b.autor ?? 'Estudante'}
Universidade: ${b.universidade ?? 'Universidade'}
Ano: ${b.ano ?? new Date().getFullYear()}

Descreve em JSON:
{
  "corFundo": "#1a1a2e",
  "corPrimaria": "#c9a84c",
  "corSecundaria": "#ffffff",
  "fontesTitulo": "serif elegante",
  "elementosVisuais": "descrição de 2-3 elementos gráficos minimalistas",
  "atmosfera": "frase descrevendo o tom visual",
  "layoutSugerido": "descrição do layout da capa"
}`,
      requestId,
    );

    // Tentar parsear JSON do conceito
    let conceito = null;
    try {
      const strip = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      conceito = JSON.parse(strip(r.content));
    } catch {
      conceito = { atmosfera: r.content.slice(0, 200) };
    }

    return {
      resposta: { imagem: null, fallback: true, conceito },
      model: r.model,
    };
  } catch (e) {
    console.warn(`[${requestId}] gerar_capa conceito LLM falhou: ${e.message}`);
    return {
      resposta: { imagem: null, fallback: true, conceito: null },
      model: 'none',
    };
  }
}

// ── revisao_trabalho ──────────────────────────────────────────────────────────
async function hRevisaoTrabalho(b, requestId) {
  requireFields(b, ['texto', 'nivel'], 'revisao_trabalho');

  const texto = String(b.texto).slice(0, 6000); // I3
  const fp    = b.feedbackProf ? `\nFeedback do professor: ${b.feedbackProf}` : '';

  const r = await llmJSON(
    'revisao_trabalho',
    'Revisor académico sénior de trabalhos universitários angolanos. Rigoroso, construtivo e preciso. ' +
    'As tuas revisões transformam trabalhos mediocres em trabalhos excelentes.',
    `Analisa e revisa este texto (nível: ${b.nivel}, tipo: ${b.tipoAnalise ?? 'tudo'})${fp}:
TEXTO: ${texto}

JSON obrigatório:
{
  "resumo": "análise geral honesta em 2-3 frases",
  "pontuacao": 80,
  "pontosFortes": ["ponto forte específico 1","ponto forte específico 2","ponto forte específico 3"],
  "melhorar": ["melhoria concreta 1","melhoria concreta 2","melhoria concreta 3"],
  "versaoMelhorada": "versão melhorada do texto aqui",
  "criterios": [
    {"nome":"Coerência","valor":80},
    {"nome":"Estrutura","valor":75},
    {"nome":"Rigor Científico","valor":82},
    {"nome":"Linguagem","valor":78}
  ]
}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── plano_livro ───────────────────────────────────────────────────────────────
async function hPlanoLivro(b, requestId) {
  requireFields(b, ['tema', 'tipoLivro', 'numCaps'], 'plano_livro');

  const r = await llmJSON(
    'plano_livro',
    'Editor literário sénior com vasta experiência no mercado africano lusófono. ' +
    'Crias planos editoriais que equilibram relevância cultural e apelo comercial.',
    `Plano editorial completo:
Tipo: ${b.tipoLivro} | Tema: ${b.tema} | Público: ${b.publico ?? 'geral'} | Tom: ${b.tom ?? 'formal'} | Caps: ${b.numCaps}

JSON com exactamente ${b.numCaps} capítulos:
{
  "titulo": "título apelativo e memorável",
  "sinopse": "3-4 frases envolventes que vendem o livro",
  "capitulos": [{"num":1,"titulo":"...","descricao":"o que este cap aborda e como contribui para o todo"}]
}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

// ── conceito_capa_livro ───────────────────────────────────────────────────────
async function hConceitoCapaLivro(b, requestId) {
  requireFields(b, ['titulo', 'tipoLivro'], 'conceito_capa_livro');

  const r = await llmText(
    'conceito_capa_livro',
    'Designer editorial com 20 anos de experiência em capas de livros para o mercado africano e lusófono.',
    `Conceito detalhado de capa para "${b.titulo}" (${b.tipoLivro}).
Público-alvo: ${b.publico ?? 'geral'} | Tom: ${b.tom ?? 'neutro'}

Descreve em 4-5 frases concretas e inspiradoras:
paleta de cores exacta, tipografia escolhida, elementos visuais principais, atmosfera geral, e porquê estas escolhas funcionam para este livro e mercado.`,
    requestId,
    1024,
    0.7,
  );

  return { resposta: r.content, model: r.model };
}

// ── gerar_capitulo_livro ──────────────────────────────────────────────────────
async function hGerarCapituloLivro(b, requestId) {
  requireFields(b, ['titulo', 'tema', 'capNum', 'capTitulo', 'capDescricao'], 'gerar_capitulo_livro');

  const extras   = Array.isArray(b.extras) ? ` Elementos a incluir: ${b.extras.join(', ')}.` : '';
  const minWords = 600;

  const r = await llmText(
    'gerar_capitulo_livro',
    `Escritor profissional de ficção e não-ficção. Tom ${b.tom ?? 'envolvente'}. ` +
    `Escreves para público ${b.publico ?? 'geral'}. ` +
    `O teu estilo é fluido, imersivo e adequado ao mercado lusófono africano.`,
    `Capítulo ${b.capNum} — "${b.capTitulo}" do livro "${b.titulo}".
Tema central: ${b.tema} | Tom: ${b.tom ?? 'envolvente'} | Público: ${b.publico ?? 'geral'}
O que este capítulo deve cobrir: ${b.capDescricao}${extras}

Mínimo 600 palavras. Parágrafos separados por linha em branco. Sem # ou bullets. Escrita imersiva.`,
    requestId,
    wordsToTokens(minWords),
    0.7,
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Cap Livro ${b.capNum}`, requestId),
    model: r.model,
  };
}

// ── chat ──────────────────────────────────────────────────────────────────────
// Usa Claude 3.5 Sonnet para respostas naturais, não "quadradas".
// System prompt optimizado para o perfil do estudante angolano.
async function hChat(b, requestId) {
  const tema      = String(b.tema ?? 'trabalho académico');
  const tipo      = String(b.tipoTrabalho ?? 'Trabalho Académico');
  const estrutura = Array.isArray(b.estrutura) ? b.estrutura.join(', ') : '';

  // System prompt revisto: mais natural, contextualizado, menos rígido
  const sys = b.modoInstrutor
    ? `És o ACADEMY Instrutor — tutor académico estratégico para estudantes universitários angolanos.

CONTEXTO DO ALUNO:
- Está a escrever: ${tipo} sobre "${tema}"
- Estrutura actual: ${estrutura || 'ainda a definir'}

O TEU MÉTODO:
- Fazes perguntas que desenvolvem o pensamento crítico do aluno
- Nunca dás respostas directas — guias para que o aluno chegue lá
- Identificas lacunas de argumento com precisão cirúrgica
- Usas exemplos do contexto angolano e africano quando relevante
- Respondes em português europeu formal mas acessível`
    : `És o ACADEMY Copiloto — parceiro académico inteligente de estudantes universitários angolanos.

CONTEXTO DO TRABALHO:
- Tipo: ${tipo} sobre "${tema}"${estrutura ? `\n- Estrutura: ${estrutura}` : ''}

O TEU ESTILO:
- Directo e útil — não perguntas desnecessárias se a resposta é clara
- Explicas conceitos com exemplos concretos do contexto angolano/africano
- Sugeres melhorias práticas e implementáveis
- Usas **negrito** para pontos-chave e listas quando clarificam
- Tom: parceiro académico competente, não assistente genérico
- Respondes em português formal mas natural — não robótico`;

  const history = Array.isArray(b.historico)
    ? b.historico.map((h) => ({
        role:    String(h.role    ?? 'user'),
        content: String(h.content ?? ''),
      }))
    : [];

  const pedido = String(b.pedido ?? '').trim();
  if (!pedido) throw new Error('[chat] Campo "pedido" obrigatório');

  const r = await llmChat('chat', sys, history, pedido, requestId);
  return { resposta: r.content, model: r.model };
}

// ══════════════════════════════════════════════════════════════════════════════
// VERCEL HANDLER — único entry point
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json(errRes('unknown', 'Método não permitido — usa POST', 'N/A'));
    return;
  }

  const requestId  = makeRequestId();
  const body       = req.body ?? {};
  const payload    = body.payload ?? {};
  // Identificação de utilizador — regra exacta da spec
  const userId = getUserId(req);

  // Normalização de action — suporta 3 formatos:
  //   novo    { action: 'plano_academico', payload: { … } }
  //   chat    { payload: { tipo: 'chat', … } }  (action omitida pelo JSON.stringify)
  //   legado  { acao: 'plano_academico', … }
  const action = String(
    body.action   ??
    payload.acao  ??
    payload.tipo  ??
    body.acao     ??
    '',
  );

  if (!action) {
    res.status(400).json(errRes('unknown', "Campo 'action' obrigatório no body", requestId));
    return;
  }

  const t0 = Date.now();
  console.log(`[${requestId}] ▶ ${action} | models: ${JSON.stringify(modelSelector(action)).slice(0, 80)}`);

  try {
    let result; // { resposta, model }

    switch (action) {
      case 'ping':                 result = hPing();                                break;
      case 'create_work':          result = await hCreateWork(payload, requestId);  break;
      case 'plano_academico':      result = await hPlanoAcademico(payload, requestId); break;
      case 'estrutura_academica':  result = await hEstruturaAcademica(payload, requestId); break;
      case 'gerar_capitulo':       result = await hGerarCapitulo(payload, requestId); break;
      case 'regenerar_capitulo':   result = await hRegerarCapitulo(payload, requestId); break;
      case 'editar_texto':         result = await hEditarTexto(payload, requestId); break;
      case 'verificar_coerencia':  result = await hVerificarCoerencia(payload, requestId); break;
      case 'gerar_mea':            result = await hGerarMEA(payload, requestId);    break;
      case 'mea_grafico':          result = await hMEAGrafico(payload, requestId);  break;
      case 'mea_tabela':           result = await hMEATabela(payload, requestId);   break;
      case 'mea_esquema':          result = await hMEAEsquema(payload, requestId);  break;
      case 'gerar_capa':           result = await hGerarCapa(payload, requestId);   break;
      case 'revisao_trabalho':     result = await hRevisaoTrabalho(payload, requestId); break;
      case 'plano_livro':          result = await hPlanoLivro(payload, requestId);  break;
      case 'conceito_capa_livro':  result = await hConceitoCapaLivro(payload, requestId); break;
      case 'gerar_capitulo_livro': result = await hGerarCapituloLivro(payload, requestId); break;
      case 'chat':                 result = await hChat(payload, requestId);        break;
      default:
        res.status(400).json(errRes(action, `Acção desconhecida: "${action}"`, requestId));
        return;
    }

    const duration = Date.now() - t0;
    console.log(`[${requestId}] ✓ ${action} — ${duration} ms — model: ${result.model}`);

    // Persistência — fire-and-forget, nunca bloqueia resposta
    persistRequest({
      requestId,
      userId,
      action,
      payload,
      result:       result.resposta,
      modelUsed:    result.model,
      responseTime: duration,
    }).catch(console.error);

    res.status(200).json(okRes(action, result.resposta, result.model, requestId));

  } catch (e) {
    const msg      = e instanceof Error ? e.message : String(e);
    const duration = Date.now() - t0;
    console.error(`[${requestId}] ✗ ${action} — ${duration} ms:`, msg);

    res.status(500).json(errRes(action, msg, requestId));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// PRÓXIMAS EVOLUÇÕES
// ══════════════════════════════════════════════════════════════════════════════
//
// 1. AUTH REAL (Supabase Auth)
//    Quando o frontend adicionar auth:
//    • O header 'x-user-id' passa a conter o JWT subject do utilizador
//    • deriveUserId() já lê este header com prioridade — zero mudanças no backend
//    • Os documentos ficam automaticamente ligados ao utilizador real
//
// 2. CACHING (Vercel KV / Upstash Redis)
//    Candidatos: plano_academico, estrutura_academica, plano_livro (inputs repetidos)
//    Nunca cachear: chat, gerar_capitulo (conteúdo único por sessão)
//
// 3. DOCUMENT_ID no frontend
//    Quando o frontend quiser continuidade explícita:
//    • Enviar payload.document_id nos requests de capítulos
//    • A camada db.js já usa parent_id para ligar capítulos ao trabalho pai
//    • A ligação automática por tema funciona como fallback
//
// ══════════════════════════════════════════════════════════════════════════════
