/* =======================================================================
   ACADEMY ENGINE - SAAS BLINDADO (PRODUÇÃO)
   Base: versão funcional original
   v60: + CORS + todas as acções do frontend + anti-IA + limite de palavras
======================================================================= */

/* ---------------- OPENROUTER ---------------- */
const OR_URL   = 'https://openrouter.ai/api/v1/chat/completions';
const OR_SITE  = 'https://academyscosao.vercel.app';
const OR_TITLE = 'ACADEMY';

const MODELS = [
  'openai/gpt-4o-mini',
  'meta-llama/llama-3.1-8b-instruct',
  'anthropic/claude-3.5-sonnet',
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

/* ---------------- ANTI-IA: POOLS DE VARIAÇÃO ---------------- */
const EXEMPLOS = [
  'A título de exemplo,','Por exemplo,','Como caso concreto,',
  'Ilustrando este ponto,','Num cenário prático,','Observa-se, por exemplo,',
  'Em contexto angolano,','Tomando como referência,','De forma ilustrativa,',
  'Como se verifica na prática,',
];
const HIPOTESES = [
  'A hipótese central deste estudo sustenta que',
  'Parte-se do pressuposto de que',
  'Este trabalho assume como ponto de partida que',
  'A investigação sugere que','Admite-se, neste contexto, que',
  'O presente trabalho defende que',
];
const CONCLUSOES = [
  'Em síntese,','Em suma,','Em conclusão,','Concluindo,',
  'Desta forma,','Face ao exposto,','Perante o analisado,','Assim sendo,',
];

function antiIA(capNum, totalCaps) {
  const n = Math.max(0, (capNum||1) - 1);
  const ex  = EXEMPLOS[n % EXEMPLOS.length];
  const hip = HIPOTESES[n % HIPOTESES.length];
  const con = CONCLUSOES[(n+2) % CONCLUSOES.length];
  const pos = totalCaps > 1 ? (n/(totalCaps-1)) : 0;
  const fase = pos<=0.1?'introdução':pos<=0.35?'fundamentação teórica':
               pos<=0.65?'análise':pos<=0.88?'síntese':'conclusão';
  return `
REGRAS DE ESTILO OBRIGATÓRIAS:
1. Usa EXCLUSIVAMENTE "${ex}" para exemplos — NUNCA "A título de exemplo:"
2. Para hipótese/pressuposto usa: "${hip}"
3. Para concluir parágrafos usa: "${con}" ou variante natural
4. PROIBIDO bullets, listas, asteriscos ou markdown
5. PROIBIDO repetir a mesma estrutura em parágrafos consecutivos
6. Texto deve soar como académico angolano experiente
7. Posição no documento: ${fase} — adequa o tom e profundidade
8. Inclui pelo menos 1 análise causa-efeito por subtópico
9. Integra contexto angolano/africano sempre que pertinente`;
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
        return res.json({ ok:true, action:'ping', data:{ pong:true, ts:Date.now() } });

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
  const totalCaps= parseInt(p.totalCaps)||parseInt(p.totalPags)||4;
  const capSubs  = (Array.isArray(p.capSubs)?p.capSubs:[]).slice(0,8).map(s=>String(s).substring(0,150));
  const palavras = Math.min(Math.max(parseInt(p.palavrasPorCap)||400, 150), 2000);

  if (!tema || !capTit) throw new Error('tema e capTitulo obrigatórios');

  const ex = EXEMPLOS[(capNum-1) % EXEMPLOS.length];
  const subs = capSubs.map((s,i) => `${capNum}.${i+1} ${s}`).join('\n') ||
               `${capNum}.1 Contextualização\n${capNum}.2 Desenvolvimento\n${capNum}.3 Análise crítica`;

  const maxTok = Math.min(Math.max(Math.round(palavras*1.7), 400), 8000);

  const prompt = `És um professor universitário angolano.
Escreve o capítulo ${capNum}. ${capTit} para um ${tipo} de nível ${nivel} sobre "${tema}".

SUBTÓPICOS (usa esta numeração exacta):
${subs}

ESTRUTURA POR SUBTÓPICO:
1. Título numerado em linha própria
2. Contextualização (60-80 palavras)
3. Desenvolvimento teórico (2-3 parágrafos, 60-80 palavras cada)
4. Exemplo com "${ex}" (mín. 60 palavras, contexto angolano)
5. Síntese (40-60 palavras)

FORMATAÇÃO OBRIGATÓRIA:
- Título do capítulo: "${capNum}. ${capTit}" — NÃO escrevas "Capítulo ${capNum} —"
- Cada subtítulo (${capNum}.1, ${capNum}.2, etc.) em LINHA PRÓPRIA com UMA LINHA EM BRANCO ANTES e DEPOIS
- Os parágrafos de cada subtópico ficam DEPOIS do subtítulo, separados por linha em branco
- NUNCA coloques o subtítulo e o texto na mesma linha
- Sem bullets, sem markdown
- Português formal angolano
- ⚠ LIMITE: ${palavras} PALAVRAS — PÁRA ao atingir este limite
${p.instrucaoSubtitulos ? '\n' + p.instrucaoSubtitulos : ''}
${antiIA(capNum, totalCaps)}`;

  const r = await callAI([{ role:'user', content:prompt }], { max_tokens: maxTok, temperature:0.65 });
  /* Remover "Capítulo N —" gerado pelo modelo */
  const limpo = r.replace(/^cap[íi]tulo\s+\d+\s*[—\-–][^\n]*\n?/gim, '').replace(/\n{3,}/g,'\n\n').trim();
  return { resposta: truncar(limpo, Math.round(palavras*1.1)) };
}

/* ---------------- REFERÊNCIAS ---------------- */
async function doReferencias(p) {
  const tema = (p.tema||'').substring(0,300);
  const tipo = (p.tipoTrabalho||'Trabalho Académico').substring(0,100);
  const area = (p.areaDetectada||tema).substring(0,80);

  const prompt = `Escreve as Referências Bibliográficas para um ${tipo} sobre "${tema}".
REGRAS ABSOLUTAS:
- Mínimo 10, máximo 12 referências
- Formato APA 7ª edição estrito
- Pelo menos 3 autores africanos ou angolanos
- Pelo menos 2 publicações recentes (2018-2024)
- Ordenadas alfabeticamente pelo apelido
- Sem numeração, sem bullets — uma referência por parágrafo, linha em branco entre cada
- Todas reais ou altamente verossímeis para a área "${area}"
Escreve APENAS as referências, sem título nem introdução.`;

  return { resposta: await callAI([{ role:'user', content:prompt }], { max_tokens:2000, temperature:0.4 }) };
}

/* ---------------- PLANO ACADÉMICO ---------------- */
async function doPlano(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const prompt = `Cria um plano académico para um ${p.tipoTrabalho||'Trabalho Académico'} de nível "${p.nivel||''}" sobre "${tema}".
Responde APENAS com JSON válido, sem markdown:
{"objetivo":"...","hipotese":"...","problema":"...","metodologia":"..."}`;
  const r = await callAI([{ role:'user', content:prompt }], { max_tokens:500, temperature:0.4 });
  return { resposta: extrairJSON(r) };
}

/* ---------------- ESTRUTURA ACADÉMICA ---------------- */
async function doEstrutura(p) {
  const tema = (p.tema||'').substring(0,300);
  if (!tema) throw new Error('tema obrigatório');
  const pags = Math.min(Math.max(parseInt(p.totalPags)||15, 5), 100);
  const prompt = `Estrutura capítulos para um ${p.tipoTrabalho||'TFC'} de nível "${p.nivel||''}" sobre "${tema}". ${pags} páginas.
${p.objetivo?'Objectivo: '+p.objetivo:''}
Responde APENAS com array JSON, sem markdown:
[{"num":1,"titulo":"...","subs":["Subtópico 1.1","Subtópico 1.2","Subtópico 1.3"]},...]
Regras: 3-6 capítulos, 2-4 subtópicos cada, último capítulo "Referências Bibliográficas" sem subs.`;
  const r = await callAI([{ role:'user', content:prompt }], { max_tokens:1000, temperature:0.4 });
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
  throw new Error('JSON inválido na resposta do modelo');
}

/* ---------------- HELPERS ---------------- */
function ok(action, data) {
  return { ok:true, action, data, meta:{ ts:Date.now(), provider:'openrouter' } };
}
