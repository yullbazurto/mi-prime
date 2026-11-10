// Service worker básico: guarda la app para abrirla sin conexión.
// Si cambias archivos y quieres forzar la actualización, sube el número de CACHE.
const CACHE = 'mi-prime-v2';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'firebase-config.js',
  'manifest.json', 'icon.svg',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Estrategia: responde con lo guardado al instante y lo actualiza en segundo plano.
// Solo toca archivos propios y el SDK de Firebase (gstatic). Los datos de
// Firestore y el login nunca pasan por aquí.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const own = url.origin === self.location.origin;
  const sdk = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!own && !sdk) return;

  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req, { ignoreSearch: own });
      const network = fetch(req)
        .then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        })
        .catch(async () => cached || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
      return cached || network;
    })
  );
});
