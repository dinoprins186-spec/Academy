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
  const totalCaps      = parseInt(payload.totalCaps, 10) || 4;
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
  const pags     = typeof payload.pags === 'number' ?
