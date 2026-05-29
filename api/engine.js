/* =======================================================================
   ACADEMY — /api/engine  (Vercel Serverless Function)
   Versão: SaaS-Hardened v2.0
   Arquitectura : Frontend → /api/engine → switch(action) → funções internas
   Provider de IA: OpenRouter (único — sem fallback, sem Groq)
   Dados         : Supabase (save_history / get_history)
   Acções        : chat | generate_lesson | save_history | get_history |
                   get_stock | + acções legacy académicas

   Melhorias SaaS v2.0:
   ─ AbortController + timeout real em cada fetch
   ─ Retry inteligente com backoff exponencial (apenas erros temporários)
   ─ Detecção de rate-limit (429), overload (503/529) e timeout
   ─ CORS garantido em TODOS os caminhos (incluindo erros precoces)
   ─ Validação e sanitização de todos os inputs
   ─ Rate-limit simples por IP (anti-spam / anti-flood)
   ─ Logs estruturados com tempo de execução por request
   ─ Envelope padrão { ok, action, data, meta } em todos os caminhos
   ─ Protecção contra payloads gigantes e histórico excessivo
   ─ Respostas consistentes mesmo em erro

   Variáveis de ambiente necessárias (Vercel → Settings → Environment):
     OPENROUTER_API_KEY   — chave da API OpenRouter
     SUPABASE_URL         — URL do projecto Supabase
     SUPABASE_SERVICE_KEY — service_role key do Supabase
======================================================================= */

/* ── Configuração OpenRouter ────────────────────────────────────────── */
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL = 'openai/gpt-4o-mini';
const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY - Grupo AGEA Comercial';

/* ── Limites de protecção ───────────────────────────────────────────── */
const LIMITS = {
  PAYLOAD_MAX_BYTES : 128 * 1024,      /* 128 KB — rejeita payloads gigantes   */
  TEMA_MAX_LEN      : 300,             /* caracteres máximos no tema           */
  PEDIDO_MAX_LEN    : 2000,            /* caracteres máximos num pedido de chat */
  TEXTO_MAX_LEN     : 4000,            /* editar_texto: máximo de caracteres   */
  HISTORICO_MAX_MSGS: 10,              /* mensagens máximas no histórico       */
  HISTORICO_MSG_LEN : 800,             /* comprimento máximo por mensagem      */
  CAPS_MAX          : 20,              /* capítulos máximos por geração        */
  SUBS_MAX          : 8,               /* subtópicos máximos por capítulo      */
  OR_TIMEOUT_MS     : 85_000,          /* timeout OpenRouter (< Vercel 90s)    */
  SB_TIMEOUT_MS     : 10_000,          /* timeout Supabase                     */
  RATE_LIMIT_WINDOW : 60_000,          /* janela de rate-limit: 60 segundos    */
  RATE_LIMIT_MAX    : 30,              /* máx. requests por IP por janela      */
};

/* ── Rate-limit em memória (por IP) ─────────────────────────────────── */
/* Nota: em Vercel Serverless cada instância tem o seu próprio mapa.
   Para produção com múltiplas instâncias, substituir por Upstash Redis. */
const _RL_MAP = new Map(); /* ip → { count, windowStart } */

/* ── CORS — aplicado em TODOS os caminhos ───────────────────────────── */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/* ── Aplicar CORS a qualquer objecto de resposta ───────────────────── */
function applyCORS(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');
}

/* ── Resposta de erro com CORS e envelope padrão ────────────────────── */
function sendError(res, status, action, message, meta = {}) {
  applyCORS(res);
  return res.status(status).json({
    ok    : false,
    action: action || 'unknown',
    data  : {},
    error : message,
    meta  : { ts: Date.now(), provider: 'openrouter', ...meta },
  });
}

