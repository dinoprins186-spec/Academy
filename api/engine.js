/* =======================================================================
   ACADEMY ENGINE - SAAS BLINDADO (PRODUÇÃO)
   v65 FINAL: SISTEMA DE PROMPTS ESTRATIFICADO
   - Perfis por nível: Ensino Médio / Licenciatura / Mestrado / Doutoramento
   - Perfis por área: Ciências / Humanidades / Gestão / Direito / Saúde / Engenharia
   - Citações autor-ano obrigatórias no corpo do texto
   - Angola específico com factos, anos, instituições reais
   - Variação estrutural entre subtópicos (5 abordagens rotativas)
   - Bugs corrigidos: ping, verificar_coerencia, gerar_mea
======================================================================= */

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

/* ---------------- POOLS ANTI-IA ---------------- */
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
  const pick = (arr, s) => arr[(n*7 + s*3) % arr.length];
  const fase = !totalCaps||totalCaps<=1 ? 'análise' :
    (n/(totalCaps-1))<=0.1 ? 'introdução' :
    (n/(totalCaps-1))<=0.35 ? 'fundamentação teórica' :
    (n/(totalCaps-1))<=0.65 ? 'análise crítica' :
    (n/(totalCaps-1))<=0.88 ? 'síntese' : 'conclusão';
  return `REGRAS DE ESTILO OBRIGATÓRIAS:
1. Para exemplos usa: "${pick(EXEMPLOS,1)}" — NUNCA "A título de exemplo:" repetido
2. Para hipótese usa: "${pick(HIPOTESES,2)}"
3. Para concluir secções usa: "${pick(CONCLUSOES,3)}"
4. Para transições usa: "${pick(TRANSICOES,4)}"
5. PROIBIDO bullets, listas, asteriscos ou markdown
6. PROIBIDO repetir a mesma estrutura em subtópicos consecutivos
7. PROIBIDO usar "Brasil", "Portugal", "Europa" como referência principal — contexto é Angola
8. PROIBIDO referir Angola de forma vaga — especifica sempre: "Luanda (2021)", "MINSA (2022)", "INE (2023)"
9. Texto deve soar como académico angolano experiente, não como IA
10. Posição no documento: ${fase} — adequa tom e profundidade`;
}

/* ---------------- PERFIS POR NÍVEL ---------------- */
const PERFIL_NIVEL = {
  'ensino médio': {
    profundidade: `Linguagem clara para estudantes 14-18 anos. Conceitos desde o básico. Para Ciências: fórmulas básicas com cada variável explicada. Exemplos do quotidiano angolano reconhecíveis. 3-4 parágrafos densos por subtópico.`,
    citacoes: `1-2 citações por subtópico formato (Apelido, Ano). Exemplo: "Segundo Cardoso (2019),..." ou "...processo fundamental (Lima & Santos, 2020)."`,
    refs_min: 8, refs_africanos: 2,
  },
  'licenciatura': {
    profundidade: `Nível universitário 1º ciclo. Rigor conceptual. Análise crítica: comparar perspectivas de pelo menos 2 autores. Dados estatísticos e factos angolanos verificáveis com anos e instituições. 4-5 parágrafos densos por subtópico.`,
    citacoes: `2-3 citações por subtópico. Exemplos: "De acordo com Ferreira (2021),..." / "(Neto, 2019; Costa, 2022)." / "Silva (2020, p.45) argumenta que..." OBRIGATÓRIO: pelo menos 1 citação no meio de cada parágrafo principal, não apenas no fim.`,
    refs_min: 10, refs_africanos: 3,
  },
  'mestrado': {
    profundidade: `Pós-graduação. Confrontar teorias, identificar lacunas. Síntese original com voz argumentativa. OBRIGATÓRIO: pelo menos 1 tensão teórica por subtópico (Autor A defende X, Autor B argumenta Y). 5-7 parágrafos de alta densidade por subtópico.`,
    citacoes: `3-4 citações por subtópico, directas e indirectas alternadas. Citação directa: Segundo Lopes (2018, p.112), "a gestão estratégica implica..." Citação indirecta: (Banda, 2020; Kiala & Mabiala, 2021). OBRIGATÓRIO: 1 tensão teórica por subtópico.`,
    refs_min: 12, refs_africanos: 4,
  },
  'doutoramento': {
    profundidade: `Investigação original. Mapear estado da arte, propor contribuição nova. Posicionamento epistemológico. Obras seminais + investigação recente (últimos 5 anos). OBRIGATÓRIO: identificar lacuna na literatura por subtópico. 6-8 parágrafos de alta densidade.`,
    citacoes: `4-6 citações por subtópico. Obras fundacionais E investigação recente. Exemplo: "A teoria de Bourdieu (1980) foi revisitada por Mabiala (2019), que argumenta..." OBRIGATÓRIO: lacuna na literatura por subtópico.`,
    refs_min: 15, refs_africanos: 5,
  },
};

