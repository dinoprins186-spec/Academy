/* =======================================================================
   ACADEMY - /api/engine  (Vercel Serverless Function)
   Arquitectura: Frontend -> /api/engine -> switch(action) -> funções internas
   Provider de IA : OpenRouter (único - sem fallback, sem Groq)
   Dados          : Supabase (save_history / get_history)
   Acções         : chat | generate_lesson | save_history | get_history | get_stock
   ---------------------------------------------------------------------
   Variáveis de ambiente necessárias (Vercel -> Settings -> Environment):
     OPENROUTER_API_KEY   - chave da API OpenRouter
     SUPABASE_URL         - URL do projecto Supabase
     SUPABASE_SERVICE_KEY - service_role key do Supabase
======================================================================= */

/* -- Configuração OpenRouter ----------------------------------------- */
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL = 'google/gemini-flash-1.5';               // ← modelo estável OR
const OR_SITE  = 'https://academy.agea.ao';
const OR_TITLE = 'ACADEMY - Grupo AGEA Comercial';

/* -- Cabeçalhos CORS ------------------------------------------------- */
const CORS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type'                : 'application/json',
};

/* ====================================================================
   ENTRY POINT
=================================================================== */
export default async function handler(req, res) {
  /* Preflight */
  if (req.method === 'OPTIONS') {
    return res.status(200).set(CORS).end();
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
    return res.status(400).json({ ok: false, error: 'action é obrigatório' });
  }

  /* -- Router central ------------------------------------------------ */
  try {
    switch (action) {

      case 'chat':
        return res.status(200).json(await actionChat(payload));

      case 'generate_lesson':
        return res.status(200).json(await actionGenerateLesson(payload));

      case 'save_history':
        return res.status(200).json(await actionSaveHistory(payload));

      case 'get_history':
        return res.status(200).json(await actionGetHistory(payload));

      case 'get_stock':
        return res.status(200).json(actionGetStock(payload));

      /* -- Acções académicas legacy (mantidas por compatibilidade) -- */
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
        return res.status(200).json(await actionLegacy(action, payload));

      default:
        return res.status(400).json({ ok: false, error: `Acção desconhecida: ${action}` });
    }
  } catch (err) {
    console.error(`[engine] ${action} falhou:`, err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
}

/* ===================================================================
   ACÇÃO: chat
   Assistente académico conversacional via OpenRouter
=================================================================== */
async function actionChat(payload) {
  const { tema = '', tipoTrabalho = 'Trabalho Académico', nivel = 'universitário', historico = [], pedido } = payload;
  if (!pedido) throw new Error('pedido é obrigatório para action=chat');

  const system = `És o motor académico oficial da plataforma ACADEMY do Grupo AGEA Comercial, liderado pelo CEO Adelino Graça.
A tua função é apoiar estudantes angolanos na produção de trabalhos académicos de qualidade universitária premium.
A escrita deve soar natural, académica e produzida por um estudante universitário experiente.
Escreve de forma fluida, coerente e com profundidade analítica real.
Varia as estruturas frásicas. Evita repetições, frases genéricas e padrões de escrita artificial.
Contexto actual: trabalho "${tema}" (${tipoTrabalho}). Nível: ${nivel}.
Sê conciso e directo — máx 200 palavras por resposta de chat.`;

  const messages = [
    { role: 'system', content: system },
    ...historico.slice(-6).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: pedido },
  ];

  const resposta = await callOpenRouter(messages, { max_tokens: 400, temperature: 0.65 }); // ← P1: chat instantâneo
  return envelope('chat', { resposta });
}

/* ===================================================================
   ACÇÃO: generate_lesson
   Gera conteúdo de uma lição/secção académica via OpenRouter
=================================================================== */
async function actionGenerateLesson(payload) {
  const {
    tema, tipoTrabalho = 'Trabalho Académico', nivel = '',
    capNum, capTitulo, capSubs = [], palavrasPorCap = 600,
    contextoAnterior = '',                                   // ← P3: anti-repetição entre capítulos
  } = payload;
  if (!tema || !capTitulo) throw new Error('tema e capTitulo são obrigatórios para generate_lesson');

  const subs     = capSubs.map((s, i) => `${i + 1}. ${s}`).join('\n'); // ← P5: numerados
  const ctxBloco = contextoAnterior
    ? `CONTEXTO DOS CAPÍTULOS ANTERIORES:\n${contextoAnterior}\nEvita repetir conceitos já explicados. Mantém continuidade lógica e progressão académica natural.\n\n`
    : '';

  const prompt = `Escreve o Capítulo ${capNum} — "${capTitulo}" para um ${tipoTrabalho} sobre "${tema}".

Nível académico: ${nivel}.

${ctxBloco}Subtópicos obrigatórios (usa como subtítulos numerados):
${subs}

QUALIDADE ESPERADA:
A escrita deve ser natural, académica e fluida — produzida por um estudante universitário experiente.
Cada parágrafo desenvolve uma ideia central com profundidade analítica.
As transições entre parágrafos devem ser suaves e logicamente encadeadas.
Usa terminologia académica adequada ao nível ${nivel}.
Desenvolve análise crítica sempre que o conteúdo o permita.

ESTILO E NATURALIDADE:
Varia naturalmente as estruturas frásicas e as expressões de transição.
Evita padrões repetitivos como "É importante destacar", "Neste contexto", "Deste modo", "Portanto".
Evita introduções artificiais como "Neste capítulo iremos abordar…".
Evita frases genéricas, de enchimento ou sem conteúdo analítico real.
Não inventes estatísticas, datas ou fontes.

FORMATAÇÃO:
Parágrafos entre 70 e 120 palavras.
Texto corrido, sem bullets, markdown, asteriscos ou símbolos especiais.
Subtítulos numerados em linha separada.

Tamanho aproximado: ${palavrasPorCap} palavras.`;

  const messages = [{ role: 'user', content: prompt }];
  const resposta = await callOpenRouter(messages, { max_tokens: 1400, temperature: 0.65 }); // ← P1: 1400
  return envelope('generate_lesson', { resposta });
}

async function actionSaveHistory(payload) {
  const { user_id, tipo, tema, pags, qual, metadata = {} } = payload;
  if (!user_id) throw new Error('user_id é obrigatório para save_history');

  const url  = process.env.SUPABASE_URL;
  const key  = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado');

  const resp = await fetch(`${url}/rest/v1/academy_history`, {
    method : 'POST',
    headers: {
      'Content-Type' : 'application/json',
      'apikey'       : key,
      'Authorization': `Bearer ${key}`,
      'Prefer'       : 'return=minimal',
    },
    body: JSON.stringify({ user_id, tipo, tema, pags, qual, metadata, created_at: new Date().toISOString() }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase insert falhou: ${err}`);
  }

  return envelope('save_history', { saved: true });
}

/* ===================================================================
   ACÇÃO: get_history
   Obtém histórico de gerações do utilizador (Supabase)
=================================================================== */
async function actionGetHistory(payload) {
  const { user_id, limit = 20 } = payload;
  if (!user_id) throw new Error('user_id é obrigatório para get_history');

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase não configurado');

  const params = new URLSearchParams({
    select  : '*',
    user_id : `eq.${user_id}`,
    order   : 'created_at.desc',
    limit   : String(limit),
  });

  const resp = await fetch(`${url}/rest/v1/academy_history?${params}`, {
    headers: {
      'apikey'       : key,
      'Authorization': `Bearer ${key}`,
    },
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Supabase select falhou: ${err}`);
  }

  const rows = await resp.json();
  return envelope('get_history', { rows });
}

/* ===================================================================
   ACÇÃO: get_stock
   Devolve stock/inventário - lógica simples sem IA
=================================================================== */
function actionGetStock(payload) {
  const { plano = 'gratuito' } = payload;

  /* Definição de stock por plano */
  const STOCK = {
    gratuito  : { pags_mes: 15,  gens_dia: 2,  gens_sem: 2  },
    basico    : { pags_mes: 60,  gens_dia: 10, gens_sem: 40 },
    estudante : { pags_mes: 120, gens_dia: 20, gens_sem: 80 },
    pro       : { pags_mes: 300, gens_dia: 50, gens_sem: 200},
  };

  const stock = STOCK[plano] || STOCK.gratuito;
  return envelope('get_stock', { plano, stock });
}

/* ===================================================================
   ACÇÃO LEGACY
   Todas as acções académicas existentes - prompts construídos aqui
=================================================================== */
async function actionLegacy(action, payload) {
  if (action === 'ping') {
    return envelope('ping', { resposta: 'pong' });
  }

  const prompt = buildPrompt(action, payload);
  const messages = [{ role: 'user', content: prompt }];

  const isJson = ['plano_academico', 'estrutura_academica', 'verificar_coerencia',
                  'gerar_mea', 'mea_grafico', 'mea_tabela', 'mea_esquema'].includes(action);

  const raw = await callOpenRouter(messages, {
    max_tokens  : 1400,                                    // ← P1: legacy geração
    temperature : action === 'chat' ? 0.7 : 0.65,
  });

  let resposta = raw;
  if (isJson) {
    const clean = raw.replace(/```json|```/g, '').trim();
    try { resposta = JSON.parse(clean); } catch { resposta = raw; }
  }

  return envelope(action, { resposta });
}

/* ===================================================================
   HELPER: callOpenRouter
   Única função que chama a API de IA — 1 retry automático em 429/5xx
=================================================================== */
async function callOpenRouter(messages, opts = {}, _retry = true) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');

  /* -- Timeout de 45s: evita requests eternos na Vercel --------------- */
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), 45000);

  let resp;
  try {
    resp = await fetch(OR_URL, {
      method : 'POST',
      signal : controller.signal,
      headers: {
        'Content-Type' : 'application/json',
        'Authorization': `Bearer ${key}`,
        'HTTP-Referer' : OR_SITE,
        'X-Title'      : OR_TITLE,
      },
      body: JSON.stringify({
        model      : OR_MODEL,
        messages,
        temperature: opts.temperature ?? 0.65,
        top_p      : opts.top_p       ?? 0.85,  // ← P6: qualidade Gemini
        max_tokens : opts.max_tokens  ?? 1400,
        provider   : { sort: 'latency' },
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  /* -- Retry automático 1x para 429 / 5xx ----------------------------- */
  if (_retry && [429, 500, 502, 503, 504].includes(resp.status)) {   // ← P7
    await new Promise(r => setTimeout(r, 1500));
    return callOpenRouter(messages, opts, false);
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenRouter HTTP ${resp.status}`);
  }

  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || 'OpenRouter erro');

  const text = data?.choices?.[0]?.message?.content || '';
  if (typeof text !== 'string') throw new Error('Formato inválido do modelo');
  if (!text) throw new Error('OpenRouter: resposta vazia');

  return text;
}

/* ===================================================================
   HELPER: buildPrompt
   Constrói o prompt correcto para cada acção legacy
=================================================================== */
function buildPrompt(action, payload) {
  const LANG = `És o motor académico oficial da plataforma ACADEMY do Grupo AGEA Comercial.
Escreves em português académico de Angola com escrita fluida, natural e universitária.
A escrita deve soar produzida por um estudante universitário experiente.
Evita padrões repetitivos como "É importante destacar", "Neste contexto", "Deste modo", "Portanto".
Evita frases genéricas, de enchimento ou introduções artificiais.`;

  switch (action) {
    case 'plano_academico':
      return `${LANG}\nCria um plano académico completo para um ${payload.tipoTrabalho} com o tema: "${payload.tema}".\nNível: ${payload.nivel}.\nResponde APENAS com JSON no formato:\n{"objetivo":"...","hipotese":"...","metodologia":"...","justificacao":"...","palavrasChave":["..."]}\nSem markdown, só JSON puro.`;

    case 'estrutura_academica':
      return `${LANG}\nCria a estrutura de capítulos para um ${payload.tipoTrabalho} com o tema: "${payload.tema}".\nNível: ${payload.nivel}. Páginas: ${payload.pags}. Número de capítulos: ${payload.numCaps || 5}.\nResponde APENAS com JSON no formato:\n{"capitulos":[{"num":1,"titulo":"...","subs":["1.1 ...","1.2 ..."]}]}\nSem markdown, só JSON puro.`;

    case 'gerar_capitulo': {
      const subs = (payload.capSubs || []).join(', ');
      return `${LANG}\nEscreve o Capítulo ${payload.capNum} - "${payload.capTitulo}" para um ${payload.tipoTrabalho} sobre "${payload.tema}".\nNível: ${payload.nivel}.\nSubtópicos: ${subs}.\nEscreve ~${payload.palavrasPorCap || 600} palavras. Parágrafos de 50-70 palavras. Sem markdown. Subtópicos como subtítulos numerados. Português angolano.`;
    }

    case 'gerar_capitulo_referencias':
      return `${LANG}\nCria a lista de Referências Bibliográficas para um ${payload.tipoTrabalho} sobre "${payload.tema}".\nNível: ${payload.nivel}. Formato APA 7.ª edição. Lista numerada. 8-14 referências. Sem prosa, sem markdown.`;

    case 'regenerar_capitulo': {
      const subs2 = (payload.capSubs || []).join(', ');
      return `${LANG}\nReescreve completamente o Capítulo ${payload.capNum} - "${payload.capTitulo}" para um ${payload.tipoTrabalho} sobre "${payload.tema}".\nSubtópicos: ${subs2}. Parágrafos de 50-70 palavras. Sem markdown. Português angolano.`;
    }

    case 'editar_texto': {
      const mapa = { melhorar: 'Melhora academicamente', expandir: 'Expande com mais detalhe', resumir: 'Resume mantendo os pontos essenciais', corrigir: 'Corrige erros e melhora' };
      return `${LANG}\n${mapa[payload.subacao] || 'Melhora'} o seguinte texto académico:\n\n${payload.texto}\n\nResponde apenas com o texto melhorado, sem comentários.`;
    }

    case 'verificar_coerencia':
      return `${LANG}\nVerifica a coerência académica entre o problema, objectivo, introdução e conclusão do trabalho.\nProblema: ${payload.problema}\nObjectivo: ${payload.objetivo}\nIntrodução (excerto): ${payload.introTexto}\nConclusão (excerto): ${payload.concTexto}\nResponde APENAS com JSON:\n{"coerente":true|false,"alertas":["..."],"sugestoes":["..."]}\nSem markdown, só JSON puro.`;

    case 'gerar_capa':
      return `${LANG}\nGera metadados para a capa de um ${payload.tipoTrabalho} sobre "${payload.tema}" de nível ${payload.nivel}.\nResponde APENAS com JSON: {"subtitulo":"...","palavrasChave":["..."]}\nSem markdown, só JSON puro.`;

    case 'gerar_mea':
      return `${LANG}\nDecide que elementos visuais (gráficos, tabelas, esquemas) enriqueceriam os seguintes capítulos:\n${JSON.stringify(payload.capitulos)}\nTema: "${payload.tema}".\nResponde APENAS com JSON:\n{"elementos":[{"tipo":"grafico"|"tabela"|"esquema","capitulo":1,"titulo":"..."}]}\nMáx 3 elementos. Só JSON puro.`;

    case 'mea_grafico':
      return `${LANG}\nGera dados para um gráfico de barras sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","labels":["..."],"dados":[0],"unidade":"...","tipo":"bar"}\nSó JSON puro.`;

    case 'mea_tabela':
      return `${LANG}\nGera uma tabela comparativa sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","cabecalhos":["..."],"linhas":[["..."]]}\nSó JSON puro.`;

    case 'mea_esquema':
      return `${LANG}\nGera um esquema de etapas sobre "${payload.capTitulo}" do trabalho "${payload.tema}".\nResponde APENAS com JSON:\n{"titulo":"...","etapas":[{"num":1,"titulo":"...","descricao":"..."}]}\nSó JSON puro.`;

    default:
      return `${LANG}\nResponde a esta questão académica:\n${JSON.stringify(payload)}`;
  }
}

/* ===================================================================
   HELPER: envelope
   Envolve todas as respostas no contrato padrão
=================================================================== */
function envelope(action, data) {
  return {
    ok    : true,
    action,
    data,
    meta  : { ts: Date.now(), provider: 'openrouter' },
  };
}