/* ====================================================================
   ENTRY POINT
==================================================================== */
export default async function handler(req, res) {
  const t0 = Date.now();

  /* ── Preflight CORS ─────────────────────────────────────────────── */
  if (req.method === 'OPTIONS') {
    applyCORS(res);
    return res.status(204).end();
  }

  /* ── Método ─────────────────────────────────────────────────────── */
  if (req.method !== 'POST') {
    return sendError(res, 405, 'unknown', 'Método não permitido. Use POST.');
  }

  /* ── Protecção payload gigante ──────────────────────────────────── */
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > LIMITS.PAYLOAD_MAX_BYTES) {
    return sendError(res, 413, 'unknown', 'Payload demasiado grande. Máximo 128 KB.');
  }

  /* ── Parse do body ──────────────────────────────────────────────── */
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') throw new Error('body não é objecto');
  } catch {
    return sendError(res, 400, 'unknown', 'JSON inválido ou body em falta.');
  }

  /* ── Validação básica de action ─────────────────────────────────── */
  const { action, payload = {} } = body;
  if (!action || typeof action !== 'string' || action.length > 64) {
    return sendError(res, 400, 'unknown', '"action" é obrigatório e deve ser string.');
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return sendError(res, 400, action, '"payload" deve ser um objecto JSON.');
  }

  /* ── Rate-limit por IP ──────────────────────────────────────────── */
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
           || req.headers['x-real-ip']
           || req.socket?.remoteAddress
           || 'unknown';

  const rlCheck = checkRateLimit(ip);
  if (!rlCheck.ok) {
    log('RATE_LIMIT', action, ip, `bloqueado (${rlCheck.count} req/min)`);
    return sendError(res, 429, action, 'Demasiadas requests. Aguarda um momento e tenta novamente.', {
      retryAfter: Math.ceil((rlCheck.windowStart + LIMITS.RATE_LIMIT_WINDOW - Date.now()) / 1000),
    });
  }

  /* ── Aplicar CORS ao caminho feliz ──────────────────────────────── */
  applyCORS(res);

  /* ── Router central ─────────────────────────────────────────────── */
  try {
    let result;

    switch (action) {

      case 'chat':
        result = await actionChat(payload);
        break;

      case 'generate_lesson':
        result = await actionGenerateLesson(payload);
        break;

      case 'save_history':
        result = await actionSaveHistory(payload);
        break;

      case 'get_history':
        result = await actionGetHistory(payload);
        break;

      case 'get_stock':
        result = actionGetStock(payload);
        break;

      /* ── Acções académicas legacy (mantidas por compatibilidade) ── */
      case 'plano_academico':
      case 'estrutura_academica':
      case 'gerar_capitulo':
      case 'gerar_capitulo_referencias':
      case 'regenerar_capitulo':
      case 'editar_texto':
      case 'verificar_coerencia':
      case 'gerar_capa':
      case 'gerar_mea':
      case 'mea_grafico':
      case 'mea_tabela':
      case 'mea_esquema':
      case 'ping':
        result = await actionLegacy(action, payload);
        break;

      default:
        return sendError(res, 400, action, `Acção desconhecida: "${action}"`);
    }

    const elapsed = Date.now() - t0;
    log('OK', action, ip, `${elapsed}ms`);

    /* Garantir que meta tem sempre ts e provider */
    if (result?.meta) {
      result.meta.elapsed_ms = elapsed;
    }

    return res.status(200).json(result);

  } catch (err) {
    const elapsed = Date.now() - t0;
    log('ERROR', action, ip, `${elapsed}ms — ${err.message}`);

    /* Traduzir erros internos conhecidos para mensagens amigáveis */
    const friendly = friendlyError(err.message);
    return sendError(res, friendly.status, action, friendly.message, { elapsed_ms: elapsed });
  }
}

/* ====================================================================
   RATE-LIMIT — controlo simples por IP em memória
==================================================================== */
function checkRateLimit(ip) {
  const now  = Date.now();
  const entry = _RL_MAP.get(ip);

  if (!entry || now - entry.windowStart > LIMITS.RATE_LIMIT_WINDOW) {
    /* Nova janela */
    _RL_MAP.set(ip, { count: 1, windowStart: now });
    /* Limpar entradas antigas periodicamente (a cada 500 entradas) */
    if (_RL_MAP.size > 500) {
      for (const [k, v] of _RL_MAP) {
        if (now - v.windowStart > LIMITS.RATE_LIMIT_WINDOW * 2) _RL_MAP.delete(k);
      }
    }
    return { ok: true, count: 1 };
  }

  entry.count++;
  if (entry.count > LIMITS.RATE_LIMIT_MAX) {
    return { ok: false, count: entry.count, windowStart: entry.windowStart };
  }
  return { ok: true, count: entry.count };
}

/* ====================================================================
   LOGS ESTRUTURADOS
==================================================================== */
function log(level, action, ip, detail) {
  const ts = new Date().toISOString();
  /* Anonimizar parcialmente o IP para logs */
  const safeIp = ip ? ip.replace(/(\d+)$/, '***') : 'unknown';
  console.log(`[ACADEMY] ${ts} [${level}] action=${action} ip=${safeIp} ${detail}`);
}