/* ---------------- PERFIS POR ÁREA ---------------- */
const PERFIL_AREA = {
  ciencias: {
    label: 'Ciências Naturais/Exactas',
    instrucoes: `ÁREA Ciências (Física, Química, Biologia, Matemática, Geologia):
- OBRIGATÓRIO para subtópicos quantitativos: fórmulas com notação correcta e variáveis explicadas
- Unidades de medida SI sempre que relevante
- Pelo menos 1 fenómeno observável em Angola (flora, fauna, geologia, clima angolano)
- Referências: Nature, Science, African Journal of Science
- PROIBIDO: referências de ciências sociais ou gestão sem nexo científico`,
  },
  humanidades: {
    label: 'Humanidades e Ciências Sociais',
    instrucoes: `ÁREA Humanidades (História, Filosofia, Literatura, Sociologia, Comunicação):
- Perspectiva histórica com datas e actores angolanos concretos
- Factos de Angola com anos: independência (1975), guerra civil (1975-2002), paz (2002)
- Teorias sociais (Bourdieu, Foucault, Gramsci) aplicadas ao contexto angolano
- Referências: revistas de ciências sociais, história africana, estudos lusófonos
- PROIBIDO: referências de engenharia ou saúde clínica`,
  },
  gestao: {
    label: 'Gestão e Economia',
    instrucoes: `ÁREA Gestão, Economia, Administração, Finanças, Marketing:
- Indicadores económicos angolanos com anos: PIB, inflação, desemprego (BNA, INE)
- Exemplo obrigatório: "Em 2023, Angola registou inflação de ~13,6% (BNA, 2023)"
- Modelos de gestão: SWOT, Porter, Balanced Scorecard quando pertinente
- Empresas/sectores angolanos reais: SONANGOL, BNA, Unitel, CLARO, sector bancário
- Referências: Journal of African Business, publicações BNA/INE Angola
- PROIBIDO: referências de saúde, ciências naturais ou direito sem nexo`,
  },
  direito: {
    label: 'Direito e Ciências Jurídicas',
    instrucoes: `ÁREA Direito (Constitucional, Penal, Civil, Comercial, Administrativo):
- OBRIGATÓRIO: citar artigos de lei angolana com número e ano
- Exemplo: "O artigo 30.º da Constituição da República de Angola (2010) consagra..."
- Legislação angolana: Código Civil, Código Penal (2021), Lei das Sociedades Comerciais
- Jurisprudência do Tribunal Supremo de Angola quando aplicável
- Referências: revistas jurídicas lusófonas, publicações MINJUSDH, legislação angolana
- PROIBIDO: referências de gestão, saúde ou engenharia sem nexo jurídico`,
  },
  saude: {
    label: 'Saúde e Ciências da Vida',
    instrucoes: `ÁREA Saúde (Medicina, Enfermagem, Farmácia, Saúde Pública, Nutrição):
- Doenças prevalentes em Angola: paludismo, tuberculose, VIH/SIDA, cólera
- Dados MINSA/OMS com anos e províncias: "Segundo MINSA (2022), a mortalidade infantil..."
- Protocolos clínicos ou guidelines OMS quando pertinente
- Nomenclatura médica correcta com equivalente comum na primeira ocorrência
- Referências: Lancet, NEJM, revistas africanas de saúde, publicações MINSA/OMS
- PROIBIDO: referências de gestão empresarial ou direito sem nexo clínico`,
  },
  engenharia: {
    label: 'Engenharia e Tecnologia',
    instrucoes: `ÁREA Engenharia (Civil, Informática, Eléctrica, Mecânica, Petrolífera, TIC):
- OBRIGATÓRIO: especificações numéricas, normas técnicas (ISO, IEEE), unidades
- Infra-estruturas angolanas reais: Barragem de Laúca (2,07 GW), Porto de Luanda, UNITEL, CLARO
- Sector petrolífero: Bloco 0, Bloco 17, SONANGOL EP quando pertinente
- Referências: IEEE, ASME, revistas de engenharia africana, IRSE/Miniplan Angola
- PROIBIDO: referências de humanidades ou direito sem nexo tecnológico`,
  },
};

