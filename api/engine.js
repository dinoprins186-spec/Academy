/* =======================================================================
   ACADEMY — /api/engine  (Vercel Serverless Function)
   Versão: SaaS-Hardened v2.1 — Academic Intelligence
   
   v2.1 — Alterações cirúrgicas:
   ─ Anti-detecção IA: pool de prefixos de exemplo por capítulo
   ─ Variação de hipótese/pressuposto
   ─ instrucaoVariacao + instrucaoInteligencia + instrucaoRaciocinio do frontend
   ─ Remoção de "Capítulo X — TÍTULO" do output
   ─ Progressão de tese por posição no documento
   ─ generate_lesson actualizado com mesmo sistema
   ─ TUDO O RESTO INALTERADO
======================================================================= */

/* ── Configuração OpenRouter ────────────────────────────────────────── */
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL = 'openai/gpt-4o-mini';
const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY - Grupo AGEA Comercial';

/* ── Limites de protecção ───────────────────────────────────────────── */
const LIMITS = {
  PAYLOAD_MAX_BYTES : 128 * 1024,
  TEMA_MAX_LEN      : 300,
  PEDIDO_MAX_LEN    : 2000,
  TEXTO_MAX_LEN     : 4000,
  HISTORICO_MAX_MSGS: 10,
  HISTORICO_MSG_LEN : 800,
  CAPS_MAX          : 20,
  SUBS_MAX          : 8,
  OR_TIMEOUT_MS     : 85_000,
  SB_TIMEOUT_MS     : 10_000,
  RATE_LIMIT_WINDOW : 60_000,
  RATE_LIMIT_MAX    : 30,
};

const _RL_MAP = new Map();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function applyCORS(res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');
}

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
   v2.1 — SISTEMA ANTI-DETECÇÃO IA
   Pools de variação linguística académica.
   Usados nos prompts de gerar_capitulo e generate_lesson.
==================================================================== */

/* Pool A: prefixos de exemplo — rotação por número de capítulo */
const EXEMPLO_PREFIXOS = [
  'A título de exemplo,',
  'Por exemplo,',
  'Como caso concreto,',
  'Ilustrando este ponto,',
  'Num cenário prático,',
  'Observa-se, por exemplo,',
  'Em contexto angolano,',
  'Tomando como referência,',
  'De forma ilustrativa,',
  'Como se verifica na prática,',
];

/* Pool B: variações de hipótese/pressuposto */
const HIPOTESE_VARIACOES = [
  'A hipótese central deste estudo sustenta que',
  'Parte-se do pressuposto de que',
  'Este trabalho assume como ponto de partida que',
  'A investigação sugere que',
  'Admite-se, neste contexto, que',
  'O presente trabalho defende que',
  'A análise desenvolvida indica que',
  'Considera-se relevante sublinhar que',
];

/* Pool C: conectores de conclusão */
const CONCLUSAO_CONECTORES = [
  'Em síntese,',
  'Em suma,',
  'Em conclusão,',
  'Concluindo,',
  'Desta forma,',
  'Face ao exposto,',
  'Perante o analisado,',
  'Assim sendo,',
];

/* Pool D: conectores de introdução */
const INTRODUCAO_CONECTORES = [
  'Neste sentido,',
  'Com efeito,',
  'Importa referir que',
  'Cumpre salientar que',
  'De facto,',
  'Convém destacar que',
  'Saliente-se que',
  'Há que considerar que',
];

/* Progressão de tese por posição no documento */
const PROGRESSAO_TESE = {
  introducao:    'contextualiza o problema, apresenta o tema e justifica a sua relevância',
  fundamentacao: 'constrói a base teórica — define conceitos-chave e situa o tema no debate académico',
  analise:       'aprofunda a análise — aplica o quadro teórico, apresenta evidências e compara perspectivas',
  sintese:       'sintetiza os achados — integra os argumentos anteriores e articula implicações',
  conclusao:     'integra totalmente a tese — responde à hipótese inicial e consolida os argumentos',
};

function calcularPosicaoTese(capNum, totalCaps) {
  const pos = totalCaps > 1 ? (capNum - 1) / (totalCaps - 1) : 0;
  if (pos <= 0.10) return 'introducao';
  if (pos <= 0.35) return 'fundamentacao';
  if (pos <= 0.65) return 'analise';
  if (pos <= 0.88) return 'sintese';
  return 'conclusao';
}

