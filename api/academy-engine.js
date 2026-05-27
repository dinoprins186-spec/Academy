// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE — v4.1 (corrigido)
// ══════════════════════════════════════════════════════════════════════════════

const OR_BASE  = 'https://openrouter.ai/api/v1';
const SITE_URL = process.env.ACADEMY_URL ?? 'https://academy.vercel.app';

// ── CORS ──────────────────────────────────────────────────────────────────────
// CORRECÇÃO: res.setHeader() exige pares (nome, valor) — não aceita um objeto.
// Usamos uma função auxiliar que aplica cada header individualmente.
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
  return res;
}

// ══════════════════════════════════════════════════════════════════════════════
// MODELOS POR ACTION
// ══════════════════════════════════════════════════════════════════════════════

const MODELS = {
  chat:                'openai/gpt-4o-mini',
  gerar_capitulo:      'anthropic/claude-3.5-sonnet',
  create_work:         'anthropic/claude-3.5-sonnet',
  plano_academico:     'openai/gpt-4o-mini',
  estrutura_academica: 'openai/gpt-4o-mini',
  melhorar_texto:      'openai/gpt-4o-mini',
  referencias:         'openai/gpt-4o-mini',
  default:             'openai/gpt-4o-mini',
};

function getModel(action) {
  return MODELS[action] || MODELS.default;
}

// ══════════════════════════════════════════════════════════════════════════════
// OPENROUTER CALL
// ══════════════════════════════════════════════════════════════════════════════

async function callOpenRouter(messages, model, maxTokens = 4096) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');

  const response = await fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type':  'application/json',
      'HTTP-Referer':  SITE_URL,
      'X-Title':       'ACADEMY',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.7, messages }),
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
  return { ok: true, action, data: { resposta }, error: null,
    meta: { model, timestamp: new Date().toISOString() } };
}

