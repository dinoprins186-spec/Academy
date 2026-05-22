// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE  v4.0  —  Vercel Serverless Function  (FICHEIRO ÚNICO)
// File    : api/academy-engine.js
// Route   : POST /api/academy-engine
// Contract: { action, payload } → { ok, action, data, error, meta }
// ──────────────────────────────────────────────────────────────────────────────
// v4.0 — FICHEIRO ÚNICO DEFINITIVO
//   • db.js completamente integrado inline — zero imports externos
//   • Sem _lib/, sem dependências, sem risco de path resolution failure
//   • Supabase permanece opcional (fire-and-forget) — engine nunca crasha
//   • package.json só precisa de: { "type": "module" }
// ──────────────────────────────────────────────────────────────────────────────
// ENV VARS (Vercel → Settings → Environment Variables):
//   OPENROUTER_API_KEY          — obrigatória
//   GEMINI_API_KEY              — opcional (gerar_capa)
//   ACADEMY_URL                 — opcional (default: https://academy.vercel.app)
//   SUPABASE_URL                — opcional (persistência)
//   SUPABASE_SERVICE_ROLE_KEY   — opcional (persistência — NUNCA expor no frontend)
// ══════════════════════════════════════════════════════════════════════════════

import crypto from 'crypto';

// ══════════════════════════════════════════════════════════════════════════════
// CAMADA DB — SUPABASE (inline, fire-and-forget, nunca crasha o engine)
// ══════════════════════════════════════════════════════════════════════════════

const SB_URL = process.env.SUPABASE_URL
  ?? 'https://ivvkxgqmvolrrjwfxtzy.supabase.co';

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
      console.warn(`[DB] Supabase ${res.status} [${table}]: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[DB] sbPost falhou [${table}]:`, e.message);
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

async function persistRequest({
  requestId,
  userId,
  action,
  payload,
  result,
  modelUsed,
  responseTime,
} = {}) {
  if (!SB_KEY) return false;

  const now = new Date().toISOString();

  try {
    await sbPost('academy_ai_logs', {
      id:            crypto.randomUUID(),
      user_id:       userId        ?? 'anonymous',
      action:        action        ?? 'unknown',
      model_used:    modelUsed     ?? null,
      request_id:    requestId     ?? 'unknown',
      response_time: responseTime  ?? null,
      payload:       payload       ?? {},
      result:        result        ?? {},
      created_at:    now,
    });
  } catch (e) {
    console.warn('[DB] academy_ai_logs insert falhou:', e.message);
  }

  const docTypeMap = {
    gerar_capitulo:       'chapter',
    gerar_capitulo_livro: 'book',
    create_work:          'work',
  };
  const docType = docTypeMap[action];

  if (docType) {
    try {
      const title = String(
        payload?.capTitulo ?? payload?.topic ?? payload?.tema ?? action
      );
      await sbPost('academy_documents', {
        id:         crypto.randomUUID(),
        user_id:    userId ?? 'anonymous',
        type:       docType,
        title,
        content:    { payload, result },
        created_at: now,
        updated_at: now,
      });
    } catch (e) {
      console.warn('[DB] academy_documents insert falhou:', e.message);
    }
  }

  return true;
}

async function getResumeData(userId) {
  const empty = {
    last_document: null,
    last_session:  null,
    last_action:   null,
    last_state:    null,
  };

  if (!SB_KEY) return empty;

  try {
    const uid = encodeURIComponent(userId ?? 'anonymous');

    const [docs, sessions, logs] = await Promise.allSettled([
      sbGet(`academy_documents?user_id=eq.${uid}&order=updated_at.desc&limit=1`),
      sbGet(`academy_sessions?user_id=eq.${uid}&order=last_activity.desc&limit=1`),
      sbGet(`academy_ai_logs?user_id=eq.${uid}&order=created_at.desc&limit=1`),
    ]);

    const toArr = (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : []);

    const lastDoc  = toArr(docs)[0]     ?? null;
    const lastSess = toArr(sessions)[0] ?? null;
    const lastLog  = toArr(logs)[0]     ?? null;

    return {
      last_document: lastDoc,
      last_session:  lastSess,
      last_action:   lastLog?.action ?? null,
      last_state:    lastLog
        ? { action: lastLog.action, payload: lastLog.payload, model: lastLog.model_used }
        : null,
    };
  } catch (e) {
    console.warn('[DB] getResumeData falhou:', e.message);
    return empty;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// CONFIG
// ══════════════════════════════════════════════════════════════════════════════

const VERSION  = '4.0.0';
const OR_BASE  = 'https://openrouter.ai/api/v1';
const SITE_URL = process.env.ACADEMY_URL ?? 'https://academy.vercel.app';

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-app-version, cache-control, pragma, x-user-id, x-academy-user',
};

// ══════════════════════════════════════════════════════════════════════════════
// AI ROUTER  —  config declarativo por action
// ══════════════════════════════════════════════════════════════════════════════

const AI_ROUTER = {

  chat: {
    primary:   'anthropic/claude-3.5-sonnet',
    secondary: 'openai/gpt-4o',
    tertiary:  'openai/gpt-4o-mini',
    maxTokens: 3000,
    temp:      0.7,
  },

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
    temp:      0.65,
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

  estrutura_academica: {
    primary:   'openai/gpt-4o-mini',
    secondary: 'anthropic/claude-3.5-sonnet',
    tertiary:  'openai/gpt-4o',
    maxTokens: 2048,
    temp:      0.2,
  },

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
      document_id: documentId,
    },
  };
}

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

