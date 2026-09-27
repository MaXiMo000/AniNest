// Push handlers, pulled into the generated service worker via
// workbox.importScripts (vite.config.js). The server sends
// {title, body, url} (backend/src/lib/push.js).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* show a generic alert */ }
  event.waitUntil(self.registration.showNotification(data.title || 'AniNest', {
    body: data.body || 'Something new is waiting for you.',
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: data.url || 'aninest',
    data: { url: data.url || '#/notifications' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '#/notifications', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(self.registration.scope));
    if (open) {
      await open.focus();
      return open.navigate(target);
    }
    return self.clients.openWindow(target);
  })());
});
