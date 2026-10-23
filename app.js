/* YT 요약노트 – 화면 동작 */
(() => {
  const C = window.Core;
  const $ = (s) => document.querySelector(s);
  const SKEY = "ytnote.settings", HKEY = "ytnote.history", CKEY = "ytnote.lastClip";
  const DEFAULTS = {
    apiKey: "", model: "gemini-flash-latest", fast: true, low: false, split: false, autoPick: true, autoClip: true, notify: true,
    vault: "", folder: "YouTube 요약",
    ttsModel: "gemini-3.8-flash-tts", voice: "Kore", rate: 1,
  };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let settings = Object.assign({}, DEFAULTS, store.get(SKEY, {}));
  const saveSettings = () => store.set(SKEY, settings);
  let history = store.get(HKEY, []);
  const XKEY = "ytnote.exhausted";
  if (store.get("ytnote.ver", "") !== C.VERSION) { try { localStorage.removeItem(XKEY); } catch {} store.set("ytnote.ver", C.VERSION); }
  function exhaustedNow() {
    const all = store.get(XKEY, {}), now = Date.now(), out = [];
    for (const k in all) if (all[k] > now) out.push(k);
    return out;
  }
  function markExhausted(model) {
    const all = store.get(XKEY, {}), now = Date.now();
    for (const k in all) if (all[k] <= now) delete all[k];
    try { all[model] = C.resetAt(); } catch { all[model] = now + 6 * 3600e3; }
    store.set(XKEY, all);
  }

  let viewId = null;           // 지금 화면에 보이는 영상
  let current = null;          // 화면에 보이는 "완료된" 요약 {id,title,md}
  const jobs = new Map();      // 진행 중인 요약 id -> {md,title}
  let localCtrl = null;        // 서비스 워커가 없을 때 화면에서 직접 요약

  const el = {
    url: $("#url"), go: $("#go"), paste: $("#paste"), stop: $("#stop"),
    status: $("#status"), out: $("#out"), empty: $("#empty"),
    bar: $("#bar"), cpMd: $("#cpMd"), cpTxt: $("#cpTxt"), share: $("#share"), obs: $("#obs"),
    play: $("#ttsPlay"), playIcon: $("#ttsIcon"), playLabel: $("#ttsLabel"), prog: $("#ttsProg"),
    rate: $("#ttsRate"), prev: $("#ttsPrev"), next: $("#ttsNext"),
    hist: $("#hist"), histCount: $("#histCount"),
    dlg: $("#settings"), openSet: $("#openSet"),
    sKey: $("#sKey"), sModel: $("#sModel"), sFast: $("#sFast"), sLow: $("#sLow"), sSplit: $("#sSplit"), sPick: $("#sPick"), sTheme: $("#sTheme"), sAuto: $("#sAuto"), sNotify: $("#sNotify"),
    sVoice: $("#sVoice"), sTts: $("#sTts"), sVault: $("#sVault"), sFolder: $("#sFolder"),
    sSave: $("#sSave"), sClose: $("#sClose"), toast: $("#toast"),
  };

  // ───────────── 상태 표시 ─────────────
  function setStatus(text, kind) {
    el.status.textContent = text || "";
    el.status.dataset.kind = kind || "";
  }
  let toastT;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.toast.hidden = true), 2200);
  }
  function refreshBar() {
    const done = !!current && current.id === viewId;
    [el.cpMd, el.cpTxt, el.share, el.obs].forEach((b) => (b.disabled = !done));
    el.bar.hidden = !(done || player.entry);
    el.stop.hidden = !jobs.has(viewId);
    updatePlayerUI();
  }
  const short = (t) => (t && t.length > 26 ? t.slice(0, 26) + "…" : t || "");
  function jobsNote() {
    const others = [...jobs.keys()].filter((k) => k !== viewId).length;
    return others ? ` · 다른 요약 ${others}개 진행 중` : "";
  }

  // ───────────── 화면에 그리기 ─────────────
  function render(md, done) {
    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.innerHTML = C.mdToHtml(md);
    el.out.classList.toggle("streaming", !done);
    markSection();
  }
  function showWaiting(text) {
    const tb = document.getElementById("timing"); if (tb) tb.hidden = true;
    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.classList.remove("streaming");
    el.out.innerHTML = `<p class="wait">${C.escapeHtml(text)}</p>`;
  }
  function showError(text) {
    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.classList.remove("streaming");
    el.out.innerHTML = `<p class="err">${C.escapeHtml(text)}</p>`;
  }
  function showEntry(e, quiet) {
    viewId = e.id;
    current = e;
    showTiming(e.timing);
    render(e.md, true);
    el.url.value = `https://youtu.be/${e.id}`;
    if (!quiet) setStatus(`저장된 요약${e.model ? " · " + e.model : ""} · ${short(e.title)}${jobsNote()}`, "ok");
    refreshBar();
  }

  // ───────────── 기록 ─────────────
  function saveHistory(e) {
    recordPerf(e);
    const rr = runFromEntry(e); if (rr && !e.recorded) { recordRun(Object.assign({ t: e.ts || Date.now() }, rr)); }
    history = [e].concat(history.filter((h) => h.id !== e.id)).slice(0, 40);
    store.set(HKEY, history);
    renderHistory();
  }
  function renderHistory() {
    el.histCount.textContent = history.length;
    el.hist.innerHTML = "";
    // 날짜별 번호: 그날 먼저 요약한 것이 1번 (목록은 최신순이라 위쪽 번호가 더 크다)
    const dayOf = (h) => new Date(h.ts).toLocaleDateString("ko-KR");
    const nums = new Map(), seen = {};
    [...history].sort((a, b) => a.ts - b.ts).forEach((h) => { const d = dayOf(h); seen[d] = (seen[d] || 0) + 1; nums.set(h.id, seen[d]); });
    for (const h of history) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="hn"></span><span class="ht"></span><span class="hd"></span>`;
      b.querySelector(".hn").textContent = nums.get(h.id) + ".";
      b.querySelector(".ht").textContent = h.title;
      b.querySelector(".hd").textContent = new Date(h.ts).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
      b.addEventListener("click", () => { stopFollow(); showEntry(h); window.scrollTo({ top: 0, behavior: "smooth" }); });
      li.appendChild(b);
      el.hist.appendChild(li);
    }
  }
  // 서비스 워커가 화면이 꺼져 있을 때 끝낸 요약을 가져온다
  async function importInbox() {
    let items = [];
    try { items = (await C.idb.all("inbox")) || []; } catch { return; }
    for (const e of items.sort((a, b) => a.ts - b.ts)) {
      saveHistory(e);
      jobs.delete(e.id);
      try { await C.idb.del("inbox", e.id); } catch {}
    }
  }

  // ───────────── 서비스 워커 연동 ─────────────
  const SW = "serviceWorker" in navigator ? navigator.serviceWorker : null;
  const swCtrl = () => SW && SW.controller;

  // ───────────── 어떤 요약을 보여 줄지 ─────────────
  // 요청한 순서를 저장해 두고, 화면은 "가장 먼저 요청한 것"을 따라간다.
  // - 아직 요약 중이면 그 요약 진행 화면, 끝났으면 그 요약 내용을 보여 준다
  // - 앱을 나갔다 오거나 다시 열어도 같은 규칙을 쓴다
  // - 목록에서 직접 고르면 따라가기를 멈춘다
  const RQKEY = "ytnote.reqs";
  const getReqs = () => store.get(RQKEY, []).filter((r) => Date.now() - r.ts < 6 * 3600 * 1000).sort((a, b) => a.ts - b.ts);
  const setReqs = (a) => store.set(RQKEY, a);
  const addReq = (id) => setReqs(getReqs().filter((r) => r.id !== id).concat([{ id, ts: Date.now() }]));
  const dropReq = (id) => setReqs(getReqs().filter((r) => r.id !== id));
  const stopFollow = () => setReqs([]);

  function presentDone(entry, fromBg) {
    showEntry(entry, true);
    showTiming(entry.timing);
    if (entry.partial) toast(`${entry.partial}개 구간은 요약하지 못했습니다. 문서에 표시했습니다.`);
    setStatus("완료" + (entry.model ? " · " + entry.model : "") + (entry.ms ? " · " + C.fmtMs(entry.ms) : "") + (fromBg ? " · 앱 밖에 있는 동안 요약이 끝났습니다." : " · 아래 버튼으로 복사하거나 들으세요.") + jobsNote(), "ok");
  }

  // 반환: 화면에 보여 주거나 따라가기로 한 영상 id (없으면 null)
  // prune=false: 서비스 워커 상태를 아직 모르는 요청은 지우지 않고 건너뛴다 (앱을 막 열었을 때)
  function focusFirst(opts) {
    const prune = !opts || opts.prune !== false, bg = !!(opts && opts.bg);
    for (const r of getReqs()) {
      const h = history.find((x) => x.id === r.id && x.ts >= r.ts - 2000);
      if (h) { stopFollow(); presentDone(h, bg); return h.id; }
      if (jobs.has(r.id)) {
        if (viewId !== r.id || current) {
          viewId = r.id; current = null;
          el.url.value = `https://www.youtube.com/watch?v=${r.id}`;
          const j = jobs.get(r.id);
          if (j.md) render(j.md, false); else showWaiting("영상을 분석하고 있습니다. 앱을 나가도 계속 요약하고, 끝나면 알림으로 알려 줍니다.");
          setStatus("요약 중" + (j.title ? " · " + short(j.title) : "") + jobsNote(), "live");
          refreshBar();
        }
        return r.id;
      }
      if (prune) dropReq(r.id);   // 끝난 기록도 진행 중인 작업도 없다 → 실패했거나 사라진 요청
    }
    return null;
  }

  function onDone(id, entry) {
    jobs.delete(id);
    saveHistory(entry);
    C.idb.del("inbox", id).catch(() => {});
    const shown = focusFirst();
    if (shown === id) { refreshBar(); return; }
    if (shown) { toast(`요약 완료 · ${short(entry.title)}`); refreshBar(); return; }   // 더 먼저 요청한 요약이 아직 진행 중
    if (viewId === id) presentDone(entry, false);
    else { toast(`요약 완료 · ${short(entry.title)}`); refreshBar(); }
  }
  function onError(id, message, aborted, extra) {
    if (!aborted && extra && extra.att) recordRun({ ok: 0, tot: extra.totalMs, att: extra.att, pick: pickCompact(extra.pick), why: String(message).split("\n")[0].slice(0, 80) });
    jobs.delete(id);
    dropReq(id);
    if (viewId === id) {
      const next = aborted ? null : focusFirst();   // 다른 요청이 남아 있으면 그쪽을 따라가고 실패는 알림으로만
      if (next) toast("요약 실패 · " + message.slice(0, 40));
      else { showError(message); setStatus(aborted ? "멈춤" : "실패", "err"); }
    } else if (!aborted) toast("요약 실패 · " + message.slice(0, 40));
    refreshBar();
  }

  if (SW) {
    SW.addEventListener("message", (ev) => {
      const m = ev.data || {};
      if (m.type === "progress") {
        jobs.set(m.id, { md: m.md, title: m.title });
        if (viewId === m.id) {
          if (current && current.id === m.id) current = null;
          render(m.md, false);
          setStatus(`요약 중${m.title ? " · " + short(m.title) : ""}${jobsNote()}`, "live");
          refreshBar();
        }
      } else if (m.type === "done") onDone(m.id, m.entry);
      else if (m.type === "error") onError(m.id, m.message, m.aborted, { att: m.att, pick: m.pick, totalMs: m.totalMs });
      else if (m.type === "model") { settings.model = m.model; saveSettings(); }
      else if (m.type === "retry") { if (viewId === m.id) showRetry(m); }
      else if (m.type === "log") addLog(m.id, m.line);
      else if (m.type === "lowOff") { settings.low = false; saveSettings(); toast("이 모델이 저해상도 옵션을 받지 않아 껐습니다"); }
      else if (m.type === "exhausted") markExhausted(m.model);
      else if (m.type === "busy") markBusy(m.model);
      else if (m.type === "pick") recordPick(m.pick);
      else if (m.type === "fastOff") { settings.fast = false; saveSettings(); toast("이 모델이 빠른 모드를 받지 않아 빠른 모드를 껐습니다"); }
      else if (m.type === "open") {
        importInbox().then(() => { const h = history.find((x) => x.id === m.id); if (h) { stopFollow(); showEntry(h); } });
      } else if (m.type === "status") {
        for (const r of m.running || []) jobs.set(r.id, { md: r.md, title: r.title });
        // 서비스 워커가 백그라운드에서 꺼져 작업이 사라졌으면 한 번 자동으로 다시 시작한다
        const alive = new Set((m.running || []).map((r) => r.id));
        for (const id of [...jobs.keys()]) {
          if (alive.has(id) || localCtrl || resumed.has(id) || Date.now() - (started.get(id) || 0) < 15000 || history.some((h) => h.id === id)) continue;
          resumed.add(id); jobs.delete(id);
          toast("백그라운드에서 요약이 끊겨 다시 시작합니다");
          summarize(id, true);
        }
        const followed = focusFirst({ prune: true, bg: true });
        if (!followed && !viewId && m.running && m.running.length) {
          const r = m.running[0];
          viewId = r.id;
          if (r.md) render(r.md, false); else showWaiting("영상을 분석하고 있습니다.");
          setStatus("요약 중" + (r.title ? " · " + short(r.title) : "") + jobsNote(), "live");
        }
        refreshBar();
      }
    });
  }

  // 모델 상태: 최근 과부하(10분) · 최근 성공 기록(속도)
  const BKEY = "ytnote.busy", PKEY = "ytnote.perf", KKEY = "ytnote.pick", GKEY = "ytnote.ping";
  const busyNow = () => { const o = store.get(BKEY, {}), now = Date.now(); return Object.keys(o).filter((k) => o[k] > now); };
  function markBusy(model) { const o = store.get(BKEY, {}); o[model] = Date.now() + 10 * 60 * 1000; store.set(BKEY, o); }
  const goodModels = () => { const o = store.get(PKEY, {}), lim = Date.now() - 6 * 3600 * 1000; return Object.keys(o).filter((k) => o[k].ts > lim).sort((a, b) => (o[a].preMs - o[b].preMs) || (o[b].ts - o[a].ts)); };
  // 핑 결과: 선택한 모델은 20분 동안 재사용하고, 모델별 핑 시간은 설정 화면에 보여 준다
  function recordPick(p) {
    if (!p || p.cached) return;
    store.set(KKEY, { model: p.model, ms: p.ms, ts: Date.now() });
    const g = store.get(GKEY, {});
    for (const x of p.tried || []) if (x.ms != null) g[x.model] = { ms: x.ms, ts: Date.now() };
    store.set(GKEY, g);
  }
  // 성능 기록: 요약마다 구간 시간·시도·핑 결과를 한 줄로 남긴다 (제목·키·영상 주소는 넣지 않는다)
  const RUNKEY = "ytnote.runs";
  const pickCompact = (p) => (p ? { m: p.model, ms: p.ms, c: p.cached ? 1 : 0, t: (p.tried || []).map((x) => [x.model, x.ms != null ? x.ms : x.why]) } : null);
  function recordRun(r) {
    const a = store.get(RUNKEY, []);
    a.push(Object.assign({ t: Date.now(), f: settings.fast ? 1 : 0, lo: settings.low ? 1 : 0, sp: settings.split ? 1 : 0, ap: settings.autoPick ? 1 : 0 }, r));
    store.set(RUNKEY, a.slice(-200));
  }
  function runFromEntry(e) {
    const t = e.timing; if (!t) return null;
    const k = t.tok || {};
    return t.split
      ? { ok: 1, split: t.split, m: t.model, tot: t.total, bad: t.failed, segs: (t.segs || []).map((x) => x && [x.firstText, x.end, (x.tok || {}).in, x.tries]), pick: pickCompact(t.pick) }
      : { ok: 1, m: t.model, lv: t.level, tot: t.total, pre: t.firstText, hdr: t.headers, end: t.end, in: k.in, th: k.think, out: k.out, chars: t.chars, tries: t.tries, fail: t.failed, wait: t.wait, att: t.att, pick: pickCompact(t.pick) };
  }
  function exportRuns(n) {
    const a = store.get(RUNKEY, []).slice(-(n || 40));
    const head = { app: C.VERSION, n: a.length, cfg: { model: settings.model, fast: settings.fast, low: settings.low, split: settings.split, autoPick: settings.autoPick }, ua: (navigator.userAgent.match(/Chrome\/[\d.]+/) || [""])[0], tz: new Date().getTimezoneOffset() };
    return [JSON.stringify(head)].concat(a.map((r) => JSON.stringify(r))).join("\n");
  }
  function recordPerf(e) {
    const t = e && e.timing;
    if (!t || t.split || !t.model || t.firstText == null) return;
    const o = store.get(PKEY, {});
    o[t.model] = { ts: e.ts || Date.now(), inTok: (t.tok || {}).in || 0, thinkTok: (t.tok || {}).think || 0, preMs: t.firstText, level: t.level };
    store.set(PKEY, o);
  }
  function renderPerf() {
    const box = document.getElementById("perf"); if (!box) return;
    const o = store.get(PKEY, {}), keys = Object.keys(o).sort((a, b) => o[b].ts - o[a].ts).slice(0, 8);
    const g = store.get(GKEY, {});
    const lines = keys.map((k) => {
      const v = o[k];
      return `${k}: 첫 응답 ${(v.preMs / 1000).toFixed(0)}초 · 입력 ${v.inTok}토큰 · 추론 ${v.thinkTok == null ? "-" : v.thinkTok}토큰 (${Math.round((Date.now() - v.ts) / 60000)}분 전)`;
    });
    const pk = Object.keys(g).sort((a, b) => g[b].ts - g[a].ts).slice(0, 8).map((k) => `핑 ${k}: ${(g[k].ms / 1000).toFixed(1)}초 (${Math.round((Date.now() - g[k].ts) / 60000)}분 전)`);
    box.textContent = lines.concat(pk).join("\n") || "(아직 없음)";
  }
  // 구간별 시간 패널
  function showTiming(t) {
    const box = document.getElementById("timing"), body = document.getElementById("timingBody"), sum = document.getElementById("timingSum");
    if (!box) return;
    if (!t) { box.hidden = true; return; }
    sum.textContent = "⏱ 구간별 시간 · 총 " + C.fmtMs(t.total);
    body.textContent = C.timingReport(t).join("\n");
    box.hidden = false;
  }
  const STAGE = [["핑", "모델 속도를 재는 중"], ["분할 요약", "구간별로 나눠 동시에 처리 중"], ["요청 보냄", "서버가 영상을 처리하는 중"], ["응답 HTTP 200", "첫 글자를 기다리는 중"], ["오류", "재시도 준비"], ["첫 글자", "글을 쓰는 중"], ["연결 끊김", "재시도 대기"]];
  const stage = new Map();
  // 진단 로그: 설정 > 진단 로그에서 본다 (마지막 80줄만 저장)
  const LKEY = "ytnote.log";
  let logLines = store.get(LKEY, []);
  function addLog(id, line) {
    const t = new Date().toLocaleTimeString("ko-KR", { hour12: false });
    if (!line.startsWith("[구간")) for (const [k, v] of STAGE) if (line.startsWith(k)) stage.set(id, v);
    logLines.push(`${t} ${String(id).slice(0, 5)} ${line}`);
    if (logLines.length > 80) logLines = logLines.slice(-80);
    store.set(LKEY, logLines);
    const box = document.getElementById("dbg");
    if (box && box.offsetParent) renderLog();
  }
  function renderLog() { const box = document.getElementById("dbg"); if (box) box.textContent = logLines.join("\n") || "(아직 없음)"; }
  const rc = document.getElementById("runsCopy");
  if (rc) rc.addEventListener("click", () => {
    const txt = exportRuns(40);
    try { navigator.clipboard.writeText(txt).then(() => toast("성능 기록 " + (txt.split("\n").length - 1) + "건을 복사했습니다"), () => toast("복사하지 못했습니다")); } catch { toast("복사하지 못했습니다"); }
  });
  const dc = document.getElementById("dbgCopy");
  if (dc) dc.addEventListener("click", () => { try { navigator.clipboard.writeText(logLines.join("\n")); toast("로그를 복사했습니다"); } catch { toast("복사하지 못했습니다"); } });
  // 요약 중에는 경과 시간을 보여 준다 (멈췄는지 구분하려고)
  setInterval(() => {
    if (!viewId || !jobs.has(viewId) || !started.has(viewId) || el.status.dataset.kind !== "live") return;
    const sec = Math.round((Date.now() - started.get(viewId)) / 1000);
    el.status.textContent = el.status.textContent.replace(/ · (단계|경과) .*$/, "") + (stage.get(viewId) ? " · 단계 " + stage.get(viewId) : "") + " · 경과 " + (sec < 60 ? sec + "초" : Math.floor(sec / 60) + "분 " + (sec % 60) + "초");
  }, 1000);
  const started = new Map();   // 요약 시작 시각 (방금 시작한 작업을 사라진 것으로 오인하지 않게)
  const resumed = new Set();   // 자동 재시작은 영상마다 한 번만 (요청 낭비 방지)
  function showRetry(info) {
    const pre = info.seg ? `구간 ${info.seg}/${info.of}: ` : "";
    const text = pre + (info.reason === "nosplit"
      ? "구간 요청이 거부되어 전체 영상을 한 번에 요약합니다…"
      : info.reason === "busy"
      ? `설정한 모델이 최근 서버 과부하였습니다. ${info.model}(으)로 요약합니다…`
      : info.reason === "skip"
      ? `설정한 모델은 오늘 한도가 찼습니다. ${info.model}(으)로 요약합니다…`
      : info.reason === "switch"
      ? `이 모델을 지금 쓸 수 없어 다른 모델(${info.model})로 요약합니다…`
      : info.reason === "shrink"
      ? "영상이 길어 분당 토큰 한도를 넘었습니다. 빠른 요약(프레임 5초에 1장)으로 줄여서 다시 합니다…"
      : info.reason === "network"
      ? `연결이 끊겼습니다. ${Math.round(info.wait / 1000)}초 뒤 다시 시도합니다 (${info.attempt}/${info.of}). 앱을 화면에 두면 더 안정적입니다…`
      : info.reason === "rate"
      ? `분당 요청 한도에 걸렸습니다. ${Math.round(info.wait / 1000)}초 기다렸다 다시 합니다…`
      : `Google 서버가 바쁩니다. ${Math.round(info.wait / 1000)}초 뒤 다시 시도합니다 (${info.attempt}/2)…`);
    if (info.seg) { setStatus(text.slice(0, 60) + jobsNote(), "live"); return; }   // 분할 중에는 이미 나온 구간 글을 지우지 않는다
    showWaiting(text);
    setStatus("재시도 중" + jobsNote(), "live");
  }

  // ───────────── 영상 길이 확인 (숨은 YouTube 플레이어) ─────────────
  // 임베드가 막힌 영상이나 오프라인이면 null → 분할 없이 한 번에 요약한다
  function ytDuration(id, timeoutMs) {
    return new Promise((resolve) => {
      let done = false, player = null, holder = null, iv = null;
      const finish = (v) => {
        if (done) return; done = true; clearTimeout(tm); clearInterval(iv);
        try { player && player.destroy(); } catch {}
        if (holder) holder.remove();
        resolve(v);
      };
      const tm = setTimeout(() => finish(null), timeoutMs || 8000);
      const init = () => {
        try {
          holder = document.createElement("div");
          holder.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:120px;opacity:0;pointer-events:none";
          const inner = document.createElement("div");
          holder.appendChild(inner); document.body.appendChild(holder);
          player = new window.YT.Player(inner, {
            videoId: id, host: "https://www.youtube-nocookie.com",
            playerVars: { controls: 0, mute: 1, playsinline: 1, rel: 0 },
            events: {
              onReady: (e) => {
                const get = () => { try { return +e.target.getDuration() || 0; } catch { return 0; } };
                if (get() > 0) return finish(get());
                iv = setInterval(() => { const d = get(); if (d > 0) finish(d); }, 250);   // 메타데이터가 늦게 들어오는 경우
              },
              onError: () => finish(null),
            },
          });
        } catch { finish(null); }
      };
      if (window.YT && window.YT.Player) init();
      else {
        window.onYouTubeIframeAPIReady = init;
        const sc = document.createElement("script");
        sc.src = "https://www.youtube.com/iframe_api"; sc.async = true; sc.onerror = () => finish(null);
        document.head.appendChild(sc);
      }
    });
  }
  const lenWait = new Map();   // 길이 확인 중인 영상 (멈춤 처리용)

  // ───────────── 요약 실행 ─────────────
  function askNotifyPermission() {
    if (settings.notify && "Notification" in window && Notification.permission === "default") {
      try { Notification.requestPermission(); } catch {}
    }
  }

  async function summarize(id, force) {
    if (!force) {
      const hit = history.find((h) => h.id === id);
      if (hit) { showEntry(hit); setStatus("이미 요약한 영상입니다. 다시 하려면 ‘요약’을 누르세요.", "ok"); return; }
    }
    if (jobs.has(id)) {
      viewId = id; current = null;
      const j = jobs.get(id);
      if (j.md) render(j.md, false); else showWaiting("요약 중입니다.");
      setStatus("요약 중" + (j.title ? " · " + short(j.title) : "") + jobsNote(), "live");
      refreshBar();
      return;
    }
    if (!settings.apiKey) { openSettings(); setStatus("먼저 Gemini API 키를 넣어 주세요.", "warn"); return; }

    // 먼저 요청한 요약이 아직 진행 중이면 화면을 뺏지 않는다. 새 요청은 뒤에서 하고 결과는 목록에 쌓는다
    const queued = getReqs().some((r) => jobs.has(r.id));
    addReq(id);
    if (queued) {
      toast("뒤에서 요약합니다. 끝나면 최근 요약 목록에 쌓입니다.");
    } else {
      viewId = id;
      current = null;
      el.url.value = `https://www.youtube.com/watch?v=${id}`;
      showWaiting("영상을 분석하고 있습니다. 앱을 나가도 계속 요약하고, 끝나면 알림으로 알려 줍니다.");
      setStatus("영상 분석 중…" + jobsNote(), "live");
    }
    const job = { id, apiKey: settings.apiKey, model: settings.model || DEFAULTS.model, fast: !!settings.fast, low: !!settings.low, split: !!settings.split, autoPick: !!settings.autoPick, pickCache: store.get(KKEY, null), duration: 0, notify: !!settings.notify, skip: exhaustedNow(), busy: busyNow(), good: goodModels() };
    jobs.set(id, { md: "", title: "" });
    started.set(id, Date.now());
    refreshBar();
    if (job.split) {
      lenWait.set(id, { cancelled: false });
      if (!queued) showWaiting("영상 길이를 확인하고 있습니다…");
      const t = Date.now();
      job.duration = (await ytDuration(id, 8000)) || 0;
      addLog(id, `영상 길이 확인 ${job.duration ? C.fmtClock(job.duration) : "실패(분할 안 함)"} (${((Date.now() - t) / 1000).toFixed(1)}초)`);
      const w = lenWait.get(id); lenWait.delete(id);
      if (w && w.cancelled) { onError(id, "요약을 멈췄습니다.", true); return; }
      if (viewId === id) showWaiting("영상을 분석하고 있습니다. 앱을 나가도 계속 요약하고, 끝나면 알림으로 알려 줍니다.");
    }

    const ctrl = swCtrl();
    if (ctrl) { ctrl.postMessage({ type: "summarize", job }); return; }

    // 서비스 워커가 아직 없을 때(첫 실행 직후 등): 화면에서 직접 요약한다
    localCtrl = new AbortController();
    try {
      const res = await C.runSplit(Object.assign({}, job, {
        signal: localCtrl.signal,
        onProgress: ({ meta, url, acc }) => {
          jobs.set(id, { md: C.buildMarkdown(meta, url, acc), title: meta.title || "" });
          if (viewId !== id) return;
          render(jobs.get(id).md, false);
          if (meta.title) setStatus(`요약 중 · ${short(meta.title)}`, "live");
        },
        onModel: (m) => { settings.model = m; saveSettings(); },
        onFastRejected: () => { settings.fast = false; saveSettings(); },
        onLowRejected: () => { settings.low = false; saveSettings(); },
        onBusy: markBusy,
        onPick: recordPick,
        onLog: (line) => addLog(id, line),
        onRetry: (info) => { if (viewId === id) showRetry(info); },
        onExhausted: markExhausted,
      }));
      onDone(id, { id, title: res.meta.title || id, md: res.md, ts: Date.now(), model: res.model, ms: res.ms, timing: res.timing, partial: res.partial || 0 });
    } catch (e) {
      onError(id, C.friendly(e), e.name === "AbortError", { att: e.att, pick: e.pick, totalMs: e.totalMs });
    } finally {
      localCtrl = null;
      refreshBar();
    }
  }

  // ───────────── 음성 재생 ─────────────
  const audio = new Audio();
  audio.preload = "auto";
  const RATES = [1, 1.25, 1.5, 1.75, 2, 0.85];
  const player = {
    entry: null, chunks: [], urls: [], blobs: [], i: 0,
    playing: false, waiting: false, gen: null, genErr: null, device: false, utter: null,
  };

  function resetPlayer() {
    if (player.gen) player.gen.abort();
    audio.pause();
    audio.removeAttribute("src");
    try { speechSynthesis.cancel(); } catch {}
    player.urls.forEach((u) => u && URL.revokeObjectURL(u));
    Object.assign(player, { entry: null, chunks: [], urls: [], blobs: [], i: 0, playing: false, waiting: false, gen: null, genErr: null, device: false, utter: null });
    markSection();
    setMediaState();
  }

  async function loadOrGenerate(entry) {
    const key = C.hash(entry.md + "|" + settings.voice + "|" + settings.ttsModel);
    try {
      const cached = await C.idb.get("audio", entry.id);
      if (player.entry !== entry) return;
      if (cached && cached.key === key && cached.blobs && cached.blobs.length === player.chunks.length) {
        player.blobs = cached.blobs;
        player.urls = cached.blobs.map((b) => URL.createObjectURL(b));
        if (player.playing && player.waiting) playIndex(player.i);
        updatePlayerUI();
        return;
      }
    } catch {}
    const gen = new AbortController();
    player.gen = gen;
    let model = settings.ttsModel || DEFAULTS.ttsModel;
    // 재생 위치부터 먼저 만들고, 나머지를 채운다
    const order = [];
    for (let k = player.i; k < player.chunks.length; k++) order.push(k);
    for (let k = 0; k < player.i; k++) order.push(k);
    for (let n = 0; n < order.length; n++) {
      const k = order[n];
      if (gen.signal.aborted || player.entry !== entry) return;
      if (player.urls[k]) continue;
      let blob;
      try {
        blob = await C.tts({ apiKey: settings.apiKey, model, voice: settings.voice, text: player.chunks[k].text, signal: gen.signal });
      } catch (err) {
        if (gen.signal.aborted) return;
        if (err.status === 404 || /not found|not supported/i.test(err.message || "")) {
          const alt = C.pickTts(await C.listModels(settings.apiKey));
          if (alt && alt !== model) { model = alt; settings.ttsModel = alt; saveSettings(); n--; continue; }
        }
        player.genErr = err;
        if (player.playing && (player.waiting || !player.urls[player.i])) startDevice(player.i, err);
        updatePlayerUI();
        return;
      }
      if (player.entry !== entry) return;
      player.blobs[k] = blob;
      player.urls[k] = URL.createObjectURL(blob);
      if (player.waiting && player.playing && player.i === k && !player.device) playIndex(k);
      updatePlayerUI();
    }
    player.gen = null;
    try {
      await C.idb.put("audio", { id: entry.id, key, blobs: player.blobs, ts: Date.now() });
      const all = ((await C.idb.all("audio")) || []).sort((a, b) => b.ts - a.ts);
      for (const old of all.slice(6)) await C.idb.del("audio", old.id); // 최근 6개만 보관
    } catch {}
  }

  function playIndex(i) {
    player.i = i;
    if (i >= player.chunks.length) { finishPlayback(); return; }
    if (player.device) { speakDevice(i); return; }
    if (player.urls[i]) {
      player.waiting = false;
      audio.src = player.urls[i];
      audio.playbackRate = settings.rate;
      audio.play().catch(() => { player.playing = false; updatePlayerUI(); setMediaState(); });
    } else if (player.genErr) {
      startDevice(i, player.genErr);
      return;
    } else {
      player.waiting = true;
    }
    markSection();
    updatePlayerUI();
    setMediaState();
  }

  function finishPlayback() {
    player.playing = false;
    player.waiting = false;
    player.i = 0;
    markSection();
    updatePlayerUI();
    setMediaState();
    toast("끝까지 읽었습니다");
  }

  audio.addEventListener("ended", () => { if (player.playing) playIndex(player.i + 1); });
  audio.addEventListener("play", () => { player.playing = true; updatePlayerUI(); setMediaState(); });
  audio.addEventListener("pause", () => {
    if (!audio.ended && !player.waiting) { player.playing = false; updatePlayerUI(); setMediaState(); }
  });

  // Gemini 음성을 못 만들 때: 기기 음성으로 읽는다 (앱을 열어 둔 동안만 동작)
  function startDevice(i, err) {
    if (!("speechSynthesis" in window)) {
      player.playing = false; player.waiting = false;
      updatePlayerUI();
      toast("음성을 만들 수 없습니다. " + C.friendly(err).slice(0, 60));
      return;
    }
    if (!player.device) toast("Gemini 음성을 만들 수 없어 기기 음성으로 읽습니다. 앱을 열어 두세요.");
    player.device = true;
    player.waiting = false;
    speakDevice(i);
  }
  function speakDevice(i) {
    player.i = i;
    try { speechSynthesis.cancel(); } catch {}
    if (i >= player.chunks.length) { finishPlayback(); return; }
    const parts = player.chunks[i].text.match(/[^.!?]+[.!?]*/g) || [player.chunks[i].text];
    const voice = speechSynthesis.getVoices().filter((v) => /^ko/i.test(v.lang))
      .sort((a, b) => /google/i.test(b.name) - /google/i.test(a.name))[0];
    let n = 0;
    const token = {};
    player.utter = token;
    const next = () => {
      if (player.utter !== token || !player.playing) return;
      if (n >= parts.length) { playIndex(i + 1); return; }
      const u = new SpeechSynthesisUtterance(parts[n++].trim());
      u.lang = "ko-KR";
      if (voice) u.voice = voice;
      u.rate = settings.rate;
      u.onend = next;
      u.onerror = (ev) => { if (ev.error !== "interrupted" && ev.error !== "canceled") next(); };
      speechSynthesis.speak(u);
    };
    markSection();
    updatePlayerUI();
    setTimeout(next, 60);
  }

  function togglePlay() {
    if (player.entry && (!current || player.entry.id === current.id)) { pauseOrResume(); return; }
    if (!current) return;
    if (!settings.apiKey) { openSettings(); return; }
    resetPlayer();
    const entry = current;
    player.entry = entry;
    player.chunks = C.speechChunks(entry.md);
    player.playing = true;
    setMediaMeta();
    playIndex(0);
    loadOrGenerate(entry);
    refreshBar();
  }
  function pauseOrResume() {
    if (player.playing) {
      player.playing = false;
      player.waiting = false;
      if (player.device) { player.utter = null; try { speechSynthesis.cancel(); } catch {} }
      else audio.pause();
    } else {
      player.playing = true;
      if (player.device) speakDevice(player.i);
      else if (audio.src && !audio.ended && audio.currentTime > 0 && player.urls[player.i] === audio.src) {
        audio.playbackRate = settings.rate;
        audio.play().catch(() => {});
      } else playIndex(player.i);
    }
    updatePlayerUI();
    setMediaState();
  }
  function skip(d) {
    if (!player.entry) return;
    const i = Math.min(Math.max(player.i + d, 0), player.chunks.length - 1);
    player.playing = true;
    if (player.device) { player.utter = null; speakDevice(i); } else playIndex(i);
  }

  function markSection() {
    el.out.querySelectorAll(".speaking").forEach((n) => n.classList.remove("speaking"));
    if (!player.entry || !current || current.id !== player.entry.id || !player.chunks.length) return;
    const sec = (player.chunks[player.i] || {}).sec;
    if (sec == null || sec < 0) return;
    const h2 = el.out.querySelectorAll("h2")[sec];
    if (h2) h2.classList.add("speaking");
  }

  function updatePlayerUI() {
    const active = !!player.entry;
    const sameAsView = active && current && player.entry.id === current.id;
    const on = player.playing;
    el.playIcon.innerHTML = on
      ? '<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/>'
      : '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>';
    el.play.classList.toggle("on", on);
    el.play.disabled = !active && !current;
    el.playLabel.textContent = on ? "일시정지" : active && player.i > 0 && (sameAsView || !current) ? "이어 듣기" : "듣기";
    el.prev.hidden = el.next.hidden = !active;
    el.rate.textContent = `${settings.rate}×`;
    let p = "요약을 소리로 읽어 줍니다";
    if (active) {
      const n = player.chunks.length;
      const made = player.urls.filter(Boolean).length;
      p = `${Math.min(player.i + 1, n)}/${n}`;
      if (player.device) p += " · 기기 음성";
      else if (player.waiting && on) p += " · 음성 만드는 중";
      else if (made < n && !player.genErr) p += ` · 생성 ${made}/${n}`;
      if (!sameAsView) p += " · " + player.entry.title;
    }
    el.prog.textContent = p;
  }

  // 잠금화면·알림창의 재생 조작
  function setMediaMeta() {
    if (!("mediaSession" in navigator) || !player.entry) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: player.entry.title, artist: "YT 요약노트", album: "요약 읽기",
        artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }],
      });
    } catch {}
  }
  function setMediaState() {
    if (!("mediaSession" in navigator)) return;
    try { navigator.mediaSession.playbackState = player.entry ? (player.playing ? "playing" : "paused") : "none"; } catch {}
  }
  if ("mediaSession" in navigator) {
    const on = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch {} };
    on("play", () => { if (!player.playing) pauseOrResume(); });
    on("pause", () => { if (player.playing) pauseOrResume(); });
    on("stop", () => { resetPlayer(); refreshBar(); });
    on("nexttrack", () => skip(1));
    on("previoustrack", () => skip(-1));
    on("seekbackward", () => { audio.currentTime = Math.max(0, audio.currentTime - 10); });
    on("seekforward", () => { audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 10); });
  }

  el.play.addEventListener("click", togglePlay);
  el.prev.addEventListener("click", () => skip(-1));
  el.next.addEventListener("click", () => skip(1));
  el.rate.addEventListener("click", () => {
    settings.rate = RATES[(RATES.indexOf(settings.rate) + 1) % RATES.length] || 1;
    saveSettings();
    audio.playbackRate = settings.rate;
    if (player.device && player.playing) speakDevice(player.i);
    updatePlayerUI();
  });

  // ───────────── 복사 / 내보내기 ─────────────
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
    }
    store.set(CKEY, text); // 자기 복사로 다시 감지되지 않게
    toast(`${label} 복사됨 · ${text.length.toLocaleString()}자`);
  }

  el.cpMd.addEventListener("click", () => current && copyText(current.md, "마크다운"));
  el.cpTxt.addEventListener("click", () => current && copyText(C.mdToPlain(current.md), "텍스트"));
  el.share.addEventListener("click", async () => {
    if (!current) return;
    const text = C.mdToPlain(current.md);
    if (navigator.share) {
      try { await navigator.share({ title: current.title, text }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    copyText(text, "텍스트");
  });
  el.obs.addEventListener("click", async () => {
    if (!current) return;
    await copyText(current.md, "마크다운");
    const folder = (settings.folder || "").trim().replace(/^\/+|\/+$/g, "");
    const d = new Date(current.ts || Date.now()), z = (n) => String(n).padStart(2, "0");
    const stamp = `${z(d.getFullYear() % 100)}${z(d.getMonth() + 1)}${z(d.getDate())} ${z(d.getHours())}${z(d.getMinutes())}`;
    const name = C.safeName(`${stamp} ${current.title}`);
    const q = [];
    if (settings.vault) q.push("vault=" + encodeURIComponent(settings.vault));
    q.push(folder ? "file=" + encodeURIComponent(folder + "/" + name) : "name=" + encodeURIComponent(name));
    q.push("clipboard");
    location.href = "obsidian://new?" + q.join("&");
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        setStatus("옵시디언이 열리지 않았습니다. 마크다운은 복사돼 있으니 옵시디언에서 붙여넣으세요.", "warn");
      }
    }, 1800);
  });

  // ───────────── 입력 ─────────────
  function runFromInput(force) {
    const id = C.extractId(el.url.value, false);
    if (!id) { setStatus("YouTube 주소를 찾지 못했습니다.", "warn"); return; }
    summarize(id, force);
  }
  el.go.addEventListener("click", () => { askNotifyPermission(); runFromInput(true); });
  el.url.addEventListener("keydown", (e) => { if (e.key === "Enter") runFromInput(false); });
  el.url.addEventListener("paste", () => setTimeout(() => runFromInput(false), 0));
  el.stop.addEventListener("click", () => {
    const w = lenWait.get(viewId);
    if (w) { w.cancelled = true; return; }
    if (localCtrl) localCtrl.abort();
    else if (swCtrl() && viewId) swCtrl().postMessage({ type: "cancel", id: viewId });
  });

  el.paste.addEventListener("click", async () => {
    askNotifyPermission();
    try {
      const t = await navigator.clipboard.readText();
      const id = C.extractId(t, false);
      if (!id) { setStatus("클립보드에 YouTube 주소가 없습니다.", "warn"); return; }
      store.set(CKEY, t);
      summarize(id, false);
    } catch {
      el.url.focus();
      el.url.select();
      let denied = false;
      try { denied = (await navigator.permissions.query({ name: "clipboard-read" })).state === "denied"; } catch {}
      setStatus(denied
        ? "클립보드 권한이 차단돼 있습니다. 주소창 왼쪽 아이콘 → 권한 → 클립보드를 허용하세요. 지금은 입력칸을 길게 눌러 붙여넣으세요."
        : "클립보드를 읽지 못했습니다. 입력칸을 길게 눌러 붙여넣으세요.", "warn");
    }
  });

  // 앱으로 돌아올 때 클립보드 자동 확인 (Android Chrome에서 권한을 허용한 경우 동작)
  async function autoClip() {
    if (!settings.autoClip || document.visibilityState !== "visible") return;
    if (!navigator.clipboard || !navigator.clipboard.readText) return;
    try {
      if (navigator.permissions) {
        const st = await navigator.permissions.query({ name: "clipboard-read" }).catch(() => null);
        if (st && st.state === "denied") return;
      }
      const t = await navigator.clipboard.readText();
      if (!t || t === store.get(CKEY, null)) return;
      store.set(CKEY, t);
      const id = C.extractId(t, true);
      if (id) summarize(id, false);
    } catch { /* 권한 없음·포커스 없음: 조용히 넘어간다 */ }
  }
  let returning = false;
  async function onReturn() {
    if (document.visibilityState !== "visible" || returning) return;
    returning = true;
    try {
      if (window.__swReg) window.__swReg.update().catch(() => {});
      await importInbox();
      const followed = focusFirst({ prune: false, bg: true });
      if (swCtrl()) swCtrl().postMessage({ type: "status" });
      if (!followed && viewId && !current && !jobs.has(viewId)) {
        const h = history.find((x) => x.id === viewId);
        if (h) { showEntry(h, true); setStatus("완료" + (h.model ? " · " + h.model : "") + " · 앱 밖에 있는 동안 요약이 끝났습니다.", "ok"); }
      }
      await autoClip();
    } finally { returning = false; }
  }
  document.addEventListener("visibilitychange", onReturn);
  window.addEventListener("focus", onReturn);

  // ───────────── 공유 시트·알림으로 들어온 경우 ─────────────
  function handleParams() {
    const p = new URLSearchParams(location.search);
    const open = p.get("open");
    const joined = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
    if (!open && !joined) return false;
    try { window.history.replaceState(null, "", location.pathname); } catch {}
    if (open) {
      const h = history.find((x) => x.id === open);
      if (h) { showEntry(h); return true; }
      return false;
    }
    const id = C.extractId(joined, false);
    if (id) { summarize(id, false); return true; }
    setStatus("공유된 내용에서 YouTube 주소를 찾지 못했습니다.", "warn");
    return true;
  }

  // ───────────── 설정 ─────────────
  function applyTheme(t) {
    const r = document.documentElement;
    if (t === "dark" || t === "light") r.setAttribute("data-theme", t); else r.removeAttribute("data-theme");
    document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    const m = document.createElement("meta"); m.name = "theme-color";
    const dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    m.content = dark ? "#0f1513" : "#0f6b5c"; document.head.appendChild(m);
  }
  applyTheme(settings.theme);
  function openSettings() {
    const v = document.getElementById("ver"); if (v) v.textContent = "버전 " + C.VERSION;
    el.sKey.value = settings.apiKey;
    el.sModel.value = settings.model;
    el.sFast.checked = !!settings.fast;
    el.sLow.checked = !!settings.low;
    el.sSplit.checked = !!settings.split;
    el.sPick.checked = !!settings.autoPick;
    el.sTheme.value = settings.theme || "auto";
    renderLog(); renderPerf();
    el.sAuto.checked = !!settings.autoClip;
    el.sNotify.checked = !!settings.notify;
    el.sVoice.value = settings.voice;
    el.sTts.value = settings.ttsModel;
    el.sVault.value = settings.vault;
    el.sFolder.value = settings.folder;
    if (el.dlg.showModal) el.dlg.showModal(); else el.dlg.setAttribute("open", "");
  }
  el.openSet.addEventListener("click", openSettings);
  el.sClose.addEventListener("click", () => el.dlg.close());
  el.sSave.addEventListener("click", (e) => {
    e.preventDefault();
    settings = Object.assign({}, settings, {
      apiKey: el.sKey.value.trim(),
      model: el.sModel.value.trim() || DEFAULTS.model,
      fast: el.sFast.checked,
      low: el.sLow.checked,
      split: el.sSplit.checked,
      autoPick: el.sPick.checked,
      theme: el.sTheme.value,
      autoClip: el.sAuto.checked,
      notify: el.sNotify.checked,
      voice: el.sVoice.value || DEFAULTS.voice,
      ttsModel: el.sTts.value.trim() || DEFAULTS.ttsModel,
      vault: el.sVault.value.trim(),
      folder: el.sFolder.value.trim(),
    });
    saveSettings();
    applyTheme(settings.theme);
    askNotifyPermission();
    el.dlg.close();
    toast("설정을 저장했습니다");
    if (settings.apiKey && !viewId) setStatus("YouTube 주소를 복사하거나 공유하세요.", "ok");
  });

  // ───────────── 시작 ─────────────
  (async () => {
    renderHistory();
    await importInbox();
    if (SW) {
      let hadController = !!SW.controller, reloaded = false;
      SW.register("./sw.js", { updateViaCache: "none" }).then((reg) => {
        window.__swReg = reg;
        reg.update().catch(() => {});
      }).catch(() => {});
      // 새 버전이 설치되면 한 번 새로고침해서 바로 적용 (요약 중이면 끝난 뒤로 미룬다)
      SW.addEventListener("controllerchange", () => {
        if (!hadController) { hadController = true; return; }
        if (reloaded) return;
        const go = () => { if (!jobs.size && !player.playing) { reloaded = true; location.reload(); } else setTimeout(go, 3000); };
        go();
      });
      SW.ready.then(() => swCtrl() && swCtrl().postMessage({ type: "status" })).catch(() => {});
    }
    const handled = handleParams();
    const followed = handled ? null : focusFirst({ prune: false, bg: true });
    if (!settings.apiKey) { setStatus("설정(⚙)에서 Gemini API 키를 넣어 주세요.", "warn"); if (!handled) openSettings(); }
    else if (!handled) { if (!followed) setStatus("YouTube 주소를 복사하거나 공유하세요.", ""); autoClip(); }
    refreshBar();
  })();
})();
