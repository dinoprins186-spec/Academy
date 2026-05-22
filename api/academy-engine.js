// ══════════════════════════════════════════════════════════════════════════════
// ACADEMY ENGINE  —  Vercel Serverless Function  v1.0.0
// File    : api/academy-engine.js
// Route   : POST /api/academy-engine
// Contract: { action, payload } → { ok, action, data, error, meta }
// Provider: OpenRouter  https://openrouter.ai/api/v1
// ──────────────────────────────────────────────────────────────────────────────
// ENV VARS (Vercel → Settings → Environment Variables):
//   OPENROUTER_API_KEY  — obrigatória
//   GEMINI_API_KEY      — opcional (gerar_capa; usa fallback se ausente)
//   ACADEMY_URL         — opcional (default: https://academy.vercel.app)
// ──────────────────────────────────────────────────────────────────────────────
// C1  finish_reason="length" → auto-continuação texto (máx 2 rounds)
// C2  maxTokens 8192 texto / 4096 JSON+chat
// C3  llmJSON: até 2 reparações de SyntaxError
// C5  AbortController timeout 45 s
// I1  withRetry (1×, 1 s backoff)
// I2  validateMinWords: aviso se output < 70 % do mínimo
// I3  revisao_trabalho: input máx 6000 chars
// I4  Logging estruturado
// S1  gerar_capa: { imagem, fallback } normalizado
// S2  gerar_mea: ≤ 4 elementos
// S3  estrutura_academica: estruturaPadrao vazio omitido
// S4  gerar_capa: erros nunca silenciosos
// P1  temperature 0.4 académico / 0.7 criativo e chat
// P2  maxTokens dinâmico (palavrasPorCap)
// ══════════════════════════════════════════════════════════════════════════════

// ── CONFIG ────────────────────────────────────────────────────────────────────

const VERSION  = '1.0.0';
const OR_BASE  = 'https://openrouter.ai/api/v1';
const MODEL    = 'openai/gpt-4o-mini';
const SITE_URL = process.env.ACADEMY_URL || 'https://academy.vercel.app';

// ── CORS ──────────────────────────────────────────────────────────────────────

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization, x-app-version, cache-control, pragma',
};

// ── RESPONSE ENVELOPE ─────────────────────────────────────────────────────────

/**
 * Sucesso — compatível com callAcademyAPI (lê data.resposta).
 * Para objectos, os campos são espalhados no topo do data E guardados em
 * data.resposta (alias), satisfazendo simultaneamente o contrato externo
 * (ex: create_work → data.topic, data.content) e o frontend (data.resposta).
 */
function okRes(action, resposta) {
  const data =
    resposta !== null && typeof resposta === 'object' && !Array.isArray(resposta)
      ? { ...resposta, resposta }
      : { resposta };

  return {
    ok:    true,
    action,
    data,
    error: null,
    meta:  {
      provider:  'openrouter',
      model:     MODEL,
      timestamp: new Date().toISOString(),
      version:   VERSION,
    },
  };
}

