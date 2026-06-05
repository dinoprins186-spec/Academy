/* =======================================================================
   ACADEMY ENGINE - SAAS BLINDADO (PRODUÇÃO)
   v65: SISTEMA DE PROMPTS ESTRATIFICADO
   - Prompts diferenciados por nível (Médio / Licenciatura / Mestrado / Doutoramento)
   - Prompts diferenciados por área (Ciências / Humanidades / Gestão / Direito / Saúde / Engenharia)
   - Citações autor-ano obrigatórias e integradas no corpo do texto
   - Referências exclusivamente da área do tema
   - Exemplos angolanos com factos específicos e verificáveis
   - Estrutura variada entre subtópicos (proibido molde único)
   - Terminologia técnica e fórmulas para Ciências/Engenharia
   - Profundidade analítica real para Mestrado/Doutoramento
   - Erro "Brasil em vez de Angola" eliminado por prompt de área
======================================================================= */

/* ---------------- OPENROUTER ---------------- */
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_SITE  = 'https://academyscosao.vercel.app';
const OR_TITLE = 'ACADEMY';

const MODELS = [
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.1-8b-instruct',
];

/* ---------------- RATE LIMIT ---------------- */
const RATE = new Map();
function rateLimit(ip) {
  const now = Date.now();
  const d = RATE.get(ip) || { count: 0, start: now };
  if (now - d.start > 60000) { RATE.set(ip, { count: 1, start: now }); return true; }
  if (d.count >= 25) return false;
  d.count++; RATE.set(ip, d); return true;
}

/* ---------------- CORS ---------------- */
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');
}

/* ============================================================
   SISTEMA DE PROMPTS ESTRATIFICADO v65
   Dimensões: nível académico × área do conhecimento
   ============================================================ */

/* ---------- POOLS DE VARIAÇÃO ANTI-IA ---------- */
const EXEMPLOS = [
  'A título ilustrativo,','Por exemplo,','Como caso concreto em Angola,',
  'Ilustrando este ponto,','Num contexto prático,','Observa-se, por exemplo,',
  'Numa perspectiva angolana,','Tomando como referência o contexto nacional,',
  'De forma ilustrativa,','Como se verifica na prática angolana,',
  'Num exemplo verificável,','A experiência angolana demonstra que',
];
const HIPOTESES = [
  'A hipótese central deste estudo sustenta que',
  'Parte-se do pressuposto de que',
  'Este trabalho assume como ponto de partida que',
  'A investigação aponta para o facto de que',
  'Admite-se, neste contexto, que',
  'O presente trabalho defende que',
  'Os dados disponíveis sugerem que',
];
const CONCLUSOES = [
  'Em síntese,','Em suma,','Em conclusão,','Concluindo,',
  'Face ao exposto,','Perante o analisado,','Assim sendo,',
  'Do exposto decorre que,','A análise evidencia que,',
];
const TRANSICOES = [
  'Neste quadro,','Neste sentido,','A este respeito,',
  'Importa sublinhar que','Cumpre referir que','Convém notar que',
  'É relevante destacar que','Vale a pena salientar que',
];

function antiIA(capNum, totalCaps) {
  const n = Math.max(0, (capNum||1) - 1);
  const rIdx = (arr, seed) => arr[(n * 7 + seed * 3 + Math.floor(Math.random() * arr.length)) % arr.length];
  const ex  = rIdx(EXEMPLOS, 1);
  const hip = rIdx(HIPOTESES, 2);
  const con = rIdx(CONCLUSOES, 3);
  const tra = rIdx(TRANSICOES, 4);
  const pos = totalCaps > 1 ? (n/(totalCaps-1)) : 0;
  const fase = pos<=0.1?'introdução':pos<=0.35?'fundamentação teórica':
               pos<=0.65?'análise crítica':pos<=0.88?'síntese':'conclusão';
  return `
REGRAS DE ESTILO OBRIGATÓRIAS:
1. Para exemplos usa: "${ex}" — NUNCA "A título de exemplo:" ou "Por exemplo:" repetido
2. Para hipótese/pressuposto usa: "${hip}"
3. Para concluir secções usa: "${con}" ou variante natural
4. Para transições entre ideias usa: "${tra}" ou equivalente
5. PROIBIDO bullets, listas, asteriscos ou qualquer markdown
6. PROIBIDO repetir a mesma estrutura de parágrafo em subtópicos consecutivos
7. PROIBIDO usar "Brasil", "Portugal", "Europa" como referência principal — o contexto é Angola
8. Texto deve soar como académico angolano experiente, não como IA
9. Posição no documento: ${fase} — adequa o tom e profundidade analítica
10. Cada subtópico deve ter abordagem distinta: um pode ser histórico, outro analítico, outro comparativo`;
}

