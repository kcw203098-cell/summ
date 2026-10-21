// 서비스 워커: ① 앱 화면 캐시 ② 백그라운드 요약 ③ 완료 알림
importScripts("core.js");
const Core = self.Core;

const CACHE = "ytnote-v13";
const SHELL = ["./", "index.html", "core.js", "app.js", "manifest.webmanifest", "icon-192.png", "icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return; // API 요청은 건드리지 않는다
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((r) => {
      if (r.ok && !u.search) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(u.search ? "./" : e.request, { ignoreSearch: true }).then((r) => r || caches.match("./")))
  );
});

// ───────────── 백그라운드 요약 ─────────────
const running = new Map(); // id -> { ctrl, md, title }

async function windows() {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}
async function broadcast(msg) {
  const cs = await windows();
  cs.forEach((c) => c.postMessage(msg));
  return cs;
}
const anyVisible = (cs) => cs.some((c) => c.visibilityState === "visible");

async function notify(job, title, body, id) {
  if (!job.notify || !self.registration.showNotification) return;
  if (typeof Notification !== "undefined" && Notification.permission !== "granted") return;
  try {
    await self.registration.showNotification(title, {
      body, tag: "ytnote-" + (id || "x"), icon: "icon-192.png", badge: "icon-192.png", data: { id },
    });
  } catch (e) {}
}

async function runJob(job) {
  if (running.has(job.id)) return;
  const ctrl = new AbortController();
  const r = { ctrl, md: "", title: "" };
  running.set(job.id, r);
  let last = 0;
  try {
    const res = await Core.runSummary({
      id: job.id, apiKey: job.apiKey, model: job.model, fast: job.fast, signal: ctrl.signal,
      onProgress: ({ meta, url, acc }) => {
        r.title = meta.title || "";
        r.md = Core.buildMarkdown(meta, url, acc);
        const now = Date.now();
        if (now - last > 300 || !acc) { last = now; broadcast({ type: "progress", id: job.id, md: r.md, title: r.title }); }
      },
      onModel: (model) => broadcast({ type: "model", model }),
      onFastRejected: () => broadcast({ type: "fastOff" }),
      onRetry: (info) => broadcast(Object.assign({ type: "retry", id: job.id }, info)),
      skip: job.skip,
      onExhausted: (model) => broadcast({ type: "exhausted", model }),
    });
    const entry = { id: job.id, title: res.meta.title || job.id, md: res.md, ts: Date.now(), model: res.model };
    await Core.idb.put("inbox", entry); // 화면이 꺼져 있어도 다음에 열 때 가져간다
    const cs = await broadcast({ type: "done", id: job.id, entry });
    if (!anyVisible(cs)) await notify(job, "요약 완료", entry.title, job.id);
  } catch (e) {
    const msg = Core.friendly(e);
    const cs = await broadcast({ type: "error", id: job.id, message: msg, aborted: e.name === "AbortError" });
    if (e.name !== "AbortError" && !anyVisible(cs)) await notify(job, "요약 실패", msg.slice(0, 120), job.id);
  } finally {
    running.delete(job.id);
  }
}

self.addEventListener("message", (e) => {
  const m = e.data || {};
  if (m.type === "summarize" && m.job) {
    // waitUntil: 화면이 백그라운드로 가도 작업이 끝날 때까지 서비스 워커를 살려 둔다
    e.waitUntil(runJob(m.job));
  } else if (m.type === "cancel") {
    const r = running.get(m.id);
    if (r) r.ctrl.abort();
  } else if (m.type === "status") {
    const list = [...running].map(([id, r]) => ({ id, md: r.md, title: r.title }));
    if (e.source) e.source.postMessage({ type: "status", running: list });
  }
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil((async () => {
    const cs = await windows();
    for (const c of cs) {
      if ("focus" in c) {
        await c.focus();
        if (id) c.postMessage({ type: "open", id });
        return;
      }
    }
    await self.clients.openWindow("./" + (id ? "?open=" + id : ""));
  })());
});