/* ---------------- ABORDAGENS ESTRUTURAIS (rotação) ---------------- */
const ABORDAGENS = [
  `Abordagem histórico-evolutiva: começa pela origem/evolução do conceito, analisa o estado actual em Angola com datas e factos concretos.`,
  `Abordagem analítico-crítica: apresenta o conceito, confronta perspectivas divergentes de 2+ autores, conclui com posição fundamentada.`,
  `Abordagem empírico-descritiva: apresenta dados quantitativos angolanos verificáveis (percentagens, anos, instituições), interpreta as implicações.`,
  `Abordagem comparativa: compara a realidade angolana com outros contextos africanos, identifica semelhanças e especificidades locais.`,
  `Abordagem prospectiva: analisa o estado actual, identifica desafios estruturais, propõe recomendações concretas para Angola.`,
];

/* ---------------- DETECÇÃO AUTOMÁTICA ---------------- */
function detectarNivel(n) {
  const s = (n||'').toLowerCase();
  if (/médio|secundário|12\.º|11\.º|10\.º|\b12\b|\b11\b|\b10\b/.test(s)) return 'ensino médio';
  if (/mestrado|2\.º ciclo|pós.grad/.test(s)) return 'mestrado';
  if (/doutoramento|doutorado|phd|3\.º ciclo/.test(s)) return 'doutoramento';
  return 'licenciatura';
}

function detectarArea(tema, areaParam) {
  if (areaParam && PERFIL_AREA[areaParam.toLowerCase()]) return areaParam.toLowerCase();
  const t = (tema||'').toLowerCase();
  if (/física|química|biologia|matemática|geologia|ecologia|botânica|astronomia/.test(t)) return 'ciencias';
  if (/direito|lei\b|jurídic|constitucional|penal|civil|comercial|legisl|tribunal/.test(t)) return 'direito';
  if (/saúde|médic|enfermagem|farmáci|hospital|doença|paludismo|nutrição|clínic/.test(t)) return 'saude';
  if (/gestão|economia|finanças|marketing|contabilidade|administração|empresa|negócio/.test(t)) return 'gestao';
  if (/engenharia|informática|software|hardware|eléctric|mecânic|construção|telecomunic|tic\b/.test(t)) return 'engenharia';
  return 'humanidades';
}

/* ---------------- TRUNCAR ---------------- */
function truncar(texto, max) {
  if (!texto) return texto;
  const p = texto.split(/\s+/);
  if (p.length <= max) return texto;
  const c = p.slice(0, max).join(' ');
  const u = Math.max(c.lastIndexOf('. '), c.lastIndexOf('.\n'));
  return (u > c.length * 0.7 ? c.substring(0, u+1) : c).trim();
}

/* ---------------- HANDLER ---------------- */
export default async function handler(req, res) {
  setCORS(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok:false, error:'METHOD_NOT_ALLOWED' });

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
        return res.json(ok(action, { resposta: JSON.stringify({ capa:{ titulo:payload.tema||'', tipo:payload.tipoTrabalho||'' } }) }));
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
    console.error('[ENGINE v65]', action, err.message);
    return res.status(500).json({ ok:false, error:'INTERNAL_ERROR', detail:err.message.substring(0,200) });
  }
}