function err(action, message) {
  return { ok: false, action, data: null, error: message,
    meta: { timestamp: new Date().toISOString() } };
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// ══════════════════════════════════════════════════════════════════════════════

// CORRECÇÃO: hChat agora usa historico para contexto (últimas 3 mensagens)
async function hChat(payload) {
  const { pedido, historico = [], tema = '', tipoTrabalho = 'Trabalho Académico' } = payload;
  if (!pedido) throw new Error('pedido obrigatório');

  const system = `És o assistente académico ACADEMY. Respondes SEMPRE em português de Angola, formal e académico. Ajudas estudantes angolanos com os seus trabalhos académicos. Contexto: trabalho "${tema}" (${tipoTrabalho}). Sê conciso e directo — máx 200 palavras por resposta.`;

  const msgs = [
    { role: 'system', content: system },
    ...historico.slice(-3).map(m => ({
      role:    m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    })),
    { role: 'user', content: pedido },
  ];

  const content = await callOpenRouter(msgs, getModel('chat'), 1024);
  return { resposta: content };
}

async function hGerarCapitulo(payload) {
  const { capTitulo, capNum, capSubs = [], tema, nivel, tipoTrabalho = 'Trabalho Académico', palavrasPorCap = 600 } = payload;
  if (!capTitulo || !tema || !nivel) throw new Error('campos obrigatórios em falta');

  const subs = capSubs.join(', ');
  const prompt = `Escreve o Capítulo ${capNum || ''} — "${capTitulo}" para um ${tipoTrabalho} sobre "${tema}".\nNível académico: ${nivel}.\nSubtópicos (usa como subtítulos numerados): ${subs}.\nEscreve ~${palavrasPorCap} palavras. Texto académico completo. REGRA ABSOLUTA DE PARÁGRAFOS: cada parágrafo deve ter entre 50 e 70 palavras — NUNCA escreves um parágrafo com mais de 70 palavras. Separa sempre os parágrafos com uma linha em branco. PROIBIDO: bullets, hífenes de lista, asteriscos, markdown, sublinhados, símbolos #. Usa APENAS texto corrido em parágrafos justificados. Inclui cada subtópico como subtítulo numerado numa linha separada. NUNCA cortes o texto a meio de uma frase. Português europeu/angolano.`;

  const content = await callOpenRouter(
    [{ role: 'user', content: prompt }],
    getModel('gerar_capitulo'),
    8192
  );
  return { resposta: content };
}

async function hCreateWork(payload) {
  const { topic } = payload;
  if (!topic) throw new Error('topic obrigatória');

  const content = await callOpenRouter(
    [{ role: 'user', content: `Cria um trabalho académico completo sobre "${topic}". Estrutura: Introdução, Desenvolvimento, Conclusão, Referências (APA). Mínimo 800 palavras, português europeu.` }],
    getModel('create_work'),
    8192
  );
  return { resposta: content };
}

async function hPlanoAcademico(payload) {
  const { tema, tipoTrabalho, nivel } = payload;
  if (!tema || !tipoTrabalho || !nivel) throw new Error('campos obrigatórios em falta');

  const prompt = `Cria um plano académico completo para um ${tipoTrabalho} com o tema: "${tema}".\nNível: ${nivel}.\nResponde APENAS com JSON no formato:\n{"objetivo":"...","hipotese":"...","metodologia":"...","justificacao":"...","palavrasChave":["..."]}\nSem markdown, só JSON puro.`;

  const content = await callOpenRouter(
    [{ role: 'user', content: prompt }],
    getModel('plano_academico'),
    1024
  );
  return { resposta: content };
}

async function hEstruturaAcademica(payload) {
  const { tema, tipoTrabalho, nivel, pags, numCaps = 5 } = payload;
  if (!tema || !tipoTrabalho || !nivel) throw new Error('campos obrigatórios em falta');

  const prompt = `Cria a estrutura de capítulos para um ${tipoTrabalho} com o tema: "${tema}".\nNível: ${nivel}. Páginas: ${pags}. Número de capítulos: ${numCaps}.\nResponde APENAS com JSON no formato:\n{"capitulos":[{"num":1,"titulo":"...","subs":["1.1 ...","1.2 ..."]}]}\nSem markdown, só JSON puro.`;

  const content = await callOpenRouter(
    [{ role: 'user', content: prompt }],
    getModel('estrutura_academica'),
    2048
  );
  return { resposta: content };
}

async function hMelhorarTexto(payload) {
  const { texto, subacao = 'melhorar' } = payload;
  if (!texto) throw new Error('texto obrigatório');

  const mapa = { melhorar: 'Melhora', resumir: 'Resume', expandir: 'Expande', corrigir: 'Corrige' };
  const verbo = mapa[subacao] || 'Melhora';

  const content = await callOpenRouter(
    [{ role: 'user', content: `${verbo} o seguinte texto académico:\n\n${texto}\n\nResponde apenas com o texto melhorado, sem comentários. Português europeu/angolano.` }],
    getModel('melhorar_texto'),
    4096
  );
  return { resposta: content };
}

async function hReferencias(payload) {
  const { tema, tipoTrabalho, nivel } = payload;
  if (!tema) throw new Error('tema obrigatório');

  const prompt = `Cria a lista de Referências Bibliográficas para um ${tipoTrabalho || 'trabalho académico'} sobre "${tema}".\nNível: ${nivel || 'universitário'}.\nFormato OBRIGATÓRIO: APA 7.ª edição, lista numerada, uma referência por linha.\nGera entre 8 e 14 referências reais e plausíveis relacionadas com o tema.\nREGRAS: NUNCA escreves prosa ou parágrafos — APENAS a lista; NUNCA uses asteriscos, markdown ou bullets; Português europeu/angolano; Começa directamente com a primeira referência.`;

  const content = await callOpenRouter(
    [{ role: 'user', content: prompt }],
    getModel('referencias'),
    2048
  );
  return { resposta: content };
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN HANDLER
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS pre-flight
  if (req.method === 'OPTIONS') {
    setCORS(res);
    return res.status(200).end();
  }

  setCORS(res);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, payload } = req.body || {};

    if (!action) {
      return res.status(400).json(err('unknown', 'action obrigatória'));
    }

    let result;

    switch (action) {
      case 'ping':
        result = { resposta: 'pong' };
        break;
      case 'chat':
        result = await hChat(payload || {});
        break;
      case 'gerar_capitulo':
        result = await hGerarCapitulo(payload || {});
        break;
      case 'create_work':
        result = await hCreateWork(payload || {});
        break;
      case 'plano_academico':
        result = await hPlanoAcademico(payload || {});
        break;
      case 'estrutura_academica':
        result = await hEstruturaAcademica(payload || {});
        break;
      case 'melhorar_texto':
        result = await hMelhorarTexto(payload || {});
        break;
      case 'referencias':
        result = await hReferencias(payload || {});
        break;
      default:
        return res.status(400).json(err(action, `action "${action}" desconhecida`));
    }

    const model = getModel(action);
    return res.status(200).json(ok(action, result.resposta, model));

  } catch (e) {
    console.error('[ACADEMY ENGINE ERROR]', e.message);
    return res.status(500).json(err(req.body?.action || 'unknown', e.message));
  }
    }
                
