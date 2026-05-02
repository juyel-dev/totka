// ============================================================
// js/decode.js — TOTKA 2.0 (updated for embedded metadata)
// Fetch encoded chunks → decode → trigger file download
// Requires: config.js, api.js, engine.js, progress.js
// ============================================================

const DECODE_PAGE = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _progress  = null;
  let _busy      = false;
  let _lastPostId= "";

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    _progress = new TotkaProgress("progress-container");

    _bindForm();
    _bindRecentList();

    const param = new URLSearchParams(window.location.search).get("id");
    if (param) {
      const input = document.getElementById("post-id-input");
      if (input) input.value = param.trim().toLowerCase();
      setTimeout(() => startDecode(param.trim()), 300);
    }

    _updateNav();
  }

  // ── BIND FORM ─────────────────────────────────────────────────
  function _bindForm() {
    const form  = document.getElementById("decode-form");
    const input = document.getElementById("post-id-input");
    const btn   = document.getElementById("decode-btn");

    if (!form) return;

    input?.addEventListener("input", () => {
      const val  = input.value.trim().toLowerCase();
      const hint = document.getElementById("id-hint");
      if (!hint) return;

      if (!val) {
        hint.textContent = "";
        return;
      }
      if (/^im\d{5}$/.test(val)) {
        hint.textContent = "✅ Valid Post ID format";
        hint.style.color = "var(--accent-green-br)";
      } else if (val.startsWith("im")) {
        hint.textContent = "Format: im + 5 digits (e.g. im00042)";
        hint.style.color = "var(--accent-gold)";
      } else {
        hint.textContent = "Post IDs start with \"im\" (e.g. im00042)";
        hint.style.color = "var(--text-muted)";
      }
    });

    document.getElementById("paste-btn")?.addEventListener("click", async () => {
      try {
        const text = await navigator.clipboard.readText();
        const id   = text.trim().toLowerCase();
        if (input) {
          input.value = id;
          input.dispatchEvent(new Event("input"));
          input.focus();
        }
      } catch (_) {
        showToast("Clipboard access denied — paste manually", "warning");
      }
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const id = input?.value.trim().toLowerCase();
      if (!id) {
        showToast("Enter a Post ID", "warning");
        input?.focus();
        return;
      }
      startDecode(id);
    });
  }

  // ── START DECODE ──────────────────────────────────────────────
  async function startDecode(postId) {
    if (_busy) return;

    postId = postId.trim().toLowerCase();
    if (!postId) { showToast("Enter a Post ID", "warning"); return; }

    if (!/^im\d{1,}$/.test(postId)) {
      _showError(`"${postId}" doesn't look like a valid Post ID. Format: im00042`);
      return;
    }

    _busy       = true;
    _lastPostId = postId;

    _hideError();
    _hideResult();
    _setBtn(true);

    _progress.show("Connecting...", ["Fetch Meta", "Fetch Chunks", "Decode", "Download"]);

    try {
      // Step 1: Fetch post metadata for display
      _progress.update(8, "Fetching post info...", postId);
      const meta = await API.FEED.getPostMeta(postId);

      if (meta.error) {
        throw new Error(meta.error === "NOT_FOUND"
          ? `Post "${postId}" not found — check the ID and try again`
          : meta.message || meta.error);
      }
      _progress.completeStep(0);

      _showPostInfo(meta);

      // Step 2: Fetch encoded chunks
      _progress.update(18, "Fetching encoded data...",
        `${meta.totalChunks} chunk${meta.totalChunks!==1?"s":""}`);

      const data = await API.DECODE.getEncodedData(postId);

      if (data.error) {
        throw new Error(
          data.error === "POST_NOT_FOUND"   ? `Post "${postId}" not found`          :
          data.error === "NO_CHUNKS_FOUND"  ? "No data found for this post"         :
          data.error === "REGISTRY_UNREACHABLE" ? "Storage service unreachable — try again" :
          data.message || data.error
        );
      }

      if (!data.encoded || data.encoded.length === 0) {
        throw new Error("Received empty data — post may be corrupted");
      }
      _progress.completeStep(1);

      const encoded    = data.encoded;
      const totalChars = encoded.length;

      // Step 3: Decode (returns { bytes, meta })
      _progress.update(35, "Decoding bits...", `${totalChars.toLocaleString()} chars`);

      let decodedResult;
      try {
        decodedResult = TOTKA_ENGINE.decode(encoded, (pct, status, detail) => {
          _progress.update(35 + Math.floor(pct * 0.55), status, detail);
        });
      } catch (decodeErr) {
        throw new Error("Decode failed — data may be corrupted. " + decodeErr.message);
      }
      _progress.completeStep(2);

      const originalBytes = decodedResult.bytes;
      const fileMeta      = decodedResult.meta;   // null if old (no header)

      // Use embedded metadata if present, otherwise fallback to guess
      const fileName = fileMeta ? fileMeta.fileName : _guessFileName(meta.title, meta.alt);
      const fileType = fileMeta ? fileMeta.mimeType : _guessFileType(fileName);
      const sizeStr  = formatSize(originalBytes.length);

      // Step 4: Trigger browser download
      _progress.update(96, "Preparing download...", sizeStr);
      await _triggerDownload(originalBytes, fileName, fileType);
      _progress.completeStep(3);
      _progress.success(`Downloaded! (${sizeStr})`, fileName);

      _showResult({
        postId, fileName, fileType,
        originalSize: sizeStr,
        encodedLen:   totalChars,
        chunks:       meta.totalChunks,
      });

      _addToRecent({ postId, title: meta.title, size: sizeStr, ts: Date.now() });

    } catch (err) {
      _progress.error(err.message || "Decode failed");
      _showError(err.message || "Something went wrong. Please try again.");
    } finally {
      _busy = false;
      _setBtn(false);
    }
  }

  // ── TRIGGER BROWSER DOWNLOAD ──────────────────────────────────
  async function _triggerDownload(uint8Array, fileName, fileType) {
    const blob = new Blob([uint8Array], { type: fileType });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = fileName;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  // ── GUESS FILENAME (fallback) ─────────────────────────────────
  function _guessFileName(title, alt) {
    const candidates = [alt, title].filter(Boolean);
    for (const c of candidates) {
      if (/\.\w{1,5}$/.test(c)) return c.trim();
    }
    const safe = (title || "totka_file")
      .replace(/[^a-zA-Z0-9\-_. ]/g, "_")
      .replace(/\s+/g, "_")
      .trim()
      .slice(0, 60);
    return safe || "totka_file";
  }

  // ── GUESS MIME TYPE (fallback) ────────────────────────────────
  function _guessFileType(fileName) {
    const ext = (fileName.split(".").pop() || "").toLowerCase();
    const map  = {
      jpg:"image/jpeg", jpeg:"image/jpeg", png:"image/png",
      gif:"image/gif",  webp:"image/webp", svg:"image/svg+xml",
      bmp:"image/bmp",  ico:"image/x-icon",
      mp4:"video/mp4",  mkv:"video/x-matroska", avi:"video/x-msvideo",
      mov:"video/quicktime", webm:"video/webm", flv:"video/x-flv",
      mp3:"audio/mpeg", wav:"audio/wav",  ogg:"audio/ogg",
      flac:"audio/flac",m4a:"audio/mp4",  aac:"audio/aac",
      pdf:"application/pdf",
      doc:"application/msword",
      docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls:"application/vnd.ms-excel",
      xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt:"application/vnd.ms-powerpoint",
      pptx:"application/vnd.openxmlformats-officedocument.presentationml.presentation",
      txt:"text/plain", csv:"text/csv", json:"application/json",
      xml:"application/xml", html:"text/html", css:"text/css",
      js:"application/javascript",
      zip:"application/zip", rar:"application/vnd.rar",
      "7z":"application/x-7z-compressed", tar:"application/x-tar",
      gz:"application/gzip",
      apk:"application/vnd.android.package-archive",
      exe:"application/x-msdownload", dmg:"application/x-apple-diskimage",
      ttf:"font/ttf", woff:"font/woff", woff2:"font/woff2",
      py:"text/x-python", java:"text/x-java-source",
    };
    return map[ext] || "application/octet-stream";
  }

  // ── SHOW POST INFO CARD ───────────────────────────────────────
  function _showPostInfo(meta) {
    const card = document.getElementById("post-info-card");
    if (!card) return;

    const tags = String(meta.tags || "")
      .split(",").map(t => t.trim()).filter(Boolean);

    card.innerHTML = `
      <div class="glass-card" style="padding:14px;margin-bottom:var(--space-md)">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:8px">
          <div>
            <div style="font-size:14px;font-weight:700;color:var(--text-primary);margin-bottom:3px">
              ${esc(meta.title)}
            </div>
            <div style="font-size:11px;color:var(--text-muted)">
              by @${esc(meta.username)} · ${timeAgo(meta.timestamp)}
            </div>
          </div>
          ${meta.nsfw ? '<span class="badge badge--nsfw">NSFW</span>' : ''}
        </div>
        ${meta.description ? `<p style="font-size:12px;color:var(--text-secondary);margin-bottom:8px">${esc(meta.description)}</p>` : ''}
        ${tags.length ? `
        <div class="card-tags" style="margin-bottom:8px">
          ${tags.map(t => `<span class="card-tag">#${esc(t)}</span>`).join("")}
        </div>` : ""}
        <div style="display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--text-muted)">
          ${meta.originalSize ? `<span>💾 ${esc(String(meta.originalSize))}</span>` : ""}
          <span>📊 ${Number(meta.encodedLen||0).toLocaleString()} chars</span>
          <span>🧩 ${meta.totalChunks} chunk${meta.totalChunks!==1?"s":""}</span>
          <span>🆔 <code style="color:var(--accent-blue)">${meta.postId}</code></span>
        </div>
      </div>
    `;
    card.style.display = "block";
  }

  // ── SHOW RESULT ───────────────────────────────────────────────
  function _showResult({ postId, fileName, originalSize, encodedLen, chunks }) {
    const card = document.getElementById("result-card");
    if (!card) return;

    card.innerHTML = `
      <div style="background:rgba(35,134,54,0.07);border:1px solid rgba(35,134,54,0.25);
        border-radius:var(--radius-md);padding:var(--space-md);margin-top:var(--space-md)">
        <div style="font-size:1.4rem;text-align:center;margin-bottom:8px">✅</div>
        <div style="text-align:center;font-family:var(--font-heading);font-size:0.95rem;
          color:var(--accent-green-br);margin-bottom:var(--space-md)">
          Download Complete!
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:var(--space-md)">
          ${[
            ["File", fileName],
            ["Size", originalSize],
            ["Post ID", postId],
            ["Chunks", chunks],
          ].map(([label, val]) => `
            <div style="background:var(--bg-tertiary);border:1px solid var(--glass-border);
              border-radius:var(--radius-sm);padding:10px 12px">
              <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;
                letter-spacing:.5px;margin-bottom:3px">${label}</div>
              <div style="font-size:12px;font-weight:700;color:var(--text-primary);
                word-break:break-all">${esc(String(val))}</div>
            </div>
          `).join("")}
        </div>
        <div style="display:flex;flex-direction:column;gap:8px">
          <button class="btn btn--success btn--full" onclick="DECODE_PAGE.reDownload()">
            ⬇️ Download Again
          </button>
          <button class="btn btn--ghost btn--full"
            onclick="copyToClipboard('${postId}','Post ID copied!')">
            📋 Copy Post ID
          </button>
          <a href="index.html" class="btn btn--ghost btn--full">🏠 Back to Feed</a>
        </div>
      </div>
    `;
    card.style.display = "block";
  }

  // ── RE-DOWNLOAD ───────────────────────────────────────────────
  function reDownload() {
    if (_lastPostId) startDecode(_lastPostId);
  }

  // ── ERROR UI ──────────────────────────────────────────────────
  function _showError(msg) {
    const el = document.getElementById("error-box");
    if (!el) return;
    el.innerHTML = `
      <div style="background:rgba(218,54,51,0.08);border:1px solid rgba(218,54,51,0.3);
        border-radius:var(--radius-md);padding:var(--space-md)">
        <div style="font-size:1.1rem;margin-bottom:6px">❌</div>
        <div style="font-size:13px;color:var(--accent-red-br);font-weight:700;margin-bottom:4px">
          Decode Failed
        </div>
        <div style="font-size:12px;color:var(--text-muted)">${esc(msg)}</div>
        <button class="btn btn--ghost btn--sm" style="margin-top:10px"
          onclick="DECODE_PAGE.clearError()">Try Again</button>
      </div>`;
    el.style.display = "block";
  }

  function _hideError() {
    const el = document.getElementById("error-box");
    if (el) { el.innerHTML = ""; el.style.display = "none"; }
  }

  function _hideResult() {
    const els = ["result-card", "post-info-card"];
    els.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.innerHTML = ""; el.style.display = "none"; }
    });
  }

  function clearError() {
    _hideError();
    document.getElementById("post-id-input")?.focus();
  }

  // ── RECENT DECODES (localStorage) ────────────────────────────
  const RECENT_KEY = "totka_recent_decodes";
  const RECENT_MAX = 8;

  function _addToRecent(item) {
    try {
      let list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      list = list.filter(r => r.postId !== item.postId);
      list.unshift(item);
      list = list.slice(0, RECENT_MAX);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      _renderRecent(list);
    } catch (_) {}
  }

  function _bindRecentList() {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      if (list.length) _renderRecent(list);
    } catch (_) {}
  }

  function _renderRecent(list) {
    const wrap = document.getElementById("recent-wrap");
    const sect = document.getElementById("recent-section");
    if (!wrap || !list.length) return;
    if (sect) sect.style.display = "block";

    wrap.innerHTML = list.map(item => `
      <button class="recent-item" onclick="DECODE_PAGE.decodeRecent('${item.postId}')">
        <span class="recent-item__id">${esc(item.postId)}</span>
        <span class="recent-item__title">${esc(item.title || "—")}</span>
        <span class="recent-item__size">${item.size || ""}</span>
      </button>
    `).join("");
  }

  function decodeRecent(postId) {
    const input = document.getElementById("post-id-input");
    if (input) input.value = postId;
    startDecode(postId);
  }

  function clearRecent() {
    localStorage.removeItem(RECENT_KEY);
    const wrap = document.getElementById("recent-wrap");
    const sect = document.getElementById("recent-section");
    if (wrap) wrap.innerHTML = "";
    if (sect) sect.style.display = "none";
  }

  // ── UI HELPERS ────────────────────────────────────────────────
  function _setBtn(loading) {
    const btn = document.getElementById("decode-btn");
    if (!btn) return;
    btn.disabled    = loading;
    btn.textContent = loading ? "Decoding..." : "🔓 Decode & Download";
  }

  function _updateNav() {
    const el = document.getElementById("nav-profile-link");
    if (!el) return;
    if (SESSION.isLoggedIn()) {
      el.href = "profile.html";
      const pic = SESSION.getPic();
      if (pic) {
        el.style.backgroundImage = `url(${pic})`;
        el.style.backgroundSize  = "cover";
        el.textContent           = "";
      } else {
        el.textContent = (SESSION.getName()||SESSION.getUsername()||"?").charAt(0).toUpperCase();
      }
    } else {
      el.href = "login.html";
    }
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init, startDecode, reDownload, clearError, decodeRecent, clearRecent };

})();

document.addEventListener("DOMContentLoaded", DECODE_PAGE.init);