/* ====================================================================
   TRADUÇÃO DE ERROS → MENSAGENS AMIGÁVEIS
==================================================================== */
function friendlyError(msg = '') {
  const m = msg.toLowerCase();

  if (m.includes('timeout') || m.includes('aborted') || m.includes('abort')) {
    return { status: 504, message: 'O servidor de IA demorou demasiado tempo. Tenta novamente num momento.' };
  }
  if (m.includes('429') || m.includes('rate') || m.includes('quota') || m.includes('resource_exhausted')) {
    return { status: 429, message: 'Limite de uso da IA atingido temporariamente. Aguarda alguns segundos e tenta novamente.' };
  }
  if (m.includes('503') || m.includes('529') || m.includes('overload') || m.includes('unavailable')) {
    return { status: 503, message: 'O serviço de IA está temporariamente sobrecarregado. Tenta novamente em breve.' };
  }
  if (m.includes('401') || m.includes('unauthorized') || m.includes('api key')) {
    return { status: 502, message: 'Erro de autenticação no servidor. Contacta o suporte ACADEMY.' };
  }
  if (m.includes('supabase') || m.includes('insert') || m.includes('select')) {
    return { status: 502, message: 'Erro ao aceder à base de dados. Tenta novamente.' };
  }
  if (m.includes('json') || m.includes('parse')) {
    return { status: 502, message: 'Resposta inválida do servidor de IA. Tenta novamente.' };
  }
  if (m.includes('resposta vazia') || m.includes('empty')) {
    return { status: 502, message: 'O servidor de IA devolveu uma resposta vazia. Tenta novamente.' };
  }
  return { status: 500, message: `Erro interno do servidor: ${msg.substring(0, 200)}` };
}

/* ====================================================================
   SANITIZAÇÃO DE STRINGS
   Remove caracteres de controlo, null bytes e normaliza espaços.
   Não altera conteúdo académico legítimo.
==================================================================== */
function sanitizeString(val, maxLen = 2000) {
  if (typeof val !== 'string') return '';
  return val
    /* Remover null bytes e caracteres de controlo (excepto \n, \r, \t) */
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    /* Normalizar múltiplos espaços em branco na mesma linha */
    .replace(/[ \t]{3,}/g, '  ')
    /* Remover linhas com apenas caracteres especiais suspeitos */
    .replace(/^[<>{}[\]\\]{3,}$/gm, '')
    /* Truncar */
    .substring(0, maxLen)
    .trim();
}

/* Sanitizar array de strings (subtópicos, histórico, etc.) */
function sanitizeStringArray(arr, maxItems, maxItemLen) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, maxItems)
    .map(s => sanitizeString(String(s || ''), maxItemLen))
    .filter(s => s.length > 0);
}

/* ====================================================================
   ACÇÃO: chat
   Assistente académico conversacional via OpenRouter
==================================================================== */
async function actionChat(payload) {
  const tema        = sanitizeString(payload.tema || '', LIMITS.TEMA_MAX_LEN);
  const tipoTrabalho = sanitizeString(payload.tipoTrabalho || 'Trabalho Académico', 100);
  const pedido      = sanitizeString(payload.pedido || '', LIMITS.PEDIDO_MAX_LEN);

  if (!pedido) throw new Error('pedido é obrigatório para action=chat');

  /* Sanitizar e limitar histórico */
  const historicoRaw = Array.isArray(payload.historico) ? payload.historico : [];
  const historico = historicoRaw
    .slice(-LIMITS.HISTORICO_MAX_MSGS)
    .map(m => ({
      role   : m?.role === 'assistant' ? 'assistant' : 'user',
      content: sanitizeString(String(m?.content || ''), LIMITS.HISTORICO_MSG_LEN),
    }))
    .filter(m => m.content.length > 0);

  const system = `És o assistente académico ACADEMY. Respondes SEMPRE em português de Angola, formal e académico.
Ajudas estudantes angolanos com os seus trabalhos académicos.
Contexto actual: trabalho "${tema}" (${tipoTrabalho}).
Sê conciso e directo - máx 200 palavras por resposta.`;

  const messages = [
    { role: 'system', content: system },
    ...historico,
    { role: 'user', content: pedido },
  ];

  const resposta = await callOpenRouter(messages, { max_tokens: 1024, temperature: 0.7 });
  return envelope('chat', { resposta });
}