/** Erro padronizado. */
function errRes(action, msg) {
  return {
    ok:    false,
    action,
    data:  null,
    error: msg,
    meta:  { timestamp: new Date().toISOString(), version: VERSION },
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ══════════════════════════════════════════════════════════════════════════════

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** I1 — 1 retry com 1 s de backoff. */
async function withRetry(fn, label) {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[ACADEMY] ${label} falhou — retry 1 s — ${e.message}`);
    await sleep(1000);
    return fn();
  }
}

/** P2 — Palavras → maxTokens (1 PT ≈ 1.4 tok × 1.5 buffer; min 4096, max 8192). */
const wordsToTokens = (w) => Math.min(Math.max(Math.ceil(w * 1.4 * 1.5), 4096), 8192);

/** I2 — Aviso se output < 70 % do mínimo. Nunca bloqueia. */
function validateMinWords(text, min, label) {
  const n = text.trim().split(/\s+/).filter(Boolean).length;
  if (n < Math.floor(min * 0.7))
    console.warn(`[ACADEMY:WARN] ${label}: ${n} palavras geradas (esperado ≥ ${min})`);
  return text;
}

// ══════════════════════════════════════════════════════════════════════════════
// OPENROUTER PROVIDER
// ══════════════════════════════════════════════════════════════════════════════

/** Chamada raw ao OpenRouter Chat Completions. */
async function orCall(msgs, maxTokens, temp) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada nas variáveis de ambiente Vercel');

  const ctrl = new AbortController();
  const tid  = setTimeout(() => ctrl.abort(), 45000); // C5

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
        model:       MODEL,
        max_tokens:  maxTokens,
        temperature: temp,
        messages:    msgs,
      }),
    });

    if (!res.ok) {
      const errText = (await res.text()).slice(0, 400);
      throw new Error(`OpenRouter ${res.status}: ${errText}`);
    }

    const d           = await res.json();
    const content     = d?.choices?.[0]?.message?.content ?? '';
    const finishReason = String(d?.choices?.[0]?.finish_reason ?? 'stop');

    if (!content) throw new Error('OpenRouter: conteúdo vazio na resposta');
    return { content, finishReason };

  } finally {
    clearTimeout(tid);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// LLM ABSTRACTIONS
// ══════════════════════════════════════════════════════════════════════════════

/**
 * llmText — Texto livre com auto-continuação (C1).
 * I1: withRetry. P1: temp parametrizável. C2: maxTokens parametrizável.
 */
async function llmText(sys, usr, maxTokens = 8192, temp = 0.4) {
  const msgs = [
    { role: 'system', content: sys },
    { role: 'user',   content: usr },
  ];

  const r1 = await withRetry(() => orCall(msgs, maxTokens, temp), 'llmText'); // I1

  if (r1.finishReason !== 'length') return r1.content; // C1: completo

  // C1 — round 1 de continuação
  console.warn('[ACADEMY] finish_reason=length — continuação round 1');
  try {
    const r2 = await orCall(
      [
        ...msgs,
        { role: 'assistant', content: r1.content },
        { role: 'user',      content: 'Continua exactamente de onde paraste. Não repitas nada do que já escreveste.' },
      ],
      maxTokens,
      temp,
    );
    const full1 = r1.content + r2.content;
    if (r2.finishReason !== 'length') return full1;

    // C1 — round 2 de continuação (máximo)
    console.warn('[ACADEMY] finish_reason=length — continuação round 2');
    try {
      const r3 = await orCall(
        [
          ...msgs,
          { role: 'assistant', content: r1.content },
          { role: 'user',      content: 'Continua.' },
          { role: 'assistant', content: r2.content },
          { role: 'user',      content: 'Conclui o texto agora. Fecha todos os parágrafos em aberto.' },
        ],
        maxTokens,
        temp,
      );
      if (r3.finishReason === 'length')
        console.warn('[ACADEMY] Texto incompleto após 2 rounds — a entregar o que existe.');
      return full1 + r3.content;
    } catch (e3) {
      console.warn('[ACADEMY] Cont-round-2 falhou:', e3.message);
      return full1;
    }
  } catch (e2) {
    console.warn('[ACADEMY] Cont-round-1 falhou:', e2.message);
    return r1.content;
  }
}

/**
 * llmJSON — JSON estruturado com até 2 reparações de SyntaxError (C3).
 * I1: withRetry. P1: temp 0.4 fixo.
 */
async function llmJSON(sys, usr) {
  const sysJ = sys + '\n\nResponde APENAS com JSON válido. Sem ```json. Sem texto fora do JSON.';

  const { content } = await withRetry( // I1
    () => orCall(
      [{ role: 'system', content: sysJ }, { role: 'user', content: usr }],
      4096, // C2
      0.4,
    ),
    'llmJSON',
  );

  const strip = (s) => s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let raw = content;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return JSON.parse(strip(raw));
    } catch (parseErr) {
      if (attempt === 2) throw parseErr; // C3: tentativas esgotadas
      console.warn(`[ACADEMY] JSON repair attempt ${attempt + 1}`);
      try {
        const { content: fixed } = await orCall(
          [
            { role: 'system', content: 'Devolves APENAS JSON válido. Sem texto adicional.' },
            { role: 'user',   content: `JSON inválido:\n${raw}\n\nCorrige e devolve JSON válido.` },
          ],
          4096,
          0.2,
        );
        raw = fixed;
      } catch {
        throw parseErr;
      }
    }
  }

  throw new Error('llmJSON: JSON inválido após 3 tentativas');
}

/** llmChat — Multi-turn. P1: temp 0.7 (conversacional). */
async function llmChat(sys, history, userMsg) {
  const { content } = await withRetry(
    () => orCall(
      [{ role: 'system', content: sys }, ...history, { role: 'user', content: userMsg }],
      3000, // C2 chat
      0.7,  // P1
    ),
    'llmChat',
  );
  return content;
}

