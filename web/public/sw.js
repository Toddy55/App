// Offline support: cache the app shell, and serve map tiles from cache when there's no signal.
const SHELL = 'fc-shell-v1';
const TILES = 'fc-tiles-v2';
const PHOTOS = 'fc-photos-v1';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['./', './index.html', './manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, TILES, PHOTOS].includes(k)).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const isTile = url.hostname === 'server.arcgisonline.com' || (url.hostname === 'spatial-img.information.qld.gov.au' && url.pathname.includes('/tile/'));
  if (isTile) {
    // cache-first for satellite tiles
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin === location.origin && url.pathname.includes('/bg/')) {
    // Home photos never change: keep them on the phone so Home opens instantly with no signal
    e.respondWith(
      caches.open(PHOTOS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) c.put(e.request, res.clone());
        return res;
      }),
    );
    return;
  }
  if (url.origin === location.origin) {
    // network-first for the app itself, falling back to cache
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
    );
  }
});

// Tapping a notification opens the app on the right screen
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data && e.notification.data.url;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => 'focus' in c);
      if (open) return open.focus().then((c) => (url && c && 'navigate' in c ? c.navigate(url) : c));
      return self.clients.openWindow(url || './');
    }),
  );
});