/* ====================================================================
   ACÇÃO: generate_lesson
   Gera conteúdo de uma lição/secção académica via OpenRouter
==================================================================== */
async function actionGenerateLesson(payload) {
  const tema          = sanitizeString(payload.tema || '', LIMITS.TEMA_MAX_LEN);
  const tipoTrabalho  = sanitizeString(payload.tipoTrabalho || 'Trabalho Académico', 100);
  const nivel         = sanitizeString(payload.nivel || '', 80);
  const capNum        = parseInt(payload.capNum, 10) || 1;
  const capTitulo     = sanitizeString(payload.capTitulo || '', 200);
  const palavrasPorCap = Math.min(Math.max(parseInt(payload.palavrasPorCap, 10) || 600, 200), 3000);
  const capSubs       = sanitizeStringArray(payload.capSubs, LIMITS.SUBS_MAX, 150);

  if (!tema)     throw new Error('tema é obrigatório para generate_lesson');
  if (!capTitulo) throw new Error('capTitulo é obrigatório para generate_lesson');

  const subsFormatados = capSubs
    .map((s, i) => `${capNum}.${i + 1} ${s}`)
    .join('\n');

  const prompt = `És um professor universitário angolano a escrever um capítulo para um ${tipoTrabalho} de nível ${nivel} sobre "${tema}".

CAPÍTULO A ESCREVER:
Capítulo ${capNum} — ${capTitulo}

SUBTÓPICOS OBRIGATÓRIOS (usa exactamente esta numeração):
${subsFormatados}

ESTRUTURA OBRIGATÓRIA PARA CADA SUBTÓPICO:
Cada subtópico deve conter, pela seguinte ordem:
1. Título do subtópico numerado (ex: ${capNum}.1 Nome do Subtópico) em linha própria e separada
2. Parágrafo de contextualização (60-80 palavras) — enquadra o subtópico no tema geral
3. Desenvolvimento teórico (2 a 3 parágrafos de 60-80 palavras cada) — conceitos, definições, argumentos académicos fundamentados
4. Exemplo concreto introduzido obrigatoriamente com a expressão "A título de exemplo:" — mínimo 60 palavras, realista e relacionado com Angola ou África quando pertinente
5. Parágrafo de síntese parcial (40-60 palavras) — encerra o subtópico com uma conclusão local

REGRAS DE FORMATAÇÃO:
- O título do capítulo principal (Capítulo ${capNum} — ${capTitulo}) aparece no topo, em linha própria
- Cada subtítulo numerado (${capNum}.1, ${capNum}.2, etc.) aparece em linha própria, separado por uma linha em branco antes e depois
- Parágrafos separados por linha em branco
- Sem bullets, sem listas com traços, sem asteriscos, sem markdown
- Português formal angolano/europeu
- Total do capítulo: aproximadamente ${palavrasPorCap} palavras

Escreve o capítulo completo agora, sem introduções nem comentários.`;

  const messages  = [{ role: 'user', content: prompt }];
  const resposta  = await callOpenRouter(messages, { max_tokens: 8192, temperature: 0.65 });
  return envelope('generate_lesson', { resposta });
}

/* ====================================================================
   ACÇÃO: save_history
   Guarda uma entrada no histórico (Supabase)
==================================================================== */
async function actionSaveHistory(payload) {
  const user_id  = sanitizeString(payload.user_id || '', 200);
  const tipo     = sanitizeString(payload.tipo     || '', 100);
  const tema     = sanitizeString(payload.tema     || '', LIMITS.TEMA_MAX_LEN);
  const pags     = typeof payload.pags === 'number' ? Math.max(1, Math.min(payload.pags, 9999)) : null;
  const qual     = typeof payload.qual === 'number' ? Math.max(0, Math.min(payload.qual, 100))   : null;
  /* Metadata: aceitar objecto plano, descartar keys suspeitas */
  const metaRaw  = (typeof payload.metadata === 'object' && !Array.isArray(payload.metadata))
                   ? payload.metadata : {};
  const metadata = Object.fromEntries(
    Object.entries(metaRaw)
      .slice(0, 20)
      .map(([k, v]) => [sanitizeString(k, 50), sanitizeString(String(v ?? ''), 300)])
  );

  if (!user_id) throw new Error('user_id é obrigatório para save_history');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), LIMITS.SB_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(`${url}/rest/v1/academy_history`, {
      method : 'POST',
      signal : ctrl.signal,
      headers: {
        'Content-Type' : 'application/json',
        'apikey'       : key,
        'Authorization': `Bearer ${key}`,
        'Prefer'       : 'return=minimal',
      },
      body: JSON.stringify({
        user_id,
        tipo,
        tema,
        pags,
        qual,
        metadata,
        created_at: new Date().toISOString(),
      }),
    });
  } finally {
    clearTimeout(tid);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supabase insert falhou (HTTP ${resp.status}): ${errText.substring(0, 200)}`);
  }

  return envelope('save_history', { saved: true });
}

/* ====================================================================
   ACÇÃO: get_history
   Obtém histórico de gerações do utilizador (Supabase)
==================================================================== */
async function actionGetHistory(payload) {
  const user_id = sanitizeString(payload.user_id || '', 200);
  const limit   = Math.min(Math.max(parseInt(payload.limit, 10) || 20, 1), 100);

  if (!user_id) throw new Error('user_id é obrigatório para get_history');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado no servidor.');

  const params = new URLSearchParams({
    select  : '*',
    user_id : `eq.${user_id}`,
    order   : 'created_at.desc',
    limit   : String(limit),
  });

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), LIMITS.SB_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(`${url}/rest/v1/academy_history?${params}`, {
      signal : ctrl.signal,
      headers: {
        'apikey'       : key,
        'Authorization': `Bearer ${key}`,
      },
    });
  } finally {
    clearTimeout(tid);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supabase select falhou (HTTP ${resp.status}): ${errText.substring(0, 200)}`);
  }

  const rows = await resp.json();
  return envelope('get_history', { rows: Array.isArray(rows) ? rows : [] });
}