/* Gera bloco de instruções anti-IA para injectar no prompt */
function gerarInstrucaoAntiIA(capNum, totalCaps, instrucaoVariacao, instrucaoInteligencia, instrucaoRaciocinio) {
  const n       = (capNum || 1) - 1; /* 0-indexed para módulo */
  const prefixo = EXEMPLO_PREFIXOS[n % EXEMPLO_PREFIXOS.length];
  const hipotese= HIPOTESE_VARIACOES[n % HIPOTESE_VARIACOES.length];
  const concl   = CONCLUSAO_CONECTORES[(n + 2) % CONCLUSAO_CONECTORES.length];
  const intro   = INTRODUCAO_CONECTORES[(n + 1) % INTRODUCAO_CONECTORES.length];
  const posicao = calcularPosicaoTese(capNum, totalCaps || 4);
  const missao  = PROGRESSAO_TESE[posicao];

  /* Construir bloco de instruções base */
  const base = `
REGRAS OBRIGATÓRIAS DE ESTILO ACADÉMICO — APLICAR RIGOROSAMENTE:

1. PROIBIDO usar "A título de exemplo:" — usa EXCLUSIVAMENTE: "${prefixo}"
2. PROIBIDO usar "A hipótese deste trabalho sugere que" — usa: "${hipotese}"
3. PROIBIDO repetir a mesma expressão de exemplo entre subtópicos
4. Para concluir parágrafos usa: "${concl}" ou variantes naturais
5. Para introduzir parágrafos usa: "${intro}" ou variantes naturais
6. PROIBIDO usar bullet points ou listas — apenas prosa académica fluida
7. PROIBIDO repetir a mesma estrutura sintáctica em parágrafos consecutivos
8. Cada parágrafo deve começar com palavra diferente do anterior
9. Varia os conectores: não uses "Além disso" mais de uma vez por subtópico
10. O texto deve soar como escrito por um académico angolano experiente, não por IA

PROGRESSÃO DA TESE (posição: ${posicao.toUpperCase()}):
Missão deste capítulo: ${missao}

PROFUNDIDADE INTELECTUAL OBRIGATÓRIA:
- Inclui pelo menos 1 análise de causa-efeito por subtópico
- Apresenta pelo menos 1 limitação ou contraponto moderado
- Não te limites a descrever — analisa, interpreta e relaciona
- Integra dados ou factos do contexto angolano sempre que pertinente
- PROIBIDO: definição atrás de definição sem análise
- PROIBIDO: enumeração mecânica de pontos sem desenvolvimento`;

  /* Acrescentar instruções do frontend se existirem */
  const extras = [
    instrucaoVariacao      ? `\nINSTRUÇÕES ADICIONAIS DE VARIAÇÃO:\n${instrucaoVariacao}`       : '',
    instrucaoInteligencia  ? `\nMEMÓRIA E CONTEXTO DO DOCUMENTO:\n${instrucaoInteligencia}`     : '',
    instrucaoRaciocinio    ? `\nRAIOCÍNIO E CONTINUIDADE ARGUMENTATIVA:\n${instrucaoRaciocinio}` : '',
  ].filter(Boolean).join('\n');

  return base + extras;
}

/* ====================================================================
   ENTRY POINT
==================================================================== */
export default async function handler(req, res) {
  const t0 = Date.now();

  if (req.method === 'OPTIONS') {
    applyCORS(res);
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return sendError(res, 405, 'unknown', 'Método não permitido. Use POST.');
  }

  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > LIMITS.PAYLOAD_MAX_BYTES) {
    return sendError(res, 413, 'unknown', 'Payload demasiado grande. Máximo 128 KB.');
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== 'object') throw new Error('body não é objecto');
  } catch {
    return sendError(res, 400, 'unknown', 'JSON inválido ou body em falta.');
  }

  const { action, payload = {} } = body;
  if (!action || typeof action !== 'string' || action.length > 64) {
    return sendError(res, 400, 'unknown', '"action" é obrigatório e deve ser string.');
  }
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return sendError(res, 400, action, '"payload" deve ser um objecto JSON.');
  }

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

  applyCORS(res);

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
    if (result?.meta) result.meta.elapsed_ms = elapsed;
    return res.status(200).json(result);

  } catch (err) {
    const elapsed = Date.now() - t0;
    log('ERROR', action, ip, `${elapsed}ms — ${err.message}`);
    const friendly = friendlyError(err.message);
    return sendError(res, friendly.status, action, friendly.message, { elapsed_ms: elapsed });
  }
}

