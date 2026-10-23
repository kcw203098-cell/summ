// 순수 함수 모음 (DOM 없음). 브라우저와 Node 테스트에서 함께 쓴다.
(function (root) {
  const YT_RE = /(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com\/(?:watch\?(?:[^\s#]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

  const PROMPT = `이 유튜브 영상의 내용을 한국어로 자세히 요약해 줘.

[규칙]
- 영상 언어와 상관없이 모두 한국어로 쓴다. 전문 용어는 처음 나올 때 원어를 괄호에 함께 쓴다.
- 영상에 없는 내용은 덧붙이지 않는다. 확실하지 않은 부분은 "(불확실)"이라고 표시한다.
- 인사말·맺음말 없이 바로 본문을 시작한다.
- 문단과 문단 사이, 제목과 본문 사이에는 반드시 빈 줄을 하나 넣는다.

[형식 - 마크다운]
## 한 줄 요약
(한 문장)

## 핵심 포인트
- (3~7개 불릿)

## 상세 요약
영상 흐름 순서대로 ### 소제목을 나누고, 소제목 끝에 대략적인 시점 (mm:ss)을 붙인다.
각 소제목 아래에는 2~5문장짜리 문단을 쓴다. 수치·예시·근거는 빠뜨리지 않는다.

## 기억할 내용
- (실천 항목, 용어, 인용할 만한 주장 등)
`;

  // strict=true: 클립보드 자동 감지용. 긴 글 속 링크(이 앱이 복사한 요약문 등)는 무시한다.
  function extractId(text, strict) {
    if (!text) return null;
    const s = String(text).trim();
    if (strict && (s.length > 300 || s.includes("\n"))) return null;
    const m = s.match(YT_RE);
    return m ? m[1] : null;
  }

  const isList = (l) => /^\s*([-*+]|\d+[.)])\s+/.test(l);

  // 문단 사이 빈 줄 1개로 통일. 연속 리스트 항목은 붙여 둔다.
  function normalize(md) {
    const lines = String(md).replace(/\r\n?/g, "\n").trim().split("\n");
    const out = [];
    for (let line of lines) {
      line = line.replace(/\s+$/, "");
      if (!line.trim()) {
        if (out.length && out[out.length - 1] !== "") out.push("");
        continue;
      }
      if (out.length && out[out.length - 1] !== "") {
        const prev = out[out.length - 1];
        const bothList = isList(prev) && isList(line);
        const cont = isList(prev) && /^[ \t]/.test(line) && !isList(line);
        if (!(bothList || cont)) out.push("");
      }
      out.push(line);
    }
    return out.join("\n").trim() + "\n";
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function stamp(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function buildMarkdown(meta, url, body, now, model) {
    const title = (meta && meta.title) || "YouTube 영상 요약";
    const head = [`# ${title}`, ""];
    if (meta && meta.author) head.push(`- 채널: ${meta.author}`);
    head.push(`- 링크: ${url}`);
    head.push(`- 요약일: ${stamp(now || new Date())}`);
    if (model) head.push(`- 모델: ${model}`);
    return normalize(head.join("\n") + "\n\n" + body);
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function inlineHtml(s) {
    let h = escapeHtml(s);
    h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
    h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    h = h.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/\((\d{1,2}:\d{2}(?::\d{2})?)\)/g, '<span class="ts">$1</span>');
    return h;
  }

  function stripInline(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, "$1").replace(/`([^`]+)`/g, "$1");
  }

  // 마크다운 → 화면용 HTML
  function mdToHtml(md) {
    const lines = String(md).replace(/\n$/, "").split("\n");
    const html = [];
    let list = null; // "ul" | "ol"
    const close = () => { if (list) { html.push(`</${list}>`); list = null; } };
    for (const line of lines) {
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        close();
        const lv = Math.min(m[1].length, 3);
        html.push(`<h${lv}>${inlineHtml(m[2].replace(/\*\*/g, ""))}</h${lv}>`);
      } else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
        if (list !== "ul") { close(); html.push("<ul>"); list = "ul"; }
        const depth = Math.floor(m[1].replace(/\t/g, "    ").length / 2);
        html.push(`<li${depth ? ` class="d${Math.min(depth, 3)}"` : ""}>${inlineHtml(m[2])}</li>`);
      } else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/))) {
        if (list !== "ol") { close(); html.push("<ol>"); list = "ol"; }
        html.push(`<li value="${m[2]}">${inlineHtml(m[3])}</li>`);
      } else if (!line.trim()) {
        close();
      } else if ((m = line.match(/^>\s?(.*)$/))) {
        close();
        html.push(`<blockquote>${inlineHtml(m[1])}</blockquote>`);
      } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
        close();
        html.push("<hr>");
      } else {
        close();
        html.push(`<p>${inlineHtml(line.trim())}</p>`);
      }
    }
    close();
    return html.join("\n");
  }

  // 마크다운 → 메모장용 일반 텍스트 (화면에 보이는 모양 그대로)
  function mdToPlain(md) {
    return String(md).split("\n").map((line) => {
      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        const t = stripInline(m[2]);
        return m[1].length === 1 ? `【${t}】` : m[1].length === 2 ? `■ ${t}` : `▸ ${t}`;
      }
      if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) {
        const depth = Math.floor(m[1].replace(/\t/g, "    ").length / 2);
        return "  ".repeat(depth) + "• " + stripInline(m[2]);
      }
      if ((m = line.match(/^>\s?(.*)$/))) return "  " + stripInline(m[1]);
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) return "──────────";
      return stripInline(line);
    }).join("\n");
  }

  function safeName(name) {
    const s = String(name || "").replace(/[\\/:*?"<>|#^\[\]]/g, " ").replace(/\s+/g, " ").trim();
    return (s || "youtube-summary").slice(0, 80);
  }

  // 설정한 모델이 없을 때 쓸 flash 모델 고르기
  function pickFlash(models) {
    const bad = ["lite", "image", "tts", "live", "audio", "embedding", "thinking-exp"];
    const c = (models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n.includes("flash") && !bad.some((b) => n.includes(b)))
      .sort().reverse();
    const stable = c.filter((n) => !n.includes("preview") && !n.includes("exp"));
    return stable[0] || c[0] || null;
  }

  // SSE 버퍼에서 완성된 data: 줄을 꺼내 텍스트 조각을 돌려준다
  function parseSSE(buffer) {
    const texts = [];
    const lines = buffer.split("\n");
    const rest = lines.pop();
    let err = null, usage = null, any = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        any = true;
        if (j.usageMetadata) usage = j.usageMetadata;
        if (j.error) err = j.error.message || "API 오류";
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        for (const p of parts) if (p.text && !p.thought) texts.push(p.text);
      } catch (e) { /* 깨진 줄은 건너뛴다 */ }
    }
    return { texts, rest, err, usage, any };
  }

  // ───────────── 네트워크: 요약 (화면과 서비스 워커가 함께 쓴다) ─────────────
  const API = "https://generativelanguage.googleapis.com/v1beta";

  async function fetchMeta(url) {
    try {
      const r = await fetch(`https://noembed.com/embed?url=${encodeURIComponent(url)}`);
      const j = await r.json();
      if (j && j.title) return { title: j.title, author: j.author_name || "" };
    } catch (e) {}
    return {};
  }

  async function apiError(r) {
    let msg = `HTTP ${r.status}`, details = [];
    try { const j = await r.json(); msg = (j.error && j.error.message) || msg; details = (j.error && j.error.details) || []; } catch (e) {}
    const err = new Error(msg); err.status = r.status;
    for (const d of details) {
      const t = String(d["@type"] || "");
      if (t.endsWith("RetryInfo") && d.retryDelay) err.retryDelay = parseFloat(d.retryDelay); // 초
      if (t.endsWith("QuotaFailure")) {
        const vs = d.violations || [];
        err.quotaIds = vs.map((v) => v.quotaId || v.quotaMetric || "").filter(Boolean);
        const val = vs.map((v) => v.quotaValue).find((x) => x != null && x !== "");
        if (val != null) err.limit = Number(val);
      }
    }
    if (err.limit == null) { const lm = msg.match(/limit:\s*(\d+)/i); if (lm) err.limit = Number(lm[1]); }
    return err;
  }
  // 연결 자체가 끊긴 오류 (HTTP 응답이 없다). 백그라운드에서 안드로이드가 연결을 끊을 때 생긴다
  const isNetwork = (e) => e && e.name !== "AbortError" && !e.status &&
    (e.name === "TypeError" || /failed to fetch|network|load failed|terminated|connection|socket/i.test(String(e.message)));
  // 인터넷이 돌아올 때까지 기다린다 (최대 20초)
  const whenOnline = (signal) => (typeof navigator === "undefined" || navigator.onLine !== false) ? Promise.resolve() :
    new Promise((res) => {
      const t = setTimeout(res, 20000);
      self.addEventListener("online", () => { clearTimeout(t); res(); }, { once: true });
      if (signal) signal.addEventListener("abort", res, { once: true });
    });
  const isTokenMinute = (e) => (e && e.quotaIds || []).some((q) => /token/i.test(q) && /minute/i.test(q));
  const isQuota = (e) => e && (e.status === 429 || /quota|exhausted/i.test(String(e.message)));
  // 하루 한도인지 (분당 한도는 잠깐 기다리면 풀린다)
  const isDailyQuota = (e) => isQuota(e) && ((e.quotaIds || []).some((q) => /PerDay/i.test(q)) || /per day|daily/i.test(String(e.message)) || e.limit === 0);

  // 모델 하나가 실패한 이유를 한 줄로
  function failReason(e) {
    if (isQuota(e)) {
      if (e.limit === 0) return "무료 등급에서 제공 안 함 (한도 0)";
      if (isTokenMinute(e)) return "분당 토큰 한도 초과 (영상이 큼)";
      if (isDailyQuota(e)) return `하루 한도${e.limit ? " " + e.limit + "회" : ""} 다 씀`;
      return `분당 한도${e.limit ? " " + e.limit + "회" : ""} 초과`;
    }
    if (isOverloaded(e)) return "서버 과부하";
    if (isNetwork(e)) return "연결이 끊김 (앱이 백그라운드에 있었을 수 있음)";
    if (isMissingModel(e)) return "이 키로 쓸 수 없는 모델";
    return String(e.message || e).slice(0, 60);
  }

  // fast=true: 프레임을 5초에 1장만 보고(fps 0.2), 추론을 줄인다(thinking low)
  // fast: false/0 = 기본, 1 = 프레임만 줄임(5초에 1장), true/2 = 프레임 + 추론 줄임
  function summaryBody(url, fast, low) {
    const level = fast === true ? 2 : +fast || 0;
    const video = { file_data: { file_uri: url } };
    const body = { contents: [{ role: "user", parts: [video, { text: PROMPT }] }] };
    if (level >= 1) {
      video.video_metadata = { fps: 0.2 };
      // low: 프레임당 토큰 258 → 66 (실험 옵션, 설정에서 켠다)
      if (low) body.generationConfig = { mediaResolution: "MEDIA_RESOLUTION_LOW" };
    }
    if (level >= 2) { body.generationConfig = body.generationConfig || {}; body.generationConfig.thinkingConfig = { thinkingLevel: "low" }; }
    return body;
  }

  async function streamSummary({ apiKey, model, url, fast, low, signal, onText, onLog, stats }) {
    const log = onLog || (() => {});
    const t = Date.now(), lv = fast === true ? 2 : +fast || 0;
    const rec = { model, level: lv, low: !!(low && lv) };
    if (stats) stats.attempts.push(rec);
    const sec = () => Math.round((Date.now() - t) / 1000);
    const fail = (e) => { rec.failed = true; rec.end = Date.now() - t; rec.err = e.status || e.name || "오류"; };
    log(`요청 보냄 · ${model} · 옵션 ${lv}${rec.low ? "+저해상도" : ""}`);
    let r;
    try {
      r = await fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST", signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(summaryBody(url, fast, low)),
      });
    } catch (e) { log(`연결 실패 (${sec()}초): ${e.name} ${String(e.message).slice(0, 50)}`); fail(e); throw e; }
    rec.headers = Date.now() - t;
    log(`응답 HTTP ${r.status} (${sec()}초)`);
    if (!r.ok) { const er = await apiError(r); log(`오류: ${String(er.message).slice(0, 90)}`); fail(er); throw er; }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", acc = "";
    const take = (res) => {
      if (res.usage) rec.usage = res.usage;
      if (res.any && rec.firstData == null) rec.firstData = Date.now() - t;
      if (res.texts.length) {
        if (rec.firstText == null) { rec.firstText = Date.now() - t; log(`첫 글자 ${sec()}초`); }
        acc += res.texts.join(""); onText && onText(acc);
      }
    };
    for (;;) {
      let chunk;
      try { chunk = await reader.read(); }
      catch (e) { log(`스트림 끊김 (${sec()}초, 글자 ${acc.length}): ${e.name} ${String(e.message).slice(0, 40)}`); fail(e); throw e; }
      const { value, done } = chunk;
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
      const res = parseSSE(buf);
      buf = res.rest;
      if (res.err) { log(`스트림 오류: ${String(res.err).slice(0, 90)}`); const e = new Error(res.err); fail(e); throw e; }
      take(res);
    }
    take(parseSSE(buf + "\n"));
    rec.end = Date.now() - t; rec.chars = acc.length;
    log(`스트림 끝 (${sec()}초, 글자 ${acc.length})`);
    return acc;
  }

  async function listModels(apiKey) {
    const r = await fetch(`${API}/models?pageSize=300`, { headers: { "x-goog-api-key": apiKey } });
    if (!r.ok) return [];
    return (await r.json()).models || [];
  }

  const isKeyError = (e) => /api key|permission|blocked/i.test(String(e && e.message));
  const isMissingModel = (e) => e && (e.status === 404 || /not found|not supported for/i.test(String(e.message)));

  // 서버 과부하(503 등): 잠시 뒤 다시 하거나 다른 모델로 넘어가면 풀리는 오류
  const isOverloaded = (e) => e && e.name !== "AbortError" &&
    (e.status === 503 || e.status === 500 || e.status === 504 ||
     /high demand|overloaded|try again later|temporarily|unavailable/i.test(String(e.message)) && !/private|video/i.test(String(e.message)));

  const sleep = (ms, signal) => new Promise((res, rej) => {
    const t = setTimeout(res, ms);
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); const e = new Error("aborted"); e.name = "AbortError"; rej(e); }, { once: true });
  });

  // 과부하일 때 넘어갈 다른 flash 모델들 (지금 모델 제외, 일반 → lite 순)
  // 요약에 쓸 수 있는 모델 전부 (계정에서 실제로 보이는 목록 기준)
  // 순서: Flash → Flash-Lite → Pro → 기타, 각 그룹 안에서 정식 → 미리보기, 새 버전 먼저
  function altFlashModels(models, exclude) {
    const bad = ["image", "tts", "live", "audio", "embedding", "aqa", "imagen", "veo", "gemma", "robotics", "computer-use", "native", "learnlm", "thinking-exp", "nano"];
    const names = [...new Set((models || [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n.startsWith("gemini") && !bad.some((b) => n.includes(b)) && !(exclude || []).includes(n)))];
    const group = (n) => (n.includes("flash") && !n.includes("lite") ? 0 : n.includes("lite") ? 1 : n.includes("pro") ? 2 : 3);
    const pre = (n) => (/preview|exp/.test(n) ? 1 : 0);
    return names.sort((a, b) => group(a) - group(b) || pre(a) - pre(b) || b.localeCompare(a, "en", { numeric: true }));
  }

  // 요약 한 건 실행.
  // - 빠른 옵션이 거부되면 기본 옵션으로 다시 한다
  // - 모델이 없으면 다른 flash 모델로 바꾸고 설정에 저장한다
  // - 서버 과부하면 같은 모델로 2번 더 기다렸다 하고, 그래도 안 되면 다른 모델로 넘어간다 (설정은 그대로)
  async function runSummary({ id, apiKey, model, fast: fastIn, low: lowIn, signal, onProgress, onModel, onFastRejected, onLowRejected, onRetry, onLog, skip, onExhausted }) {
    skip = (skip || []).slice();
    const report = [];   // 모델별 실패 이유
    const markExhausted = (mm, e) => {
      if (e && e.name !== "AbortError") report.push({ model: mm, why: failReason(e) });
      if (isDailyQuota(e) && !skip.includes(mm)) { skip.push(mm); onExhausted && onExhausted(mm); }
    };
    const url = `https://www.youtube.com/watch?v=${id}`;
    const t0 = Date.now();
    const stats = { attempts: [], waitMs: 0, listMs: 0, metaMs: null };
    // 제목 조회는 요약과 동시에 한다 (기다리지 않는다)
    let meta = {};
    const metaP = fetchMeta(url).then((x) => { meta = x || {}; stats.metaMs = Date.now() - t0; return meta; });
    const onText = (acc) => onProgress && onProgress({ meta, url, acc });
    onText("");
    let m = model || "gemini-flash-latest";
    let fast = !!fastIn, low = !!lowIn;
    const log = (x) => onLog && onLog(x);
    log(`시작 · ${m} · 빠른 ${fast ? "켬" : "끔"} · 저해상도 ${low ? "켬" : "끔"}`);
    let modelList = null;
    const getModels = async () => {
      if (modelList) return modelList;
      const t = Date.now(); modelList = await listModels(apiKey); stats.listMs += Date.now() - t;
      return modelList;
    };
    const waitFor = async (ms) => { stats.waitMs += ms; await sleep(ms, signal); };
    // 오늘 한도가 찬 모델이면 처음부터 다른 모델로 시작한다 (요청을 헛되이 쓰지 않게)
    if (skip.includes(m)) {
      const alt = altFlashModels(await getModels(), skip)[0];
      if (alt) { m = alt; onRetry && onRetry({ reason: "skip", model: alt }); }
    }
    const tryFastThenPlain = async (mm) => {
      const base = { apiKey, model: mm, url, signal, onText, onLog, stats };
      if (!fast) return streamSummary(Object.assign({ fast: false, low: false }, base));
      try {
        return await streamSummary(Object.assign({ fast: true, low }, base));
      } catch (e) {
        if (e.status === 400 && !isKeyError(e)) {
          // 추론 설정만 거부하는 모델(lite 등)이 있다 → 프레임 줄이기는 유지하고 한 번 더
          try {
            return await streamSummary(Object.assign({ fast: 1, low }, base));
          } catch (e2) {
            if (!(e2.status === 400 && !isKeyError(e2))) throw e2;
          }
          // 저해상도 옵션만 거부하는 경우: 그 옵션을 빼고 한 번 더
          if (low) {
            try {
              const out2 = await streamSummary(Object.assign({ fast: 1, low: false }, base));
              low = false; onLowRejected && onLowRejected();
              return out2;
            } catch (e3) {
              if (!(e3.status === 400 && !isKeyError(e3))) throw e3;
            }
          }
          // 기본 옵션으로 성공할 때만 "빠른 모드를 지원하지 않음"으로 본다 (비공개 영상 등도 400이 올 수 있음)
          const out = await streamSummary(Object.assign({ fast: false, low: false }, base));
          onFastRejected && onFastRejected();
          return out;
        }
        throw e;
      }
    };
    const withModelFix = async () => {
      try {
        return await tryFastThenPlain(m);
      } catch (e) {
        if (!isMissingModel(e)) throw e;
        const alt = pickFlash(await listModels(apiKey));
        if (!alt || alt === m) throw e;
        m = alt;
        onModel && onModel(alt);
        return tryFastThenPlain(m);
      }
    };

    let body, lastErr;
    const waits = [3000, 8000];            // 같은 모델로 재시도 전 대기 시간
    const netWaits = [2000, 5000, 12000];  // 연결이 끊겼을 때 재시도 전 대기 시간
    let netTry = 0;
    for (let attempt = 0; attempt <= waits.length; attempt++) {
      try { body = await withModelFix(); lastErr = null; break; }
      catch (e) {
        if (isNetwork(e) && netTry < netWaits.length) {
          const w = netWaits[netTry++];
          onText("");
          log(`연결 끊김 → ${Math.round(w / 1000)}초 뒤 재시도 ${netTry}/${netWaits.length}`);
          onRetry && onRetry({ reason: "network", wait: w, model: m, attempt: netTry, of: netWaits.length });
          await waitFor(w);
          await whenOnline(signal);
          attempt--;                       // 과부하 재시도 횟수는 쓰지 않는다
          continue;
        }
        lastErr = e;
        markExhausted(m, e);
        if (attempt === waits.length) break;
        if (isTokenMinute(e)) {
          // 영상이 길어 요청 하나가 분당 토큰 한도를 넘음: 빠른 요약(프레임 5초에 1장)으로 한 번만 줄여 본다
          if (fast) break;
          fast = true;
          onText("");
          onRetry && onRetry({ reason: "shrink", wait: 0, model: m, attempt: 1 });
          continue;
        }
        if (isQuota(e) && !isDailyQuota(e) && (e.retryDelay || 0) <= 45 && attempt === 0) {
          const w = Math.ceil((e.retryDelay || 20) + 1) * 1000;   // 분당 한도: 안내된 시간만큼 한 번만 기다린다
          onText("");
          onRetry && onRetry({ reason: "rate", wait: w, model: m, attempt: 1 });
          await waitFor(w);
          continue;
        }
        if (!isOverloaded(e)) break;
        onText("");
        onRetry && onRetry({ reason: "overloaded", wait: waits[attempt], model: m, attempt: attempt + 1 });
        await waitFor(waits[attempt]);
      }
    }
    // 한도는 모델마다 따로 센다 → 다른 모델은 한도가 남아 있을 수 있다
    if (lastErr && !isTokenMinute(lastErr) && (isOverloaded(lastErr) || isQuota(lastErr))) {
      const tried = skip.concat([m]);
      for (const alt of altFlashModels(await getModels(), tried)) {
        onText("");
        onRetry && onRetry({ reason: "switch", model: alt });
        try { m = alt; body = await tryFastThenPlain(alt); lastErr = null; break; }
        catch (e) {
          tried.push(alt); markExhausted(alt, e);
          if (e.name === "AbortError" || isKeyError(e)) { lastErr = e; break; }
          if (!lastErr || isQuota(e) || !isQuota(lastErr)) lastErr = e;   // 한도 오류를 우선 보여 준다
        }
      }
      if (lastErr) lastErr.triedCount = new Set(tried).size;
    }
    if (lastErr) { lastErr.report = report; throw lastErr; }
    if (!String(body).trim()) throw new Error("빈 응답을 받았습니다. 다시 시도하세요.");
    await Promise.race([metaP, sleep(2500)]);
    const timing = makeTiming(stats, Date.now() - t0, m);
    timingReport(timing).forEach((x) => log("⏱ " + x));
    return { meta, url, body, model: m, ms: Date.now() - t0, timing, md: buildMarkdown(meta, url, body, null, m) };
  }

  // ───────────── 구간별 시간 ─────────────
  // 마지막으로 성공한 시도를 기준으로 구간을 나눈다
  function makeTiming(stats, total, model) {
    const fin = [...stats.attempts].reverse().find((a) => !a.failed) || {};
    const failed = stats.attempts.filter((a) => a.failed).reduce((n, a) => n + (a.end || 0), 0);
    const u = fin.usage || {};
    return {
      total, model, level: fin.level, low: fin.low, tries: stats.attempts.length,
      meta: stats.metaMs, list: stats.listMs, wait: stats.waitMs, failed,
      headers: fin.headers, firstText: fin.firstText, end: fin.end, chars: fin.chars,
      tok: { in: u.promptTokenCount, think: u.thoughtsTokenCount, out: u.candidatesTokenCount },
    };
  }
  const sec1 = (ms) => (ms == null ? "-" : (ms / 1000).toFixed(1) + "초");
  const pct = (a, t) => (t ? Math.round((a / t) * 100) + "%" : "");
  function timingReport(t) {
    if (!t) return [];
    const pre = t.firstText != null && t.headers != null ? t.firstText - t.headers : null;   // 첫 글자까지 (영상 처리 + 추론)
    const gen = t.end != null && t.firstText != null ? t.end - t.firstText : null;          // 글 생성
    const over = (t.wait || 0) + (t.failed || 0);                                          // 재시도·대기·실패한 시도
    // 서버는 첫 글자가 준비된 뒤에야 응답 헤더를 보낸다 → 두 구간이 거의 같으면 하나로 본다
    const merged = pre != null && pre < 1500;
    const PRE = "첫 응답까지 (서버가 영상 읽기+추론)";
    const rows = [
      ["재시도·대기·실패한 시도", over],
      ["모델 목록 조회", t.list || 0],
      merged ? [PRE, t.firstText] : ["서버 접속·응답 시작", t.headers],
      merged ? [PRE + " 중 글자 시작 이후", null] : ["첫 글자까지 (영상 처리+추론)", pre],
      ["글 생성", gen],
    ].filter((r) => !(merged && r[0].endsWith("이후")));
    const lines = [`총 ${sec1(t.total)} · ${t.model || ""} · 옵션 ${t.level == null ? "-" : t.level}${t.low ? "+저해상도" : ""} · 시도 ${t.tries}번`];
    for (const [k, v] of rows) lines.push(`${k}: ${sec1(v)} ${v ? pct(v, t.total) : ""}`.trim());
    lines.push(`제목 조회: ${sec1(t.meta)} (요약과 동시에 함)`);
    const k = t.tok || {};
    if (k.in != null || k.out != null) lines.push(`토큰: 입력 ${k.in ?? "-"} · 추론 ${k.think ?? 0} · 출력 ${k.out ?? "-"}`);
    if (gen > 0 && t.chars) lines.push(`생성 속도: ${Math.round(t.chars / (gen / 1000))}글자/초 (${t.chars}글자)`);
    // 가장 큰 구간 → 가능한 원인 (추정)
    const big = rows.filter((r) => r[1] != null).sort((a, b) => b[1] - a[1])[0];
    if (big && big[1] > 0) {
      const hint = {
        "재시도·대기·실패한 시도": "실패하고 다시 한 시간이 큽니다. 연결 끊김이나 서버 과부하일 수 있습니다. 진단 로그를 보세요.",
        "모델 목록 조회": "모델 목록을 가져오는 데 오래 걸렸습니다.",
        "서버 접속·응답 시작": "접속이나 응답 시작이 느립니다. 네트워크 상태일 수 있습니다.",
        [PRE]: ((k.in || 0) < 60000 && (k.think || 0) < 500)
          ? "입력·추론 토큰이 작은데도 오래 걸립니다. 토큰 계산이 아니라 영상을 가져오는 시간이나 서버 대기열일 가능성이 큽니다. 같은 영상을 한 번 더 돌려 시간이 줄면 영상 캐시, 비슷하면 영상 길이에 비례하는 처리입니다."
          : "영상을 읽고 추론하는 서버 처리가 깁니다(네트워크 아님). 입력 토큰이 크면 해상도 낮춤·프레임 줄이기, 추론 토큰이 크면 추론 줄이기, 또는 lite 모델을 시험해 보세요." + ((k.think || 0) > 1000 ? ` 추론 토큰 ${k.think}개가 쓰였습니다.` : ""),
        "첫 글자까지 (영상 처리+추론)": "영상 처리나 추론이 느립니다. 프레임 해상도 낮춤, lite 모델을 시험해 보세요." + ((k.think || 0) > 1000 ? ` 추론 토큰 ${k.think}개가 쓰였습니다.` : ""),
        "글 생성": "글을 쓰는 시간이 큽니다. 출력이 길거나 모델 속도가 느립니다. lite 모델이 더 빠를 수 있습니다.",
      }[big[0]];
      lines.push(`가장 큰 구간: ${big[0]} → ${hint} (추정)`);
    }
    return lines;
  }

  // 하루 한도는 미국 태평양 시간 자정에 다시 채워진다 → 사용자의 현지 시각으로 바꿔 보여 준다
  function resetAt() {
    const now = new Date();
    const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const next = new Date(la); next.setHours(24, 0, 0, 0);
    return now.getTime() + (next - la);
  }
  function resetTime() {
    try {
      const now = new Date();
      const la = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
      const next = new Date(la); next.setHours(24, 0, 0, 0);
      const t = new Date(now.getTime() + (next - la));
      return t.toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" });
    } catch (x) { return "미국 태평양 시간 자정"; }
  }

  function friendly(e) {
    const base = friendlyBase(e);
    const rep = (e && e.report) || [];
    if (!rep.length) return base;
    const seen = new Set();
    const lines = rep.filter((r) => !seen.has(r.model) && seen.add(r.model)).map((r) => `· ${r.model}: ${r.why}`);
    return base + "\n\n모델별 결과\n" + lines.join("\n");
  }

  function friendlyBase(e) {
    const s = String((e && e.message) || e);
    const low = s.toLowerCase();
    if (e && e.name === "AbortError") return "요약을 멈췄습니다.";
    if (isKeyError(e) && (e.status === 400 || e.status === 401 || e.status === 403))
      return "API 키가 거부됐습니다. 키가 맞는지, 키 제한에 Generative Language API가 들어 있는지 확인하세요. (" + s.slice(0, 120) + ")";
    if (isQuota(e)) {
      if (isTokenMinute(e))
        return "영상이 길어서 요청 하나가 무료 등급의 분당 입력 토큰 한도를 넘었습니다. 사용량과 상관없이 생기는 오류입니다. 빠른 요약으로 줄여서도 시도했지만 넘었습니다. 더 짧은 영상을 쓰거나, 유료 등급으로 올리면 됩니다. (" + (e.quotaIds || []).join(", ") + ")";
      if (isDailyQuota(e))
        return (e.report && e.report.length)
          ? `지금 요약할 수 있는 모델이 없습니다. 모델 ${e.triedCount || e.report.length}개를 시도했습니다. 하루 한도는 ${resetTime()}에 다시 채워지고, 분당 한도는 1분 뒤에 풀립니다.`
          : `오늘 무료 사용량을 다 썼습니다. 한도는 ${resetTime()}에 다시 채워집니다. (한도: ${(e.quotaIds || []).join(", ") || "하루 요청 수"})`;
      return "분당 요청 한도에 걸렸습니다. 1분쯤 뒤 다시 하세요. (" + ((e.quotaIds || []).join(", ") || s.slice(0, 80)) + ")";
    }
    if (isOverloaded(e))
      return "Google 서버에 요청이 몰려 있습니다. 자동으로 다시 시도하고 다른 모델로도 넘어갔지만 모두 바빴습니다. 1~2분 뒤 ‘요약’을 다시 누르세요.";
    if (low.includes("failed to fetch") || low.includes("network") || low.includes("load failed"))
      return "연결이 끊겨 요약하지 못했습니다. 자동으로 3번 다시 했지만 실패했습니다. Wi-Fi·데이터를 확인하고, 요약이 끝날 때까지 앱을 화면에 두면 더 안정적입니다. 안드로이드는 백그라운드 앱의 연결을 끊을 수 있습니다.";
    if (low.includes("private") || low.includes("unavailable"))
      return "이 영상을 읽을 수 없습니다. 비공개·연령 제한·지역 제한 영상은 처리되지 않습니다. (" + s.slice(0, 120) + ")";
    return "오류: " + s.slice(0, 300);
  }

  // ───────────── 네트워크: 음성 (TTS) ─────────────
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // 헤더 없는 16비트 PCM에 WAV 헤더를 붙인다
  function pcmToWav(pcm, rate) {
    const h = new DataView(new ArrayBuffer(44));
    const w = (o, s) => { for (let i = 0; i < s.length; i++) h.setUint8(o + i, s.charCodeAt(i)); };
    w(0, "RIFF"); h.setUint32(4, 36 + pcm.length, true); w(8, "WAVE");
    w(12, "fmt "); h.setUint32(16, 16, true); h.setUint16(20, 1, true); h.setUint16(22, 1, true);
    h.setUint32(24, rate, true); h.setUint32(28, rate * 2, true); h.setUint16(32, 2, true); h.setUint16(34, 16, true);
    w(36, "data"); h.setUint32(40, pcm.length, true);
    const out = new Uint8Array(44 + pcm.length);
    out.set(new Uint8Array(h.buffer), 0);
    out.set(pcm, 44);
    return out;
  }

  // 응답 JSON 어디에 있든 오디오 데이터(base64)를 찾는다. 마지막 것을 돌려준다.
  function findAudio(obj) {
    let found = null;
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      const mime = String(o.mime_type || o.mimeType || "");
      if (typeof o.data === "string" && o.data.length > 100 && (o.type === "audio" || mime.startsWith("audio"))) {
        found = { data: o.data, mime };
      }
      for (const k in o) if (k !== "data") walk(o[k]);
    };
    walk(obj);
    return found;
  }

  function audioBlobFrom(found) {
    let bytes = b64ToBytes(found.data);
    const isWav = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46; // "RIFF"
    if (!isWav) {
      const m = found.mime.match(/rate=(\d+)/);
      bytes = pcmToWav(bytes, m ? +m[1] : 24000);
    }
    return new Blob([bytes], { type: "audio/wav" });
  }

  // 문서상의 Interactions API를 먼저 쓰고, 안 되면 예전 generateContent 방식으로 한 번 더 시도한다
  async function tts({ apiKey, model, voice, text, signal }) {
    const headers = { "Content-Type": "application/json", "x-goog-api-key": apiKey };
    let r = await fetch(`${API}/interactions`, {
      method: "POST", signal, headers,
      body: JSON.stringify({
        model,
        input: [{ type: "user_input", content: [{ type: "text", text }] }],
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      }),
    });
    if (!r.ok && (r.status === 400 || r.status === 404)) {
      r = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST", signal, headers,
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
          },
        }),
      });
    }
    if (!r.ok) throw await apiError(r);
    const found = findAudio(await r.json());
    if (!found) throw new Error("음성 데이터가 응답에 없습니다.");
    return audioBlobFrom(found);
  }

  function pickTts(models) {
    const c = (models || [])
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n.includes("tts") && n.includes("flash"))
      .sort().reverse();
    const stable = c.filter((n) => !n.includes("preview") && !n.includes("lite"));
    return stable[0] || c[0] || null;
  }

  // 요약 마크다운 → 읽을 조각들. 첫 조각은 짧게 해서 빨리 재생을 시작한다.
  function speechChunks(md, firstMax, restMax) {
    firstMax = firstMax || 300; restMax = restMax || 1200;
    const clean = (s) => stripInline(s)
      .replace(/\(\s*\d{1,2}:\d{2}(?::\d{2})?\s*\)/g, "")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\s+/g, " ").trim();
    const lines = String(md).split("\n");
    const title = clean((lines[0] || "").replace(/^#\s+/, ""));
    let start = lines.findIndex((l) => /^##\s/.test(l));
    if (start < 0) start = 1;
    const units = [];
    if (title) units.push({ sec: -1, text: title.replace(/[.!?]?$/, ".") });
    let sec = -1;
    for (const l of lines.slice(start)) {
      if (!l.trim() || /^\s*(-{3,}|\*{3,})\s*$/.test(l)) continue;
      const h = l.match(/^(#{2,6})\s+(.*)$/);
      let t;
      if (h) {
        if (h[1].length === 2) sec++;
        t = clean(h[2]);
        if (t && !/[.!?]$/.test(t)) t += ".";
      } else {
        t = clean(l.replace(/^\s*([-*+]|\d+[.)])\s+/, "").replace(/^>\s?/, ""));
        if (t && !/[.!?。]$/.test(t)) t += ".";
      }
      if (t) units.push({ sec: Math.max(sec, 0), text: t });
    }
    const chunks = [];
    let cur = null;
    for (const u of units) {
      const max = chunks.length === 0 ? firstMax : restMax;
      if (cur && cur.text.length + u.text.length + 1 > max) { chunks.push(cur); cur = null; }
      if (!cur) cur = { sec: u.sec, text: u.text };
      else cur.text += " " + u.text;
    }
    if (cur) chunks.push(cur);
    return chunks;
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // ───────────── IndexedDB (서비스 워커와 화면이 함께 쓰는 저장소) ─────────────
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("ytnote", 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains("inbox")) db.createObjectStore("inbox", { keyPath: "id" });
        if (!db.objectStoreNames.contains("audio")) db.createObjectStore("audio", { keyPath: "id" });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  async function idbDo(store, mode, fn) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode);
      const req = fn(tx.objectStore(store));
      let out;
      if (req) req.onsuccess = () => { out = req.result; };
      tx.oncomplete = () => { db.close(); res(out); };
      tx.onerror = () => { db.close(); rej(tx.error); };
      tx.onabort = () => { db.close(); rej(tx.error); };
    });
  }
  const idb = {
    put: (store, v) => idbDo(store, "readwrite", (s) => s.put(v)),
    get: (store, k) => idbDo(store, "readonly", (s) => s.get(k)),
    all: (store) => idbDo(store, "readonly", (s) => s.getAll()),
    del: (store, k) => idbDo(store, "readwrite", (s) => s.delete(k)),
  };

  const VERSION = "2026-10-23.6";
  const fmtMs = (ms) => { const s = Math.round((ms || 0) / 1000); return s < 60 ? s + "초" : Math.floor(s / 60) + "분 " + (s % 60) + "초"; };
  const api = {
    VERSION, fmtMs, timingReport,
    YT_RE, PROMPT, extractId, normalize, buildMarkdown, mdToHtml, mdToPlain, safeName, pickFlash, parseSSE, escapeHtml,
    fetchMeta, runSummary, friendly, isOverloaded, altFlashModels, isQuota, isDailyQuota, isTokenMinute, resetTime, resetAt, failReason, tts, pickTts, listModels, speechChunks, hash, idb, pcmToWav, findAudio, summaryBody,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== "undefined" ? self : this);