// ══════════════════════════════════════════════════════════════════════════════
// ACTION HANDLERS
// Cada handler recebe b = payload e devolve o valor bruto de "resposta".
// O router envolve com okRes(action, resposta).
// ══════════════════════════════════════════════════════════════════════════════

// ── ping ──────────────────────────────────────────────────────────────────────
function hPing() { return 'pong'; }

// ── create_work  (acção principal MVP) ───────────────────────────────────────
async function hCreateWork(b) {
  const topic = String(b.topic || '').trim();
  if (!topic) throw new Error("Campo 'topic' é obrigatório no payload");

  const content = await llmText(
    'És um assistente académico especializado em trabalhos científicos formais. ' +
    'Escreves em português europeu formal com rigor, precisão e estrutura clara.',
    `Cria um trabalho académico estruturado e completo sobre: ${topic}

Estrutura obrigatória:
1. Introdução (contexto, objectivos, justificativa do tema)
2. Desenvolvimento (análise, argumentação fundamentada, evidências e dados)
3. Conclusão (síntese dos pontos principais, contribuição e implicações)
4. Referências Bibliográficas (mínimo 5 referências, formato APA 7.ª ed.)

Regras de formatação: texto corrido académico, parágrafos separados por linha em branco, sem marcadores ou numeração automática. Mínimo 600 palavras.`,
    8192, // C2
    0.4,  // P1 académico
  );

  // { topic, content } — okRes() espalha em data E cria data.resposta
  return { topic, content };
}

// ── plano_academico ───────────────────────────────────────────────────────────
async function hPlanoAcademico(b) {
  return llmJSON(
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
  );
}

// ── estrutura_academica ───────────────────────────────────────────────────────
// S3: estruturaPadrao vazio omitido do prompt
async function hEstruturaAcademica(b) {
  const ep =
    Array.isArray(b.estruturaPadrao) && b.estruturaPadrao.length > 0
      ? `\nReferência de estrutura: ${JSON.stringify(b.estruturaPadrao)}`
      : '';

  return llmJSON(
    'És especialista em estruturação de trabalhos académicos angolanos. Segues normas das universidades de Angola.',
    `Gera estrutura de capítulos para:
Tema: ${b.tema} | Tipo: ${b.tipoTrabalho} | Nível: ${b.nivel} | Páginas: ${b.pags || 15}
Sugestão do professor: ${b.estruturaProf || 'nenhuma'}${ep}

JSON obrigatório:
{
  "capitulos": [
    {"num":1,"titulo":"Introdução","subs":["1.1 Contextualização","1.2 Justificativa","1.3 Objectivos"]},
    {"num":2,"titulo":"...","subs":["2.1 ...","2.2 ..."]}
  ]
}
Inclui obrigatoriamente: Introdução, 2-4 capítulos de desenvolvimento, Conclusão, Referências Bibliográficas.`,
  );
}

// ── gerar_capitulo ────────────────────────────────────────────────────────────
// P2: maxTokens dinâmico; I2: validação mínimo de palavras
async function hGerarCapitulo(b) {
  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap || 600);

  const text = await llmText(
    'És um escritor académico de excelência. Escreves em português formal angolano com rigor científico.',
    `Escreve o Capítulo ${b.capNum} — "${b.capTitulo}" para um ${b.tipoTrabalho} sobre "${b.tema}".
Sub-secções: ${subs || 'livre'} | Nível: ${b.nivel} | Palavras alvo: ${minWords}
Objectivo: ${b.objetivo || ''} | Hipótese: ${b.hipotese || ''} | Metodologia: ${b.metodologia || ''}

Texto académico corrido. Parágrafos separados por linha em branco. Sem # ou bullets.`,
    wordsToTokens(minWords), // P2
    0.4,                     // P1 académico
  );

  return validateMinWords(text, minWords, `Cap ${b.capNum} — ${b.capTitulo}`); // I2
}

// ── regenerar_capitulo ────────────────────────────────────────────────────────
async function hRegerarCapitulo(b) {
  const subs     = Array.isArray(b.capSubs) ? b.capSubs.join(', ') : '';
  const minWords = Number(b.palavrasPorCap || 600);

  const text = await llmText(
    'Regeneras capítulos académicos com nova perspectiva mas igual qualidade.',
    `Regenera o Capítulo ${b.capNum} — "${b.capTitulo}" para ${b.tipoTrabalho} sobre "${b.tema}".
Sub-secções: ${subs || 'livre'}
Nova versão, diferente da anterior. Texto académico formal. Parágrafos com linha em branco.`,
    wordsToTokens(minWords),
    0.7, // P1 criativo
  );

  return validateMinWords(text, minWords, `Regen Cap ${b.capNum}`); // I2
}

