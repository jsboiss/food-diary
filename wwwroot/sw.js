const cacheName = 'food-diary-shell-v5';
const shell = ['/', '/index.html', '/app.js', '/updates.js', '/uploads.js', '/icons.js', '/barcode.js', '/app.css', '/fonts.css', '/manifest.webmanifest', '/icon.svg'];
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)));
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !shell.includes(url.pathname)) { return; }
  event.respondWith(fetch(event.request, { cache: 'no-store' }).then((response) => {
    if (response.ok) { const clone = response.clone(); void caches.open(cacheName).then((cache) => cache.put(event.request, clone)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
