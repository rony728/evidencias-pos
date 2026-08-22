const CACHE_NAME = 'evidencias-pos-v8';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/db.js',
  './js/images.js',
  './js/backup.js',
  './js/ui.js',
  './js/config.js',
  './js/api.js',
  './js/sync.js',
  './icons/icon.svg'
];
const STATIC_URLS = new Set(APP_SHELL.map((path) => new URL(path, self.location.href).href));

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);
  const isStaticRequest = STATIC_URLS.has(requestUrl.href) || event.request.mode === 'navigate';
  // Las respuestas del API nunca se cachean: solo se conserva la aplicación estática.
  if (event.request.method !== 'GET' || requestUrl.origin !== self.location.origin || !isStaticRequest) return;

  event.respondWith(fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    return event.request.mode === 'navigate' ? caches.match('./index.html') : Response.error();
  }));
});