// ── editar_texto ──────────────────────────────────────────────────────────────
async function hEditarTexto(b) {
  const ops = {
    melhorar: 'Melhora o estilo académico, fluidez e precisão linguística. Mantém o conteúdo original.',
    resumir:  'Resume mantendo as ideias principais. Estilo académico formal.',
    expandir: 'Expande com mais desenvolvimento, exemplos e profundidade académica.',
  };
  const instrucao = ops[String(b.subacao || 'melhorar')] || ops.melhorar;
  const texto     = String(b.texto || '').slice(0, 3000);

  return llmText(
    'És um editor académico especializado em português de Angola.',
    `${instrucao}\n\nTEXTO:\n${texto}`,
  );
}

// ── verificar_coerencia ───────────────────────────────────────────────────────
async function hVerificarCoerencia(b) {
  return llmJSON(
    'Revisor académico especializado em coerência estrutural de trabalhos universitários.',
    `Verifica coerência entre problema, objectivo, introdução e conclusão:
Problema: ${b.problema}
Objectivo: ${b.objetivo}
Introdução (excerto): ${b.introTexto}
Conclusão (excerto): ${b.concTexto}

JSON obrigatório:
{"coerente":true,"alertas":["alerta se existir"],"sugestoes":["sugestão"],"pontuacaoCoerencia":85}
Se tudo correcto: alertas e sugestoes são arrays vazios.`,
  );
}

// ── gerar_mea ─────────────────────────────────────────────────────────────────
// S2: garante ≤ 4 elementos
async function hGerarMEA(b) {
  const data = await llmJSON(
    'Especialista em enriquecimento académico visual. Decides onde gráficos/tabelas/esquemas acrescentam valor real.',
    `Trabalho sobre "${b.tema}". Capítulos: ${JSON.stringify(b.capitulos)}

JSON obrigatório (máx 4 elementos):
{"elementos":[{"tipo":"grafico","capitulo":1,"titulo":"..."},{"tipo":"tabela","capitulo":2,"titulo":"..."}]}
"tipo" é exactamente: "grafico", "tabela" ou "esquema".`,
  );

  // S2: truncar se modelo devolveu mais de 4
  if (Array.isArray(data?.elementos) && data.elementos.length > 4) {
    data.elementos.splice(4);
  }
  return data;
}

// ── mea_grafico ───────────────────────────────────────────────────────────────
async function hMEAGrafico(b) {
  return llmJSON(
    'Geras dados realistas para gráficos académicos.',
    `Gráfico para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo}
JSON: {"titulo":"...","tipo":"bar","labels":["A","B","C","D"],"dados":[40,65,52,78],"unidade":"%"}
"tipo" pode ser: "bar", "line" ou "pie".`,
  );
}

// ── mea_tabela ────────────────────────────────────────────────────────────────
async function hMEATabela(b) {
  return llmJSON(
    'Geras tabelas académicas realistas.',
    `Tabela para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo}
JSON: {"titulo":"...","cabecalhos":["Col1","Col2","Col3"],"linhas":[["v1","v2","v3"],["v1","v2","v3"]]}
Máx 4 colunas e 5 linhas.`,
  );
}

// ── mea_esquema ───────────────────────────────────────────────────────────────
async function hMEAEsquema(b) {
  return llmJSON(
    'Geras esquemas de processos académicos claros.',
    `Esquema para "${b.capTitulo}" (tema: ${b.tema}). Contexto: ${b.capResumo}
JSON: {"titulo":"...","etapas":[{"num":1,"titulo":"Etapa 1","descricao":"desc breve"}]}
3 a 5 etapas sequenciais.`,
  );
}

