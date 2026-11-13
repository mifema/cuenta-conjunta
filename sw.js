// ============================================================================
// SERVICE WORKER · PWA INSTALABLE + NOTIFICACIONES PUSH (ANDROID & iOS)
// ============================================================================

const CACHE_NAME = 'cuenta-conjunta-pwa-v5';

self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Siempre red primero sin caché antigua para que en iOS se vean los cambios al instante
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request))
  );
});

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
