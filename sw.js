/* ═══════════════════════════════════════════════════════════════════
   ACADEMY ScOS — Service Worker v1.0
   Estratégia de cache:
     • Static assets (CDN, fonts) → Cache First
     • Main HTML                  → Stale While Revalidate
     • API calls (/api/*)         → Network Only  (dados sempre frescos)
     • Offline fallback           → Cache HTML + overlay
   ═══════════════════════════════════════════════════════════════════ */

const CACHE_NAME     = 'academy-v1';
const OFFLINE_URL    = '/';
const API_BASE       = '/api/';

/* Assets estáticos para pre-cache no install */
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  /* CDN assets — cached on first use via runtime strategy */
];

/* Hosts externos tratados como static (Cache First) */
const CACHE_FIRST_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

/* ── INSTALL: pre-cache assets críticos ─────────────────────────── */
self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(STATIC_ASSETS)
    ).then(() => self.skipWaiting())
  );
});

/* ── ACTIVATE: limpar caches antigos ────────────────────────────── */
self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ── FETCH: router de estratégias ───────────────────────────────── */
self.addEventListener('fetch', (evt) => {
  const { request } = evt;
  const url = new URL(request.url);

  /* 1. API calls — Network Only, sem cache (dados dinâmicos) */
  if (url.pathname.startsWith(API_BASE)) {
    evt.respondWith(networkOnly(request));
    return;
  }

  /* 2. CDN / fonts — Cache First (imutáveis por URL) */
  if (CACHE_FIRST_HOSTS.includes(url.hostname)) {
    evt.respondWith(cacheFirst(request));
    return;
  }

  /* 3. Main app HTML — Stale While Revalidate */
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    evt.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* 4. Ícones e assets locais — Cache First */
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/manifest')) {
    evt.respondWith(cacheFirst(request));
    return;
  }

  /* 5. Tudo o resto — Network com fallback para cache */
  evt.respondWith(networkWithCacheFallback(request));
});

/* ── ESTRATÉGIAS ────────────────────────────────────────────────── */

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null);

  return cached || (await fetchPromise) || offlineFallback();
}

async function networkOnly(request) {
  try {
    return await fetch(request);
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Sem ligação à internet. Verifica a tua rede.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

async function networkWithCacheFallback(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback();
  }
}

function offlineFallback() {
  return new Response(
    `<!DOCTYPE html>
    <html lang="pt">
    <head>
      <meta charset="UTF-8"/>
      <meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>ACADEMY — Offline</title>
      <style>
        body{background:#0C0E14;color:#F8FAFC;font-family:system-ui,sans-serif;
             display:flex;flex-direction:column;align-items:center;justify-content:center;
             min-height:100vh;gap:16px;text-align:center;padding:24px}
        .logo{font-size:48px;margin-bottom:8px}
        h1{font-size:22px;font-weight:700;color:#43E8A7}
        p{color:#64748B;font-size:14px;line-height:1.7;max-width:280px}
        button{background:#43E8A7;color:#0C0E14;border:none;padding:12px 28px;
               border-radius:8px;font-weight:700;font-size:14px;cursor:pointer;margin-top:8px}
      </style>
    </head>
    <body>
      <div class="logo">🎓</div>
      <h1>ACADEMY offline</h1>
      <p>Não há ligação à internet. Verifica a tua rede e tenta novamente.</p>
      <button onclick="location.reload()">↺ Tentar novamente</button>
    </body>
    </html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/* ── PUSH NOTIFICATIONS ─────────────────────────────────────────── */
self.addEventListener('push', (evt) => {
  let data = { title: 'ACADEMY', body: 'Nova notificação', icon: '/icons/icon-192.png' };
  try { data = { ...data, ...evt.data.json() }; } catch {}

  evt.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon  || '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      vibrate: [100, 50, 100],
      data:    { url: data.url || '/' },
      actions: data.actions || [],
      tag:     data.tag    || 'academy-notification',
      renotify: true,
    })
  );
});

self.addEventListener('notificationclick', (evt) => {
  evt.notification.close();
  const targetUrl = evt.notification.data?.url || '/';
  evt.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

/* ── BACKGROUND SYNC (para requests que falharam offline) ───────── */
self.addEventListener('sync', (evt) => {
  if (evt.tag === 'academy-sync') {
    evt.waitUntil(syncPendingRequests());
  }
});

async function syncPendingRequests() {
  /* Placeholder — implementar com IndexedDB quando necessário */
  console.log('[SW] Background sync triggered');
}

/* ── MESSAGE: skip waiting manual ──────────────────────────────── */
self.addEventListener('message', (evt) => {
  if (evt.data?.action === 'skipWaiting') self.skipWaiting();
});