/* ---------------- CHAT ---------------- */
async function doChat(p) {
  const pedido = (p.pedido||'').substring(0,2000);
  if (!pedido) throw new Error('pedido obrigatório');
  const hist = (Array.isArray(p.historico)?p.historico:[]).slice(-8)
    .map(m => ({ role:m.role==='assistant'?'assistant':'user', content:String(m.content||'').substring(0,800) }));
  return { resposta: await callAI([
    { role:'system', content:`Assistente académico ACADEMY. Português Angola, formal. Contexto: "${p.tema||''}" (${p.tipoTrabalho||''}). Máx 200 palavras.` },
    ...hist,
    { role:'user', content:pedido },
  ], { max_tokens:800 }) };
}

/* ---------------- CAPÍTULO (v65: estratificado) ---------------- */
async function doCapitulo(p) {
  const tema      = (p.tema||'').substring(0,300);
  const tipo      = (p.tipoTrabalho||'Trabalho Académico').substring(0,100);
  const nivel     = (p.nivel||'').substring(0,80);
  const capNum    = parseInt(p.capNum)||1;
  const capTit    = (p.capTitulo||'').substring(0,200);
  const totalCaps = parseInt(p.totalCaps)||parseInt(p.totalPags)||4;
  const totalPags = parseInt(p.totalPags)||15;
  const capSubs   = (Array.isArray(p.capSubs)?p.capSubs:[]).slice(0,8).map(s=>String(s).substring(0,150));

  if (!tema||!capTit) throw new Error('tema e capTitulo obrigatórios');

  /* Cálculo de palavras */
  const palavrasCalc = Math.round(((totalPags-2)*370) / totalCaps);
  const palavras = Math.min(Math.max(parseInt(p.palavrasPorCap)||palavrasCalc, 150), 2000);

  /* Perfis */
  const nivelKey  = detectarNivel(nivel);
  const areaKey   = detectarArea(tema, p.area);
  const pNivel    = PERFIL_NIVEL[nivelKey];
  const pArea     = PERFIL_AREA[areaKey];

  /* Subtópicos */
  const subs = capSubs.map((s,i) => `${capNum}.${i+1} ${s}`).join('\n') ||
    `${capNum}.1 Contextualização\n${capNum}.2 Desenvolvimento\n${capNum}.3 Análise crítica`;

  /* Abordagem estrutural rotativa */
  const abordagem = ABORDAGENS[(capNum-1) % ABORDAGENS.length];

  const maxTok = Math.min(Math.max(Math.round(palavras*1.7), 500), 8000);

  const prompt = `És um professor universitário angolano a escrever o Capítulo ${capNum} de um ${tipo} de nível ${nivel} sobre "${tema}".

CAPÍTULO: ${capNum}. ${capTit}

SUBTÓPICOS OBRIGATÓRIOS (usa esta numeração exacta, cada um em linha própria):
${subs}

ABORDAGEM ESTRUTURAL PARA ESTE CAPÍTULO:
${abordagem}

NÍVEL ACADÉMICO — ${nivelKey.toUpperCase()}:
${pNivel.profundidade}

CITAÇÕES OBRIGATÓRIAS:
${pNivel.citacoes}

${pArea.instrucoes}

FORMATAÇÃO OBRIGATÓRIA:
- Título do capítulo: "${capNum}. ${capTit}" — NÃO escrevas "Capítulo ${capNum} —"
- Cada subtítulo (${capNum}.1, ${capNum}.2, etc.) em LINHA PRÓPRIA com linha em branco ANTES e DEPOIS
- NUNCA coloques o subtítulo e o texto na mesma linha
- Parágrafos separados por linha em branco
- Sem bullets, sem markdown
- Português formal angolano
- ⚠ LIMITE: ${palavras} PALAVRAS — PÁRA ao atingir este limite
${p.instrucaoSubtitulos ? '\n' + p.instrucaoSubtitulos : ''}
${antiIA(capNum, totalCaps)}

Escreve o capítulo completo agora.`;

  const r = await callAI([{ role:'user', content:prompt }], { max_tokens:maxTok, temperature:0.65 });
  const limpo = r.replace(/^cap[íi]tulo\s+\d+\s*[—\-–][^\n]*\n?/gim,'').replace(/\n{3,}/g,'\n\n').trim();
  return { resposta: truncar(limpo, Math.round(palavras*1.1)) };
}