/* ---------- PERFIS POR NÍVEL ACADÉMICO ---------- */
const PERFIL_NIVEL = {
  'ensino médio': {
    label: 'Ensino Médio',
    profundidade: `- Linguagem clara e acessível, adequada a estudantes do ensino médio (14-18 anos)
- Conceitos explicados desde o básico, sem assumir conhecimentos prévios avançados
- Para Ciências e Matemática: inclui fórmulas básicas com explicação de cada variável
- Exemplos do quotidiano angolano que o estudante reconhece
- Citações de 2-3 obras didáticas reconhecidas na área
- Comprimento dos subtópicos: 3-4 parágrafos densos`,
    citacoes: `Inclui 1-2 citações por subtópico no formato (Apelido, Ano), integradas naturalmente no texto.
Exemplo: "Segundo Cardoso (2019), a fotossíntese constitui..." ou "...processo fundamental na biologia vegetal (Lima & Santos, 2020)."`,
    terminologia: 'Terminologia introdutória da área, com definições explícitas de termos técnicos na primeira ocorrência.',
  },
  'licenciatura': {
    label: 'Licenciatura',
    profundidade: `- Nível universitário de 1º ciclo, com rigor conceptual e terminologia da área
- Revisão de literatura com autores relevantes da área citados no texto
- Análise crítica básica: não apenas descrever, mas comparar perspectivas
- Dados estatísticos e factos verificáveis integrados na argumentação
- Exemplos angolanos com anos, instituições, números concretos
- Comprimento dos subtópicos: 4-5 parágrafos densos`,
    citacoes: `Inclui 2-3 citações por subtópico no formato (Apelido, Ano), integradas no argumento.
Exemplos: "De acordo com Ferreira (2021),..." / "...conforme demonstrado por vários estudos (Neto, 2019; Costa, 2022)." / "Silva (2020, p.45) argumenta que..."
OBRIGATÓRIO: cada subtópico deve ter pelo menos uma citação integrada no meio de um parágrafo, não apenas no fim.`,
    terminologia: 'Terminologia técnica da área utilizada com naturalidade, sem definições elementares.',
  },
  'mestrado': {
    label: 'Mestrado',
    profundidade: `- Nível de pós-graduação com profundidade analítica e pensamento crítico avançado
- Revisão sistemática da literatura: confrontar teorias, identificar lacunas, posicionar o trabalho
- Análise epistemológica: questionar pressupostos, identificar limitações metodológicas
- Dados empíricos, modelos teóricos e frameworks analíticos da área
- Síntese original que vai além da descrição — o autor deve ter voz própria argumentativa
- Comprimento dos subtópicos: 5-7 parágrafos densos com elevada densidade conceptual`,
    citacoes: `Inclui 3-4 citações por subtópico, com citações directas e indirectas alternadas.
Citação directa: Segundo Lopes (2018, p.112), "a gestão estratégica implica..."
Citação indirecta: Este argumento é corroborado por várias investigações no contexto africano (Banda, 2020; Kiala & Mabiala, 2021).
OBRIGATÓRIO: apresentar pelo menos uma tensão teórica por subtópico (Autor A defende X, enquanto Autor B argumenta Y).`,
    terminologia: 'Terminologia especializada e jargão técnico da área usado com precisão. Conceitos avançados sem simplificação.',
  },
  'doutoramento': {
    label: 'Doutoramento',
    profundidade: `- Nível de investigação original, com contribuição para o avanço do conhecimento na área
- Revisão exaustiva da literatura: mapear o estado da arte, identificar gap investigativo
- Posicionamento epistemológico explícito: paradigma de investigação, ontologia, epistemologia
- Construção teórica própria: proposta de modelos, frameworks ou hipóteses originais
- Articulação rigorosa entre teoria, metodologia e dados empíricos
- Comprimento dos subtópicos: 6-8 parágrafos de alta densidade teórica e analítica`,
    citacoes: `Inclui 4-6 citações por subtópico, com citações seminais e recentes articuladas.
Citar obras fundacionais da área (clássicos) E investigação recente (últimos 5 anos).
Exemplo: "A teoria fundacional de Bourdieu (1980) sobre capital cultural foi revisitada no contexto africano por Mabiala (2019), que argumenta..."
OBRIGATÓRIO: identificar explicitamente pelo menos uma lacuna na literatura existente por subtópico.`,
    terminologia: 'Terminologia de ponta na área. Conceitos cunhados por autores específicos com atribuição correcta. Sem simplificações.',
  },
};