/* ====================================================================
   RATE-LIMIT
==================================================================== */
function checkRateLimit(ip) {
  const now   = Date.now();
  const entry = _RL_MAP.get(ip);
  if (!entry || now - entry.windowStart > LIMITS.RATE_LIMIT_WINDOW) {
    _RL_MAP.set(ip, { count: 1, windowStart: now });
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
   LOGS
==================================================================== */
function log(level, action, ip, detail) {
  const ts = new Date().toISOString();
  const safeIp = ip ? ip.replace(/(\d+)$/, '***') : 'unknown';
  console.log(`[ACADEMY] ${ts} [${level}] action=${action} ip=${safeIp} ${detail}`);
}

/* ====================================================================
   ERROS AMIGÁVEIS
==================================================================== */
function friendlyError(msg = '') {
  const m = msg.toLowerCase();
  if (m.includes('timeout') || m.includes('aborted') || m.includes('abort'))
    return { status: 504, message: 'O servidor de IA demorou demasiado tempo. Tenta novamente num momento.' };
  if (m.includes('429') || m.includes('rate') || m.includes('quota') || m.includes('resource_exhausted'))
    return { status: 429, message: 'Limite de uso da IA atingido temporariamente. Aguarda alguns segundos e tenta novamente.' };
  if (m.includes('503') || m.includes('529') || m.includes('overload') || m.includes('unavailable'))
    return { status: 503, message: 'O serviço de IA está temporariamente sobrecarregado. Tenta novamente em breve.' };
  if (m.includes('401') || m.includes('unauthorized') || m.includes('api key'))
    return { status: 502, message: 'Erro de autenticação no servidor. Contacta o suporte ACADEMY.' };
  if (m.includes('supabase') || m.includes('insert') || m.includes('select'))
    return { status: 502, message: 'Erro ao aceder à base de dados. Tenta novamente.' };
  if (m.includes('json') || m.includes('parse'))
    return { status: 502, message: 'Resposta inválida do servidor de IA. Tenta novamente.' };
  if (m.includes('resposta vazia') || m.includes('empty'))
    return { status: 502, message: 'O servidor de IA devolveu uma resposta vazia. Tenta novamente.' };
  return { status: 500, message: `Erro interno do servidor: ${msg.substring(0, 200)}` };
}

/* ====================================================================
   SANITIZAÇÃO
==================================================================== */
function sanitizeString(val, maxLen = 2000) {
  if (typeof val !== 'string') return '';
  return val
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[ \t]{3,}/g, '  ')
    .replace(/^[<>{}[\]\\]{3,}$/gm, '')
    .substring(0, maxLen)
    .trim();
}

function sanitizeStringArray(arr, maxItems, maxItemLen) {
  if (!Array.isArray(arr)) return [];
  return arr
    .slice(0, maxItems)
    .map(s => sanitizeString(String(s || ''), maxItemLen))
    .filter(s => s.length > 0);
}

/* ====================================================================
   ENVELOPE PADRÃO
==================================================================== */
function envelope(action, data, meta = {}) {
  return {
    ok    : true,
    action,
    data,
    meta  : { ts: Date.now(), provider: 'openrouter', ...meta },
  };
}

/* ====================================================================
   ACÇÃO: chat — INALTERADA
==================================================================== */
async function actionChat(payload) {
  const tema         = sanitizeString(payload.tema || '', LIMITS.TEMA_MAX_LEN);
  const tipoTrabalho = sanitizeString(payload.tipoTrabalho || 'Trabalho Académico', 100);
  const pedido       = sanitizeString(payload.pedido || '', LIMITS.PEDIDO_MAX_LEN);

  if (!pedido) throw new Error('pedido é obrigatório para action=chat');

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
   ACÇÃO: generate_lesson — v2.1 COM ANTI-DETECÇÃO IA
==================================================================== */
async function actionGenerateLesson(payload) {
  const tema           = sanitizeString(payload.tema || '', LIMITS.TEMA_MAX_LEN);
  const tipoTrabalho   = sanitizeString(payload.tipoTrabalho || 'Trabalho Académico', 100);
  const nivel          = sanitizeString(payload.nivel || '', 80);
  const capNum         = parseInt(payload.capNum, 10) || 1;
  const totalCaps      = parseInt(payload.totalCaps, 10) || parseInt(payload.totalPags, 10) || 4;
  const capTitulo      = sanitizeString(payload.capTitulo || '', 200);
  const palavrasPorCap = Math.min(Math.max(parseInt(payload.palavrasPorCap, 10) || 600, 200), 3000);
  const capSubs        = sanitizeStringArray(payload.capSubs, LIMITS.SUBS_MAX, 150);

  /* Campos de inteligência do frontend (opcionais) */
  const instrucaoVariacao     = sanitizeString(payload.instrucaoVariacao     || '', 1500);
  const instrucaoInteligencia = sanitizeString(payload.instrucaoInteligencia || '', 3000);
  const instrucaoRaciocinio   = sanitizeString(payload.instrucaoRaciocinio   || '', 2000);

  if (!tema)      throw new Error('tema é obrigatório para generate_lesson');
  if (!capTitulo) throw new Error('capTitulo é obrigatório para generate_lesson');

  /* Seleccionar prefixo de exemplo para este capítulo */
  const prefixoExemplo = EXEMPLO_PREFIXOS[(capNum - 1) % EXEMPLO_PREFIXOS.length];

  const subsFormatados = capSubs
    .map((s, i) => `${capNum}.${i + 1} ${s}`)
    .join('\n');

  /* Bloco anti-IA */
  const blocoAntiIA = gerarInstrucaoAntiIA(
    capNum, totalCaps,
    instrucaoVariacao, instrucaoInteligencia, instrucaoRaciocinio
  );

  const prompt = `És um professor universitário angolano a escrever um capítulo para um ${tipoTrabalho} de nível ${nivel} sobre "${tema}".

CAPÍTULO A ESCREVER:
${capNum}. ${capTitulo}

SUBTÓPICOS OBRIGATÓRIOS (usa exactamente esta numeração):
${subsFormatados}

ESTRUTURA OBRIGATÓRIA PARA CADA SUBTÓPICO:
Cada subtópico deve conter, pela seguinte ordem:
1. Título do subtópico numerado (ex: ${capNum}.1 Nome do Subtópico) em linha própria e separada
2. Parágrafo de contextualização (60-80 palavras)
3. Desenvolvimento teórico (2 a 3 parágrafos de 60-80 palavras cada)
4. Exemplo concreto introduzido OBRIGATORIAMENTE com a expressão "${prefixoExemplo}" — mínimo 60 palavras, realista e relacionado com Angola ou África
5. Parágrafo de síntese parcial (40-60 palavras)

REGRAS DE FORMATAÇÃO:
- O título do capítulo (${capNum}. ${capTitulo}) aparece no topo, em linha própria
- NÃO ESCREVAS "Capítulo ${capNum} —" nem "CAPÍTULO ${capNum} —" — apenas "${capNum}. ${capTitulo}"
- Cada subtítulo numerado aparece em linha própria, separado por linha em branco
- Parágrafos separados por linha em branco
- Sem bullets, sem listas, sem asteriscos, sem markdown
- Português formal angolano/europeu
- Total do capítulo: aproximadamente ${palavrasPorCap} palavras

${blocoAntiIA}

Escreve o capítulo completo agora, sem introduções nem comentários.`;

  const messages = [{ role: 'user', content: prompt }];
  const resposta = await callOpenRouter(messages, { max_tokens: 8192, temperature: 0.65 });

  /* v2.1: Remover linha "Capítulo X — TÍTULO" do output se o modelo a gerar */
  const respostaLimpa = removerCabecalhoDuplicado(resposta, capNum, capTitulo);

  return envelope('generate_lesson', { resposta: respostaLimpa });
}

/* ====================================================================
   v2.1 — Remover cabeçalho duplicado "Capítulo X — TÍTULO" do output
==================================================================== */
function removerCabecalhoDuplicado(texto, capNum, capTitulo) {
  if (!texto) return texto;
  return texto
    /* Remove "Capítulo N — qualquer coisa" em linha própria */
    .replace(/^cap[íi]tulo\s+\d+\s*[—\-–][^\n]*\n?/gim, '')
    /* Remove "CAPÍTULO N — qualquer coisa" em maiúsculas */
    .replace(/^CAP[ÍIÍTULO]+\s+\d+\s*[—\-–][^\n]*\n?/gm, '')
    /* Remove linhas em branco duplas resultantes da remoção */
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ====================================================================
   ACÇÃO: save_history — INALTERADA
==================================================================== */
async function actionSaveHistory(payload) {
  const user_id  = sanitizeString(payload.user_id || '', 200);
  const tipo     = sanitizeString(payload.tipo     || '', 100);
  const tema     = sanitizeString(payload.tema     || '', LIMITS.TEMA_MAX_LEN);
  const pags     = typeof payload.pags === 'number' ? Math.max(1, Math.min(payload.pags, 9999)) : null;
  const qual     = typeof payload.qual === 'number' ? Math.max(0, Math.min(payload.qual, 100))   : null;
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
      body: JSON.stringify({ user_id, tipo, tema, pags, qual, metadata, created_at: new Date().toISOString() }),
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
   ACÇÃO: get_history — INALTERADA
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
      headers: { 'apikey': key, 'Authorization': `Bearer ${key}` },
    });
  } finally {
    clearTimeout(tid);
  }

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Supabase select falhou (HTTP ${resp.status}): ${errText.substring(0, 200)}`);
  }

  const rows = await resp.json();
  return envelope('get_history', { rows });
}

/* ====================================================================
   ACÇÃO: get_stock — INALTERADA (stub)
==================================================================== */
function actionGetStock(payload) {
  return envelope('get_stock', { items: [] });
}

/* ====================================================================
   ACÇÃO: legacy — v2.1 COM ANTI-DETECÇÃO IA INJECTADA
   Trata todas as acções académicas legacy.
   ALTERAÇÃO CIRÚRGICA: prompts de gerar_capitulo e
   gerar_capitulo_referencias recebem blocoAntiIA + prefixoExemplo.
==================================================================== */
async function actionLegacy(action, payload) {

  /* ── ping ──────────────────────────────────────────────────────── */
  if (action === 'ping') {
    return envelope('ping', { pong: true, ts: Date.now() });
  }

  /* ── Campos comuns ──────────────────────────────────────────────── */
  const tema         = sanitizeString(payload.tema         || '', LIMITS.TEMA_MAX_LEN);
  const tipoTrabalho = sanitizeString(payload.tipoTrabalho || 'Trabalho Académico', 120);
  const nivel        = sanitizeString(payload.nivel        || '', 80);
  const capNum       = parseInt(payload.capNum, 10) || 1;
  const totalCaps    = parseInt(payload.totalCaps, 10) || parseInt(payload.totalPags, 10) || 4;
  const capTitulo    = sanitizeString(payload.capTitulo    || '', 200);
  const palavrasPorCap = Math.min(Math.max(parseInt(payload.palavrasPorCap, 10) || 600, 200), 3000);
  const capSubs      = sanitizeStringArray(payload.capSubs || [], LIMITS.SUBS_MAX, 150);

  /* Campos de inteligência do frontend (v51/v52/v53) */
  const instrucaoVariacao     = sanitizeString(payload.instrucaoVariacao     || '', 1500);
  const instrucaoInteligencia = sanitizeString(payload.instrucaoInteligencia || '', 3000);
  const instrucaoRaciocinio   = sanitizeString(payload.instrucaoRaciocinio   || '', 2000);
  const instrucaoSubtitulos   = sanitizeString(payload.instrucaoSubtitulos   || '', 400);

  /* ── plano_academico ────────────────────────────────────────────── */
  if (action === 'plano_academico') {
    if (!tema) throw new Error('tema é obrigatório para plano_academico');
    const prompt = `És um professor universitário angolano especialista em metodologia académica.
Cria um plano académico completo para um ${tipoTrabalho} de nível "${nivel}" sobre: "${tema}".

Responde APENAS com um objecto JSON válido, sem markdown, sem comentários, com esta estrutura exacta:
{
  "objetivo": "string — objectivo geral do trabalho (2-3 frases)",
  "hipotese": "string — hipótese central do trabalho (1-2 frases)",
  "problema": "string — problema de investigação (1-2 frases)",
  "metodologia": "string — metodologia a usar (1-2 frases)"
}`;
    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 512, temperature: 0.4 });
    const json = extrairJSON(r);
    /* v2.1 fix: frontend espera envelope.data.resposta */
    return envelope(action, { resposta: json });
  }

  /* ── estrutura_academica ────────────────────────────────────────── */
  if (action === 'estrutura_academica') {
    if (!tema) throw new Error('tema é obrigatório para estrutura_academica');
    const totalPags  = Math.min(Math.max(parseInt(payload.totalPags, 10) || 15, 5), 100);
    const objetivo   = sanitizeString(payload.objetivo   || '', 300);
    const hipotese   = sanitizeString(payload.hipotese   || '', 200);
    const metodologia= sanitizeString(payload.metodologia|| '', 200);

    const prompt = `És um professor universitário angolano a estruturar um ${tipoTrabalho} de nível "${nivel}" sobre "${tema}".
${objetivo  ? `Objectivo: ${objetivo}`    : ''}
${hipotese  ? `Hipótese: ${hipotese}`     : ''}
${metodologia ? `Metodologia: ${metodologia}` : ''}
Número total de páginas pretendido: ${totalPags}

Cria uma estrutura de capítulos para este trabalho.
Responde APENAS com um array JSON, sem markdown, sem explicações:
[
  { "num": 1, "titulo": "Título do Capítulo", "subs": ["Subtópico 1.1", "Subtópico 1.2", "Subtópico 1.3"] },
  ...
]
Regras:
- Entre 3 e 6 capítulos
- Cada capítulo com 2 a 4 subtópicos
- Inclui sempre uma secção de Referências Bibliográficas no final
- Títulos em português formal angolano
- O último capítulo deve ser "Referências Bibliográficas" sem subtópicos`;

    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 1024, temperature: 0.4 });
    const json = extrairJSON(r);
    /* v2.1 fix: frontend espera envelope.data.resposta */
    return envelope(action, { resposta: Array.isArray(json) ? json : [] });
  }

  /* ── gerar_capitulo ─────────────────────────────────────────────── */
  if (action === 'gerar_capitulo') {
    if (!tema)      throw new Error('tema é obrigatório');
    if (!capTitulo) throw new Error('capTitulo é obrigatório');

    const subsFormatados = capSubs
      .map((s, i) => `${capNum}.${i + 1} ${s}`)
      .join('\n');

    /* v2.1: prefixo de exemplo específico para este capítulo */
    const prefixoExemplo = EXEMPLO_PREFIXOS[(capNum - 1) % EXEMPLO_PREFIXOS.length];

    /* v2.1: bloco anti-IA completo */
    const blocoAntiIA = gerarInstrucaoAntiIA(
      capNum, totalCaps,
      instrucaoVariacao, instrucaoInteligencia, instrucaoRaciocinio
    );

    const prompt = `És um professor universitário angolano a escrever um capítulo académico.

TRABALHO: ${tipoTrabalho} | Nível: ${nivel} | Tema: "${tema}"

CAPÍTULO A ESCREVER:
${capNum}. ${capTitulo}

SUBTÓPICOS OBRIGATÓRIOS:
${subsFormatados || `${capNum}.1 Contextualização\n${capNum}.2 Desenvolvimento\n${capNum}.3 Análise crítica`}

ESTRUTURA DE CADA SUBTÓPICO:
1. Título numerado em linha própria (ex: ${capNum}.1 Nome)
2. Contextualização (60-80 palavras)
3. Desenvolvimento teórico (2-3 parágrafos, 60-80 palavras cada)
4. Exemplo concreto com "${prefixoExemplo}" (mínimo 60 palavras, contexto angolano/africano)
5. Síntese (40-60 palavras)

FORMATAÇÃO:
- Título do capítulo no topo: "${capNum}. ${capTitulo}"
- NÃO ESCREVAS "Capítulo ${capNum} —" em linha separada — isso é proibido
- Sem bullets, sem asteriscos, sem markdown
- Parágrafos separados por linha em branco
- Português formal angolano
- Total: ~${palavrasPorCap} palavras
${instrucaoSubtitulos ? '\n' + instrucaoSubtitulos : ''}
${blocoAntiIA}

Escreve o capítulo completo agora.`;

    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 8192, temperature: 0.65 });
    const rLimpo = removerCabecalhoDuplicado(r, capNum, capTitulo);
    return envelope(action, { resposta: rLimpo });
  }

  /* ── gerar_capitulo_referencias ─────────────────────────────────── */
  if (action === 'gerar_capitulo_referencias') {
    const objetivo    = sanitizeString(payload.objetivo    || '', 200);
    const hipotese    = sanitizeString(payload.hipotese    || '', 150);
    const areaDetectada = sanitizeString(payload.areaDetectada || '', 50);

    const prompt = `És um professor universitário angolano a escrever a secção de Referências Bibliográficas para um ${tipoTrabalho} sobre "${tema}".

REGRAS ABSOLUTAS:
- Mínimo 10 referências, máximo 12
- Formato APA 7ª edição ESTRITO
- Inclui obrigatoriamente pelo menos 3 autores africanos ou angolanos
- Inclui pelo menos 2 publicações recentes (2018-2024)
- Inclui artigos de revistas científicas, livros e dissertações
- Ordena alfabeticamente pelo apelido do primeiro autor
- Sem numeração, sem bullets — apenas texto, uma referência por parágrafo
- Separa cada referência com uma linha em branco
- Hanging indent APA: segunda linha recuada (o modelo de linguagem deve indicar com espaços)
- Todas as referências devem ser REAIS ou altamente verossímeis para a área de "${areaDetectada || tema}"

Escreve APENAS as referências, sem título, sem introdução, sem comentários.`;

    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 2048, temperature: 0.4 });
    return envelope(action, { resposta: r });
  }

  /* ── regenerar_capitulo ─────────────────────────────────────────── */
  if (action === 'regenerar_capitulo') {
    if (!tema)      throw new Error('tema é obrigatório');
    if (!capTitulo) throw new Error('capTitulo é obrigatório');

    const prefixoExemplo = EXEMPLO_PREFIXOS[(capNum - 1) % EXEMPLO_PREFIXOS.length];
    const blocoAntiIA    = gerarInstrucaoAntiIA(capNum, totalCaps, instrucaoVariacao, instrucaoInteligencia, instrucaoRaciocinio);

    const subsFormatados = capSubs.map((s, i) => `${capNum}.${i + 1} ${s}`).join('\n');

    const prompt = `Regenera o capítulo "${capNum}. ${capTitulo}" para um ${tipoTrabalho} sobre "${tema}".
Nível: ${nivel}. Subtópicos: ${subsFormatados || 'padrão'}.
Usa "${prefixoExemplo}" nos exemplos concretos.
NÃO ESCREVAS "Capítulo ${capNum} —" — apenas "${capNum}. ${capTitulo}" no título.
Total: ~${palavrasPorCap} palavras. Sem bullets, sem markdown.
${blocoAntiIA}`;

    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 8192, temperature: 0.7 });
    const rLimpo = removerCabecalhoDuplicado(r, capNum, capTitulo);
    return envelope(action, { resposta: rLimpo });
  }

  /* ── editar_texto ───────────────────────────────────────────────── */
  if (action === 'editar_texto') {
    const texto   = sanitizeString(payload.texto   || '', LIMITS.TEXTO_MAX_LEN);
    const subacao = sanitizeString(payload.subacao || 'melhorar', 50);

    if (!texto) throw new Error('texto é obrigatório para editar_texto');

    const instrucoes = {
      melhorar : 'Melhora o estilo académico e fluidez, mantendo o conteúdo original. Português formal angolano.',
      expandir : 'Expande o texto com mais detalhe académico, +30% de comprimento. Português formal angolano.',
      resumir  : 'Resume o texto mantendo as ideias principais, -40% de comprimento. Português formal angolano.',
      formalizar:'Formaliza a linguagem para nível universitário angolano. Sem alterar o conteúdo.',
    };

    const instrucao = instrucoes[subacao] || instrucoes.melhorar;
    const prompt = `${instrucao}\n\nTexto:\n${texto}\n\nDevolve apenas o texto editado, sem comentários.`;
    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 4096, temperature: 0.5 });
    return envelope(action, { resposta: r });
  }

  /* ── verificar_coerencia ────────────────────────────────────────── */
  if (action === 'verificar_coerencia') {
    const textoA = sanitizeString(payload.textoA || '', 2000);
    const textoB = sanitizeString(payload.textoB || '', 2000);
    if (!textoA || !textoB) throw new Error('textoA e textoB são obrigatórios');
    const prompt = `Analisa a coerência entre dois capítulos académicos e responde apenas com JSON:
{"coerente": true/false, "problemas": ["lista de problemas"], "sugestoes": ["lista de sugestões"]}
Capítulo A: ${textoA}
Capítulo B: ${textoB}`;
    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 512, temperature: 0.3 });
    const json = extrairJSON(r);
    return envelope(action, { resposta: json });
  }

  /* ── gerar_capa ─────────────────────────────────────────────────── */
  if (action === 'gerar_capa') {
    return envelope(action, { resposta: JSON.stringify({ capa: { titulo: tema, tipo: tipoTrabalho } }) });
  }

  /* ── mea_grafico / mea_tabela / mea_esquema ─────────────────────── */
  if (['gerar_mea', 'mea_grafico', 'mea_tabela', 'mea_esquema'].includes(action)) {
    const capResumo = sanitizeString(payload.capResumo || '', 400);
    const tipo_mea  = action === 'mea_grafico' ? 'gráfico' : action === 'mea_tabela' ? 'tabela' : 'esquema';
    const prompt    = `Cria um ${tipo_mea} académico para o capítulo "${capTitulo}" sobre "${tema}".
Resumo: ${capResumo}
Responde com JSON estruturado para o ${tipo_mea}, sem markdown.`;
    const r = await callOpenRouter([{ role: 'user', content: prompt }], { max_tokens: 1024, temperature: 0.5 });
    const json = extrairJSON(r);
    return envelope(action, { resposta: json });
  }

  /* Fallback para acções legacy não reconhecidas */
  throw new Error(`Acção legacy não implementada: "${action}"`);
}

/* ====================================================================
   OPENROUTER — chamada com retry, abort e backoff
==================================================================== */
async function callOpenRouter(messages, opts = {}) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY não configurada no servidor.');

  const maxRetries = 3;
  const baseDelay  = 1500;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), LIMITS.OR_TIMEOUT_MS);

    let resp;
    try {
      resp = await fetch(OR_URL, {
        method : 'POST',
        signal : ctrl.signal,
        headers: {
          'Content-Type'     : 'application/json',
          'Authorization'    : `Bearer ${apiKey}`,
          'HTTP-Referer'     : OR_SITE,
          'X-Title'          : OR_TITLE,
        },
        body: JSON.stringify({
          model      : OR_MODEL,
          messages,
          max_tokens : opts.max_tokens  ?? 2048,
          temperature: opts.temperature ?? 0.7,
          stream     : false,
        }),
      });
    } finally {
      clearTimeout(tid);
    }

    /* Rate-limit ou overload — retry com backoff */
    if (resp.status === 429 || resp.status === 503 || resp.status === 529) {
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw new Error(`OpenRouter HTTP ${resp.status} após ${maxRetries} tentativas`);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(`OpenRouter HTTP ${resp.status}: ${errText.substring(0, 300)}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || content.trim().length === 0) throw new Error('resposta vazia do modelo');

    return content.trim();
  }

  throw new Error('Todas as tentativas falharam');
}

/* ====================================================================
   EXTRAIR JSON DE RESPOSTA DO MODELO
==================================================================== */
function extrairJSON(texto) {
  if (!texto) throw new Error('Texto vazio para extrair JSON');
  /* Remover blocos markdown ```json ... ``` */
  const semMd = texto.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
  /* Tentar parse directo */
  try { return JSON.parse(semMd); } catch { /* continua */ }
  /* Tentar extrair o primeiro objecto ou array */
  const matchObj = semMd.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (matchObj) {
    try { return JSON.parse(matchObj[1]); } catch { /* continua */ }
  }
  throw new Error('Não foi possível extrair JSON válido da resposta do modelo');
}

