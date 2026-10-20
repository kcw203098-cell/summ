/* YT 요약노트 – 화면 동작 */
(() => {
  const C = window.Core;
  const $ = (s) => document.querySelector(s);
  const SKEY = "ytnote.settings", HKEY = "ytnote.history", CKEY = "ytnote.lastClip";
  const DEFAULTS = { apiKey: "", model: "gemini-flash-latest", autoClip: true, vault: "", folder: "YouTube 요약" };

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  let settings = Object.assign({}, DEFAULTS, store.get(SKEY, {}));
  let history = store.get(HKEY, []);
  let current = null;            // {id,title,md}
  let busy = false, queue = [], ctrl = null;

  const el = {
    url: $("#url"), go: $("#go"), paste: $("#paste"), stop: $("#stop"),
    status: $("#status"), out: $("#out"), empty: $("#empty"),
    bar: $("#bar"), cpMd: $("#cpMd"), cpTxt: $("#cpTxt"), share: $("#share"), obs: $("#obs"),
    hist: $("#hist"), histCount: $("#histCount"),
    dlg: $("#settings"), openSet: $("#openSet"),
    sKey: $("#sKey"), sModel: $("#sModel"), sAuto: $("#sAuto"), sVault: $("#sVault"), sFolder: $("#sFolder"),
    sSave: $("#sSave"), sClose: $("#sClose"), toast: $("#toast"),
  };

  // ---------- 상태 표시 ----------
  function setStatus(text, kind) {
    el.status.textContent = text || "";
    el.status.dataset.kind = kind || "";
  }
  let toastT;
  function toast(text) {
    el.toast.textContent = text;
    el.toast.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (el.toast.hidden = true), 1800);
  }

  // ---------- 결과 표시 ----------
  function show(md, done) {
    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.innerHTML = C.mdToHtml(md);
    el.out.classList.toggle("streaming", !done);
    el.bar.hidden = !done;
  }

  function showEntry(e) {
    current = e;
    show(e.md, true);
    el.url.value = `https://youtu.be/${e.id}`;
    setStatus(`저장된 요약 · ${e.title}`, "ok");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- 기록 ----------
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
      b.addEventListener("click", () => showEntry(h));
      li.appendChild(b);
      el.hist.appendChild(li);
    }
  }

  // ---------- 제목/채널 ----------
  async function fetchMeta(url) {
    try {
      const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (j && j.title) return { title: j.title, author: j.author_name || "" };
    } catch {}
    return {};
  }

  // ---------- Gemini ----------
  async function streamGemini(model, url, onText, signal) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const r = await fetch(endpoint, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ file_data: { file_uri: url } }, { text: C.PROMPT }] }] }),
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); msg = (j.error && j.error.message) || msg; } catch {}
      const e = new Error(msg); e.status = r.status; throw e;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      const { texts, rest, err } = C.parseSSE(buf);
      buf = rest;
      if (err) throw new Error(err);
      if (texts.length) { acc += texts.join(""); onText(acc); }
    }
    const tail = C.parseSSE(buf + "\n");
    if (tail.texts.length) { acc += tail.texts.join(""); onText(acc); }
    return acc;
  }

  async function findModel() {
    const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
      headers: { "x-goog-api-key": settings.apiKey },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return C.pickFlash(j.models);
  }

  function friendly(e) {
    const s = String((e && e.message) || e);
    const low = s.toLowerCase();
    if (e && e.name === "AbortError") return "요약을 멈췄습니다.";
    if (e && (e.status === 400 || e.status === 403) && (low.includes("api key") || low.includes("permission")))
      return "API 키가 맞지 않습니다. 설정에서 키를 확인하세요.";
    if ((e && e.status === 429) || low.includes("quota") || low.includes("exhausted"))
      return "사용량 한도에 걸렸습니다. 잠시 뒤 다시 하세요. 무료 등급은 하루 YouTube 처리 시간에 한도가 있습니다.";
    if (low.includes("failed to fetch") || low.includes("network"))
      return "네트워크에 연결할 수 없습니다. 인터넷 연결을 확인하세요.";
    if (low.includes("private") || low.includes("unavailable") || low.includes("uri"))
      return "이 영상을 읽을 수 없습니다. 비공개·연령 제한·지역 제한 영상은 처리되지 않습니다. (" + s.slice(0, 160) + ")";
    return "오류: " + s.slice(0, 300);
  }

  // ---------- 요약 실행 ----------
  async function summarize(id, force) {
    if (!force) {
      const hit = history.find((h) => h.id === id);
      if (hit) { showEntry(hit); setStatus("이미 요약한 영상입니다. 다시 하려면 ‘요약’을 누르세요.", "ok"); return; }
    }
    if (!settings.apiKey) { openSettings(); setStatus("먼저 Gemini API 키를 넣어 주세요.", "warn"); return; }
    if (busy) {
      if (!queue.includes(id) && (!current || current.id !== id)) queue.push(id);
      setStatus(`요약 중입니다. 대기 ${queue.length}개`, "live");
      return;
    }
    busy = true;
    el.go.disabled = true;
    el.stop.hidden = false;
    el.bar.hidden = true;
    const url = `https://www.youtube.com/watch?v=${id}`;
    el.url.value = url;
    current = { id, title: id, md: "" };
    el.empty.hidden = true;
    el.out.hidden = false;
    el.out.innerHTML = '<p class="wait">영상을 분석하고 있습니다. 긴 영상은 1~2분 걸립니다.</p>';
    setStatus("영상 분석 중…", "live");
    ctrl = new AbortController();

    try {
      const meta = await fetchMeta(url);
      if (meta.title) setStatus(`요약 중 · ${meta.title}`, "live");
      const onText = (acc) => show(C.buildMarkdown(meta, url, acc), false);
      let body;
      try {
        body = await streamGemini(settings.model || DEFAULTS.model, url, onText, ctrl.signal);
      } catch (e) {
        if (e.status === 404 || /not found|not supported/i.test(e.message || "")) {
          const alt = await findModel();
          if (!alt || alt === settings.model) throw e;
          settings.model = alt;
          store.set(SKEY, settings);
          setStatus(`모델을 ${alt}(으)로 바꿨습니다.`, "live");
          body = await streamGemini(alt, url, onText, ctrl.signal);
        } else throw e;
      }
      if (!body.trim()) throw new Error("빈 응답을 받았습니다. 다시 시도하세요.");
      const md = C.buildMarkdown(meta, url, body);
      current = { id, title: meta.title || id, md, ts: Date.now() };
      saveHistory(current);
      show(md, true);
      setStatus("완료 · 아래 버튼으로 복사하세요.", "ok");
    } catch (e) {
      el.out.innerHTML = `<p class="err">${C.escapeHtml(friendly(e))}</p>`;
      setStatus("실패", "err");
    } finally {
      busy = false;
      ctrl = null;
      el.go.disabled = false;
      el.stop.hidden = true;
      if (queue.length) summarize(queue.shift());
    }
  }

  // ---------- 복사 / 내보내기 ----------
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
  el.obs.addEventListener("click", () => {
    if (!current) return;
    const file = (settings.folder ? settings.folder.replace(/\/+$/, "") + "/" : "") + C.safeName(current.title);
    const p = new URLSearchParams();
    if (settings.vault) p.set("vault", settings.vault);
    p.set("file", file);
    p.set("content", current.md);
    // URLSearchParams는 공백을 +로 바꾸므로 %20으로 고친다
    location.href = "obsidian://new?" + p.toString().replace(/\+/g, "%20");
  });

  // ---------- 입력 ----------
  function runFromInput(force) {
    const id = C.extractId(el.url.value, false);
    if (!id) { setStatus("YouTube 주소를 찾지 못했습니다.", "warn"); return; }
    summarize(id, force);
  }
  el.go.addEventListener("click", () => runFromInput(true));
  el.url.addEventListener("keydown", (e) => { if (e.key === "Enter") runFromInput(false); });
  el.url.addEventListener("paste", () => setTimeout(() => runFromInput(false), 0));
  el.stop.addEventListener("click", () => ctrl && ctrl.abort());

  el.paste.addEventListener("click", async () => {
    try {
      const t = await navigator.clipboard.readText();
      const id = C.extractId(t, false);
      if (!id) { setStatus("클립보드에 YouTube 주소가 없습니다.", "warn"); return; }
      store.set(CKEY, t);
      summarize(id, false);
    } catch {
      el.url.focus();
      setStatus("클립보드 읽기가 막혔습니다. 입력칸을 길게 눌러 붙여넣으세요.", "warn");
    }
  });

  // 앱으로 돌아올 때 클립보드 자동 확인 (Android Chrome에서 권한을 허용한 경우 동작)
  async function autoClip() {
    if (!settings.autoClip || busy || document.visibilityState !== "visible") return;
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
  document.addEventListener("visibilitychange", autoClip);
  window.addEventListener("focus", autoClip);

  // ---------- 공유 시트로 들어온 경우 ----------
  function handleShare() {
    const p = new URLSearchParams(location.search);
    const joined = [p.get("url"), p.get("text"), p.get("title")].filter(Boolean).join(" ");
    if (!joined) return false;
    try { window.history.replaceState(null, "", location.pathname); } catch {}
    const id = C.extractId(joined, false);
    if (id) { summarize(id, false); return true; }
    setStatus("공유된 내용에서 YouTube 주소를 찾지 못했습니다.", "warn");
    return true;
  }

  // ---------- 설정 ----------
  function openSettings() {
    el.sKey.value = settings.apiKey;
    el.sModel.value = settings.model;
    el.sAuto.checked = !!settings.autoClip;
    el.sVault.value = settings.vault;
    el.sFolder.value = settings.folder;
    if (el.dlg.showModal) el.dlg.showModal(); else el.dlg.setAttribute("open", "");
  }
  el.openSet.addEventListener("click", openSettings);
  el.sClose.addEventListener("click", () => el.dlg.close());
  el.sSave.addEventListener("click", (e) => {
    e.preventDefault();
    settings = {
      apiKey: el.sKey.value.trim(),
      model: el.sModel.value.trim() || DEFAULTS.model,
      autoClip: el.sAuto.checked,
      vault: el.sVault.value.trim(),
      folder: el.sFolder.value.trim(),
    };
    store.set(SKEY, settings);
    el.dlg.close();
    toast("설정을 저장했습니다");
    if (settings.apiKey && !current) setStatus("YouTube 주소를 복사하거나 공유하세요.", "ok");
  });

  // ---------- 시작 ----------
  renderHistory();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  const shared = handleShare();
  if (!settings.apiKey) { setStatus("설정(⚙)에서 Gemini API 키를 넣어 주세요.", "warn"); if (!shared) openSettings(); }
  else if (!shared) { setStatus("YouTube 주소를 복사하거나 공유하세요.", ""); autoClip(); }
})();
