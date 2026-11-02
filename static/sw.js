/* 只做两件事：让站点/写稿台能「装到桌面」，断网时还能打开看过的东西。
   策略：字体和图标缓存优先（基本不变），页面与脚本网络优先（永远拿最新的，免得改了看不见）。 */
const CACHE = 'epistle-v2';
const PRECACHE = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/fonts/zhiduan-qingchang.woff2'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 静态资源的 URL 带 ?v=<构建时间戳>，每次部署都是一个新地址：
   按 pathname 存、查缓存时忽略查询串，否则缓存只增不减、而且永远命中不了 */
function assetKey(url) {
  return new Request(url.origin + url.pathname);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (/\.(woff2|png|svg|ico|webp|avif)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
        if (!res.ok) return res;                       /* 404 之类别写进缓存 */
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(assetKey(url), copy));
        return res;
      }))
    );
    return;
  }

  /* 页面：网络优先，顺手留一份，断网时还能打开看过的信 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || new Response('离线了，联网之后再试。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      })))
    );
    return;
  }

  e.respondWith(
    fetch(req).catch(() => caches.match(req).then((hit) => hit || Response.error()))
  );
});