/* ====================================================================
   ACÇÃO: get_stock
   Devolve stock/inventário — lógica simples sem IA
==================================================================== */
function actionGetStock(payload) {
  const plano = sanitizeString(payload.plano || 'gratuito', 50);

  const STOCK = {
    gratuito  : { pags_mes: 15,  gens_dia: 2,  gens_sem: 2   },
    basico    : { pags_mes: 60,  gens_dia: 10, gens_sem: 40  },
    estudante : { pags_mes: 120, gens_dia: 20, gens_sem: 80  },
    pro       : { pags_mes: 300, gens_dia: 50, gens_sem: 200 },
  };

  const stock = STOCK[plano] || STOCK.gratuito;
  return envelope('get_stock', { plano: STOCK[plano] ? plano : 'gratuito', stock });
}

/* ====================================================================
   ACÇÃO LEGACY
   Todas as acções académicas existentes — prompts construídos em buildPrompt
==================================================================== */
async function actionLegacy(action, payload) {
  if (action === 'ping') {
    return envelope('ping', { resposta: 'pong' });
  }

  /* Sanitizar payload antes de construir prompt */
  const cleanPayload = sanitizeLegacyPayload(action, payload);
  const prompt   = buildPrompt(action, cleanPayload);
  const messages = [{ role: 'user', content: prompt }];

  const isJson = [
    'plano_academico', 'estrutura_academica', 'verificar_coerencia',
    'gerar_mea', 'mea_grafico', 'mea_tabela', 'mea_esquema',
  ].includes(action);

  const raw = await callOpenRouter(messages, {
    max_tokens  : 8192,
    temperature : action === 'chat' ? 0.7 : 0.65,
  });

  let resposta = raw;
  if (isJson) {
    const clean = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    try {
      resposta = JSON.parse(clean);
    } catch {
      /* Se o JSON falhar, devolver o texto limpo — o frontend trata */
      resposta = raw;
    }
  }

  return envelope(action, { resposta });
}