// ── gerar_capa ────────────────────────────────────────────────────────────────
// S1: contrato normalizado { imagem, fallback }
// S4: erros nunca silenciosos
async function hGerarCapa(b) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.warn('[ACADEMY] hGerarCapa: GEMINI_API_KEY não definida — fallback tipográfico.');
    return { imagem: null, fallback: true };
  }

  try {
    const t0  = Date.now();
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${key}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{
            prompt:
              `Academic document cover. Theme: ${b.tema}. Type: ${b.tipoTrabalho}. ` +
              `Professional, dark and sophisticated. Angola university style. Minimalist.`,
          }],
          parameters: { sampleCount: 1 },
        }),
      },
    );

    if (!res.ok) {
      console.warn(`[ACADEMY] hGerarCapa: Gemini ${res.status} — a usar fallback.`); // S4
      return { imagem: null, fallback: true };
    }

    const d   = await res.json();
    const b64 = d?.predictions?.[0]?.bytesBase64Encoded;

    console.log(`[ACADEMY] gerar_capa — ${Date.now() - t0} ms — ${b64 ? 'imagem gerada' : 'resposta vazia'}`);

    if (b64) return { imagem: `data:image/png;base64,${b64}`, fallback: false };
    console.warn('[ACADEMY] hGerarCapa: Gemini devolveu resultado vazio — fallback.'); // S4

  } catch (e) {
    console.warn('[ACADEMY] hGerarCapa: excepção —', e.message); // S4
  }

  return { imagem: null, fallback: true }; // S1
}

// ── revisao_trabalho ──────────────────────────────────────────────────────────
// I3: input máx 6000 chars
async function hRevisaoTrabalho(b) {
  const texto = String(b.texto || '').slice(0, 6000); // I3
  const fp    = b.feedbackProf ? `\nFeedback professor: ${b.feedbackProf}` : '';

  return llmJSON(
    'Revisor académico sénior de trabalhos universitários angolanos. Rigoroso, construtivo e preciso.',
    `Analisa e revisa (nível: ${b.nivel}, tipo: ${b.tipoAnalise || 'tudo'})${fp}:
TEXTO: ${texto}

JSON obrigatório:
{
  "resumo": "análise geral em 2-3 frases",
  "pontuacao": 80,
  "pontosFortes": ["ponto1","ponto2","ponto3"],
  "melhorar": ["melhoria1","melhoria2","melhoria3"],
  "versaoMelhorada": "texto melhorado aqui",
  "criterios": [
    {"nome":"Coerência","valor":80},
    {"nome":"Estrutura","valor":75},
    {"nome":"Rigor","valor":82},
    {"nome":"Linguagem","valor":78}
  ]
}`,
  );
}

// ── plano_livro ───────────────────────────────────────────────────────────────
async function hPlanoLivro(b) {
  return llmJSON(
    'Editor literário especializado no mercado africano lusófono.',
    `Plano editorial completo:
Tipo: ${b.tipoLivro} | Tema: ${b.tema} | Público: ${b.publico} | Tom: ${b.tom} | Caps: ${b.numCaps}

JSON com exactamente ${b.numCaps} capítulos:
{"titulo":"...","sinopse":"3-4 frases envolventes","capitulos":[{"num":1,"titulo":"...","descricao":"o que este cap aborda"}]}`,
  );
}

// ── conceito_capa_livro ───────────────────────────────────────────────────────
async function hConceitoCapaLivro(b) {
  return llmText(
    'Designer editorial com experiência em capas de livros para o mercado angolano e lusófono.',
    `Conceito de capa para "${b.titulo}" (${b.tipoLivro}), público: ${b.publico}, tom: ${b.tom}.
4-5 frases: paleta de cores, tipografia, elementos visuais, atmosfera. Português, concreto e inspirador.`,
    4096,
    0.7, // P1 criativo
  );
}

// ── gerar_capitulo_livro ──────────────────────────────────────────────────────
// P1: 0.7 criativo; P2: maxTokens dinâmico; I2: validação mínimo
async function hGerarCapituloLivro(b) {
  const extras   = Array.isArray(b.extras) ? ` Extras: ${b.extras.join(', ')}.` : '';
  const minWords = 600;

  const text = await llmText(
    `Escritor profissional. Tom ${b.tom || 'formal'}. Escreves para público ${b.publico || 'geral'}.`,
    `Capítulo ${b.capNum} — "${b.capTitulo}" do livro "${b.titulo}".
Tema: ${b.tema} | Tom: ${b.tom} | Público: ${b.publico}
Descrição: ${b.capDescricao}${extras}

Mínimo 600 palavras. Parágrafos separados por linha em branco. Sem # ou bullets.`,
    wordsToTokens(minWords), // P2
    0.7,                     // P1 criativo
  );

  return validateMinWords(text, minWords, `Cap Livro ${b.capNum} — ${b.capTitulo}`); // I2
}

