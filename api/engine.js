/* =======================================================================
   ACADEMY ENGINE - SAAS BLINDADO (PRODUÇÃO)
   v66: DOCUMENT AST — backend gera JSON estruturado
   O frontend deixa de inferir estrutura de texto
   - Perfis por nível: Ensino Médio / Licenciatura / Mestrado / Doutoramento
   - Perfis por área: Ciências / Humanidades / Gestão / Direito / Saúde / Engenharia
   - Citações autor-ano obrigatórias no corpo do texto
  - Dados verificáveis com fontes e anos
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
/* v67: pools expandidos — 20+ variantes por categoria
   Elimina repetições mecânicas detectadas na avaliação de qualidade */
const EXEMPLOS = [
  'A investigação académica demonstra que',
  'No contexto em análise,',
  'Num cenário concreto verificável,',
  'Os dados de campo indicam que',
  'A evidência empírica revela que',
  'Tomando como caso ilustrativo',
  'A evidência empírica mostra que',
  'Num contexto prático verificável,',
  'A análise do caso em estudo revela',
  'Os indicadores disponíveis mostram que',
  'O tema em análise ilustra bem',
  'Verificando os dados disponíveis,',
];
const HIPOTESES = [
  'A tese central deste trabalho é que',
  'A análise conduz à conclusão de que',
  'Os dados permitem inferir que',
  'A investigação aponta para o facto de que',
  'O exame crítico da literatura revela que',
  'A posição defendida neste estudo é que',
  'A leitura dos factos sugere que',
  'A evidência disponível indica que',
];
const CONCLUSOES = [
  'A análise evidencia, portanto, que',
  'Os dados apresentados confirmam que',
  'O exame crítico demonstra que',
  'A síntese dos argumentos aponta para',
  'O quadro analítico traçado revela que',
  'A investigação permite concluir que',
  'Os elementos reunidos sustentam que',
  'O percurso argumentativo culmina em',
];
const TRANSICOES = [
  'Aprofundando esta perspectiva,',
  'A análise revela ainda que',
  'Numa leitura mais crítica,',
  'Articulando com o argumento anterior,',
  'A dimensão analítica exige reconhecer que',
  'Complementando a perspectiva teórica,',
  'O debate académico evidencia que',
  'A revisão da literatura aponta que',
];
/* v67: Conectores proibidos — detectados como marcadores de texto IA */
const CONECTORES_PROIBIDOS = [
  'Cumpre referir que','Importa sublinhar que','Convém notar que',
  'Vale a pena salientar que','É relevante destacar que',
  'Neste sentido,','Neste quadro,','A este respeito,',
  'Do exposto decorre que','Perante o analisado,',
];

function antiIA(capNum, totalCaps, geoInstrucao) {
  const n = Math.max(0, (capNum||1) - 1);
  const pick = (arr, s) => arr[(n*7 + s*3) % arr.length];
  const fase = !totalCaps||totalCaps<=1 ? 'análise' :
    (n/(totalCaps-1))<=0.1 ? 'introdução' :
    (n/(totalCaps-1))<=0.35 ? 'fundamentação teórica' :
    (n/(totalCaps-1))<=0.65 ? 'análise crítica' :
    (n/(totalCaps-1))<=0.88 ? 'síntese' : 'conclusão';
  const proibidos = CONECTORES_PROIBIDOS.slice(0,4).join('", "');
  return `REGRAS DE ESTILO OBRIGATÓRIAS — APLICAR RIGOROSAMENTE:

TOM E VOZ:
1. Escreve com VOZ ANALÍTICA — não apenas descrever conceitos, mas comparar, questionar, posicionar
2. Cada subtópico deve incluir: (a) posição teórica, (b) contraponto ou limitação, (c) aplicação ao contexto do tema
3. PROIBIDO usar estes conectores mecânicos que revelam texto IA: "${proibidos}"
4. PROIBIDO iniciar dois parágrafos consecutivos com a mesma palavra ou estrutura
5. Para exemplos usa: "${pick(EXEMPLOS,1)}" — nunca a mesma expressão duas vezes no mesmo capítulo
6. Para hipótese/posição usa: "${pick(HIPOTESES,2)}"
7. Para concluir usa: "${pick(CONCLUSOES,3)}"
8. Para transições usa: "${pick(TRANSICOES,4)}"

CITAÇÕES — OBRIGATÓRIO:
9. Cada dado estatístico DEVE ter citação inline: (Autor, Ano) ou (Instituição, Ano)
10. Não escrever "segundo dados do INE" sem especificar o ano: "segundo INE (2023)"
11. Mínimo 2 citações por parágrafo de desenvolvimento — integradas no argumento, não no fim

CONTEXTO GEOGRÁFICO: ${geoInstrucao}

POSIÇÃO NO DOCUMENTO: ${fase} — adequa profundidade analítica`;
}

