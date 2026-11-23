/**
 * STOCKA WMS — Service Worker (PWA + Web Push Notifications)
 * Estrategia deliberadamente ligera (Network-Only con fallback offline):
 * - NO cachea HTML, JS, CSS ni llamadas API de Supabase para mantener siempre
 *   la última versión desplegada en wms.stocka.cl sin conflictos de caché.
 * - Maneja notificaciones Web Push en segundo plano y deep-linking vía StockaRouter.
 */

const SW_VERSION = 'stocka-pwa-v1.0.0';
const OFFLINE_CACHE = `stocka-offline-${SW_VERSION}`;
const OFFLINE_ASSETS = [
  '/offline.html',
  '/img/pwa/icon-192.png',
  '/img/pwa/badge-96.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(OFFLINE_CACHE)
      .then((cache) => cache.addAll(OFFLINE_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('stocka-') && key !== OFFLINE_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// Solo fallback offline en navegaciones de documentos HTML; todo lo demás va directo a red.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (event.request.mode !== 'navigate') return;

  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(OFFLINE_CACHE);
      const offlinePage = await cache.match('/offline.html');
      return offlinePage || new Response('Sin conexión a internet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })
  );
});

function sanitizeSameOriginUrl(rawUrl) {
  try {
    const resolved = new URL(rawUrl || '/panel', self.location.origin);
    if (resolved.origin !== self.location.origin) {
      return self.location.origin + '/panel';
    }
    return resolved.href;
  } catch (_) {
    return self.location.origin + '/panel';
  }
}

// Recepción de Web Push (incluso con la app / navegador cerrado)
self.addEventListener('push', (event) => {
  let payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_) {
      try {
        payload = { title: 'STOCKA WMS', body: event.data.text() };
      } catch (__) {
        payload = {};
      }
    }
  }

  const title = payload.title || 'STOCKA WMS';
  const body = payload.body || 'Tienes una nueva actualización en tu portal STOCKA WMS.';
  const targetUrl = sanitizeSameOriginUrl(payload.url || (payload.data && payload.data.url) || '/panel');
  const tag = payload.tag || `stocka-${payload.category || 'general'}-${Date.now()}`;

  const notificationOptions = {
    body,
    icon: payload.icon || '/img/pwa/icon-192.png',
    badge: payload.badge || '/img/pwa/badge-96.png',
    tag,
    renotify: Boolean(payload.renotify),
    requireInteraction: Boolean(payload.requireInteraction),
    timestamp: payload.timestamp || Date.now(),
    vibrate: [120, 60, 120],
    data: {
      url: targetUrl,
      category: payload.category || 'general',
      meta: payload.meta || null
    }
  };

  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    notificationOptions.actions = payload.actions.slice(0, 2);
  }

  if (payload.image) {
    notificationOptions.image = payload.image;
  }

  event.waitUntil((async () => {
    await self.registration.showNotification(title, notificationOptions);

    // Notificar a pestañas abiertas para refrescar campanita/badges en vivo
    try {
      const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      windowClients.forEach((client) => {
        try {
          client.postMessage({
            type: 'STOCKA_PUSH_RECEIVED',
            payload: { title, body, url: targetUrl, category: payload.category || 'general' }
          });
        } catch (_) {}
      });
    } catch (_) {}
  })());
});

// Al hacer clic en una notificación nativa
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawUrl = (event.notification.data && event.notification.data.url) || '/panel';
  const targetUrl = sanitizeSameOriginUrl(rawUrl);
  const targetPath = new URL(targetUrl).pathname;
  const isTargetAdmin = targetPath.startsWith('/admin') || targetPath.startsWith('/conteo');

  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    });

    // Buscar una ventana abierta del mismo portal (/admin o /panel)
    let matchingClient = null;
    for (const client of windowClients) {
      try {
        const clientUrl = new URL(client.url);
        if (clientUrl.origin !== self.location.origin) continue;
        const isClientAdmin = clientUrl.pathname.startsWith('/admin') || clientUrl.pathname.startsWith('/conteo');
        if (isClientAdmin === isTargetAdmin) {
          matchingClient = client;
          break;
        }
      } catch (_) {}
    }

    if (matchingClient) {
      try {
        await matchingClient.focus();
      } catch (_) {}

      // Avisar al router SPA y/o navegar si cambia la ruta
      try {
        matchingClient.postMessage({
          type: 'STOCKA_PUSH_NAVIGATE',
          url: targetUrl,
          pathname: targetPath
        });
      } catch (_) {}

      try {
        if ('navigate' in matchingClient && matchingClient.url !== targetUrl) {
          await matchingClient.navigate(targetUrl);
        }
      } catch (_) {}
      return;
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});

// Mensajes desde la app (ej. forzar activación inmediata)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Si el navegador rota la suscripción push, avisar a las ventanas abiertas para resincronizar con Supabase
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    const windowClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    windowClients.forEach((client) => {
      try {
        client.postMessage({ type: 'STOCKA_PUSH_RESUBSCRIBE' });
      } catch (_) {}
    });
  })());
});
