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

  function buildMarkdown(meta, url, body, now) {
    const title = (meta && meta.title) || "YouTube 영상 요약";
    const head = [`# ${title}`, ""];
    if (meta && meta.author) head.push(`- 채널: ${meta.author}`);
    head.push(`- 링크: ${url}`);
    head.push(`- 요약일: ${stamp(now || new Date())}`);
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
    let err = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        if (j.error) err = j.error.message || "API 오류";
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        for (const p of parts) if (p.text && !p.thought) texts.push(p.text);
      } catch (e) { /* 깨진 줄은 건너뛴다 */ }
    }
    return { texts, rest, err };
  }

  const api = { YT_RE, PROMPT, extractId, normalize, buildMarkdown, mdToHtml, mdToPlain, safeName, pickFlash, parseSSE, escapeHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Core = api;
})(typeof self !== "undefined" ? self : this);