/* ---------------- PERFIS POR NÍVEL ---------------- */
const PERFIL_NIVEL = {
  'ensino médio': {
    profundidade: `Linguagem clara para estudantes 14-18 anos. Conceitos desde o básico. Para Ciências: fórmulas básicas com cada variável explicada. Exemplos reconhecíveis do contexto do tema. 3-4 parágrafos densos por subtópico.`,
    citacoes: `1-2 citações por subtópico formato (Apelido, Ano). Exemplo: "Segundo Cardoso (2019),..." ou "...processo fundamental (Lima & Santos, 2020)."`,
    refs_min: 8, refs_africanos: 2,
  },
  'licenciatura': {
    profundidade: `Nível universitário 1º ciclo. Rigor conceptual. Análise crítica: comparar perspectivas de pelo menos 2 autores. Dados estatísticos e factos verificáveis com anos e instituições (contexto do tema). 4-5 parágrafos densos por subtópico.`,
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
  - Fenómenos observáveis relevantes ao tema
- Referências: Nature, Science, African Journal of Science
- PROIBIDO: referências de ciências sociais ou gestão sem nexo científico`,
  },
  humanidades: {
    label: 'Humanidades e Ciências Sociais',
    instrucoes: `ÁREA Humanidades (História, Filosofia, Literatura, Sociologia, Comunicação):
  - Perspectiva histórica com datas e actores concretos do contexto
  - Factos históricos verificáveis com anos e fontes
  - Teorias sociais aplicadas ao contexto do tema
- Referências: revistas de ciências sociais, história africana, estudos lusófonos
- PROIBIDO: referências de engenharia ou saúde clínica`,
  },
  gestao: {
    label: 'Gestão e Economia',
    instrucoes: `ÁREA Gestão, Economia, Administração, Finanças, Marketing:
  - Indicadores económicos verificáveis com anos e fontes
  - Dados quantitativos com fontes e anos verificáveis
- Modelos de gestão: SWOT, Porter, Balanced Scorecard quando pertinente
  - Exemplos de empresas e sectores relevantes ao tema
  - Referências de revistas académicas reconhecidas na área
- PROIBIDO: referências de saúde, ciências naturais ou direito sem nexo`,
  },
  direito: {
    label: 'Direito e Ciências Jurídicas',
    instrucoes: `ÁREA Direito (Constitucional, Penal, Civil, Comercial, Administrativo):
  - Citar artigos de lei relevantes com número e ano
  - Ex: citar legislação relevante ao tema com artigo e ano
  - Legislação relevante ao tema
  - Jurisprudência aplicável ao tema
  - Referências jurídicas académicas reconhecidas
- PROIBIDO: referências de gestão, saúde ou engenharia sem nexo jurídico`,
  },
  saude: {
    label: 'Saúde e Ciências da Vida',
    instrucoes: `ÁREA Saúde (Medicina, Enfermagem, Farmácia, Saúde Pública, Nutrição):
- Dados epidemiológicos relevantes ao tema com fontes (OMS, estudos peer-reviewed)
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
  - Dados técnicos e infra-estruturas relevantes ao tema
  - Exemplos de empresas e sectores relevantes ao tema
  - IEEE, ASME, revistas de engenharia internacionais reconhecidas
- PROIBIDO: referências de humanidades ou direito sem nexo tecnológico`,
  },
};

/* ---------------- ABORDAGENS ESTRUTURAIS (rotação) ---------------- */
const ABORDAGENS = [
  `Abordagem histórico-evolutiva: começa pela origem/evolução do conceito, analisa o estado actual com datas e factos concretos do contexto do tema.`,
  `Abordagem analítico-crítica: apresenta o conceito, confronta perspectivas divergentes de 2+ autores, conclui com posição fundamentada.`,
  `Abordagem empírico-descritiva: apresenta dados quantitativos verificáveis (percentagens, anos, instituições), interpreta as implicações.`,
  `Abordagem comparativa: compara o contexto do tema com outros contextos relevantes, identifica semelhanças e especificidades locais.`,
  `Abordagem prospectiva: analisa o estado actual, identifica desafios estruturais, propõe recomendações concretas.`,
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

/* v68: Detectar se o tema tem contexto geográfico explícito.
   Se tem → usar esse contexto.
   Se não tem → contexto global, sem forçar Angola. */
function detectarContextoGeo(tema, pais) {
  const t = (tema||'').toLowerCase();
  const p = (pais||'').toLowerCase();

  /* País/região explicitamente no tema */
  if (/angola|luanda|benguela|huambo|cabinda|namibe|malanje/.test(t)) return 'angola';
  if (/cabo.?verde|mindelo|praia|fogo|sal\b|barlavento/.test(t)) return 'cabo_verde';
  if (/moçambique|mozambique|maputo|beira\b|nampula/.test(t)) return 'mocambique';
  if (/brasil|são paulo|rio de janeiro|brasília|nordeste/.test(t)) return 'brasil';
  if (/portugal|lisboa|porto\b|coimbra|algarve/.test(t)) return 'portugal';
  if (/africa do sul|joanesburgo|cape town|pretória/.test(t)) return 'africa_sul';
  if (/estados unidos|eua|usa|new york|washington|california/.test(t)) return 'eua';
  if (/europa|ue\b|união europeia|berlim|paris|madrid|roma\b/.test(t)) return 'europa';
  if (/china|beijing|xangai|asia\b|japão|índia/.test(t)) return 'asia';
  if (/africa\b|africano|subsaariana|continente africano/.test(t)) return 'africa_geral';

  /* País nas configurações do utilizador */
  if (p && p !== 'angola') return p;
  if (p === 'angola') return 'angola';

  /* Sem contexto geográfico → global */
  return 'global';
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


/* ================================================================
   AST REPAIR ENGINE — v72
   Recebe AST parcial/inválido e devolve AST válido garantido.
   Nunca falha. Nunca retorna texto livre.
================================================================ */
function repararAST(raw, capNum, capTit, subs) {
  /* Tentar extrair o que existe */
  let ast = null;
  if (raw && typeof raw === 'object') {
    ast = raw;
  } else if (typeof raw === 'string') {
    try { ast = JSON.parse(raw.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim()); }
    catch (_) { ast = null; }
    if (!ast) {
      /* Tentar extrair JSON parcial */
      const m = raw.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (m) try { ast = JSON.parse(m[1]); } catch (_) {}
    }
  }

  /* Schema mínimo garantido */
  const base = {
    chapter_id : String(capNum),
    title      : capTit || `Capítulo ${capNum}`,
    status     : 'generated',
    generated_at: new Date().toISOString(),
    generated_by: 'academy-engine-v72',
    version    : 1,
    sections   : [],
  };

  if (!ast) {
    /* Fallback total — criar estrutura vazia com subtópicos */
    const secsDefault = (Array.isArray(subs) && subs.length > 0 ? subs : [
      'Contextualização', 'Desenvolvimento', 'Análise Crítica'
    ]).map((s, i) => ({
      section_id  : `${capNum}.${i+1}`,
      title       : s,
      status      : 'empty',
      paragraphs  : [],
    }));
    return { ...base, sections: secsDefault, _repaired: true, _repair_reason: 'no_json' };
  }

  /* Reparar campos em falta */
  ast.chapter_id  = ast.chapter_id  || base.chapter_id;
  ast.title       = ast.title       || base.title;
  ast.status      = ast.status      || 'generated';
  ast.generated_at= ast.generated_at|| base.generated_at;
  ast.generated_by= ast.generated_by|| base.generated_by;
  ast.version     = ast.version     || 1;

  /* Reparar sections */
  if (!Array.isArray(ast.sections) || ast.sections.length === 0) {
    ast.sections = base.sections;
    ast._repaired = true;
    ast._repair_reason = 'missing_sections';
  } else {
    ast.sections = ast.sections.map((sec, i) => {
      /* Garantir section_id */
      if (!sec.section_id) sec.section_id = `${capNum}.${i+1}`;
      /* Garantir title */
      if (!sec.title) sec.title = subs?.[i] || `${capNum}.${i+1}`;
      /* Garantir paragraphs como array */
      if (!Array.isArray(sec.paragraphs)) {
        /* Tentar extrair de content string */
        if (typeof sec.content === 'string' && sec.content.trim()) {
          sec.paragraphs = sec.content.split('\n\n')
            .map(p => p.trim()).filter(p => p.length > 20);
        } else {
          sec.paragraphs = [];
        }
        ast._repaired = true;
        ast._repair_reason = 'paragraphs_repaired';
      }
      /* Remover parágrafos vazios */
      sec.paragraphs = sec.paragraphs
        .map(p => typeof p === 'string' ? p.trim() : '')
        .filter(p => p.length > 15);
      return sec;
    });
  }

  return ast;
}

/* Validar AST após reparação */
function validarAST(ast) {
  if (!ast || !ast.sections || !Array.isArray(ast.sections)) return false;
  if (ast.sections.length === 0) return false;
  /* Pelo menos 1 secção com conteúdo */
  return ast.sections.some(s =>
    Array.isArray(s.paragraphs) && s.paragraphs.length >= 1
  );
}

/* ================================================================
   DOCUMENT HEALTH ENGINE — v72
   Mede integridade documental. Separado do Academic Score.
   Responde: "Este documento tem o mínimo para ser válido?"
================================================================ */
function calcularDocumentHealth(ast, nivel) {
  const issues = [];
  let score = 100;

  /* 1. Secções vazias */
  const secsVazias = ast.sections?.filter(
    s => !s.paragraphs || s.paragraphs.length === 0
  ) || [];
  if (secsVazias.length > 0) {
    score -= secsVazias.length * 15;
    issues.push({
      severity : 'error',
      code     : 'EMPTY_SECTIONS',
      message  : `${secsVazias.length} subtópico(s) sem conteúdo`,
      sections : secsVazias.map(s => s.section_id),
    });
  }

  /* 2. Parágrafos curtos demais */
  const parasMinimos = { 'ensino médio': 60, 'licenciatura': 80, 'mestrado': 100, 'doutoramento': 120 };
  const minChars = parasMinimos[nivel] || 80;
  let parasCurtos = 0;
  (ast.sections || []).forEach(s =>
    (s.paragraphs || []).forEach(p => { if ((p||'').length < minChars) parasCurtos++; })
  );
  if (parasCurtos > 2) {
    score -= Math.min(20, parasCurtos * 4);
    issues.push({
      severity : 'warning',
      code     : 'SHORT_PARAGRAPHS',
      message  : `${parasCurtos} parágrafos abaixo do mínimo para ${nivel}`,
    });
  }

  /* 3. AST reparado (indica falha na geração) */
  if (ast._repaired) {
    score -= 10;
    issues.push({
      severity : 'warning',
      code     : 'AST_REPAIRED',
      message  : `Estrutura reconstruída automaticamente (razão: ${ast._repair_reason})`,
    });
  }

  score = Math.max(0, score);
  return {
    health  : score,
    issues,
    label   : score >= 85 ? 'Saudável' : score >= 60 ? 'Aceitável' : 'Necessita revisão',
  };
}

/* ================================================================
   READINESS SCORE — v72
   Responde UMA pergunta: "Posso entregar este capítulo ao professor?"
   Binário com justificação.
================================================================ */
function calcularReadiness(ast, nivel, geoCtx) {
  const blockers = [];
  const warnings = [];

  /* Bloqueadores — não pronto */
  if (!validarAST(ast)) {
    blockers.push('Capítulo sem conteúdo gerado');
  }

  const totalParas = (ast.sections || []).reduce(
    (acc, s) => acc + (s.paragraphs || []).length, 0
  );
  const minParas = { 'ensino médio': 6, 'licenciatura': 9, 'mestrado': 12, 'doutoramento': 15 };
  if (totalParas < (minParas[nivel] || 6)) {
    blockers.push(`Parágrafos insuficientes: ${totalParas} (mínimo: ${minParas[nivel] || 6})`);
  }

  /* Avisos — pronto mas com ressalvas */
  if (ast._repaired) {
    warnings.push('Estrutura foi reconstruída automaticamente');
  }
  if (geoCtx === 'global' && ast._angola_count > 10) {
    warnings.push('Texto contém referências geográficas inesperadas');
  }

  const ready = blockers.length === 0;
  return {
    ready,
    verdict : ready ? 'Pronto para entrega' : 'Não recomendado para entrega',
    blockers,
    warnings,
  };
}


/* ================================================================
   CONFIDENCE SCORE — v73
   Mede não apenas QUALIDADE mas FIABILIDADE do processo.
   Dois documentos com health=94 podem ter origens muito diferentes.
   Confidence expõe isso.
================================================================ */
function calcularConfidence(ast, meta) {
  /* meta: { retry_count, ast_repaired, repair_reason, generation_time_ms } */
  let score = 100;
  const factores = [];

  /* AST reparado = menos confiança na estrutura */
  if (ast._repaired || meta.ast_repaired) {
    const penalty = meta.repair_reason === 'no_json' ? 25 : 12;
    score -= penalty;
    factores.push({ factor: 'ast_repaired', impact: -penalty, reason: meta.repair_reason });
  }

  /* Retries = o modelo precisou de mais tentativas */
  if (meta.retry_count > 0) {
    const penalty = meta.retry_count * 8;
    score -= Math.min(penalty, 20);
    factores.push({ factor: 'retries', count: meta.retry_count, impact: -Math.min(penalty, 20) });
  }

  /* Secções vazias depois de reparação = baixa confiança no conteúdo */
  const secsVazias = (ast.sections || []).filter(
    s => !s.paragraphs || s.paragraphs.length === 0
  ).length;
  if (secsVazias > 0) {
    score -= secsVazias * 10;
    factores.push({ factor: 'empty_sections', count: secsVazias, impact: -secsVazias * 10 });
  }

  /* Poucos parágrafos = conteúdo raso */
  const totalParas = (ast.sections || []).reduce(
    (acc, s) => acc + (s.paragraphs || []).length, 0
  );
  if (totalParas < 6) {
    score -= 15;
    factores.push({ factor: 'low_paragraph_count', count: totalParas, impact: -15 });
  }

  /* Tempo de geração anormalmente alto = possível timeout/retry silencioso */
  if (meta.generation_time_ms > 60000) {
    score -= 5;
    factores.push({ factor: 'slow_generation', ms: meta.generation_time_ms, impact: -5 });
  }

  score = Math.max(0, score);
  return {
    confidence : score,
    label      : score >= 85 ? 'Alta' : score >= 65 ? 'Média' : 'Baixa',
    factores,
  };
}

/* ================================================================
   TELEMETRIA — v73
   Regista métricas por geração para análise futura.
   Guarda no Supabase se disponível; loga sempre no console.
================================================================ */
async function registarTelemetria(payload) {
  const record = {
    ts               : new Date().toISOString(),
    tema             : payload.tema,
    nivel            : payload.nivel,
    area             : payload.area,
    tipo             : payload.tipo,
    cap_num          : payload.cap_num,
    ast_generated    : payload.ast_generated,
    ast_repaired     : payload.ast_repaired     || false,
    repair_reason    : payload.repair_reason    || null,
    retry_count      : payload.retry_count      || 0,
    health           : payload.health           || null,
    confidence       : payload.confidence       || null,
    ready            : payload.ready            || false,
    generation_time_ms: payload.generation_time_ms || 0,
    pages_requested  : payload.pages_requested  || null,
    word_count       : payload.word_count       || 0,
    model_used       : payload.model_used       || 'unknown',
  };

  /* Log estruturado — sempre */
  console.log('[TELEMETRIA v73]', JSON.stringify(record));

  /* Supabase — se configurado */
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(`${url}/rest/v1/academy_ai_logs`, {
      method  : 'POST',
      signal  : ctrl.signal,
      headers : {
        'Content-Type'  : 'application/json',
        'apikey'        : key,
        'Authorization' : `Bearer ${key}`,
        'Prefer'        : 'return=minimal',
      },
      body: JSON.stringify(record),
    });
  } catch (_) { /* telemetria nunca bloqueia */ }
  finally { clearTimeout(t); }
}


/* ================================================================
   COMPLETENESS SCORE — v74
   Mede profundidade e cobertura, não apenas integridade.
   Responde: "O documento está superficial ou denso?"
================================================================ */
function calcularCompleteness(ast, palavrasAlvo, totalCaps, nivelKey) {
  const dimensoes = {};

  /* 1. Cobertura de páginas — palavras reais vs alvo */
  const totalPalavras = (ast.sections || []).reduce(
    (acc, s) => acc + (s.paragraphs || []).join(' ').split(/\s+/).filter(Boolean).length, 0
  );
  const paginasGeradas = totalPalavras / 370;
  const coberturaRatio = Math.min(1, totalPalavras / Math.max(palavrasAlvo, 1));
  dimensoes.paginas = Math.round(coberturaRatio * 100);

  /* 2. Densidade de conteúdo — parágrafos por secção */
  const secCounts = (ast.sections || []).map(s => (s.paragraphs || []).length);
  const minPorSec = { 'ensino médio': 3, 'licenciatura': 4, 'mestrado': 5, 'doutoramento': 6 };
  const min = minPorSec[nivelKey] || 4;
  const densidadeRatio = secCounts.length > 0
    ? secCounts.reduce((a, n) => a + Math.min(1, n / min), 0) / secCounts.length
    : 0;
  dimensoes.densidade = Math.round(densidadeRatio * 100);

  /* 3. Cobertura de subtópicos — todos gerados vs esperados */
  const secsComConteudo = (ast.sections || []).filter(s => (s.paragraphs || []).length > 0).length;
  const totalSecs = Math.max((ast.sections || []).length, 1);
  dimensoes.cobertura = Math.round((secsComConteudo / totalSecs) * 100);

  /* 4. Profundidade — tamanho médio dos parágrafos */
  const todasParas = (ast.sections || []).flatMap(s => s.paragraphs || []);
  const charsMedios = todasParas.length > 0
    ? todasParas.reduce((a, p) => a + (p || '').length, 0) / todasParas.length
    : 0;
  const charMin = { 'ensino médio': 200, 'licenciatura': 300, 'mestrado': 400, 'doutoramento': 500 };
  dimensoes.profundidade = Math.min(100, Math.round((charsMedios / (charMin[nivelKey] || 300)) * 100));

  /* Score final ponderado */
  const score = Math.round(
    dimensoes.paginas    * 0.35 +
    dimensoes.densidade  * 0.25 +
    dimensoes.cobertura  * 0.25 +
    dimensoes.profundidade * 0.15
  );

  return {
    completeness : score,
    label        : score >= 85 ? 'Completo' : score >= 65 ? 'Parcial' : 'Superficial',
    dimensoes,
    palavras     : _totalWords(ast),
    paginas_est  : Math.round(_totalWords(ast) / 370 * 10) / 10,
  };
}

function _totalWords(ast) {
  return (ast.sections || []).reduce(
    (acc, s) => acc + (s.paragraphs || []).join(' ').split(/\s+/).filter(Boolean).length, 0
  );
}

/* ================================================================
   ISSUE ACTIONS — v74
   Cada issue tem uma acção correctiva sugerida.
   O frontend pode executá-la automaticamente.
================================================================ */
const ISSUE_ACTIONS = {
  EMPTY_SECTIONS     : { label: 'Regenerar secções vazias',   acao: 'regenerar_capitulo',  auto: true  },
  SHORT_PARAGRAPHS   : { label: 'Enriquecer capítulo',        acao: 'editar_texto',         auto: true  },
  AST_REPAIRED       : { label: 'Regenerar capítulo',          acao: 'regenerar_capitulo',  auto: false },
  NO_REFERENCES      : { label: 'Gerar referências',           acao: 'gerar_capitulo_referencias', auto: true },
  NO_CONCLUSION      : { label: 'Gerar conclusão',             acao: 'gerar_capitulo',       auto: false },
  NO_INTRODUCTION    : { label: 'Gerar introdução',            acao: 'gerar_capitulo',       auto: false },
  LOW_PARAGRAPH_COUNT: { label: 'Expandir conteúdo',          acao: 'editar_texto',         auto: true  },
};

function enriquecerIssuesComAccoes(issues) {
  return (issues || []).map(issue => ({
    ...issue,
    action: ISSUE_ACTIONS[issue.code] || null,
  }));
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
    { role:'system', content:`Assistente académico ACADEMY. Português formal. Contexto: "${p.tema||''}" (${p.tipoTrabalho||''}). Máx 200 palavras.` },
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
  const _startTime = Date.now(); /* v73: para telemetria */
  let retryCount = 0;            /* v73: contar retries reais */

  /* v71: Cálculo de palavras exacto
     Páginas fixas: capa(1) + contracapa(1) + TOC(1) = 3
     Deixa margem para pré/pós-textuais opcionais
     Limite max aumentado para 4000 para documentos grandes */
  const PAGINAS_FIXAS = 3; /* capa + TOC + contracapa */
  const PALAVRAS_POR_PAGINA = 370;
  const paginasConteudo = Math.max(totalPags - PAGINAS_FIXAS, 1);
  const palavrasCalc = Math.round((paginasConteudo * PALAVRAS_POR_PAGINA) / totalCaps);
  const palavras = Math.min(Math.max(parseInt(p.palavrasPorCap)||palavrasCalc, 200), 4000);

  /* Perfis v68: contexto geográfico dinâmico */
  const nivelKey  = detectarNivel(nivel);
  const areaKey   = detectarArea(tema, p.area);
  const pNivel    = PERFIL_NIVEL[nivelKey];
  const pArea     = PERFIL_AREA[areaKey];
  const geoCtx    = detectarContextoGeo(tema, p.pais);
  const isAngola  = geoCtx === 'angola';
  const isCabVerde= geoCtx === 'cabo_verde';
  const isGlobal  = geoCtx === 'global';

  /* Subtópicos */
  const subs = capSubs.map((s,i) => `${capNum}.${i+1} ${s}`).join('\n') ||
    `${capNum}.1 Contextualização\n${capNum}.2 Desenvolvimento\n${capNum}.3 Análise crítica`;

  /* Abordagem estrutural rotativa */
  const abordagem = ABORDAGENS[(capNum-1) % ABORDAGENS.length];

  /* v71: tokens proporcionais — sem corte artificial */
  const maxTok = Math.min(Math.max(Math.round(palavras*1.8), 600), 12000);

  /* v67: abordagem analítica por posição do capítulo */
  /* v68: instrução geográfica dinâmica */
  let geoInstrucao;
  if(isAngola){
    /* Tema menciona Angola explicitamente */
    geoInstrucao = 'O tema refere-se especificamente a Angola. Quando relevante, usa dados angolanos com fonte e ano.';
  } else if(isCabVerde){
    geoInstrucao = 'O tema refere-se a Cabo Verde. Usa referências cabo-verdianas quando relevante.';
  } else {
    /* PADRÃO UNIVERSAL — não forçar nenhum país */
    geoInstrucao = 'Trata o tema de forma universal e académica. NÃO faças referência a Angola, Brasil, Portugal ou qualquer país específico a não ser que o tema o exija explicitamente. Usa fontes académicas internacionais.';
  }

    const abordagemAnalitica = [
    `Abordagem histórico-crítica: traça a evolução do conceito com datas concretas, questiona a narrativa dominante, propõe leitura alternativa fundamentada.`,
    `Abordagem teórico-comparativa: confronta pelo menos 2 perspectivas teóricas divergentes, posiciona o argumento, aplica ao contexto do tema com dados específicos.`,
    `Abordagem empírico-analítica: parte de dados quantitativos verificáveis, analisa causas e efeitos, não se limita a descrever — interpreta e questiona.`,
    `Abordagem crítico-reflexiva: identifica contradições ou tensões no tema, examina limitações das abordagens existentes, propõe síntese fundamentada.`,
    `Abordagem prospectiva-propositiva: analisa o estado actual com rigor, identifica lacunas e desafios estruturais, formula recomendações concretas.`,
  ][(capNum-1) % 5];

  const prompt = `És um professor universitário especialista em ${pArea.label} a escrever o Capítulo ${capNum} de um ${tipo} de nível ${nivel} sobre "${tema}".

CAPÍTULO: ${capNum}. ${capTit}

SUBTÓPICOS OBRIGATÓRIOS (usa esta numeração exacta, cada um em linha própria):
${subs}

ABORDAGEM ANALÍTICA OBRIGATÓRIA:
${abordagemAnalitica}

ESTRUTURA DE CADA SUBTÓPICO (nesta ordem exacta):
1. Contextualização teórica com pelo menos 1 citação (Autor, Ano)
2. Desenvolvimento analítico — confrontar perspectivas, não apenas descrever
3. Dado quantitativo verificável com fonte e ano (ex: "Segundo [Fonte], em [Ano], X registou Y"), 2023)"
4. Análise crítica do dado — o que significa para o tema?
5. Síntese argumentativa — qual é a posição do autor?

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
- Português formal académico
- ⚠ LIMITE: ${palavras} PALAVRAS — PÁRA ao atingir este limite
${p.instrucaoSubtitulos ? '\n' + p.instrucaoSubtitulos : ''}
${antiIA(capNum, totalCaps, geoInstrucao)}

Escreve o capítulo completo agora.`;

  /* v66-r2: Tentativa 1 — prompt AST completo */
  const promptAST = prompt + `

FORMATO DE SAÍDA OBRIGATÓRIO — JSON:
Não escrevas texto livre. Responde APENAS com este JSON (sem markdown, sem \`\`\`):
{
  "chapter_id": "${capNum}",
  "title": "${capTit}",
  "sections": [
    {
      "section_id": "${capNum}.1",
      "title": "Título do subtópico",
      "paragraphs": [
        "Texto do parágrafo 1.",
        "Texto do parágrafo 2.",
        "Texto do parágrafo 3."
      ]
    }
  ]
}
Cada secção corresponde a um subtópico listado acima.
Cada parágrafo é uma string completa sem formatação.
Mínimo 3 parágrafos por secção.`;

  /* ── v72: AST GUARANTEED ──────────────────────────────────────────
     Nunca retorna texto puro. Sempre retorna AST válido.
     Ordem: Tentativa 1 → Tentativa 2 → AST Repair Engine
  ─────────────────────────────────────────────────────────────── */

  /* Tentativa 1 — prompt AST completo */
  let r = await callAI([{ role:'user', content:promptAST }], { max_tokens:maxTok, temperature:0.65 });
  let astRaw = null;
  try { astRaw = extrairJSON(r); } catch (_) {}

  /* Tentativa 2 — prompt simplificado se AST inválido */
  if (!validarAST(astRaw)) {
    console.warn(`[AST v73] T1 falhou — retry simplificado — cap ${capNum}`);
    retryCount++;
    const promptSimples = `Escreve capítulo ${capNum} "${capTit}" sobre "${tema}".
Subtópicos: ${subs}
JSON APENAS, sem markdown:
{"chapter_id":"${capNum}","title":"${capTit}","sections":[{"section_id":"${capNum}.1","title":"Primeiro subtópico","paragraphs":["Parágrafo 1.","Parágrafo 2.","Parágrafo 3."]}]}
Português formal. Mínimo 3 parágrafos/secção.`;
    r = await callAI([{ role:'user', content:promptSimples }], { max_tokens:maxTok, temperature:0.5 });
    try { astRaw = extrairJSON(r); } catch (_) {}
  }

  /* AST Repair Engine — garante AST válido mesmo se ambas as tentativas falharem */
  const ast = repararAST(astRaw || r, capNum, capTit, capSubs);
  if (ast._repaired) {
    console.warn(`[AST v72] Reparado — cap ${capNum} — razão: ${ast._repair_reason}`);
  }

  /* Document Health + Readiness */
  const health   = calcularDocumentHealth(ast, nivelKey);
  const readiness = calcularReadiness(ast, nivelKey, geoCtx);

  /* v73: Rastreabilidade completa */
  ast.version      = (ast.version || 0) + 1;
  ast.generated_by = 'academy-engine-v73';
  ast.generated_at = new Date().toISOString();
  ast.retry_count  = retryCount;

  /* v73: Confidence Score */
  const confidence = calcularConfidence(ast, {
    retry_count       : retryCount,
    ast_repaired      : ast._repaired || false,
    repair_reason     : ast._repair_reason || null,
    generation_time_ms: Date.now() - _startTime,
  });

  /* v73: Telemetria assíncrona — não bloqueia a resposta */
  const totalWords = (ast.sections || []).reduce(
    (acc, s) => acc + (s.paragraphs || []).join(' ').split(/\s+/).length, 0
  );
  registarTelemetria({
    tema               : tema,
    nivel              : nivel,
    area               : areaKey,
    tipo               : tipo,
    cap_num            : capNum,
    ast_generated      : true,
    ast_repaired       : ast._repaired || false,
    repair_reason      : ast._repair_reason || null,
    retry_count        : retryCount,
    health             : health.health,
    confidence         : confidence.confidence,
    ready              : readiness.ready,
    generation_time_ms : Date.now() - _startTime,
    pages_requested    : totalPags,
    word_count         : totalWords,
    model_used         : 'openrouter/auto',
  }); /* fire-and-forget */

  /* v74: Completeness Score */
  const completeness = calcularCompleteness(
    ast, palavras * (capSubs.length || 3), totalCaps, nivelKey
  );

  /* v74: Enriquecer issues com acções */
  health.issues   = enriquecerIssuesComAccoes(health.issues);

  /* v74: first_pass_success na telemetria */
  const firstPassSuccess = retryCount === 0 && !ast._repaired;
  registarTelemetria({
    tema, nivel, area: areaKey, tipo, cap_num: capNum,
    ast_generated      : true,
    ast_repaired       : ast._repaired || false,
    repair_reason      : ast._repair_reason || null,
    retry_count        : retryCount,
    first_pass_success : firstPassSuccess,
    health             : health.health,
    confidence         : confidence.confidence,
    completeness       : completeness.completeness,
    ready              : readiness.ready,
    generation_time_ms : Date.now() - _startTime,
    pages_requested    : totalPags,
    word_count         : completeness.palavras,
    model_used         : 'openrouter/auto',
  });

  return {
    resposta    : ast,
    ast         : true,
    health,
    readiness,
    confidence,
    completeness,
    _guaranteed : true,
  };
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
  const geoCtxR  = detectarContextoGeo(tema, p.pais);
  const geoRefsInstrucao = geoCtxR === 'angola'
    ? `O tema é sobre Angola. Inclui fontes relevantes combinadas com literatura internacional.`
    : `As referências devem ser de revistas académicas internacionais. Evita fontes específicas de qualquer país a menos que o tema o exija.`;
  return { resposta: await callAI([{ role:'user', content:prompt }], { max_tokens:2500, temperature:0.4 }) };
}

/* ---------------- PLANO ACADÉMICO ---------------- */
async function doPlano(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const r = await callAI([{ role:'user', content:
    `Cria um plano académico para um ${p.tipoTrabalho||'TFC'} de nível "${p.nivel||''}" sobre "${tema}".
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
    `Estrutura capítulos para um ${p.tipoTrabalho||'TFC'} de nível "${p.nivel||''}" sobre "${tema}". ${pags} páginas.
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
    melhorar:   'Melhora o estilo académico mantendo o conteúdo. Português formal académico.',
    expandir:   'Expande com mais detalhe académico (+30%). Português formal académico.',
    resumir:    'Resume mantendo as ideias principais (-40%). Português formal académico.',
    formalizar: 'Formaliza a linguagem para nível universitário.',
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