/* ── Sanitização de payloads legacy ─────────────────────────────── */
function sanitizeLegacyPayload(action, payload) {
  const p = { ...payload };

  /* Campos de texto curto */
  if (p.tema)        p.tema        = sanitizeString(p.tema,        LIMITS.TEMA_MAX_LEN);
  if (p.tipoTrabalho) p.tipoTrabalho = sanitizeString(p.tipoTrabalho, 100);
  if (p.nivel)       p.nivel       = sanitizeString(p.nivel,       80);
  if (p.capTitulo)   p.capTitulo   = sanitizeString(p.capTitulo,   200);
  if (p.objetivo)    p.objetivo    = sanitizeString(p.objetivo,    400);
  if (p.hipotese)    p.hipotese    = sanitizeString(p.hipotese,    300);
  if (p.metodologia) p.metodologia = sanitizeString(p.metodologia, 300);
  if (p.problema)    p.problema    = sanitizeString(p.problema,    400);
  if (p.subacao)     p.subacao     = sanitizeString(p.subacao,     30);
  if (p.estruturaProf) p.estruturaProf = sanitizeString(p.estruturaProf, 500);

  /* Texto a editar — limite especial */
  if (p.texto) p.texto = sanitizeString(p.texto, LIMITS.TEXTO_MAX_LEN);

  /* Textos de introdução/conclusão */
  if (p.introTexto) p.introTexto = sanitizeString(p.introTexto, 600);
  if (p.concTexto)  p.concTexto  = sanitizeString(p.concTexto,  600);

  /* Números seguros */
  if (p.capNum !== undefined) p.capNum = parseInt(p.capNum, 10) || 1;
  if (p.numCaps !== undefined) p.numCaps = Math.min(Math.max(parseInt(p.numCaps, 10) || 5, 1), LIMITS.CAPS_MAX);
  if (p.pags !== undefined)   p.pags   = Math.min(Math.max(parseInt(p.pags, 10) || 15, 1), 9999);
  if (p.palavrasPorCap !== undefined) {
    p.palavrasPorCap = Math.min(Math.max(parseInt(p.palavrasPorCap, 10) || 600, 200), 3000);
  }

  /* Arrays de subtópicos */
  if (p.capSubs !== undefined) {
    p.capSubs = sanitizeStringArray(p.capSubs, LIMITS.SUBS_MAX, 150);
  }

  /* estruturaPadrao: array de capítulos (apenas validação de tipo) */
  if (p.estruturaPadrao !== undefined && !Array.isArray(p.estruturaPadrao)) {
    p.estruturaPadrao = [];
  }

  /* capitulos para gerar_mea: limitar a CAPS_MAX entradas */
  if (Array.isArray(p.capitulos)) {
    p.capitulos = p.capitulos.slice(0, LIMITS.CAPS_MAX).map(c => ({
      num   : parseInt(c?.num, 10) || 1,
      titulo: sanitizeString(String(c?.titulo || ''), 200),
    }));
  }

  return p;
}

/* ====================================================================
   HELPER: callOpenRouter
   Única função que chama a API de IA.
   Inclui AbortController, retry inteligente e backoff exponencial.
==================================================================== */
async function callOpenRouter(messages, opts = {}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada no servidor.');

  /* Validação defensiva das mensagens */
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('callOpenRouter: messages deve ser array não vazio.');
  }

  const MAX_RETRIES     = 3;
  const RETRYABLE_CODES = new Set([429, 500, 502, 503, 529]);
  /* 529 é o código de overload da OpenRouter */

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    /* Backoff exponencial: 0s, 3s, 9s, 27s */
    if (attempt > 0) {
      const delay = Math.pow(3, attempt) * 1000;
      log('RETRY', 'openrouter', '-', `tentativa ${attempt + 1}/${MAX_RETRIES + 1} em ${delay}ms`);
      await sleep(delay);
    }

    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), LIMITS.OR_TIMEOUT_MS);

    try {
      const resp = await fetch(OR_URL, {
        method : 'POST',
        signal : ctrl.signal,
        headers: {
          'Content-Type' : 'application/json',
          'Authorization': `Bearer ${key}`,
          'HTTP-Referer' : OR_SITE,
          'X-Title'      : OR_TITLE,
        },
        body: JSON.stringify({
          model      : OR_MODEL,
          messages,
          temperature: opts.temperature ?? 0.7,
          max_tokens : opts.max_tokens  ?? 8192,
        }),
      });

      clearTimeout(tid);

      /* ── Erros HTTP da OpenRouter ──────────────────────────────── */
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        const errMsg  = errData?.error?.message
                     || errData?.message
                     || `OpenRouter HTTP ${resp.status}`;

        /* Só fazer retry em erros temporários */
        if (RETRYABLE_CODES.has(resp.status) && attempt < MAX_RETRIES) {
          /* Rate-limit: respeitar o Retry-After se fornecido */
          if (resp.status === 429) {
            const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
            if (retryAfter > 0 && retryAfter < 90) {
              log('RATE_LIMIT', 'openrouter', '-', `Retry-After: ${retryAfter}s`);
              await sleep(retryAfter * 1000);
            }
          }
          lastError = new Error(errMsg);
          continue; /* próxima tentativa */
        }

        throw new Error(errMsg);
      }

      /* ── Parse da resposta ─────────────────────────────────────── */
      const data = await resp.json().catch(() => null);

      if (!data) throw new Error('OpenRouter: resposta não é JSON válido.');
      if (data?.error) throw new Error(data.error.message || 'OpenRouter: erro na resposta.');

      const text = data?.choices?.[0]?.message?.content || '';
      if (!text || text.trim().length === 0) {
        throw new Error('OpenRouter: resposta vazia recebida.');
      }

      return text;

    } catch (err) {
      clearTimeout(tid);

      /* AbortError = timeout */
      if (err.name === 'AbortError' || err.message?.includes('abort')) {
        lastError = new Error(`timeout: a IA demorou mais de ${LIMITS.OR_TIMEOUT_MS / 1000}s`);
        if (attempt < MAX_RETRIES) continue;
        throw lastError;
      }

      /* Erros de rede — podem ser transitórios */
      const isNetworkError = err.message?.includes('fetch') ||
                             err.message?.includes('ECONNRESET') ||
                             err.message?.includes('ETIMEDOUT') ||
                             err.message?.includes('ENOTFOUND');
      if (isNetworkError && attempt < MAX_RETRIES) {
        lastError = err;
        continue;
      }

      throw err;
    }
  }

  throw lastError || new Error('OpenRouter: falhou após múltiplas tentativas.');
}

