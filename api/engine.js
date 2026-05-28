// ================================================================
// PATCHES CRÍTICOS FINAIS — PRODUÇÃO ESTÁVEL
// Aplicar manualmente no engine actual
// ================================================================

// ================================================================
// 1. BODY VALIDATION (logo após JSON.parse)
// ================================================================

if (!body || typeof body !== 'object' || Array.isArray(body)) {
return res.status(400).json({
ok: false,
error: 'Body inválido',
});
}

// ================================================================
// 2. SAFE ERROR HANDLER (substituir catch principal)
// ================================================================

} catch (err) {

const msg =
err instanceof Error
? err.message
: String(err);

console.error("[engine] ${action} falhou:", msg);

return res.status(500).json({
ok: false,
error: msg,
});
}

// ================================================================
// 3. SAFE capSubs (generate_lesson)
// ================================================================

const subs = Array.isArray(capSubs)
? capSubs.map((s, i) => "${i + 1}. ${s}").join('\n')
: '';

// ================================================================
// 4. SAFE contextoAnterior (generate_lesson)
// ================================================================

const contextoSeguro =
typeof contextoAnterior === 'string'
? contextoAnterior.slice(0, 4000)
: '';

// ================================================================
// 5. SAFE OpenRouter RESPONSE CHECK
// adicionar logo após fetch()
// ================================================================

if (!resp || typeof resp.status !== 'number') {
throw new Error('Falha de conexão com OpenRouter');
}

// ================================================================
// 6. SAFE OpenRouter JSON PARSE
// substituir:
// const data = await resp.json();
// ================================================================

let data;

try {
data = await resp.json();
} catch {
throw new Error('Resposta inválida do OpenRouter');
}

// ================================================================
// 7. SAFE metadata LIMIT (save_history)
// ================================================================

const metadataSeguro =
JSON.stringify(metadata).length < 10000
? metadata
: {};

// substituir no body:

body: JSON.stringify({
user_id,
tipo,
tema,
pags,
qual,
metadata: metadataSeguro,
created_at: new Date().toISOString()
}),

// ================================================================
// 8. SAFE LEGACY SUBTOPICS
// gerar_capitulo + regenerar_capitulo
// ================================================================

const subs = Array.isArray(payload.capSubs)
? payload.capSubs.map((s, i) => "${i + 1}. ${s}").join('\n')
: '';

// ================================================================
// 9. VERCEL CONFIG
// criar vercel.json na raiz do projecto
// ================================================================

{
"functions": {
"api/engine.js": {
"maxDuration": 60
}
}
}

// ================================================================
// 10. FRONTEND RETRY
// requests.js
// ================================================================

async function requestWithRetry(url, options, retries = 1) {

try {

const res = await fetch(url, options);

if (!res.ok && retries > 0 && [429,500,502,503,504].includes(res.status)) {

  await new Promise(r => setTimeout(r, 1500));

  return requestWithRetry(url, options, retries - 1);
}

return res;

} catch (err) {

if (retries > 0) {

  await new Promise(r => setTimeout(r, 1500));

  return requestWithRetry(url, options, retries - 1);
}

throw err;

}
}

// ================================================================
// 11. PAYLOAD LIMIT
// generate_lesson
// ================================================================

if (prompt.length > 12000) {
throw new Error('Prompt demasiado grande');
}

// ================================================================
// 12. SAFE historico LIMIT
// actionChat
// ================================================================

const historicoValido = Array.isArray(historico)
? historico
.filter(m =>
m &&
typeof m.content === 'string' &&
m.content.trim()
)
.slice(-6)
: [];

// ================================================================
// 13. ENVIRONMENT VALIDATION
// topo do ficheiro
// ================================================================

const REQUIRED_ENVS = [
'OPENROUTER_API_KEY',
'SUPABASE_URL',
'SUPABASE_SERVICE_KEY',
];

for (const env of REQUIRED_ENVS) {

if (!process.env[env]) {

console.error(`[BOOT] ENV AUSENTE: ${env}`);

}
}

// ================================================================
// 14. REQUEST SIZE PROTECTION
// início do handler
// ================================================================

const size = JSON.stringify(req.body || {}).length;

if (size > 500000) {

return res.status(413).json({
ok: false,
error: 'Payload demasiado grande',
});
}

// ================================================================
// 15. SIMPLE RATE LIMIT
// anti spam básico
// ================================================================

const RATE_LIMIT = new Map();

function isRateLimited(ip) {

const now = Date.now();

const data = RATE_LIMIT.get(ip);

if (!data) {

RATE_LIMIT.set(ip, {
  count: 1,
  ts: now,
});

return false;

}

if (now - data.ts > 60000) {

RATE_LIMIT.set(ip, {
  count: 1,
  ts: now,
});

return false;

}

data.count++;

if (data.count > 30) {
return true;
}

return false;
}

// dentro do handler:

const ip =
req.headers['x-forwarded-for'] ||
req.socket?.remoteAddress ||
'unknown';

if (isRateLimited(ip)) {

return res.status(429).json({
ok: false,
error: 'Demasiadas requests',
});
}

// ================================================================
// RESULTADO FINAL
// ================================================================
//
// Depois destes patches:
//
// - o backend fica MUITO mais resiliente
// - elimina crashes silenciosos
// - reduz 500 inesperados
// - protege contra payload inválido
// - melhora estabilidade Vercel
// - protege OpenRouter
// - reduz risco de spam
// - melhora produção real SaaS
//
// O próximo passo já NÃO é mexer mais no engine.
// É:
// - testar carga
// - validar frontend
// - monitorar logs reais
// - medir latência
// - observar comportamento de utilizadores reais
//