const wordsToTokens = (w) => Math.min(Math.max(Math.ceil(w * 1.4 * 1.5), 4096), 8192);

function validateMinWords(text, min, label, requestId) {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  if (n < Math.floor(min * 0.7))
    console.warn(`[${requestId}] WARN ${label}: ${n} palavras (esperado ≥ ${min})`);
  return text;
}

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

    const d            = await res.json();
    const content      = d?.choices?.[0]?.message?.content ?? '';
    const finishReason = String(d?.choices?.[0]?.finish_reason ?? 'stop');

    if (!content) throw new Error(`[${model}]: resposta com conteúdo vazio`);
    return { content, finishReason, model };

  } finally {
    clearTimeout(tid);
  }
}

async function orCallWithRetry(msgs, model, maxTokens, temp, requestId) {
  try {
    return await orCall(msgs, model, maxTokens, temp, requestId);
  } catch (e) {
    if (e.status === 429 || String(e.message).includes('429')) {
      console.warn(`[${requestId}] ${model} rate-limited (429) — a passar para fallback`);
      throw e;
    }
    console.warn(`[${requestId}] ${model} erro transiente (${e.message}) — retry 1 s`);
    await sleep(1000);
    return await orCall(msgs, model, maxTokens, temp, requestId);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// FALLBACK CHAIN
// ══════════════════════════════════════════════════════════════════════════════

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
      return result;
    } catch (e) {
      console.warn(`[${requestId}] ${model} falhou (${i + 1}/${chain.length}): ${e.message}`);
      lastError = e;
      if (e.status === 429 || String(e.message).includes('429')) {
        await sleep(2000);
      }
    }
  }

  throw new Error(
    `Todos os modelos falharam para action "${action}". ` +
    `Chain: [${chain.join(' → ')}]. Último erro: ${lastError?.message}`
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LLM ABSTRACTIONS
// ══════════════════════════════════════════════════════════════════════════════

async function llmText(action, sys, usr, requestId, maxTokensOverride = null, tempOverride = null) {
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user',   content: usr },
  ];

  const r1 = await callWithFallback(action, msgs, maxTokensOverride, tempOverride, requestId);

  if (r1.finishReason !== 'length') return r1;

  // Auto-continuação round 1
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

    // Round 2 (máximo)
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
// ══════════════════════════════════════════════════════════════════════════════

function hPing() {
  return { resposta: 'pong', model: 'none' };
}

async function hCreateWork(b, requestId) {
  requireFields(b, ['topic'], 'create_work');
  const topic = String(b.topic).trim();

  const r = await llmText(
    'create_work',
    'És um assistente académico especializado em trabalhos científicos formais. ' +
    'Escreves em português europeu formal com rigor, precisão e estrutura clara.',
    `Cria um trabalho académico estruturado e completo sobre: ${topic}\n\nEstrutura obrigatória:\n1. Introdução (contexto, objectivos, justificativa do tema)\n2. Desenvolvimento (análise, argumentação fundamentada, evidências e dados)\n3. Conclusão (síntese dos pontos principais, contribuição e implicações)\n4. Referências Bibliográficas (mínimo 5 referências, formato APA 7.ª ed.)\n\nTexto corrido académico. Parágrafos separados por linha em branco. Mínimo 600 palavras.`,
    requestId,
  );

  return { resposta: { topic, content: r.content }, model: r.model };
}

async function hPlanoAcademico(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'nivel'], 'plano_academico');

  const r = await llmJSON(
    'plano_academico',
    'És um especialista académico do sistema universitário angolano. Respondes em português formal.',
    `Gera um plano académico de investigação para:\nTema: ${b.tema} | Tipo: ${b.tipoTrabalho} | Nível: ${b.nivel}\n\nJSON obrigatório:\n{\n  "problema": "enunciado claro do problema",\n  "objetivo": "objetivo geral",\n  "objetivosEspecificos": ["obj1","obj2","obj3"],\n  "hipotese": "hipótese principal",\n  "metodologia": "abordagem metodológica",\n  "justificativa": "relevância do estudo",\n  "limitacoes": "limitações previstas"\n}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hEstruturaAcademica(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'nivel'], 'estrutura_academica');

  const ep =
    Array.isArray(b.estruturaPadrao) && b.estruturaPadrao.length > 0
      ? `\nReferência de estrutura: ${JSON.stringify(b.estruturaPadrao)}`
      : '';

  const r = await llmJSON(
    'estrutura_academica',
    'És especialista em estruturação de trabalhos académicos angolanos. Segues normas das universidades de Angola.',
    `Gera estrutura de capítulos para:\nTema: ${b.tema} | Tipo: ${b.tipoTrabalho} | Nível: ${b.nivel} | Páginas: ${b.pags ?? 15}\nSugestão do professor: ${b.estruturaProf ?? 'nenhuma'}${ep}\n\nJSON obrigatório:\n{\n  "capitulos": [\n    {"num":1,"titulo":"Introdução","subs":["1.1 Contextualização","1.2 Justificativa","1.3 Objectivos"]},\n    {"num":2,"titulo":"...","subs":["2.1 ...","2.2 ..."]}\n  ]\n}\nInclui obrigatoriamente: Introdução, 2-4 caps de desenvolvimento, Conclusão, Referências Bibliográficas.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hGerarCapitulo(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'capNum', 'capTitulo'], 'gerar_capitulo');

  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap ?? 600);

  const r = await llmText(
    'gerar_capitulo',
    'És um escritor académico de excelência. Escreves em português formal angolano com rigor científico, ' +
    'argumentação coesa e transições fluidas entre parágrafos.',
    `Escreve o Capítulo ${b.capNum} — "${b.capTitulo}" para um ${b.tipoTrabalho} sobre "${b.tema}".\nSub-secções: ${subs || 'livre'} | Nível: ${b.nivel ?? 'universitário'} | Palavras alvo: ${minWords}\nObjectivo geral: ${b.objetivo ?? ''}\nHipótese: ${b.hipotese ?? ''}\nMetodologia: ${b.metodologia ?? ''}\n\nRegras: texto académico corrido, parágrafos separados por linha em branco, sem # ou bullets.`,
    requestId,
    wordsToTokens(minWords),
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Cap ${b.capNum} — ${b.capTitulo}`, requestId),
    model: r.model,
  };
}

async function hRegerarCapitulo(b, requestId) {
  requireFields(b, ['tema', 'tipoTrabalho', 'capNum', 'capTitulo'], 'regenerar_capitulo');

  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap ?? 600);

  const r = await llmText(
    'regenerar_capitulo',
    'Regeneras capítulos académicos com nova perspectiva, novos exemplos e ângulo diferente, mas igual rigor.',
    `Regenera o Capítulo ${b.capNum} — "${b.capTitulo}" para um ${b.tipoTrabalho} sobre "${b.tema}".\nSub-secções: ${subs || 'livre'}\n\nIMPORTANTE: Esta deve ser uma versão claramente diferente da anterior.\nUsa novos exemplos, nova ordem de argumentos, perspectiva diferente.\nTexto académico formal. Parágrafos com linha em branco.`,
    requestId,
    wordsToTokens(minWords),
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Regen Cap ${b.capNum}`, requestId),
    model: r.model,
  };
}

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

