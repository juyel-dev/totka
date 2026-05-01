// ============================================================
// js/admin.js — TOTKA 2.0
// Secret admin panel — stats, storage, posts, users, notify
// Requires: config.js, api.js loaded first
// NO external auth — password checked client-side via SHA-256
// ============================================================

const ADMIN = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _authed = false;

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    // Check if already authed this session
    if (sessionStorage.getItem("totka_admin_ok") === "1") {
      _authed = true;
      _showDashboard();
      _loadAll();
      return;
    }
    _showLoginScreen();
    _bindLoginForm();
  }

  // ── LOGIN ─────────────────────────────────────────────────────
  function _showLoginScreen() {
    document.getElementById("login-screen") ?.classList.remove("hidden");
    document.getElementById("dashboard")    ?.classList.add("hidden");
  }

  function _showDashboard() {
    document.getElementById("login-screen") ?.classList.add("hidden");
    document.getElementById("dashboard")    ?.classList.remove("hidden");
  }

  function _bindLoginForm() {
    const form = document.getElementById("admin-login-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const pass = document.getElementById("admin-pass")?.value;
      if (!pass) return;

      const btn = document.getElementById("admin-login-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Checking..."; }

      const hash = await sha256(pass);

      if (btn) { btn.disabled = false; btn.textContent = "Enter"; }

      if (hash === TOTKA.ADMIN_PASS) {
        _authed = true;
        sessionStorage.setItem("totka_admin_ok", "1");
        _showDashboard();
        _loadAll();
      } else {
        const err = document.getElementById("login-err");
        if (err) {
          err.textContent  = "Wrong password";
          err.style.display= "block";
        }
        // Shake animation
        const card = document.getElementById("login-card");
        if (card) {
          card.style.animation = "none";
          setTimeout(() => { card.style.animation = "shake 0.4s ease"; }, 10);
        }
      }
    });
  }

  // ── LOAD ALL DASHBOARD DATA ───────────────────────────────────
  async function _loadAll() {
    await Promise.all([
      _loadStats(),
      _loadStorage(),
      _loadRecentPosts(),
      _loadRecentUsers(),
    ]);
  }

  // ── STATS ─────────────────────────────────────────────────────
  async function _loadStats() {
    const res = await API.ADMIN.getStats();
    if (res.error) { _setEl("stats-error", res.message || res.error); return; }

    _setEl("stat-posts",       res.totalPosts    ?? "—");
    _setEl("stat-users",       res.totalUsers    ?? "—");
    _setEl("stat-nsfw",        res.nsfwPosts     ?? "—");
    _setEl("stat-24h",         res.postsLast24h  ?? "—");
    _setEl("stat-sheets",      res.totalSheets   ?? "—");
    _setEl("stat-full-sheets", res.fullSheets    ?? "—");

    // Active storage bar
    const active = res.activeStorage;
    if (active) {
      _setEl("active-sheet-id",   active.sheetId  || "—");
      _setEl("active-sheet-rows", `${Number(active.totalRows).toLocaleString()} / ${Number(active.maxLimit).toLocaleString()}`);
      _setEl("active-sheet-pct",  `${active.usedPct}%`);

      const bar = document.getElementById("active-storage-bar");
      if (bar) {
        bar.style.width = active.usedPct + "%";
        bar.className   = "storage-bar-fill " + (
          active.usedPct >= 90 ? "storage-bar-fill--danger" :
          active.usedPct >= 70 ? "storage-bar-fill--warn"   :
          "storage-bar-fill--ok"
        );
      }

      // Warning if nearly full
      if (active.usedPct >= 90) {
        showToast(`⚠️ Storage ${active.sheetId} is ${active.usedPct}% full!`, "warning", 6000);
      }
    }

    // Generated at
    _setEl("stats-updated", res.generatedAt
      ? new Date(res.generatedAt).toLocaleString("en-BD", { timeZone:"Asia/Dhaka" })
      : "—");
  }

  // ── STORAGE LIST ──────────────────────────────────────────────
  async function _loadStorage() {
    const wrap = document.getElementById("storage-list");
    if (!wrap) return;

    wrap.innerHTML = _skeletonRows(3, 3);

    const res = await API.ADMIN.getStorageList();
    if (res.error || !res.sheets) {
      wrap.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">
        Failed to load storage list</td></tr>`;
      return;
    }

    if (res.sheets.length === 0) {
      wrap.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">
        No storage sheets registered</td></tr>`;
      return;
    }

    wrap.innerHTML = res.sheets.map(s => {
      const statusColor = {
        ACTIVE: "var(--accent-green-br)",
        FULL:   "var(--accent-red-br)",
        EMPTY:  "var(--text-muted)",
      }[s.status] || "var(--text-muted)";

      const barPct   = s.usedPct || 0;
      const barClass = barPct >= 90 ? "storage-bar-fill--danger"
                     : barPct >= 70 ? "storage-bar-fill--warn"
                     : "storage-bar-fill--ok";

      return `
      <tr>
        <td>
          <span class="code-inline" style="font-size:11px">${esc(s.sheetId)}</span>
        </td>
        <td>
          <div class="storage-bar-wrap">
            <div class="storage-bar-fill ${barClass}" style="width:${barPct}%"></div>
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
            ${Number(s.totalRows).toLocaleString()} / ${Number(s.maxLimit).toLocaleString()}
            (${barPct}%)
          </div>
        </td>
        <td>
          <span style="color:${statusColor};font-size:12px;font-weight:700">
            ${s.status}
          </span>
        </td>
        <td>
          <span style="font-size:10px;color:var(--text-muted)">
            ${s.notes || "—"}
          </span>
        </td>
        <td>
          <a href="https://docs.google.com/spreadsheets/d/${esc(s.spreadsheetId)}"
            target="_blank" class="btn btn--ghost btn--sm" style="font-size:10px">
            🔗 Open
          </a>
        </td>
      </tr>`;
    }).join("");
  }

  // ── ADD STORAGE SHEET ─────────────────────────────────────────
  async function addStorage() {
    const sheetId       = document.getElementById("new-sheet-id")     ?.value.trim();
    const spreadsheetId = document.getElementById("new-spreadsheet-id")?.value.trim();
    const sheetName     = document.getElementById("new-sheet-name")    ?.value.trim();
    const notes         = document.getElementById("new-sheet-notes")   ?.value.trim() || "";

    if (!sheetId || !spreadsheetId || !sheetName) {
      showToast("Fill in Sheet ID, Spreadsheet ID, and Tab Name", "warning");
      return;
    }

    const btn = document.getElementById("add-storage-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Adding..."; }

    const res = await API.ADMIN.addStorage({ sheetId, spreadsheetId, sheetName, notes });

    if (btn) { btn.disabled = false; btn.textContent = "➕ Add Storage Sheet"; }

    if (res.success) {
      showToast(`Storage ${sheetId} added! ✅`, "success");
      // Clear inputs
      ["new-sheet-id","new-spreadsheet-id","new-sheet-name","new-sheet-notes"]
        .forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
      _loadStorage();
      _loadStats();
    } else {
      showToast(res.message || res.error || "Failed to add storage", "error");
    }
  }

  // ── RECENT POSTS ──────────────────────────────────────────────
  async function _loadRecentPosts() {
    const wrap = document.getElementById("recent-posts-list");
    if (!wrap) return;

    wrap.innerHTML = _skeletonRows(5, 5);

    const res = await API.ADMIN.getRecentPosts(15);
    if (res.error || !res.posts) {
      wrap.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">
        Failed to load posts</td></tr>`;
      return;
    }

    if (res.posts.length === 0) {
      wrap.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">
        No posts yet</td></tr>`;
      return;
    }

    wrap.innerHTML = res.posts.map(p => `
      <tr id="post-row-${p.postId}">
        <td>
          <span class="code-inline" style="font-size:11px">${esc(p.postId)}</span>
        </td>
        <td>
          <div style="font-size:12px;font-weight:600;color:var(--text-primary);
            max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(p.title)}
          </div>
          ${p.nsfw ? '<span class="badge badge--nsfw" style="font-size:9px">NSFW</span>' : ""}
        </td>
        <td style="font-size:11px;color:var(--text-muted)">@${esc(p.username)}</td>
        <td style="font-size:11px;color:var(--text-muted)">${timeAgo(p.timestamp)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <a href="decode.html?id=${p.postId}" target="_blank"
              class="btn btn--ghost btn--sm" style="font-size:10px">🔓</a>
            <button class="btn btn--ghost btn--sm"
              style="font-size:10px;color:var(--accent-red-br)"
              onclick="ADMIN.deletePost('${p.postId}')">🗑️</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  // ── DELETE POST (admin) ───────────────────────────────────────
  async function deletePost(postId) {
    const reason = prompt(`Delete post ${postId}?\n\nReason (optional):`);
    if (reason === null) return; // cancelled

    const res = await API.ADMIN.deletePost(postId, reason || "Admin action");
    if (res.success) {
      const row = document.getElementById(`post-row-${postId}`);
      if (row) {
        row.style.opacity    = "0";
        row.style.transition = "opacity 0.3s";
        setTimeout(() => row.remove(), 300);
      }
      showToast(`Post ${postId} deleted ✅`, "success");
    } else {
      showToast(res.message || "Delete failed", "error");
    }
  }

  // ── RECENT USERS ──────────────────────────────────────────────
  async function _loadRecentUsers() {
    const wrap = document.getElementById("recent-users-list");
    if (!wrap) return;

    wrap.innerHTML = _skeletonRows(5, 4);

    const res = await API.ADMIN.getRecentUsers(15);
    if (res.error || !res.users) {
      wrap.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">
        Failed to load users</td></tr>`;
      return;
    }

    if (res.users.length === 0) {
      wrap.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">
        No users yet</td></tr>`;
      return;
    }

    wrap.innerHTML = res.users.map(u => `
      <tr>
        <td>
          <span class="code-inline" style="font-size:11px">${esc(u.userId)}</span>
        </td>
        <td style="font-size:12px;font-weight:600;color:var(--text-primary)">
          @${esc(u.username)}
          <div style="font-size:10px;color:var(--text-muted);font-weight:400">
            ${esc(u.profession || "—")}
          </div>
        </td>
        <td style="font-size:11px;color:var(--text-muted)">${timeAgo(u.createdAt)}</td>
        <td>
          <a href="profile.html?uid=${u.userId}" target="_blank"
            class="btn btn--ghost btn--sm" style="font-size:10px">View</a>
        </td>
      </tr>
    `).join("");
  }

  // ── SEND NOTIFICATION ─────────────────────────────────────────
  async function sendNotification() {
    const msg    = document.getElementById("notify-message")?.value.trim();
    const target = document.getElementById("notify-target") ?.value.trim() || "all";

    if (!msg) { showToast("Enter a message", "warning"); return; }

    const btn = document.getElementById("send-notify-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Sending..."; }

    const res = await API.ADMIN.sendNotification(msg, target);

    if (btn) { btn.disabled = false; btn.textContent = "📢 Send Notification"; }

    if (res.success) {
      showToast("Notification sent via Telegram ✅", "success");
      const el = document.getElementById("notify-message");
      if (el) el.value = "";
    } else {
      showToast(res.message || "Failed to send", "error");
    }
  }

  // ── REFRESH ALL ───────────────────────────────────────────────
  async function refreshAll() {
    const btn = document.getElementById("refresh-btn");
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Loading..."; }
    await _loadAll();
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Refresh"; }
    showToast("Dashboard refreshed", "success");
  }

  // ── LOGOUT ADMIN ──────────────────────────────────────────────
  function adminLogout() {
    sessionStorage.removeItem("totka_admin_ok");
    _authed = false;
    _showLoginScreen();
    const passEl = document.getElementById("admin-pass");
    if (passEl) passEl.value = "";
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function _setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _skeletonRows(rows, cols) {
    return Array(rows).fill(0).map(() => `
      <tr>${Array(cols).fill(0).map(() => `
        <td><div class="skeleton" style="height:14px;width:80%;border-radius:4px"></div></td>
      `).join("")}</tr>
    `).join("");
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return {
    init,
    addStorage,
    deletePost,
    sendNotification,
    refreshAll,
    adminLogout,
  };

})();

document.addEventListener("DOMContentLoaded", ADMIN.init);
