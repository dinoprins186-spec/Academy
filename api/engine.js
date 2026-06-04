/* =======================================================================
   ACADEMY — /api/engine (Proxy no projecto academy-a)
   
   Este ficheiro resolve o CORS quando o frontend está em academy-a.vercel.app
   e o engine real está em academyscosao.vercel.app.
   
   Deploy: colocar em api/engine.js no projecto academy-a no Vercel.
   O proxy recebe o pedido do browser (mesmo domínio = sem CORS)
   e reencaminha para o engine real no servidor (servidor-a-servidor = sem CORS).
======================================================================= */

const ENGINE_URL = 'https://academyscosao.vercel.app/api/engine';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin' : '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  /* Preflight OPTIONS */
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Método não permitido' });
  }

  try {
    /* Reencaminhar para o engine real */
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 88000);

    let upstream;
    try {
      upstream = await fetch(ENGINE_URL, {
        method : 'POST',
        signal : ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body   : typeof req.body === 'string'
                   ? req.body
                   : JSON.stringify(req.body),
      });
    } finally {
      clearTimeout(tid);
    }

    const data = await upstream.json();
    return res.status(upstream.status).json(data);

  } catch (err) {
    return res.status(502).json({
      ok    : false,
      error : 'Proxy error: ' + err.message,
      action: 'unknown',
      data  : {},
      meta  : { ts: Date.now() },
    });
  }
}