async function hVerificarCoerencia(b, requestId) {
  requireFields(b, ['problema', 'objetivo'], 'verificar_coerencia');

  const r = await llmJSON(
    'verificar_coerencia',
    'Revisor académico especializado em coerência estrutural de trabalhos universitários angolanos.',
    `Verifica coerência entre problema, objectivo, introdução e conclusão:\nProblema: ${b.problema}\nObjectivo: ${b.objetivo}\nIntrodução (excerto): ${b.introTexto ?? '(não fornecida)'}\nConclusão (excerto): ${b.concTexto ?? '(não fornecida)'}\n\nJSON obrigatório:\n{"coerente":true,"alertas":["alerta se existir"],"sugestoes":["sugestão"],"pontuacaoCoerencia":85}\nSe tudo correcto: alertas e sugestoes são arrays vazios.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hGerarMEA(b, requestId) {
  requireFields(b, ['tema'], 'gerar_mea');

  const r = await llmJSON(
    'gerar_mea',
    'Especialista em enriquecimento académico visual. Decides onde gráficos/tabelas/esquemas acrescentam valor real ao argumento.',
    `Trabalho sobre "${b.tema}". Capítulos: ${JSON.stringify(b.capitulos ?? [])}\n\nJSON obrigatório (máx 4 elementos, escolhe apenas onde há valor real):\n{"elementos":[{"tipo":"grafico","capitulo":1,"titulo":"..."},{"tipo":"tabela","capitulo":2,"titulo":"..."}]}\n"tipo" é exactamente: "grafico", "tabela" ou "esquema".`,
    requestId,
  );

  const data = r.data;
  if (Array.isArray(data?.elementos) && data.elementos.length > 4) {
    data.elementos.splice(4);
  }

  return { resposta: data, model: r.model };
}

async function hMEAGrafico(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_grafico');

  const r = await llmJSON(
    'mea_grafico',
    'Geras dados realistas e academicamente plausíveis para gráficos de trabalhos universitários.',
    `Gráfico para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}\nJSON: {"titulo":"...","tipo":"bar","labels":["A","B","C","D"],"dados":[40,65,52,78],"unidade":"%"}\n"tipo" pode ser: "bar", "line" ou "pie". Dados devem ser realistas para o contexto académico.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hMEATabela(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_tabela');

  const r = await llmJSON(
    'mea_tabela',
    'Geras tabelas académicas realistas e informativas para trabalhos universitários.',
    `Tabela para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}\nJSON: {"titulo":"...","cabecalhos":["Col1","Col2","Col3"],"linhas":[["v1","v2","v3"],["v1","v2","v3"]]}\nMáx 4 colunas e 5 linhas. Dados devem ser realistas e úteis para o argumento académico.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hMEAEsquema(b, requestId) {
  requireFields(b, ['tema', 'capTitulo'], 'mea_esquema');

  const r = await llmJSON(
    'mea_esquema',
    'Geras esquemas de processos claros e academicamente rigorosos.',
    `Esquema para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo ?? ''}\nJSON: {"titulo":"...","etapas":[{"num":1,"titulo":"Etapa 1","descricao":"desc breve e objectiva"}]}\n3 a 5 etapas sequenciais. Títulos concisos, descrições informativas.`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hGerarCapa(b, requestId) {
  requireFields(b, ['tema'], 'gerar_capa');

  const geminiKey = process.env.GEMINI_API_KEY;

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

  console.log(`[${requestId}] gerar_capa — a gerar conceito tipográfico via LLM`);
  try {
    const r = await llmText(
      'conceito_capa_livro',
      'És um designer gráfico especializado em capas académicas formais para universidades africanas lusófonas.',
      `Cria um conceito detalhado de capa para este trabalho académico:\nTema: ${b.tema}\nTipo: ${b.tipoTrabalho ?? 'Trabalho Académico'}\nAutor: ${b.autor ?? 'Estudante'}\nUniversidade: ${b.universidade ?? 'Universidade'}\nAno: ${b.ano ?? new Date().getFullYear()}\n\nDescreve em JSON:\n{\n  "corFundo": "#1a1a2e",\n  "corPrimaria": "#c9a84c",\n  "corSecundaria": "#ffffff",\n  "fontesTitulo": "serif elegante",\n  "elementosVisuais": "descrição de 2-3 elementos gráficos minimalistas",\n  "atmosfera": "frase descrevendo o tom visual",\n  "layoutSugerido": "descrição do layout da capa"\n}`,
      requestId,
    );

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

async function hRevisaoTrabalho(b, requestId) {
  requireFields(b, ['texto', 'nivel'], 'revisao_trabalho');

  const texto = String(b.texto).slice(0, 6000);
  const fp    = b.feedbackProf ? `\nFeedback do professor: ${b.feedbackProf}` : '';

  const r = await llmJSON(
    'revisao_trabalho',
    'Revisor académico sénior de trabalhos universitários angolanos. Rigoroso, construtivo e preciso. ' +
    'As tuas revisões transformam trabalhos mediocres em trabalhos excelentes.',
    `Analisa e revisa este texto (nível: ${b.nivel}, tipo: ${b.tipoAnalise ?? 'tudo'})${fp}:\nTEXTO: ${texto}\n\nJSON obrigatório:\n{\n  "resumo": "análise geral honesta em 2-3 frases",\n  "pontuacao": 80,\n  "pontosFortes": ["ponto forte específico 1","ponto forte específico 2","ponto forte específico 3"],\n  "melhorar": ["melhoria concreta 1","melhoria concreta 2","melhoria concreta 3"],\n  "versaoMelhorada": "versão melhorada do texto aqui",\n  "criterios": [\n    {"nome":"Coerência","valor":80},\n    {"nome":"Estrutura","valor":75},\n    {"nome":"Rigor Científico","valor":82},\n    {"nome":"Linguagem","valor":78}\n  ]\n}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hPlanoLivro(b, requestId) {
  requireFields(b, ['tema', 'tipoLivro', 'numCaps'], 'plano_livro');

  const r = await llmJSON(
    'plano_livro',
    'Editor literário sénior com vasta experiência no mercado africano lusófono. ' +
    'Crias planos editoriais que equilibram relevância cultural e apelo comercial.',
    `Plano editorial completo:\nTipo: ${b.tipoLivro} | Tema: ${b.tema} | Público: ${b.publico ?? 'geral'} | Tom: ${b.tom ?? 'formal'} | Caps: ${b.numCaps}\n\nJSON com exactamente ${b.numCaps} capítulos:\n{\n  "titulo": "título apelativo e memorável",\n  "sinopse": "3-4 frases envolventes que vendem o livro",\n  "capitulos": [{"num":1,"titulo":"...","descricao":"o que este cap aborda e como contribui para o todo"}]\n}`,
    requestId,
  );

  return { resposta: r.data, model: r.model };
}

async function hConceitoCapaLivro(b, requestId) {
  requireFields(b, ['titulo', 'tipoLivro'], 'conceito_capa_livro');

  const r = await llmText(
    'conceito_capa_livro',
    'Designer editorial com 20 anos de experiência em capas de livros para o mercado africano e lusófono.',
    `Conceito detalhado de capa para "${b.titulo}" (${b.tipoLivro}).\nPúblico-alvo: ${b.publico ?? 'geral'} | Tom: ${b.tom ?? 'neutro'}\n\nDescreve em 4-5 frases concretas e inspiradoras:\npaleta de cores exacta, tipografia escolhida, elementos visuais principais, atmosfera geral, e porquê estas escolhas funcionam para este livro e mercado.`,
    requestId,
    1024,
    0.7,
  );

  return { resposta: r.content, model: r.model };
}

async function hGerarCapituloLivro(b, requestId) {
  requireFields(b, ['titulo', 'tema', 'capNum', 'capTitulo', 'capDescricao'], 'gerar_capitulo_livro');

  const extras   = Array.isArray(b.extras) ? ` Elementos a incluir: ${b.extras.join(', ')}.` : '';
  const minWords = 600;

  const r = await llmText(
    'gerar_capitulo_livro',
    `Escritor profissional de ficção e não-ficção. Tom ${b.tom ?? 'envolvente'}. ` +
    `Escreves para público ${b.publico ?? 'geral'}. ` +
    `O teu estilo é fluido, imersivo e adequado ao mercado lusófono africano.`,
    `Capítulo ${b.capNum} — "${b.capTitulo}" do livro "${b.titulo}".\nTema central: ${b.tema} | Tom: ${b.tom ?? 'envolvente'} | Público: ${b.publico ?? 'geral'}\nO que este capítulo deve cobrir: ${b.capDescricao}${extras}\n\nMínimo 600 palavras. Parágrafos separados por linha em branco. Sem # ou bullets. Escrita imersiva.`,
    requestId,
    wordsToTokens(minWords),
    0.7,
  );

  return {
    resposta: validateMinWords(r.content, minWords, `Cap Livro ${b.capNum}`, requestId),
    model: r.model,
  };
}

async function hChat(b, requestId) {
  const tema      = String(b.tema ?? 'trabalho académico');
  const tipo      = String(b.tipoTrabalho ?? 'Trabalho Académico');
  const estrutura = Array.isArray(b.estrutura) ? b.estrutura.join(', ') : '';

  const sys = b.modoInstrutor
    ? `És o ACADEMY Instrutor — tutor académico estratégico para estudantes universitários angolanos.\n\nCONTEXTO DO ALUNO:\n- Está a escrever: ${tipo} sobre "${tema}"\n- Estrutura actual: ${estrutura || 'ainda a definir'}\n\nO TEU MÉTODO:\n- Fazes perguntas que desenvolvem o pensamento crítico do aluno\n- Nunca dás respostas directas — guias para que o aluno chegue lá\n- Identificas lacunas de argumento com precisão cirúrgica\n- Usas exemplos do contexto angolano e africano quando relevante\n- Respondes em português europeu formal mas acessível`
    : `És o ACADEMY Copiloto — parceiro académico inteligente de estudantes universitários angolanos.\n\nCONTEXTO DO TRABALHO:\n- Tipo: ${tipo} sobre "${tema}"${estrutura ? `\n- Estrutura: ${estrutura}` : ''}\n\nO TEU ESTILO:\n- Directo e útil — não perguntas desnecessárias se a resposta é clara\n- Explicas conceitos com exemplos concretos do contexto angolano/africano\n- Sugeres melhorias práticas e implementáveis\n- Usas **negrito** para pontos-chave e listas quando clarificam\n- Tom: parceiro académico competente, não assistente genérico\n- Respondes em português formal mas natural — não robótico`;

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

// ── resume (GET /api/academy-engine?action=resume) ────────────────────────────
async function hResume(req) {
  const userId = getUserId(req);
  return getResumeData(userId);
}

// ══════════════════════════════════════════════════════════════════════════════
// VERCEL HANDLER — único entry point
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  // ── GET /api/academy-engine?action=resume ────────────────────────────────
  if (req.method === 'GET') {
    const action = req.query?.action ?? '';
    if (action === 'resume') {
      try {
        const data = await hResume(req);
        res.status(200).json({ ok: true, action: 'resume', data });
      } catch (e) {
        res.status(200).json({ ok: true, action: 'resume', data: {
          last_document: null, last_session: null, last_action: null, last_state: null,
        }});
      }
      return;
    }
    res.status(405).json(errRes('unknown', 'Método não permitido — usa POST', 'N/A'));
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json(errRes('unknown', 'Método não permitido — usa POST', 'N/A'));
    return;
  }

  const requestId = makeRequestId();
  const body      = req.body ?? {};
  const payload   = body.payload ?? {};
  const userId    = getUserId(req);

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
    let result;

    switch (action) {
      case 'ping':                 result = hPing();                                       break;
      case 'create_work':          result = await hCreateWork(payload, requestId);          break;
      case 'plano_academico':      result = await hPlanoAcademico(payload, requestId);      break;
      case 'estrutura_academica':  result = await hEstruturaAcademica(payload, requestId);  break;
      case 'gerar_capitulo':       result = await hGerarCapitulo(payload, requestId);       break;
      case 'regenerar_capitulo':   result = await hRegerarCapitulo(payload, requestId);     break;
      case 'editar_texto':         result = await hEditarTexto(payload, requestId);         break;
      case 'verificar_coerencia':  result = await hVerificarCoerencia(payload, requestId);  break;
      case 'gerar_mea':            result = await hGerarMEA(payload, requestId);            break;
      case 'mea_grafico':          result = await hMEAGrafico(payload, requestId);          break;
      case 'mea_tabela':           result = await hMEATabela(payload, requestId);           break;
      case 'mea_esquema':          result = await hMEAEsquema(payload, requestId);          break;
      case 'gerar_capa':           result = await hGerarCapa(payload, requestId);           break;
      case 'revisao_trabalho':     result = await hRevisaoTrabalho(payload, requestId);     break;
      case 'plano_livro':          result = await hPlanoLivro(payload, requestId);          break;
      case 'conceito_capa_livro':  result = await hConceitoCapaLivro(payload, requestId);   break;
      case 'gerar_capitulo_livro': result = await hGerarCapituloLivro(payload, requestId);  break;
      case 'chat':                 result = await hChat(payload, requestId);                break;
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
    }).catch((e) => console.warn('[ACADEMY] persist falhou (non-blocking):', e.message));

    res.status(200).json(okRes(action, result.resposta, result.model, requestId));

  } catch (e) {
    const msg      = e instanceof Error ? e.message : String(e);
    const duration = Date.now() - t0;
    console.error(`[${requestId}] ✗ ${action} — ${duration} ms:`, msg);
    res.status(500).json(errRes(action, msg, requestId));
  }
}