/* ---------- PERFIS POR ÁREA DO CONHECIMENTO ---------- */
const PERFIL_AREA = {
  ciencias: {
    label: 'Ciências Naturais/Exactas',
    instrucoes: `ÁREA: Ciências (Física, Química, Biologia, Matemática, Geologia)
- OBRIGATÓRIO para subtópicos quantitativos: inclui fórmulas relevantes com notação correcta
  Exemplo para Física: E = mc² (onde E = energia, m = massa, c = velocidade da luz)
  Exemplo para Química: equações químicas balanceadas quando pertinentes
- Menciona unidades de medida correctas (SI) sempre que relevante
- Inclui pelo menos 1 experiência ou fenómeno observável angolano (flora, fauna, geologia, clima)
- Referências de revistas científicas: Nature, Science, African Journal of Science, etc.
- PROIBIDO: referências de educação ou ciências sociais, a não ser que o tema seja interdisciplinar`,
  },
  humanidades: {
    label: 'Humanidades e Ciências Sociais',
    instrucoes: `ÁREA: Humanidades (História, Filosofia, Literatura, Sociologia, Antropologia, Comunicação)
- Perspectiva histórica e cultural com datas, eventos e actores angolanos concretos
- Contextualização no panorama africano e lusófono
- Teorias sociais relevantes: Bourdieu, Foucault, Gramsci, etc. — aplica ao contexto angolano
- Menciona factos históricos de Angola com anos: independência (1975), guerra civil (1975-2002), etc.
- Referências: revistas de ciências sociais, história africana, estudos lusófonos
- PROIBIDO: referências de engenharia, saúde clínica ou gestão empresarial`,
  },
  gestao: {
    label: 'Gestão e Economia',
    instrucoes: `ÁREA: Gestão, Economia, Administração, Finanças, Marketing
- Menciona indicadores económicos angolanos com anos: PIB, taxa de desemprego, inflação
  Exemplo: "Em 2023, Angola registou uma taxa de inflação de cerca de 13,6% (BNA, 2023)"
- Inclui modelos de gestão: SWOT, Porter, Balanced Scorecard, etc. quando pertinente
- Referências ao sector petrolífero angolano, à SONANGOL, ao BNA, ao INE quando relevante
- Exemplos de empresas ou sectores angolanos reais (banca, telecomunicações, construção)
- Referências: Journal of African Business, revistas de economia africana, publicações do BNA/INE
- PROIBIDO: referências de saúde, ciências naturais ou direito (excepto se interdisciplinar)`,
  },
  direito: {
    label: 'Direito e Ciências Jurídicas',
    instrucoes: `ÁREA: Direito (Constitucional, Penal, Civil, Comercial, Internacional, Administrativo)
- OBRIGATÓRIO: citar artigos de lei angolana com número e ano
  Exemplo: "O artigo 30.º da Constituição da República de Angola (2010) consagra..."
- Mencionar legislação angolana relevante: Código Civil, Código Penal (2021), Lei das Sociedades Comerciais
- Jurisprudência do Tribunal Supremo de Angola quando aplicável
- Doutrina jurídica: autores de direito angolano, português e africano
- Referências: revistas jurídicas lusófonas, publicações do MINJUSDH, legislação angolana
- PROIBIDO: referências de gestão, saúde ou engenharia sem nexo jurídico`,
  },
  saude: {
    label: 'Saúde e Ciências da Vida',
    instrucoes: `ÁREA: Saúde (Medicina, Enfermagem, Farmácia, Saúde Pública, Nutrição)
- Mencionar doenças prevalentes em Angola: paludismo, tuberculose, VIH/SIDA, cólera
- Dados do MINSA, OMS Angola, com anos e províncias específicas quando disponíveis
  Exemplo: "Segundo o MINSA (2022), a taxa de mortalidade infantil em Angola..."
- Inclui protocolos clínicos ou guidelines da OMS quando pertinente
- Nomenclatura médica correcta com equivalente comum entre parênteses na primeira ocorrência
- Referências: Lancet, NEJM, revistas africanas de saúde pública, publicações do MINSA/OMS
- PROIBIDO: referências de gestão empresarial, direito ou ciências exactas sem nexo clínico`,
  },
  engenharia: {
    label: 'Engenharia e Tecnologia',
    instrucoes: `ÁREA: Engenharia (Civil, Informática, Eléctrica, Mecânica, Petrolífera, Telecomunicações)
- OBRIGATÓRIO para tópicos técnicos: inclui especificações numéricas, normas técnicas, unidades
  Exemplo: "A norma ISO 9001:2015 estabelece requisitos para sistemas de gestão da qualidade"
- Menciona infra-estruturas angolanas reais: Barragem de Laúca, porto de Luanda, CLARO, UNITEL
- Aplica metodologias de engenharia: análise de falhas, simulação, dimensionamento quando pertinente
- Referências ao sector petrolífero angolano (bloco 0, bloco 17) ou às obras públicas nacionais
- Referências: IEEE, ASME, revistas de engenharia africana, publicações da IRSE/Miniplan
- PROIBIDO: referências de humanidades, direito ou saúde sem nexo tecnológico`,
  },
};