/* ====================================================================
   HELPER: buildPrompt
   Constrói o prompt correcto para cada acção legacy.
   (Prompts originais preservados sem simplificação.)
==================================================================== */
function buildPrompt(action, payload) {
  const LANG = 'Respondes SEMPRE em português de Angola, formal e académico. És um professor universitário angolano experiente.';

  switch (action) {

    case 'plano_academico':
      return `${LANG}\nCria um plano académico completo para um ${payload.tipoTrabalho} com o tema: "${payload.tema}".\nNível: ${payload.nivel}.\nResponde APENAS com JSON no formato:\n{"objetivo":"...","hipotese":"...","metodologia":"...","justificacao":"...","palavrasChave":["..."]}\nSem markdown, só JSON puro.`;

    case 'estrutura_academica':
      return `${LANG}\nCria a estrutura de capítulos para um ${payload.tipoTrabalho} com o tema: "${payload.tema}".\nNível: ${payload.nivel}. Páginas: ${payload.pags}. Número de capítulos: ${payload.numCaps || 5}.\nCada capítulo deve ter 3 a 5 subtópicos numerados (ex: 1.1, 1.2, 1.3).\nResponde APENAS com JSON no formato:\n{"capitulos":[{"num":1,"titulo":"...","subs":["1.1 ...","1.2 ..."]}]}\nSem markdown, só JSON puro.`;

    case 'gerar_capitulo': {
      const subsFormatados = (payload.capSubs || [])
        .map((s, i) => `${payload.capNum}.${i + 1} ${s}`)
        .join('\n');

      const contextoPlano = [
        payload.objetivo    ? `Objectivo do trabalho: ${payload.objetivo}`   : '',
        payload.hipotese    ? `Hipótese: ${payload.hipotese}`                 : '',
        payload.metodologia ? `Metodologia: ${payload.metodologia}`           : '',
      ].filter(Boolean).join('\n');

      return `${LANG}

Escreve o Capítulo ${payload.capNum} — "${payload.capTitulo}" para um ${payload.tipoTrabalho} sobre "${payload.tema}".
Nível académico: ${payload.nivel}.
${contextoPlano ? `\nCONTEXTO DO TRABALHO:\n${contextoPlano}\n` : ''}
SUBTÓPICOS OBRIGATÓRIOS (usa exactamente esta numeração):
${subsFormatados}

ESTRUTURA OBRIGATÓRIA PARA CADA SUBTÓPICO:
Cada subtópico deve conter, pela seguinte ordem:
1. Título do subtópico numerado (ex: ${payload.capNum}.1 Nome) em linha própria e separada
2. Parágrafo de contextualização (60-80 palavras) — enquadra o subtópico no tema geral e no objectivo do trabalho
3. Desenvolvimento teórico (2 a 3 parágrafos de 60-80 palavras cada) — conceitos, definições, argumentos académicos fundamentados com referência à hipótese e metodologia quando pertinente
4. Exemplo concreto introduzido com "A título de exemplo:" — mínimo 60 palavras, realista e relacionado com Angola ou África quando pertinente
5. Parágrafo de síntese parcial (40-60 palavras) — encerra o subtópico com uma conclusão local

REGRAS DE FORMATAÇÃO:
- Título do capítulo no topo, em linha própria
- Cada subtítulo numerado em linha própria, separado por linha em branco antes e depois
- Parágrafos separados por linha em branco
- Sem bullets, sem traços, sem asteriscos, sem markdown
- Total: aproximadamente ${payload.palavrasPorCap || 600} palavras

Escreve o capítulo completo agora, sem introduções nem comentários.`;
    }

    case 'gerar_capitulo_referencias':
      return `${LANG}\nCria a lista de Referências Bibliográficas para um ${payload.tipoTrabalho} sobre "${payload.tema}".\nNível: ${payload.nivel}. Formato APA 7.ª edição. Lista numerada de 8 a 14 referências. Inclui autores angolanos ou africanos quando pertinente. Sem prosa, sem markdown. Só a lista numerada.`;

    case 'regenerar_capitulo': {
      const subsFormatados2 = (payload.capSubs || [])
        .map((s, i) => `${payload.capNum}.${i + 1} ${s}`)
        .join('\n');

      return `${LANG}

Reescreve completamente o Capítulo ${payload.capNum} — "${payload.capTitulo}" para um ${payload.tipoTrabalho} sobre "${payload.tema}".

SUBTÓPICOS OBRIGATÓRIOS:
${subsFormatados2}

ESTRUTURA OBRIGATÓRIA PARA CADA SUBTÓPICO:
1. Título numerado em linha própria
2. Parágrafo de contextualização (60-80 palavras)
3. Desenvolvimento teórico (2 a 3 parágrafos de 60-80 palavras)
4. Exemplo concreto introduzido com "A título de exemplo:" — mínimo 60 palavras
5. Parágrafo de síntese parcial (40-60 palavras)

Sem bullets, sem traços, sem asteriscos, sem markdown. Português angolano formal.
Escreve o capítulo completo agora, sem introduções nem comentários.`;
    }

    case 'editar_texto': {
      const mapa = {
        melhorar: 'Melhora academicamente, tornando o texto mais rigoroso, coeso e formal',
        expandir : 'Expande com mais detalhe teórico e exemplos concretos, mantendo o estilo académico',
        resumir  : 'Resume mantendo os pontos essenciais e a coerência académica',
        corrigir : 'Corrige erros gramaticais e ortográficos e melhora a fluência académica',
      };
      const instrucao = mapa[payload.subacao] || 'Melhora academicamente';
      return `${LANG}\n${instrucao} o seguinte texto:\n\n${payload.texto}\n\nResponde apenas com o texto melhorado, sem comentários ou introduções.`;
    }

    case 'verificar_coerencia':
      return `${LANG}\nVerifica a coerência académica entre o problema, objectivo, introdução e conclusão do trabalho.\nProblema: ${payload.problema}\nObjectivo: ${payload.objetivo}\nIntrodução (excerto): ${payload.introTexto}\nConclusão (excerto): ${payload.concTexto}\nResponde APENAS com JSON:\n{"coerente":true|false,"alertas":["..."],"sugestoes":["..."]}\nSem markdown, só JSON puro.`;

    case 'gerar_capa':
      return `${LANG}\nGera metadados para a capa de um ${payload.tipoTrabalho} sobre "${payload.tema}" de nível ${payload.nivel}.\nResponde APENAS com JSON: {"subtitulo":"...","palavrasChave":["..."]}\nSem markdown, só JSON puro.`;

    case 'gerar_mea':
      return `${LANG}\nDecide que elementos visuais (gráficos, tabelas, esquemas) enriqueceriam os seguintes capítulos:\n${JSON.stringify(payload.capitulos || [])}\nTema: "${payload.tema}".\nResponde APENAS com JSON:\n{"elementos":[{"tipo":"grafico"|"tabela"|"esquema","capitulo":1,"titulo":"..."}]}\nMáx 3 elementos. Só JSON puro.`;

    case 'mea_grafico':
      return `${LANG}\nGera dados para um gráfico de barras sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","labels":["..."],"dados":[0],"unidade":"...","tipo":"bar"}\nSó JSON puro.`;

    case 'mea_tabela':
      return `${LANG}\nGera uma tabela comparativa sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","cabecalhos":["..."],"linhas":[["..."]]}\nSó JSON puro.`;

    case 'mea_esquema':
      return `${LANG}\nGera um esquema de etapas sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","etapas":[{"num":1,"titulo":"...","descricao":"..."}]}\nSó JSON puro.`;

    default:
      return `${LANG}\nResponde a esta questão académica:\n${JSON.stringify(payload).substring(0, 500)}`;
  }
}

/* ====================================================================
   HELPER: envelope
   Envolve todas as respostas no contrato padrão.
   { ok, action, data, meta }
==================================================================== */
function envelope(action, data) {
  return {
    ok    : true,
    action,
    data  : data || {},
    meta  : { ts: Date.now(), provider: 'openrouter' },
  };
}

/* ====================================================================
   HELPER: sleep
==================================================================== */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