/* ---------------- REFERÊNCIAS (v65: por área e nível) ---------------- */
async function doReferencias(p) {
  const tema  = (p.tema||'').substring(0,300);
  const tipo  = (p.tipoTrabalho||'Trabalho Académico').substring(0,100);
  const nivel = (p.nivel||'').substring(0,80);
  const nivelKey = detectarNivel(nivel);
  const areaKey  = detectarArea(tema, p.area);
  const pNivel   = PERFIL_NIVEL[nivelKey];
  const pArea    = PERFIL_AREA[areaKey];

  const prompt = `Escreve as Referências Bibliográficas para um ${tipo} de nível ${nivel} sobre "${tema}".

REGRAS ABSOLUTAS:
- Mínimo ${pNivel.refs_min} referências
- Formato APA 7ª edição estrito
- Pelo menos ${pNivel.refs_africanos} autores africanos ou angolanos
- Pelo menos 3 publicações recentes (2019-2024)
- ${pArea.instrucoes.split('\n')[0]}
- PROIBIDO referências fora da área temática
- Ordenadas alfabeticamente pelo apelido
- Sem numeração, sem bullets — uma referência por parágrafo com linha em branco entre cada

Escreve APENAS as referências, sem título nem introdução.`;

  return { resposta: await callAI([{ role:'user', content:prompt }], { max_tokens:2500, temperature:0.4 }) };
}

