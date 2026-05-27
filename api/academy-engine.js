// ═══════════════════════════════════════════════════════════════
// ACADEMY ENGINE — FINAL STABLE VERSION
// ═══════════════════════════════════════════════════════════════

const OR_BASE = 'https://openrouter.ai/api/v1';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ═══════════════════════════════════════════════════════════════
// MODELOS
// ═══════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════
// REFERER DINÂMICO
// ═══════════════════════════════════════════════════════════════

function getSiteUrl(req) {
  const origin =
    req.headers.origin ||
    req.headers.referer ||
    'https://academy.vercel.app';

  return origin;
}

// ═══════════════════════════════════════════════════════════════
// SYSTEM PROMPT ACADÉMICO
// ═══════════════════════════════════════════════════════════════

const ACADEMIC_SYSTEM_PROMPT = `
Você é um redator académico profissional especializado na criação de trabalhos universitários de alta qualidade.

REGRAS OBRIGATÓRIAS DE FORMATAÇÃO:

- Escreva SEMPRE em parágrafos densos e coesos.
- Cada parágrafo deve conter entre 4 e 6 linhas de desenvolvimento.
- Nunca escreva uma frase isolada como parágrafo.
- Nunca quebre texto frase por frase.
- Evite listas excessivas.
- O texto deve parecer escrito por um académico humano experiente.
- Utilize linguagem natural, formal e fluida.
- As ideias devem conectar-se logicamente entre os parágrafos.
- Não use emojis.
- Não use markdown desnecessário.
- Não use títulos repetitivos.
- Não deixe linhas vazias excessivas.
- Mantenha coerência, profundidade e continuidade argumentativa.
- Desenvolva raciocínios completos.
- Evite respostas superficiais.
- Produza conteúdo detalhado, maduro e bem estruturado.

OBJETIVO:
Gerar conteúdo académico profissional, elegante e visualmente limpo.
`;

// ═══════════════════════════════════════════════════════════════
// NORMALIZAÇÃO DE TEXTO
// ═══════════════════════════════════════════════════════════════

function normalizeText(text = '') {
  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([^\n])\n([^\n])/g, '$1 $2')
    .trim();
}

// ═══════════════════════════════════════════════════════════════
// OPENROUTER
// ═══════════════════════════════════════════════════════════════

async function callOpenRouter({
  messages,
  model,
  maxTokens = 4000,
  temperature = 0.7,
  siteUrl,
}) {

  const key = process.env.OPENROUTER_API_KEY;

  if (!key) {
    throw new Error('OPENROUTER_API_KEY não configurada');
  }

  // Timeout Protection
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, 30000);

  try {

    const response = await fetch(`${OR_BASE}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,

      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',

        // Referer Dinâmico
        'HTTP-Referer': siteUrl,

        'X-Title': 'ACADEMY',
      },

      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,

        messages: [
          {
            role: 'system',
            content: ACADEMIC_SYSTEM_PROMPT,
          },
          ...messages,
        ],
      }),
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const err = await response.text();

      console.error('OPENROUTER ERROR:', err);

      throw new Error(`OpenRouter ${response.status}`);
    }

    const data = await response.json();

    const content =
      data?.choices?.[0]?.message?.content || '';

    return normalizeText(content);

  } catch (err) {

    console.error('CALL ERROR:', err);

    if (err.name === 'AbortError') {
      throw new Error('Timeout da IA');
    }

    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════

export default async function handler(req, res) {

  Object.entries(CORS).forEach(([k, v]) => {
    res.setHeader(k, v);
  });

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    });
  }

  try {

    const { action, payload } = req.body || {};

    if (!action) {
      return res.status(400).json({
        ok: false,
        error: 'Action obrigatória',
      });
    }

    const model = getModel(action);

    const siteUrl = getSiteUrl(req);

    let result = {};

    // ═══════════════════════════════════════
    // CHAT
    // ═══════════════════════════════════════

    if (action === 'chat') {

      if (!payload?.pedido) {
        return res.status(400).json({
          ok: false,
          error: 'Pedido inválido',
        });
      }

      // Histórico limitado
      const hist =
        (payload.historico || []).slice(-3);

      const content = await callOpenRouter({
        model,
        siteUrl,
        maxTokens: 2500,
        temperature: 0.7,

        messages: [
          ...hist,
          {
            role: 'user',
            content: payload.pedido,
          },
        ],
      });

      result = {
        resposta: content,
      };
    }

    // ═══════════════════════════════════════
    // GERAR CAPÍTULO
    // ═══════════════════════════════════════

    else if (action === 'gerar_capitulo') {

      const prompt = `
Tema: ${payload.tema}

Capítulo:
${payload.capTitulo}

Nível académico:
${payload.nivel}

Escreve um capítulo académico completo,
bem estruturado,
profundo,
com argumentação madura,
e parágrafos densos.
`;

      const content = await callOpenRouter({
        model,
        siteUrl,
        maxTokens: 5000,
        temperature: 0.8,

        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      result = {
        resposta: content,
      };
    }

    // ═══════════════════════════════════════
    // ACTION INVÁLIDA
    // ═══════════════════════════════════════

    else {

      return res.status(400).json({
        ok: false,
        error: 'Action desconhecida',
      });
    }

    return res.status(200).json({
      ok: true,
      data: result,

      meta: {
        model,
      },
    });

  } catch (err) {

    console.error('HANDLER ERROR:', err);

    return res.status(500).json({
      ok: false,
      error: 'Erro interno do servidor',
    });
  }
}
