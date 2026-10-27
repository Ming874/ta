// 聖心醫院 Service Worker(只在正式版註冊,見 src/main.js installPWA)
// - 靜態資源(JS/CSS/貼圖/音效/模型/字型/wasm…)cache-first;快取名帶版本號(主程式檔名雜湊),改版時整批換新
// - HTML(導覽請求)network-first:有網路就拿最新版,離線時用快取
// - WebSocket、/api、Range 請求(串流)、跨來源請求一律不經過快取
const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = 'hz-' + VERSION;
const SCOPE = new URL(self.registration.scope).pathname;
const STATIC = /\.(?:m?js|css|png|jpe?g|webp|avif|gif|svg|ico|ktx2|basis|glb|gltf|bin|hdr|exr|mp3|ogg|opus|wav|m4a|flac|webm|mp4|json|wasm|woff2?|ttf|otf|webmanifest)$/i;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll([SCOPE, SCOPE + 'manifest.webmanifest', SCOPE + 'icons/icon-192.png']).catch(() => {});
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('hz-') && k !== CACHE) await caches.delete(k);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'clear') e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('hz-')).map((k) => caches.delete(k)))));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname.slice(SCOPE.length - 1);
  if (path.startsWith('/ws') || path.startsWith('/api') || req.headers.has('range')) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(e)); return; }
  if (STATIC.test(url.pathname) && !url.pathname.endsWith('/sw.js')) e.respondWith(cacheFirst(req));
});

async function networkFirst(e) {
  const c = await caches.open(CACHE);
  try {
    const res = (await e.preloadResponse) || (await fetch(e.request));
    if (res && res.ok) c.put(e.request, res.clone()).catch(() => {});
    return res;
  } catch {
    return (await c.match(e.request, { ignoreSearch: true })) || (await c.match(SCOPE)) || Response.error();
  }
}

async function cacheFirst(req) {
  const c = await caches.open(CACHE);
  const hit = await c.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.status === 200 && res.type === 'basic') c.put(req, res.clone()).catch(() => {});
  return res;
}
