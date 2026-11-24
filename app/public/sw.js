// Service worker: makes the app installable and usable offline.
// App shell = stale-while-revalidate (instant load, updates in background).
// Data (api/*, Google Sheet) is never cached here — the app keeps its own copy.
const VERSION = 'v1';
const CACHE = 'trip-shell-' + VERSION;
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'sheet-import.js', 'config.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('trip-shell-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // Google Sheet etc. go straight to network
  if (url.pathname.includes('/api/')) return;                          // server data: always live

  const isPage = req.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(isPage ? 'index.html' : req, { ignoreSearch: true });
    const network = fetch(req).then(res => {
      if (res.ok && res.type === 'basic') cache.put(isPage ? 'index.html' : req, res.clone());
      return res;
    }).catch(() => cached);
    return cached || network;
  }));
});
