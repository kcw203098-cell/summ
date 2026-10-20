// 앱 화면만 캐시한다. Gemini·noembed 요청은 건드리지 않는다.
const CACHE = "ytnote-v1";
const SHELL = ["./", "index.html", "core.js", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  // 새 버전을 먼저 받고, 오프라인이면 캐시를 쓴다. 공유로 들어온 ?text= 주소는 index로 응답한다.
  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok && !u.search) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(u.search ? "./" : e.request, { ignoreSearch: true }).then((r) => r || caches.match("./")))
  );
});