// ── chat ──────────────────────────────────────────────────────────────────────
// O frontend envia { tipo:'chat', pedido, … } sem "acao".
// O router recupera action='chat' via payload.tipo (ver abaixo).
async function hChat(b) {
  const tema      = String(b.tema || 'trabalho académico');
  const tipo      = String(b.tipoTrabalho || 'Trabalho Académico');
  const estrutura = Array.isArray(b.estrutura) ? b.estrutura.join(', ') : '';

  const sys = b.modoInstrutor
    ? `És o ACADEMY Instrutor — tutor académico estratégico e exigente para estudantes angolanos.
Trabalho: ${tipo} sobre "${tema}". Estrutura: ${estrutura || 'em desenvolvimento'}.
Guias com perguntas, nunca dás respostas directas. Identificas pontos fracos. Respondes em português.`
    : `És o ACADEMY Copiloto — assistente académico amigável para estudantes angolanos.
Contexto: ${tipo} sobre "${tema}".${estrutura ? ` Estrutura: ${estrutura}.` : ''}
Respondes em português de forma clara, directa e útil. Podes usar **negrito** e listas.`;

  const history = Array.isArray(b.historico)
    ? b.historico.map((h) => ({
        role:    String(h.role    || 'user'),
        content: String(h.content || ''),
      }))
    : [];

  return llmChat(sys, history, String(b.pedido || ''));
}

// ══════════════════════════════════════════════════════════════════════════════
// VERCEL HANDLER — único entry point
// ══════════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS em todos os pedidos
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  // Preflight
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json(errRes('unknown', 'Método não permitido — usa POST'));
    return;
  }

  // Vercel auto-parseia JSON; req.body já é objecto
  const body    = req.body || {};
  const payload = body.payload || {};

  // Action routing — suporta 3 formatos:
  //   novo    { action: 'plano_academico', payload: { … } }
  //   chat    { payload: { tipo: 'chat', pedido: … } }     (action omitida por JSON.stringify)
  //   legado  { acao: 'plano_academico', … }               (retrocompat)
  const action = String(
    body.action    ||  // formato novo
    payload.acao   ||  // legado no payload
    payload.tipo   ||  // chat
    body.acao      ||  // legado flat
    '',
  );

  if (!action) {
    res.status(400).json(errRes('unknown', "Campo 'action' obrigatório no body"));
    return;
  }

  const t0 = Date.now();
  console.log(`[ACADEMY] ▶ ${action}`); // I4

  try {
    let resposta;

    switch (action) {
      case 'ping':                 resposta = hPing();                             break;
      case 'create_work':          resposta = await hCreateWork(payload);          break;
      case 'plano_academico':      resposta = await hPlanoAcademico(payload);      break;
      case 'estrutura_academica':  resposta = await hEstruturaAcademica(payload);  break;
      case 'gerar_capitulo':       resposta = await hGerarCapitulo(payload);       break;
      case 'regenerar_capitulo':   resposta = await hRegerarCapitulo(payload);     break;
      case 'editar_texto':         resposta = await hEditarTexto(payload);         break;
      case 'verificar_coerencia':  resposta = await hVerificarCoerencia(payload);  break;
      case 'gerar_mea':            resposta = await hGerarMEA(payload);            break;
      case 'mea_grafico':          resposta = await hMEAGrafico(payload);          break;
      case 'mea_tabela':           resposta = await hMEATabela(payload);           break;
      case 'mea_esquema':          resposta = await hMEAEsquema(payload);          break;
      case 'gerar_capa':           resposta = await hGerarCapa(payload);           break;
      case 'revisao_trabalho':     resposta = await hRevisaoTrabalho(payload);     break;
      case 'plano_livro':          resposta = await hPlanoLivro(payload);          break;
      case 'conceito_capa_livro':  resposta = await hConceitoCapaLivro(payload);   break;
      case 'gerar_capitulo_livro': resposta = await hGerarCapituloLivro(payload);  break;
      case 'chat':                 resposta = await hChat(payload);                break;
      default:
        res.status(400).json(errRes(action, `Acção desconhecida: "${action}"`));
        return;
    }

    console.log(`[ACADEMY] ✓ ${action} — ${Date.now() - t0} ms`); // I4
    res.status(200).json(okRes(action, resposta));

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[ACADEMY] ✗ "${action}" em ${Date.now() - t0} ms:`, msg); // I4
    res.status(500).json(errRes(action, msg));
  }
}
