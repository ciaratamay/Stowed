// Network-first for app files so updates show up; cache fallback when offline.
const CACHE = 'stowed-v6';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];

self.addEventListener('install', (e) => {
  // cache: 'reload' so a new version never picks up stale files from the browser's HTTP cache.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const isImage = /\.(png|jpg|jpeg|svg|webp|ico)$/i.test(new URL(req.url).pathname);
  if (isImage) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
    return;
  }
  // 'no-cache' revalidates with the server each time, so uploads show up on the next open.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('index.html')))
  );
});