/* ---------- DETECTOR DE ÁREA ---------- */
function detectarArea(tema, areaParam) {
  if (areaParam && PERFIL_AREA[areaParam.toLowerCase()]) return areaParam.toLowerCase();
  const t = (tema||'').toLowerCase();
  if (/física|química|biologia|matemática|geologia|ecologia|botânica|zoologia|astronomia/.test(t)) return 'ciencias';
  if (/direito|lei|jurídic|constitucional|penal|civil|comercial|legisl|tribunal/.test(t)) return 'direito';
  if (/saúde|médic|enfermagem|farmáci|hospital|doença|paludismo|nutrição|clínic/.test(t)) return 'saude';
  if (/gestão|economia|finanças|marketing|contabilidade|administração|empresa|negócio/.test(t)) return 'gestao';
  if (/engenharia|informática|software|hardware|eléctric|mecânic|civil|construção|telecomunicações/.test(t)) return 'engenharia';
  return 'humanidades'; // default
}

/* ---------- DETECTOR DE NÍVEL ---------- */
function detectarNivel(nivelParam) {
  const n = (nivelParam||'').toLowerCase();
  if (/médio|secundário|12|11|10/.test(n)) return 'ensino médio';
  if (/licenciatura|bacharelato|1.*ciclo|graduação/.test(n)) return 'licenciatura';
  if (/mestrado|2.*ciclo|pós.grad/.test(n)) return 'mestrado';
  if (/doutoramento|doutorado|phd|3.*ciclo/.test(n)) return 'doutoramento';
  return 'licenciatura'; // default
}

/* ---------------- TRUNCAR POR PALAVRAS ---------------- */
function truncar(texto, max) {
  if (!texto) return texto;
  const palavras = texto.split(/\s+/);
  if (palavras.length <= max) return texto;
  const cortado = palavras.slice(0, max).join(' ');
  const ultimo = Math.max(cortado.lastIndexOf('. '), cortado.lastIndexOf('.\n'));
  return (ultimo > cortado.length * 0.7 ? cortado.substring(0, ultimo+1) : cortado).trim();
}

