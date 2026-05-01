// ============================================================
// js/progress.js — TOTKA 2.0
// Reusable animated progress bar component
// Requires: config.js loaded first
// ============================================================

class TotkaProgress {

  // ── CONSTRUCTOR ─────────────────────────────────────────────
  // containerId: ID of the div where the progress bar renders
  constructor(containerId) {
    this.container   = document.getElementById(containerId);
    this.currentPct  = 0;
    this.isVisible   = false;
    this._rafId      = null;
    this._targetPct  = 0;

    if (!this.container) {
      console.warn(`[TotkaProgress] Container #${containerId} not found`);
      return;
    }
    this._render();
  }

  // ── RENDER HTML ─────────────────────────────────────────────
  _render() {
    this.container.innerHTML = `
      <div class="prog-wrap" id="prog-wrap-${this.container.id}" style="display:none">
        <div class="prog-header">
          <span class="prog-status" id="prog-status-${this.container.id}">Preparing...</span>
          <span class="prog-pct"    id="prog-pct-${this.container.id}">0%</span>
        </div>
        <div class="prog-track">
          <div class="prog-fill" id="prog-fill-${this.container.id}"></div>
        </div>
        <div class="prog-detail" id="prog-detail-${this.container.id}"></div>
        <div class="prog-steps"  id="prog-steps-${this.container.id}"></div>
      </div>
    `;

    // Cache element refs
    const id        = this.container.id;
    this._wrap      = document.getElementById(`prog-wrap-${id}`);
    this._statusEl  = document.getElementById(`prog-status-${id}`);
    this._pctEl     = document.getElementById(`prog-pct-${id}`);
    this._fillEl    = document.getElementById(`prog-fill-${id}`);
    this._detailEl  = document.getElementById(`prog-detail-${id}`);
    this._stepsEl   = document.getElementById(`prog-steps-${id}`);
  }

  // ── SHOW ─────────────────────────────────────────────────────
  show(label = "Starting...", steps = []) {
    if (!this._wrap) return;
    this._wrap.style.display = "block";
    this._wrap.className     = "prog-wrap prog-wrap--active";
    this.isVisible           = true;
    this.currentPct          = 0;
    this._targetPct          = 0;

    if (this._fillEl)  this._fillEl.style.width = "0%";
    if (this._pctEl)   this._pctEl.textContent  = "0%";
    if (this._detailEl)this._detailEl.textContent = "";

    this._setStatus(label);

    // Optional step indicators
    if (steps.length > 0) {
      this._stepsEl.innerHTML = steps.map((s, i) =>
        `<span class="prog-step" id="prog-step-${this.container.id}-${i}">${s}</span>`
      ).join("");
    } else {
      this._stepsEl.innerHTML = "";
    }
  }

  // ── UPDATE ───────────────────────────────────────────────────
  update(pct, status = "", detail = "") {
    if (!this._wrap) return;
    const clamped    = Math.max(0, Math.min(100, Math.round(pct)));
    this._targetPct  = clamped;

    this._animateFill(clamped);
    if (status) this._setStatus(status);
    if (detail !== undefined && this._detailEl) {
      this._detailEl.textContent = detail;
    }

    // Color shift: blue → green as we approach 100%
    if (this._fillEl) {
      if (clamped < 40) {
        this._fillEl.style.background = "linear-gradient(90deg, #58a6ff, #79c0ff)";
      } else if (clamped < 80) {
        this._fillEl.style.background = "linear-gradient(90deg, #58a6ff, #00e5ff)";
      } else {
        this._fillEl.style.background = "linear-gradient(90deg, #238636, #3fb950)";
      }
    }
  }

  // ── MARK A STEP COMPLETE ─────────────────────────────────────
  completeStep(stepIndex) {
    const el = document.getElementById(`prog-step-${this.container.id}-${stepIndex}`);
    if (el) {
      el.classList.add("prog-step--done");
      el.textContent = "✓ " + el.textContent.replace(/^[✓·] /, "");
    }
  }

  // ── SUCCESS STATE ────────────────────────────────────────────
  success(msg = "Done!", detail = "", autoHide = true) {
    this.update(100, "✅ " + msg, detail);
    if (this._wrap) {
      this._wrap.classList.add("prog-wrap--success");
      this._wrap.classList.remove("prog-wrap--error");
    }
    if (autoHide) {
      setTimeout(() => this.hide(), 3000);
    }
  }

  // ── ERROR STATE ──────────────────────────────────────────────
  error(msg, detail = "") {
    if (!this._wrap) return;
    this._wrap.classList.add("prog-wrap--error");
    this._wrap.classList.remove("prog-wrap--success");
    this._setStatus("❌ " + msg);
    if (detail && this._detailEl) this._detailEl.textContent = detail;
    if (this._fillEl) {
      this._fillEl.style.background = "var(--accent-red)";
      this._fillEl.style.width      = "100%";
    }
    if (this._pctEl) this._pctEl.textContent = "Error";
  }