/* ---------------- PLANO ACADÉMICO ---------------- */
async function doPlano(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const r = await callAI([{ role:'user', content:
    `Cria um plano académico para um ${p.tipoTrabalho||'TFC'} de nível "${p.nivel||''}" sobre "${tema}" em Angola.
Responde APENAS com JSON válido, sem markdown:
{"objetivo":"...","hipotese":"...","problema":"...","metodologia":"..."}`
  }], { max_tokens:600, temperature:0.4 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- ESTRUTURA ACADÉMICA ---------------- */
async function doEstrutura(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const pags = Math.min(Math.max(parseInt(p.totalPags)||15, 5), 100);
  const r = await callAI([{ role:'user', content:
    `Estrutura capítulos para um ${p.tipoTrabalho||'TFC'} de nível "${p.nivel||''}" sobre "${tema}" em Angola. ${pags} páginas.
${p.objetivo ? 'Objectivo: '+p.objetivo : ''}
Responde APENAS com array JSON, sem markdown:
[{"num":1,"titulo":"...","subs":["Subtópico 1.1","Subtópico 1.2","Subtópico 1.3"]},...]
Regras: 3-6 capítulos, 2-4 subtópicos cada, último capítulo "Referências Bibliográficas" sem subs.`
  }], { max_tokens:1000, temperature:0.4 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- EDITAR TEXTO ---------------- */
async function doEditar(p) {
  const texto  = (p.texto||'').substring(0,4000);
  const subacao = p.subacao||p.acao||'melhorar';
  if (!texto) throw new Error('texto obrigatório');
  const instrucoes = {
    melhorar:   'Melhora o estilo académico mantendo o conteúdo. Português formal angolano.',
    expandir:   'Expande com mais detalhe académico (+30%). Português formal angolano.',
    resumir:    'Resume mantendo as ideias principais (-40%). Português formal angolano.',
    formalizar: 'Formaliza a linguagem para nível universitário angolano.',
  };
  const r = await callAI([{ role:'user', content:`${instrucoes[subacao]||instrucoes.melhorar}\n\nTexto:\n${texto}\n\nDevolve apenas o texto editado.` }],
    { max_tokens:4000, temperature:0.5 });
  return { resposta: r };
}

/* ---------------- VERIFICAR COERÊNCIA (v65: corrigido) ---------------- */
async function doCoerencia(p) {
  /* Frontend pode enviar introTexto/concTexto ou textoA/textoB */
  const a = (p.introTexto||p.textoA||'').substring(0,2000);
  const b = (p.concTexto||p.textoB||'').substring(0,2000);
  if (!a||!b) throw new Error('textos obrigatórios');
  const r = await callAI([{ role:'user', content:
    `Analisa a coerência entre introdução e conclusão de um trabalho académico.
Responde APENAS com JSON:
{"coerente":true/false,"problemas":["..."],"sugestoes":["..."]}
Introdução: ${a}
Conclusão: ${b}`
  }], { max_tokens:600, temperature:0.3 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- MEA (v65: corrigido para array de capítulos) ---------------- */
async function doMEA(action, p) {
  const tipo_mea = action==='mea_grafico'?'gráfico':action==='mea_tabela'?'tabela':'esquema';
  const tema     = (p.tema||'').substring(0,200);
  /* Frontend pode enviar array 'capitulos' ou string 'capResumo' */
  const resumo = Array.isArray(p.capitulos)
    ? p.capitulos.slice(0,5).map(c=>`${c.titulo}: ${(c.c||c.conteudo||'').substring(0,200)}`).join('\n')
    : (p.capResumo||p.capTitulo||'').substring(0,400);

  const schemas = {
    mea_grafico: '{"tipo":"grafico","titulo":"...","eixoX":"...","eixoY":"...","dados":[{"label":"...","valor":0}]}',
    mea_tabela:  '{"tipo":"tabela","titulo":"...","colunas":["..."],"linhas":[["...","..."]]}',
    mea_esquema: '{"tipo":"esquema","titulo":"...","nos":[{"id":"...","texto":"...","ligacoes":["..."]}]}',
  };
  const schema = schemas[action] || schemas.mea_esquema;

  const r = await callAI([{ role:'user', content:
    `Cria um ${tipo_mea} académico para o trabalho sobre "${tema}".
Conteúdo dos capítulos: ${resumo}
Responde APENAS com JSON neste formato exacto (sem markdown): ${schema}`
  }], { max_tokens:1000, temperature:0.5 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- SUPABASE: SAVE ---------------- */
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
      body:JSON.stringify({ user_id:p.user_id, tipo:p.tipo, tema:p.tema, pags:p.pags, metadata:p.metadata, created_at:new Date().toISOString() }),
    });
  } finally { clearTimeout(t); }
  return { saved:true };
}

/* ---------------- SUPABASE: GET ---------------- */
async function doGetHistory(p) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url||!key) return { rows:[] };
  const params = new URLSearchParams({ select:'*', user_id:`eq.${p.user_id||''}`, order:'created_at.desc', limit:String(Math.min(parseInt(p.limit)||20,100)) });
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), 10000);
  let rows = [];
  try {
    const r = await fetch(`${url}/rest/v1/academy_history?${params}`, { signal:ctrl.signal, headers:{ apikey:key, Authorization:`Bearer ${key}` } });
    rows = await r.json();
  } finally { clearTimeout(t); }
  return { rows: Array.isArray(rows)?rows:[] };
}

/* ---------------- OPENROUTER COM FALLBACK ---------------- */
async function callAI(messages, opts={}) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY não configurada');
  let lastErr = '';
  for (const model of MODELS) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), 85000);
      let resp;
      try {
        resp = await fetch(OR_URL, {
          method:'POST', signal:ctrl.signal,
          headers:{ 'Content-Type':'application/json','Authorization':`Bearer ${key}`,'HTTP-Referer':OR_SITE,'X-Title':OR_TITLE },
          body:JSON.stringify({ model, messages, temperature:opts.temperature??0.7, max_tokens:opts.max_tokens??800, stream:false }),
        });
      } finally { clearTimeout(t); }
      if (resp.status===429||resp.status===503) { lastErr=String(resp.status); continue; }
      if (!resp.ok) { lastErr=await resp.text().catch(()=>String(resp.status)); continue; }
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text && text.length>10) return text;
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
  throw new Error('JSON inválido na resposta');
}

/* ---------------- HELPER ---------------- */
function ok(action, data) {
  return { ok:true, action, data, meta:{ ts:Date.now(), provider:'openrouter' } };
}