/* ---------------- HANDLER ---------------- */
export default async function handler(req, res) {
  setCORS(res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
  if (!rateLimit(ip)) return res.status(429).json({ ok:false, error:'RATE_LIMIT' });

  let body;
  try { body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { return res.status(400).json({ ok:false, error:'INVALID_JSON' }); }

  const action  = body?.action || '';
  const payload = body?.payload || {};

  try {
    switch (action) {

      case 'ping':
        return res.json({ ok:true, action:'ping', data:{ resposta:'pong', pong:true, ts:Date.now() } });

      case 'chat':
        return res.json(ok('chat', await doChat(payload)));

      case 'generate_lesson':
      case 'gerar_capitulo':
        return res.json(ok(action, await doCapitulo(payload)));

      case 'gerar_capitulo_referencias':
        return res.json(ok(action, await doReferencias(payload)));

      case 'regenerar_capitulo':
        return res.json(ok(action, await doCapitulo({ ...payload, regenerar:true })));

      case 'plano_academico':
        return res.json(ok(action, await doPlano(payload)));

      case 'estrutura_academica':
        return res.json(ok(action, await doEstrutura(payload)));

      case 'editar_texto':
        return res.json(ok(action, await doEditar(payload)));

      case 'verificar_coerencia':
        return res.json(ok(action, await doCoerencia(payload)));

      case 'gerar_capa':
        return res.json(ok(action, { resposta: JSON.stringify({ capa:{ titulo: payload.tema||'', tipo: payload.tipoTrabalho||'' } }) }));

      case 'gerar_mea':
      case 'mea_grafico':
      case 'mea_tabela':
      case 'mea_esquema':
        return res.json(ok(action, await doMEA(action, payload)));

      case 'save_history':
        return res.json(ok(action, await doSaveHistory(payload)));

      case 'get_history':
        return res.json(ok(action, await doGetHistory(payload)));

      case 'get_stock':
        return res.json(ok(action, { items:[] }));

      default:
        return res.status(400).json({ ok:false, error:'UNKNOWN_ACTION', action });
    }
  } catch (err) {
    console.error('[ENGINE]', action, err.message);
    return res.status(500).json({ ok:false, error:'INTERNAL_ERROR', detail: err.message.substring(0,200) });
  }
}

/* ---------------- CHAT ---------------- */
async function doChat(p) {
  const pedido = (p.pedido||'').substring(0, 2000);
  if (!pedido) throw new Error('pedido obrigatório');
  const hist = (Array.isArray(p.historico)?p.historico:[]).slice(-8)
    .map(m => ({ role: m.role==='assistant'?'assistant':'user', content: String(m.content||'').substring(0,800) }));
  const msgs = [
    { role:'system', content:`Assistente académico ACADEMY. Português de Angola, formal. Contexto: "${p.tema||''}" (${p.tipoTrabalho||''}). Máx 200 palavras.` },
    ...hist,
    { role:'user', content: pedido },
  ];
  return { resposta: await callAI(msgs, { max_tokens:800 }) };
}

/* ---------------- CAPÍTULO ---------------- */
async function doCapitulo(p) {
  const tema     = (p.tema||'').substring(0,300);
  const tipo     = (p.tipoTrabalho||'Trabalho Académico').substring(0,100);
  const nivel    = (p.nivel||'').substring(0,80);
  const capNum   = parseInt(p.capNum)||1;
  const capTit   = (p.capTitulo||'').substring(0,200);
  const totalCaps= parseInt(p.totalCaps)||4;
  const capSubs  = (Array.isArray(p.capSubs)?p.capSubs:[]).slice(0,8).map(s=>String(s).substring(0,150));

  /* v65: cálculo de palavras */
  const PALAVRAS_POR_PAGINA = 370;
  const PAGINAS_FIXAS = 2;
  const totalPags = parseInt(p.totalPags) || 15;
  const paginasConteudo = Math.max(totalPags - PAGINAS_FIXAS, 1);
  const palavrasCalculadas = Math.round((paginasConteudo * PALAVRAS_POR_PAGINA) / totalCaps);
  const palavras = Math.min(Math.max(
    parseInt(p.palavrasPorCap) || palavrasCalculadas,
    150
  ), 2000);

  if (!tema || !capTit) throw new Error('tema e capTitulo obrigatórios');

  /* v65: detectar nível e área */
  const nivelKey = detectarNivel(nivel);
  const areaKey  = detectarArea(tema, p.area);
  const perfilNivel = PERFIL_NIVEL[nivelKey];
  const perfilArea  = PERFIL_AREA[areaKey];

  const subs = capSubs.map((s,i) => `${capNum}.${i+1} ${s}`).join('\n') ||
               `${capNum}.1 Contextualização\n${capNum}.2 Desenvolvimento\n${capNum}.3 Análise crítica`;

  /* v65: variação estrutural por posição do subtópico
     Garante que cada subtópico tem abordagem diferente */
  const abordagens = [
    `Abordagem histórico-evolutiva: começa pela origem/evolução do conceito, depois analisa o estado actual em Angola.`,
    `Abordagem analítico-crítica: apresenta o conceito principal, confronta perspectivas divergentes de pelo menos 2 autores, tira conclusão fundamentada.`,
    `Abordagem empírico-descritiva: parte de dados concretos (números, percentagens, anos) para construir o argumento teórico.`,
    `Abordagem comparativa: compara o contexto angolano com pelo menos um contexto africano similar, identificando convergências e divergências.`,
    `Abordagem prospectiva: analisa o estado actual e projecta implicações futuras para Angola com base em tendências identificadas na literatura.`,
  ];
  const subsAbordagens = capSubs.map((s,i) =>
    `${capNum}.${i+1} ${s} → ${abordagens[i % abordagens.length]}`
  ).join('\n');

  const maxTok = Math.min(Math.max(Math.round(palavras*1.7), 400), 8000);

  const prompt = `És um académico angolano de referência, especialista em "${tema}", a escrever um ${tipo} de nível ${perfilNivel.label}.

TAREFA: Escreve APENAS o conteúdo do capítulo "${capTit}" para um ${tipo} sobre "${tema}".

REGRA CRÍTICA: NÃO escrevas o título "${capNum}. ${capTit}" nem "Capítulo ${capNum}" — o título já existe no documento. Começa directamente pelo primeiro subtópico numerado.

══════════════════════════════════════════
SUBTÓPICOS COM ABORDAGEM OBRIGATÓRIA:
${subsAbordagens || subs}
══════════════════════════════════════════

PROFUNDIDADE EXIGIDA — NÍVEL ${perfilNivel.label.toUpperCase()}:
${perfilNivel.profundidade}

INTEGRAÇÃO DE CITAÇÕES OBRIGATÓRIA:
${perfilNivel.citacoes}

CONTEXTO DA ÁREA:
${perfilArea.instrucoes}

REGRAS DE CONTEÚDO ANGOLANO:
- Menciona pelo menos 2 factos verificáveis de Angola: províncias, cidades, anos, instituições reais
- Proibido usar "Angola" de forma vaga — especifica: "Luanda (2021)", "MINSA (2022)", "INE Angola (2023)"
- Proibido mencionar Brasil, Portugal ou Europa como contexto principal deste trabalho
- Exemplos estrangeiros apenas como comparação, nunca como caso central

FORMATAÇÃO RIGOROSA:
- Cada subtópico começa com o número e título em linha própria: "${capNum}.1 Nome do Subtópico"
- Parágrafos separados por linha em branco
- Sem bullets, sem listas, sem asteriscos, sem markdown
- ⚠ LIMITE: ${palavras} PALAVRAS — para ao atingir este limite com frase completa
${p.instrucaoSubtitulos ? '\n' + p.instrucaoSubtitulos : ''}
${antiIA(capNum, totalCaps)}`;

  let r = await callAI([{ role:'user', content:prompt }], { max_tokens: maxTok, temperature:0.65 });

  /* v62: limpar qualquer título que o modelo tenha incluído mesmo proibido */
  let limpo = r
    .replace(/^cap[íi]tulo\s+\d+\s*[—\-–][^\n]*\n?/gim, '')
    .replace(new RegExp(`^${capNum}[.\\s]+${capTit.substring(0,30).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^\n]*\n?`, 'gim'), '')
    .replace(new RegExp(`^${capTit.substring(0,30).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^\n]*\n?`, 'gim'), '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  /* v62: se texto cortado, pedir continuação */
  if (!/[.!?]\s*$/.test(limpo)) {
    try {
      const cont = await callAI([
        { role:'user', content: prompt },
        { role:'assistant', content: limpo },
        { role:'user', content: 'O texto ficou incompleto. Continua e termina com uma frase de conclusão completa. Máx. 120 palavras.' },
      ], { max_tokens: 400, temperature: 0.65 });
      if (cont && /[.!?]\s*$/.test(cont.trim())) {
        limpo = (limpo + '\n\n' + cont.trim()).replace(/\n{3,}/g, '\n\n').trim();
      }
    } catch(_) { /* continua com o que existe */ }
  }

  /* v62: garantir conteúdo mínimo — se ficou curto, regenerar uma vez */
  const MIN_PALAVRAS = Math.round(palavras * 0.6);
  if (limpo.split(/\s+/).filter(Boolean).length < MIN_PALAVRAS) {
    try {
      const regen = await callAI([
        { role:'user', content: prompt + `\n\nIMPORTANTE: O texto anterior ficou muito curto. Escreve com mais detalhe, mínimo ${palavras} palavras.` }
      ], { max_tokens: maxTok, temperature: 0.7 });
      const regenLimpo = regen
        .replace(/^cap[íi]tulo\s+\d+\s*[—\-–][^\n]*\n?/gim, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (regenLimpo.split(/\s+/).filter(Boolean).length > limpo.split(/\s+/).filter(Boolean).length) {
        limpo = regenLimpo;
      }
    } catch(_) { /* fica com o original */ }
  }

  return { resposta: truncar(limpo, Math.round(palavras * 1.1)) };
}

/* ---------------- REFERÊNCIAS v65 ---------------- */
async function doReferencias(p) {
  const tema = (p.tema||'').substring(0,300);
  const tipo = (p.tipoTrabalho||'Trabalho Académico').substring(0,100);
  const nivel = (p.nivel||'').substring(0,80);
  const areaKey = detectarArea(tema, p.area);
  const perfilArea = PERFIL_AREA[areaKey];
  const nivelKey = detectarNivel(nivel);

  /* Número de referências por nível */
  const nRefs = { 'ensino médio': '8-10', 'licenciatura': '10-12', 'mestrado': '12-15', 'doutoramento': '15-20' };
  const minRecentes = { 'ensino médio': 2, 'licenciatura': 3, 'mestrado': 4, 'doutoramento': 5 };
  const minAfricanos = { 'ensino médio': 2, 'licenciatura': 3, 'mestrado': 4, 'doutoramento': 5 };

  const prompt = `Escreve as Referências Bibliográficas para um ${tipo} de nível ${PERFIL_NIVEL[nivelKey].label} sobre "${tema}".

CONTEXTO DA ÁREA: ${perfilArea.label}
${perfilArea.instrucoes}

REGRAS ABSOLUTAS:
1. Quantidade: ${nRefs[nivelKey] || '10-12'} referências
2. Formato APA 7ª edição rigoroso
3. TODAS as referências devem ser EXCLUSIVAMENTE sobre "${tema}" ou área "${perfilArea.label}"
4. PROIBIDO citar obras de outras áreas (ex: se o tema é Física, proibido citar obras de Educação ou Gestão)
5. Pelo menos ${minAfricanos[nivelKey] || 3} autores africanos ou angolanos
6. Pelo menos ${minRecentes[nivelKey] || 3} publicações entre 2019 e 2024
7. Para nível Mestrado/Doutoramento: incluir pelo menos 2 artigos de revistas indexadas (Scopus, WoS)
8. Ordenadas alfabeticamente pelo apelido do primeiro autor
9. Sem numeração, sem bullets — uma referência por parágrafo, linha em branco entre cada
10. PROIBIDO inventar DOIs — se não souberes o DOI real, omite-o completamente
11. Títulos de livros em itálico não é possível em texto plano — usa maiúsculas iniciais apenas
12. Os nomes dos autores, títulos e revistas citados devem ser plausíveis e existir de facto na área "${perfilArea.label}"

EXEMPLOS DO FORMATO CORRECTO (APA 7):
Livro: Apelido, A. B. (2020). Título do livro em itálico. Editora.
Artigo: Apelido, A. B., & Apelido2, C. D. (2021). Título do artigo. Nome da Revista, 15(3), 45–62.
Capítulo: Apelido, A. B. (2019). Título do capítulo. Em C. D. Apelido (Ed.), Título do livro (pp. 23–45). Editora.

Escreve APENAS as referências, sem título "Referências Bibliográficas" nem introdução.`;

  return { resposta: await callAI([{ role:'user', content:prompt }], { max_tokens:2500, temperature:0.35 }) };
}

/* ---------------- PLANO ACADÉMICO v65 ---------------- */
async function doPlano(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const nivelKey = detectarNivel(p.nivel);
  const areaKey  = detectarArea(tema, p.area);
  const perfilNivel = PERFIL_NIVEL[nivelKey];
  const perfilArea  = PERFIL_AREA[areaKey];

  const prompt = `Cria o plano académico para um ${p.tipoTrabalho||'Trabalho Académico'} de nível "${perfilNivel.label}" sobre "${tema}".
Área: ${perfilArea.label}

O plano deve reflectir o nível ${perfilNivel.label}:
${nivelKey === 'ensino médio' ? '- Problema e objectivo claros e acessíveis, metodologia descritiva simples' : ''}
${nivelKey === 'licenciatura' ? '- Problema com enquadramento teórico, hipótese testável, metodologia de revisão bibliográfica ou estudo de caso' : ''}
${nivelKey === 'mestrado' ? '- Problema com gap investigativo identificado, hipótese operacionalizável, metodologia mista ou qualitativa avançada' : ''}
${nivelKey === 'doutoramento' ? '- Problema de investigação original com contribuição para o conhecimento, hipótese inovadora, metodologia rigorosa com justificação paradigmática' : ''}

Responde APENAS com JSON válido, sem markdown:
{"objetivo":"...","hipotese":"...","problema":"...","metodologia":"..."}`;

  const r = await callAI([{ role:'user', content:prompt }], { max_tokens:600, temperature:0.4 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- ESTRUTURA ACADÉMICA v65 ---------------- */
async function doEstrutura(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const pags = Math.min(Math.max(parseInt(p.totalPags)||15, 5), 100);
  const nivelKey = detectarNivel(p.nivel);
  const areaKey  = detectarArea(tema, p.area);
  const perfilNivel = PERFIL_NIVEL[nivelKey];
  const perfilArea  = PERFIL_AREA[areaKey];

  const prompt = `Gera a estrutura de capítulos para um ${p.tipoTrabalho||'TFC'} de nível "${perfilNivel.label}" sobre "${tema}". Total: ${pags} páginas.
Área do conhecimento: ${perfilArea.label}
${p.objetivo?'Objectivo: '+p.objetivo:''}

REGRAS:
- 3-6 capítulos de conteúdo (excluindo Referências Bibliográficas)
- 2-4 subtópicos por capítulo, com títulos específicos ao tema (não genéricos como "Contextualização")
- Os títulos dos subtópicos devem variar em abordagem: histórico, analítico, empírico, prospectivo
- Último elemento: capítulo "Referências Bibliográficas" sem subtópicos
- PROIBIDO subtópicos genéricos: "Introdução ao capítulo", "Conclusão do capítulo", "Contextualização" isolado
- Os títulos devem reflectir o tema "${tema}" especificamente

Responde APENAS com array JSON válido, sem markdown:
[{"num":1,"titulo":"...","subs":["Subtópico 1.1 específico","Subtópico 1.2 específico","Subtópico 1.3 específico"]},...]`;

  const r = await callAI([{ role:'user', content:prompt }], { max_tokens:1200, temperature:0.4 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- EDITAR TEXTO ---------------- */
async function doEditar(p) {
  const texto  = (p.texto||'').substring(0,4000);
  const subacao= p.subacao||p.acao||'melhorar';
  if (!texto) throw new Error('texto obrigatório');
  const instrucoes = {
    melhorar:   'Melhora o estilo académico mantendo o conteúdo. Português formal angolano.',
    expandir:   'Expande o texto com mais detalhe académico (+30%). Português formal angolano.',
    resumir:    'Resume mantendo ideias principais (-40%). Português formal angolano.',
    formalizar: 'Formaliza a linguagem para nível universitário angolano.',
  };
  const instr = instrucoes[subacao] || instrucoes.melhorar;
  const r = await callAI([{ role:'user', content:`${instr}\n\nTexto:\n${texto}\n\nDevolve apenas o texto editado.` }], { max_tokens:4000, temperature:0.5 });
  return { resposta: r };
}

/* ---------------- COERÊNCIA ---------------- */
async function doCoerencia(p) {
  const a = (p.textoA||'').substring(0,2000);
  const b = (p.textoB||'').substring(0,2000);
  if (!a||!b) throw new Error('textoA e textoB obrigatórios');
  const r = await callAI([{ role:'user', content:`Analisa coerência entre dois capítulos. Responde apenas com JSON:\n{"coerente":true/false,"problemas":[],"sugestoes":[]}\nA:${a}\nB:${b}` }], { max_tokens:512, temperature:0.3 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- MEA ---------------- */
async function doMEA(action, p) {
  const tipo = action==='mea_grafico'?'gráfico':action==='mea_tabela'?'tabela':'esquema';
  const r = await callAI([{ role:'user', content:`Cria um ${tipo} académico para "${p.capTitulo||''}" sobre "${p.tema||''}". JSON estruturado.` }], { max_tokens:800, temperature:0.5 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- SUPABASE: SAVE HISTORY ---------------- */
async function doSaveHistory(p) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url||!key) return { saved:false };
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 10000);
  try {
    await fetch(`${url}/rest/v1/academy_history`, {
      method:'POST', signal:ctrl.signal,
      headers:{ 'Content-Type':'application/json','apikey':key,'Authorization':`Bearer ${key}`,'Prefer':'return=minimal' },
      body: JSON.stringify({ user_id:p.user_id, tipo:p.tipo, tema:p.tema, pags:p.pags, metadata:p.metadata, created_at:new Date().toISOString() }),
    });
  } finally { clearTimeout(t); }
  return { saved:true };
}

/* ---------------- SUPABASE: GET HISTORY ---------------- */
async function doGetHistory(p) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url||!key) return { rows:[] };
  const params = new URLSearchParams({ select:'*', user_id:`eq.${p.user_id}`, order:'created_at.desc', limit:String(Math.min(parseInt(p.limit)||20,100)) });
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 10000);
  let rows = [];
  try {
    const r = await fetch(`${url}/rest/v1/academy_history?${params}`, { signal:ctrl.signal, headers:{ apikey:key, Authorization:`Bearer ${key}` } });
    rows = await r.json();
  } finally { clearTimeout(t); }
  return { rows };
}

/* ---------------- OPENROUTER COM FALLBACK ---------------- */
async function callAI(messages, opts={}) {
  let lastErr = '';
  for (const model of MODELS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 85000);
      let resp;
      try {
        resp = await fetch(OR_URL, {
          method:'POST', signal:ctrl.signal,
          headers:{ 'Content-Type':'application/json', 'Authorization':`Bearer ${process.env.OPENROUTER_API_KEY}`, 'HTTP-Referer':OR_SITE, 'X-Title':OR_TITLE },
          body: JSON.stringify({ model, messages, temperature:opts.temperature??0.7, max_tokens:opts.max_tokens??800, stream:false }),
        });
      } finally { clearTimeout(t); }
      if (resp.status===429||resp.status===503) { lastErr=`${resp.status}`; continue; }
      if (!resp.ok) { lastErr=await resp.text().catch(()=>resp.status); continue; }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      /* v61: mínimo 80 palavras — evita capítulos quase vazios */
      if (text && text.split(/\s+/).filter(Boolean).length >= 80) return text;
      lastErr='empty response';
    } catch(e) { lastErr=e.message; }
  }
  throw new Error('Todos os modelos falharam: '+lastErr);
}

/* ---------------- JSON EXTRACTOR ---------------- */
function extrairJSON(texto) {
  if (!texto) throw new Error('resposta vazia');
  const s = texto.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(s); } catch {}
  const m = s.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (m) try { return JSON.parse(m[1]); } catch {}
  throw new Error('JSON inválido na resposta do modelo');
}

/* ---------------- HELPERS ---------------- */
function ok(action, data) {
  return { ok:true, action, data, meta:{ ts:Date.now(), provider:'openrouter' } };
}