  // ── HIDE ─────────────────────────────────────────────────────
  hide() {
    if (!this._wrap) return;
    this._wrap.style.opacity   = "0";
    this._wrap.style.transform = "translateY(-4px)";
    setTimeout(() => {
      if (this._wrap) {
        this._wrap.style.display   = "none";
        this._wrap.style.opacity   = "";
        this._wrap.style.transform = "";
        this._wrap.className       = "prog-wrap";
        this.isVisible             = false;
        this.currentPct            = 0;
      }
    }, 300);
  }

  // ── RESET ────────────────────────────────────────────────────
  reset() {
    this.hide();
    setTimeout(() => {
      if (this._fillEl)  this._fillEl.style.width = "0%";
      if (this._pctEl)   this._pctEl.textContent  = "0%";
      if (this._statusEl)this._statusEl.textContent = "";
      if (this._detailEl)this._detailEl.textContent = "";
      if (this._stepsEl) this._stepsEl.innerHTML   = "";
    }, 350);
  }

  // ── INTERNAL: Smooth fill animation ─────────────────────────
  _animateFill(target) {
    if (!this._fillEl || !this._pctEl) return;
    if (this._rafId) cancelAnimationFrame(this._rafId);

    const animate = () => {
      const diff = target - this.currentPct;
      if (Math.abs(diff) < 0.5) {
        this.currentPct = target;
      } else {
        this.currentPct += diff * 0.15; // ease factor
      }
      this._fillEl.style.width     = this.currentPct + "%";
      this._pctEl.textContent      = Math.round(this.currentPct) + "%";
      if (this.currentPct !== target) {
        this._rafId = requestAnimationFrame(animate);
      }
    };
    this._rafId = requestAnimationFrame(animate);
  }

  // ── INTERNAL: Set status text ─────────────────────────────
  _setStatus(text) {
    if (this._statusEl) this._statusEl.textContent = text;
  }
}


// ── INJECT PROGRESS CSS (if not in app.css) ──────────────────
(function injectProgressCSS() {
  if (document.getElementById("totka-progress-css")) return;
  const style = document.createElement("style");
  style.id    = "totka-progress-css";
  style.textContent = `
    .prog-wrap {
      background:    rgba(255,255,255,0.04);
      border:        1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding:       16px 18px;
      margin:        14px 0;
      transition:    opacity 0.3s ease, transform 0.3s ease,
                     border-color 0.3s ease, background 0.3s ease;
    }
    .prog-wrap--active  { border-color: rgba(88,166,255,0.3); }
    .prog-wrap--success { border-color: rgba(35,134,54,0.5);
                          background:   rgba(35,134,54,0.06); }
    .prog-wrap--error   { border-color: rgba(218,54,51,0.5);
                          background:   rgba(218,54,51,0.06); }

    .prog-header {
      display:         flex;
      justify-content: space-between;
      align-items:     center;
      margin-bottom:   10px;
    }
    .prog-status {
      font-family: 'JetBrains Mono', monospace;
      font-size:   13px;
      color:       #e6edf3;
      font-weight: 500;
    }
    .prog-pct {
      font-family: 'JetBrains Mono', monospace;
      font-size:   12px;
      color:       #58a6ff;
      font-weight: 700;
      min-width:   38px;
      text-align:  right;
    }
    .prog-track {
      background:    rgba(255,255,255,0.07);
      border-radius: 999px;
      height:        8px;
      overflow:      hidden;
    }
    .prog-fill {
      height:        100%;
      border-radius: 999px;
      width:         0%;
      background:    linear-gradient(90deg, #58a6ff, #79c0ff);
      box-shadow:    0 0 12px rgba(88,166,255,0.45);
      transition:    background 0.5s ease;
    }
    .prog-detail {
      font-family: 'JetBrains Mono', monospace;
      font-size:   11px;
      color:       #8b949e;
      margin-top:  8px;
      min-height:  16px;
    }
    .prog-steps {
      display:    flex;
      flex-wrap:  wrap;
      gap:        6px;
      margin-top: 10px;
    }
    .prog-step {
      font-family:   'JetBrains Mono', monospace;
      font-size:     11px;
      color:         #8b949e;
      background:    rgba(255,255,255,0.05);
      border:        1px solid rgba(255,255,255,0.08);
      border-radius: 4px;
      padding:       3px 8px;
      transition:    all 0.3s ease;
    }
    .prog-step--done {
      color:        #3fb950;
      border-color: rgba(63,185,80,0.4);
      background:   rgba(63,185,80,0.08);
    }
  `;
  document.head.appendChild(style);
})();
