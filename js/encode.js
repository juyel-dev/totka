// ============================================================
// js/encode.js — TOTKA 2.0
// File upload → encode → metadata form → save post
// Requires: config.js, api.js, engine.js, image.js, progress.js
// ============================================================

const ENCODE_PAGE = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _file         = null;   // selected File object
  let _encoded      = "";     // result of TOTKA_ENGINE.encode()
  let _originalSize = 0;
  let _originalFmt  = "";
  let _worker       = null;   // Web Worker (large files)
  let _nsfw         = false;
  let _progress     = null;   // TotkaProgress instance
  let _stage        = "idle"; // idle | encoding | saving | done

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    // Must be logged in to encode
    if (!requireLogin("login.html?next=encode.html")) return;

    _progress = new TotkaProgress("progress-container");

    _bindDropZone();
    _bindMetaForm();
    _bindNsfwToggle();
    _bindTagInput();
    _bindCharCounters();
    _showStage("pick");
  }

  // ── STAGE MANAGER ────────────────────────────────────────────
  // Stages: pick → info → encoding → done
  function _showStage(stage) {
    ["stage-pick", "stage-info", "stage-done"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    const target = document.getElementById(`stage-${stage}`);
    if (target) target.classList.remove("hidden");
  }

  // ── DROP ZONE ────────────────────────────────────────────────
  function _bindDropZone() {
    const zone  = document.getElementById("drop-zone");
    const input = document.getElementById("file-input");
    if (!zone || !input) return;

    // Click on zone → open file picker
    zone.addEventListener("click", () => input.click());

    // File picked via input
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) _handleFile(input.files[0]);
    });

    // Drag & drop
    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("drag-over");
    });
    zone.addEventListener("dragleave", () => zone.classList.remove("drag-over"));
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("drag-over");
      const f = e.dataTransfer.files?.[0];
      if (f) _handleFile(f);
    });
  }

  // ── HANDLE FILE SELECTION ─────────────────────────────────────
  function _handleFile(file) {
    // Size check
    if (file.size > TOTKA.MAX_FILE_SIZE) {
      showToast(`File too large (max ${formatSize(TOTKA.MAX_FILE_SIZE)})`, "error");
      return;
    }
    if (file.size === 0) {
      showToast("File is empty", "error");
      return;
    }

    _file         = file;
    _originalSize = file.size;
    _originalFmt  = formatSize(file.size);

    // Update drop zone to show selected file
    const zone = document.getElementById("drop-zone");
    if (zone) {
      zone.innerHTML = `
        <div class="drop-zone__icon">📄</div>
        <div class="drop-zone__text" style="color:var(--accent-blue);font-weight:700">
          ${esc(file.name)}
        </div>
        <div class="drop-zone__hint">${formatSize(file.size)} · ${file.type || "unknown type"}</div>
        <div class="drop-zone__hint" style="margin-top:6px;color:var(--accent-green)">
          ✅ File selected — click Next to continue
        </div>
        <input type="file" id="file-input" style="position:absolute;inset:0;opacity:0;cursor:pointer"/>
      `;
      // Re-bind input after re-render
      document.getElementById("file-input")?.addEventListener("change", (e) => {
        if (e.target.files?.[0]) _handleFile(e.target.files[0]);
      });
    }

    // Pre-fill title from filename (strip extension)
    const titleInput = document.getElementById("meta-title");
    if (titleInput && !titleInput.value) {
      titleInput.value = file.name.replace(/\.[^/.]+$/, "").slice(0, TOTKA.MAX_TITLE_LEN);
      _updateCharCount("meta-title", "title-count", TOTKA.MAX_TITLE_LEN);
    }

    // Show next button
    const nextBtn = document.getElementById("btn-next");
    if (nextBtn) nextBtn.classList.remove("hidden");
  }

  // ── METADATA FORM ─────────────────────────────────────────────
  function _bindMetaForm() {
    // "Next" button → go to info stage
    document.getElementById("btn-next")?.addEventListener("click", () => {
      if (!_file) { showToast("Select a file first", "warning"); return; }
      _showStage("info");
    });

    // "Back" button → go back to pick
    document.getElementById("btn-back")?.addEventListener("click", () => {
      _showStage("pick");
    });

    // Submit form → start encoding
    document.getElementById("meta-form")?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (_stage !== "idle") return;
      await _startEncode();
    });
  }

  // ── NSFW TOGGLE ───────────────────────────────────────────────
  function _bindNsfwToggle() {
    const toggle = document.getElementById("nsfw-toggle");
    const label  = document.getElementById("nsfw-label");
    if (!toggle) return;

    toggle.addEventListener("click", () => {
      _nsfw = !_nsfw;
      toggle.classList.toggle("on", _nsfw);
      toggle.classList.toggle("nsfw-toggle", _nsfw);
      if (label) {
        label.textContent = _nsfw ? "🔞 Marked as NSFW" : "Mark as NSFW (18+)";
        label.style.color = _nsfw ? "var(--accent-red-br)" : "var(--text-muted)";
      }
    });
  }

  // ── TAG INPUT (comma-separated, pill display) ──────────────────
  function _bindTagInput() {
    const input = document.getElementById("meta-tags");
    if (!input) return;

    input.addEventListener("input", () => {
      const val   = input.value;
      const tags  = val.split(",").map(t => t.trim()).filter(Boolean);
      const count = document.getElementById("tag-count");
      if (count) {
        count.textContent = `${tags.length}/5 tags`;
        count.style.color = tags.length > 5 ? "var(--accent-red)" : "var(--text-muted)";
      }
    });

    // Enforce 5 tags max on blur
    input.addEventListener("blur", () => {
      const tags = input.value.split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
      input.value = tags.slice(0, 5).join(", ");
    });
  }

  // ── CHARACTER COUNTERS ────────────────────────────────────────
  function _bindCharCounters() {
    [
      ["meta-title", "title-count", TOTKA.MAX_TITLE_LEN],
      ["meta-desc",  "desc-count",  TOTKA.MAX_DESC_LEN],
      ["meta-alt",   "alt-count",   200],
    ].forEach(([inputId, countId, max]) => {
      const el = document.getElementById(inputId);
      if (!el) return;
      el.addEventListener("input", () => _updateCharCount(inputId, countId, max));
    });
  }

  function _updateCharCount(inputId, countId, max) {
    const val   = document.getElementById(inputId)?.value || "";
    const count = document.getElementById(countId);
    if (!count) return;
    const len = val.length;
    count.textContent = `${len}/${max}`;
    count.style.color = len > max * 0.9
      ? len > max ? "var(--accent-red)" : "var(--accent-gold)"
      : "var(--text-muted)";
  }

  // ── START ENCODING ────────────────────────────────────────────
  async function _startEncode() {
    // Validate form
    const title = document.getElementById("meta-title")?.value.trim();
    const tags  = document.getElementById("meta-tags")?.value.trim();
    const desc  = document.getElementById("meta-desc")?.value.trim() || "";
    const alt   = document.getElementById("meta-alt")?.value.trim()  || "";

    if (!title) {
      document.getElementById("meta-title")?.focus();
      showToast("Enter a title for your post", "warning");
      return;
    }
    if (title.length > TOTKA.MAX_TITLE_LEN) {
      showToast(`Title too long (max ${TOTKA.MAX_TITLE_LEN} chars)`, "error");
      return;
    }

    const tagList = tags ? tags.split(",").map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    if (tagList.length > 5) {
      showToast("Max 5 tags allowed", "error");
      return;
    }

    _stage = "encoding";
    _disableForm(true);

    // Show progress
    _progress.show("Starting...", ["Read", "Compress", "Encode", "Save"]);

    try {
      // Read file as Uint8Array
      _progress.update(5, "Reading file...", formatSize(_file.size));
      const buffer = await _file.arrayBuffer();
      const uint8  = new Uint8Array(buffer);
      _progress.completeStep(0);

      // Choose Web Worker for large files (>10MB), main thread for small
      _progress.update(10, "Compressing & encoding...", "");

      if (_file.size > 10 * 1024 * 1024) {
        // Large file → Web Worker
        _worker  = TOTKA_WORKER.create();
        _encoded = await _worker.encode(uint8, (pct, status, detail) => {
          _progress.update(10 + Math.floor(pct * 0.7), status, detail);
        });
        _worker.terminate();
        _worker = null;
      } else {
        // Small file → main thread (synchronous, simpler)
        _encoded = TOTKA_ENGINE.encode(uint8, (pct, status, detail) => {
          _progress.update(10 + Math.floor(pct * 0.7), status, detail);
        });
      }

      _progress.completeStep(1);
      _progress.completeStep(2);
      _progress.update(82, "Saving to cloud...", `${_encoded.length.toLocaleString()} chars`);

      // Save post via GAS 3
      const res = await API.WRITE.savePost({
        encoded:      _encoded,
        title,
        tags:         tagList.join(","),
        description:  desc,
        alt,
        nsfw:         _nsfw,
        originalSize: _originalFmt,
        userId:       SESSION.getUserId(),
        username:     SESSION.getUsername(),
      });

      _progress.completeStep(3);

      if (res.error) {
        throw new Error(res.message || res.error);
      }

      // ── SUCCESS ─────────────────────────────────────────────
      _progress.success("Saved successfully!", `Post ID: ${res.postId}`);
      _stage = "done";
      _showDoneStage(res, title, tagList);

    } catch (err) {
      _progress.error(err.message || "Something went wrong");
      _stage = "idle";
      _disableForm(false);
      if (_worker) { _worker.terminate(); _worker = null; }
      showToast(err.message || "Encoding failed", "error");
    }
  }

  // ── DONE STAGE ───────────────────────────────────────────────
  function _showDoneStage(res, title, tags) {
    _showStage("done");

    // Fill in result values
    const els = {
      "done-post-id":     res.postId,
      "done-title":       title,
      "done-size":        _originalFmt,
      "done-encoded-len": `${Number(res.encodedLen).toLocaleString()} chars`,
      "done-chunks":      `${res.chunks} chunk${res.chunks !== 1 ? "s" : ""}`,
      "done-storage":     res.storageId,
    };
    Object.entries(els).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });

    // Tags
    const tagsEl = document.getElementById("done-tags");
    if (tagsEl && tags.length) {
      tagsEl.innerHTML = tags.map(t =>
        `<span class="card-tag">#${esc(t)}</span>`
      ).join("");
    }

    // Wire up done-stage buttons
    document.getElementById("btn-copy-id")?.addEventListener("click", () => {
      copyToClipboard(res.postId, "Post ID copied!");
    });

    document.getElementById("btn-share-post")?.addEventListener("click", async () => {
      const url   = `${TOTKA.SITE_URL}/?id=${res.postId}`;
      const text  = `Check out "${title}" on TOTKA`;
      if (navigator.share) {
        try { await navigator.share({ title: text, url }); } catch (_) {}
      } else {
        copyToClipboard(url, "Share link copied!");
      }
    });

    document.getElementById("btn-go-feed")?.addEventListener("click", () => {
      window.location.href = "index.html";
    });

    document.getElementById("btn-encode-another")?.addEventListener("click", () => {
      window.location.reload();
    });
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function _disableForm(disabled) {
    ["meta-title","meta-tags","meta-desc","meta-alt","btn-submit","btn-back"]
      .forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init };

})();

document.addEventListener("DOMContentLoaded", ENCODE_PAGE.init);
