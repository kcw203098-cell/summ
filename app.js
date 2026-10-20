/* YT 요약노트 – 화면 동작 */
(() => {
  const C = window.Core;
  const $ = (s) => document.querySelector(s);
  const SKEY = "ytnote.settings", HKEY = "ytnote.history", CKEY = "ytnote.lastClip";
  const DEFAULTS = {
    apiKey: "", model: "gemini-flash-latest", fast: true, autoClip: true, notify: true,
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
    sKey: $("#sKey"), sModel: $("#sModel"), sFast: $("#sFast"), sAuto: $("#sAuto"), sNotify: $("#sNotify"),
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
    render(e.md, true);
    el.url.value = `https://youtu.be/${e.id}`;
    if (!quiet) setStatus(`저장된 요약 · ${e.title}${jobsNote()}`, "ok");
    refreshBar();
  }

  // ───────────── 기록 ─────────────
  function saveHistory(e) {
    history = [e].concat(history.filter((h) => h.id !== e.id)).slice(0, 40);
    store.set(HKEY, history);
    renderHistory();
  }
  function renderHistory() {
    el.histCount.textContent = history.length;
    el.hist.innerHTML = "";
    for (const h of history) {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<span class="ht"></span><span class="hd"></span>`;
      b.querySelector(".ht").textContent = h.title;
      b.querySelector(".hd").textContent = new Date(h.ts).toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
      b.addEventListener("click", () => { showEntry(h); window.scrollTo({ top: 0, behavior: "smooth" }); });
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

  function onDone(id, entry) {
    jobs.delete(id);
    saveHistory(entry);
    C.idb.del("inbox", id).catch(() => {});
    if (viewId === id) {
      showEntry(entry, true);
      setStatus("완료 · 아래 버튼으로 복사하거나 들으세요." + jobsNote(), "ok");
    } else {
      toast(`요약 완료 · ${entry.title}`);
      refreshBar();
    }
  }
  function onError(id, message, aborted) {
    jobs.delete(id);
    if (viewId === id) {
      showError(message);
      setStatus(aborted ? "멈춤" : "실패", "err");
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
          setStatus(`요약 중${m.title ? " · " + m.title : ""}${jobsNote()}`, "live");
          refreshBar();
        }
      } else if (m.type === "done") onDone(m.id, m.entry);
      else if (m.type === "error") onError(m.id, m.message, m.aborted);
      else if (m.type === "model") { settings.model = m.model; saveSettings(); }
      else if (m.type === "fastOff") { settings.fast = false; saveSettings(); toast("이 모델이 빠른 모드를 받지 않아 빠른 모드를 껐습니다"); }
      else if (m.type === "open") {
        importInbox().then(() => { const h = history.find((x) => x.id === m.id); if (h) showEntry(h); });
      } else if (m.type === "status") {
        for (const r of m.running || []) jobs.set(r.id, { md: r.md, title: r.title });
        if (!viewId && m.running && m.running.length) {
          const r = m.running[m.running.length - 1];
          viewId = r.id;
          if (r.md) render(r.md, false); else showWaiting("영상을 분석하고 있습니다.");
          setStatus("요약 중" + (r.title ? " · " + r.title : "") + jobsNote(), "live");
        }
        refreshBar();
      }
    });
  }

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
      setStatus("요약 중" + (j.title ? " · " + j.title : "") + jobsNote(), "live");
      refreshBar();
      return;
    }
    if (!settings.apiKey) { openSettings(); setStatus("먼저 Gemini API 키를 넣어 주세요.", "warn"); return; }

    viewId = id;
    current = null;
    el.url.value = `https://www.youtube.com/watch?v=${id}`;
    showWaiting("영상을 분석하고 있습니다. 앱을 나가도 계속 요약하고, 끝나면 알림으로 알려 줍니다.");
    setStatus("영상 분석 중…" + jobsNote(), "live");
    const job = { id, apiKey: settings.apiKey, model: settings.model || DEFAULTS.model, fast: !!settings.fast, notify: !!settings.notify };
    jobs.set(id, { md: "", title: "" });
    refreshBar();

    const ctrl = swCtrl();
    if (ctrl) { ctrl.postMessage({ type: "summarize", job }); return; }

    // 서비스 워커가 아직 없을 때(첫 실행 직후 등): 화면에서 직접 요약한다
    localCtrl = new AbortController();
    try {
      const res = await C.runSummary(Object.assign({}, job, {
        signal: localCtrl.signal,
        onProgress: ({ meta, url, acc }) => {
          jobs.set(id, { md: C.buildMarkdown(meta, url, acc), title: meta.title || "" });
          if (viewId !== id) return;
          render(jobs.get(id).md, false);
          if (meta.title) setStatus(`요약 중 · ${meta.title}`, "live");
        },
        onModel: (m) => { settings.model = m; saveSettings(); },
        onFastRejected: () => { settings.fast = false; saveSettings(); },
      }));
      onDone(id, { id, title: res.meta.title || id, md: res.md, ts: Date.now() });
    } catch (e) {
      onError(id, C.friendly(e), e.name === "AbortError");
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
    const name = C.safeName(current.title);
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
      await importInbox();
      if (swCtrl()) swCtrl().postMessage({ type: "status" });
      if (viewId && !current && !jobs.has(viewId)) {
        const h = history.find((x) => x.id === viewId);
        if (h) { showEntry(h, true); setStatus("완료 · 앱 밖에 있는 동안 요약이 끝났습니다.", "ok"); }
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
  function openSettings() {
    el.sKey.value = settings.apiKey;
    el.sModel.value = settings.model;
    el.sFast.checked = !!settings.fast;
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
      autoClip: el.sAuto.checked,
      notify: el.sNotify.checked,
      voice: el.sVoice.value || DEFAULTS.voice,
      ttsModel: el.sTts.value.trim() || DEFAULTS.ttsModel,
      vault: el.sVault.value.trim(),
      folder: el.sFolder.value.trim(),
    });
    saveSettings();
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
      SW.register("./sw.js").catch(() => {});
      SW.ready.then(() => swCtrl() && swCtrl().postMessage({ type: "status" })).catch(() => {});
    }
    const handled = handleParams();
    if (!settings.apiKey) { setStatus("설정(⚙)에서 Gemini API 키를 넣어 주세요.", "warn"); if (!handled) openSettings(); }
    else if (!handled) { setStatus("YouTube 주소를 복사하거나 공유하세요.", ""); autoClip(); }
    refreshBar();
  })();
})();
