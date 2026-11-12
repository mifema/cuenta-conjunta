// ============================================================================
// SERVICE WORKER · PWA INSTALABLE + NOTIFICACIONES PUSH (ANDROID & iOS)
// ============================================================================

const CACHE_NAME = 'cuenta-conjunta-pwa-v4';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

// Necesario para que Chrome en Android habilite "Instalar aplicación" (PWA real)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

// Recepción de eventos Web Push
self.addEventListener('push', event => {
  let payload = {
    title: 'Cuenta Conjunta',
    body: 'Recordatorio: revisa tu aportación mensual a la cuenta conjunta.',
    url: '/'
  };

  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (e) {
      payload.body = event.data.text();
    }
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: payload.url || '/' }
    })
  );
});

// Mensajes desde la aplicación para lanzar notificaciones nativas del sistema
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body } = event.data;
    event.waitUntil(
      self.registration.showNotification(title || 'Cuenta Conjunta', {
        body: body || 'Revisa tus aportaciones del mes en Cuenta Conjunta.',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        data: { url: '/' }
      })
    );
  }
});

// Al tocar la notificación en Android o iPhone, abre la app
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
