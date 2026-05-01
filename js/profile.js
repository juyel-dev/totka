// ============================================================
// js/profile.js — TOTKA 2.0
// View any user profile, edit own profile, post history,
// social links, personal sheet linking
// Requires: config.js, api.js, image.js loaded first
// ============================================================

const PROFILE_PAGE = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _viewUserId  = "";   // whose profile we're viewing
  let _isOwn       = false;// are we viewing our own profile?
  let _editMode    = false;
  let _newPicB64   = "";   // compressed pic waiting to save
  let _userPosts   = [];

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    // Determine whose profile to show
    const params     = new URLSearchParams(window.location.search);
    const paramUid   = params.get("uid") || params.get("profile") || "";
    const sessionUid = SESSION.getUserId() || "";

    if (paramUid) {
      _viewUserId = paramUid;
      _isOwn      = sessionUid && (paramUid === sessionUid);
    } else if (sessionUid) {
      // No param → show own profile
      _viewUserId = sessionUid;
      _isOwn      = true;
    } else {
      // Not logged in, no param → redirect to login
      window.location.href = "login.html?next=profile.html";
      return;
    }

    _loadProfile();
    _loadUserPosts();
    _bindEditBtn();
    _bindEditForm();
    _bindPicInput();
    _bindSheetForm();
    _bindLogout();
    _updateTopNav();
  }

  // ── LOAD PROFILE DATA ────────────────────────────────────────
  async function _loadProfile() {
    showSkeleton("profile-header-wrap", _profileSkeleton());

    const res = await API.FEED.getUserInfo(_viewUserId);

    if (res.error) {
      document.getElementById("profile-header-wrap").innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">👤</div>
          <div class="empty-state__title">User not found</div>
          <p class="empty-state__text">This profile doesn't exist or was removed.</p>
        </div>`;
      return;
    }

    _renderProfileHeader(res);

    // If own profile, pre-fill edit form with session data
    if (_isOwn) _prefillEditForm(res);
  }

  // ── RENDER PROFILE HEADER ─────────────────────────────────────
  function _renderProfileHeader(user) {
    const wrap = document.getElementById("profile-header-wrap");
    if (!wrap) return;

    // Parse social links
    let links = {};
    try { links = typeof user.socialLinks === "string"
      ? JSON.parse(user.socialLinks) : (user.socialLinks || {}); } catch (_) {}

    const socialHtml = Object.entries({
      twitter: ["🐦", "Twitter"],
      ig:      ["📸", "Instagram"],
      fb:      ["📘", "Facebook"],
      gh:      ["💻", "GitHub"],
    }).filter(([key]) => links[key])
      .map(([key, [icon, label]]) => `
        <a href="${esc(links[key])}" target="_blank" rel="noopener"
          class="social-link">${icon} ${label}</a>
      `).join("");

    wrap.innerHTML = `
      <div class="profile-header anim-fade-in">

        <!-- Avatar -->
        <div style="position:relative;display:inline-block">
          <img class="profile-avatar"
            id="profile-avatar-img"
            src="${user.profilePic || IMAGE.generateAvatar(user.name || user.username, 90)}"
            alt="@${esc(user.username)}"
            onerror="this.src='${IMAGE.generateAvatar(user.name||user.username,90)}'"/>
          ${_isOwn ? `
          <label for="edit-pic-input" style="
            position:absolute; bottom:2px; right:2px;
            background:var(--accent-blue); border-radius:50%;
            width:26px; height:26px; display:flex; align-items:center;
            justify-content:center; cursor:pointer; font-size:13px;
            border:2px solid var(--bg-primary);" title="Change photo">✏️</label>` : ""}
        </div>

        <!-- Name & username -->
        <div class="profile-name">${esc(user.name || user.username)}</div>
        <div class="profile-username">@${esc(user.username)}</div>

        <!-- Profession -->
        ${user.profession ? `
          <span class="profile-profession">${esc(user.profession)}</span>` : ""}

        <!-- Bio -->
        ${user.bio ? `
          <p class="profile-bio">${esc(user.bio)}</p>` : ""}

        <!-- Stats -->
        <div class="profile-stats">
          <div class="profile-stat">
            <div class="profile-stat__num" id="post-count-num">
              ${user.postCount ?? "—"}
            </div>
            <div class="profile-stat__label">Posts</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat__num">
              ${user.createdAt
                ? new Date(user.createdAt).toLocaleDateString("en-BD",{month:"short",year:"numeric"})
                : "—"}
            </div>
            <div class="profile-stat__label">Joined</div>
          </div>
        </div>

        <!-- Social links -->
        ${socialHtml ? `<div class="social-links">${socialHtml}</div>` : ""}

        <!-- Own profile actions -->
        ${_isOwn ? `
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center">
          <button class="btn btn--ghost btn--sm" id="edit-profile-btn">
            ✏️ Edit Profile
          </button>
          <a href="encode.html" class="btn btn--primary btn--sm">
            ⬆️ New Post
          </a>
          <button class="btn btn--ghost btn--sm" id="logout-btn"
            style="color:var(--accent-red-br)">
            🚪 Logout
          </button>
        </div>` : `
        <div style="margin-top:8px">
          <button class="btn btn--ghost btn--sm"
            onclick="copyToClipboard('${_viewUserId}','User ID copied!')">
            📋 Copy User ID
          </button>
        </div>`}

      </div>
    `;

    // Re-bind after re-render
    _bindEditBtn();
    _bindLogout();
  }

  // ── LOAD USER POSTS ───────────────────────────────────────────
  async function _loadUserPosts() {
    const wrap = document.getElementById("user-posts-wrap");
    if (!wrap) return;

    showSkeleton("user-posts-wrap", _postsSkeleton());

    const res = await API.FEED.getUserPosts(_viewUserId);

    if (res.error || !res.posts) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📭</div>
        <div class="empty-state__title">No posts yet</div>
        ${_isOwn ? '<p class="empty-state__text"><a href="encode.html" class="text-accent">Upload your first file →</a></p>' : ""}
      </div>`;
      return;
    }

    _userPosts = res.posts;

    // Update post count in header
    const countEl = document.getElementById("post-count-num");
    if (countEl) countEl.textContent = res.total;

    if (res.posts.length === 0) {
      wrap.innerHTML = `<div class="empty-state">
        <div class="empty-state__icon">📭</div>
        <div class="empty-state__title">No posts yet</div>
        ${_isOwn ? '<p class="empty-state__text"><a href="encode.html" class="text-accent">Upload your first file →</a></p>' : ""}
      </div>`;
      return;
    }

    wrap.innerHTML = res.posts.map(post => _postRow(post)).join("");
  }

  // ── RENDER POST ROW ───────────────────────────────────────────
  function _postRow(post) {
    const tags  = String(post.tags || "").split(",").map(t=>t.trim()).filter(Boolean);
    const isOwn = _isOwn;

    return `
    <div class="glass-card" style="padding:14px;margin-bottom:10px" data-post="${post.postId}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:var(--text-primary);
            margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${esc(post.title)}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-bottom:6px">
            ${timeAgo(post.timestamp)}
            ${post.nsfw ? ' · <span class="badge badge--nsfw" style="font-size:9px">NSFW</span>' : ""}
          </div>
          ${tags.length ? `
          <div class="card-tags" style="margin-bottom:6px">
            ${tags.map(t=>`<span class="card-tag" style="font-size:10px">#${esc(t)}</span>`).join("")}
          </div>` : ""}
          <div style="display:flex;gap:8px;font-size:11px;color:var(--text-muted);flex-wrap:wrap">
            ${post.originalSize ? `<span>💾 ${esc(String(post.originalSize))}</span>` : ""}
            <span>📊 ${Number(post.encodedLen||0).toLocaleString()} chars</span>
            <span>🧩 ${post.totalChunks}</span>
            <span class="code-inline" style="font-size:10px">${post.postId}</span>
          </div>
        </div>
        <!-- Actions -->
        <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0">
          <a href="decode.html?id=${post.postId}"
            class="btn btn--primary btn--sm" style="font-size:11px">
            🔓 Decode
          </a>
          <button class="btn btn--ghost btn--sm" style="font-size:11px"
            onclick="copyToClipboard('${post.postId}','Post ID copied!')">
            📋 Copy
          </button>
          ${isOwn ? `
          <button class="btn btn--ghost btn--sm" style="font-size:11px;color:var(--accent-red-br)"
            onclick="PROFILE_PAGE.deletePost('${post.postId}')">
            🗑️ Delete
          </button>` : ""}
        </div>
      </div>
    </div>`;
  }

  // ── DELETE POST (from profile) ────────────────────────────────
  async function deletePost(postId) {
    if (!confirm(`Delete post ${postId}?\nThis cannot be undone.`)) return;
    const res = await API.WRITE.deletePost(postId);
    if (res.success) {
      const card = document.querySelector(`[data-post="${postId}"]`);
      if (card) {
        card.style.opacity   = "0";
        card.style.transform = "translateX(-8px)";
        card.style.transition= "all 0.3s";
        setTimeout(() => {
          card.remove();
          // Update count
          _userPosts = _userPosts.filter(p => p.postId !== postId);
          const el = document.getElementById("post-count-num");
          if (el) el.textContent = _userPosts.length;
        }, 300);
      }
      showToast("Post deleted", "success");
    } else {
      showToast(res.message || "Delete failed", "error");
    }
  }

  // ── EDIT PROFILE ──────────────────────────────────────────────
  function _bindEditBtn() {
    document.getElementById("edit-profile-btn")?.addEventListener("click", () => {
      _toggleEditPanel(true);
    });
  }

  function _toggleEditPanel(show) {
    const panel = document.getElementById("edit-panel");
    if (!panel) return;
    _editMode = show;
    panel.classList.toggle("hidden", !show);
    if (show) panel.scrollIntoView({ behavior:"smooth", block:"start" });
  }

  function _prefillEditForm(user) {
    const fields = {
      "edit-name":       user.name       || "",
      "edit-bio":        user.bio        || "",
      "edit-profession": user.profession || "",
    };
    Object.entries(fields).forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.value = val;
    });

    // Social links
    let links = {};
    try { links = typeof user.socialLinks === "string"
      ? JSON.parse(user.socialLinks) : (user.socialLinks || {}); } catch (_) {}

    ["twitter","ig","fb","gh"].forEach(key => {
      const el = document.getElementById(`edit-${key}`);
      if (el) el.value = links[key] || "";
    });

    // Sheet linking
    const sheetIdEl = document.getElementById("edit-sheet-id");
    const sheetNmEl = document.getElementById("edit-sheet-name");
    if (sheetIdEl) sheetIdEl.value = SESSION.getSheetId()   || user.sheetId   || "";
    if (sheetNmEl) sheetNmEl.value = SESSION.getSheetName() || user.sheetName || "";

    // Bio char count
    _updateBioCount();
  }

  function _bindEditForm() {
    // Bio counter
    document.getElementById("edit-bio")?.addEventListener("input", _updateBioCount);

    // Cancel
    document.getElementById("edit-cancel-btn")?.addEventListener("click", () => {
      _toggleEditPanel(false);
    });

    // Save profile
    document.getElementById("edit-save-btn")?.addEventListener("click", async () => {
      await _saveProfile();
    });
  }

  function _updateBioCount() {
    const bio   = document.getElementById("edit-bio")?.value || "";
    const count = document.getElementById("bio-count");
    if (count) {
      count.textContent = `${bio.length}/${TOTKA.MAX_BIO_LEN}`;
      count.style.color = bio.length > TOTKA.MAX_BIO_LEN
        ? "var(--accent-red)" : "var(--text-muted)";
    }
  }

  async function _saveProfile() {
    const name       = document.getElementById("edit-name")?.value.trim();
    const bio        = document.getElementById("edit-bio")?.value.trim() || "";
    const profession = document.getElementById("edit-profession")?.value.trim() || "";

    if (!name) { showToast("Name cannot be empty", "error"); return; }
    if (bio.length > TOTKA.MAX_BIO_LEN) {
      showToast(`Bio max ${TOTKA.MAX_BIO_LEN} characters`, "error"); return;
    }

    const socialLinks = {
      twitter: document.getElementById("edit-twitter")?.value.trim() || "",
      ig:      document.getElementById("edit-ig")?.value.trim()      || "",
      fb:      document.getElementById("edit-fb")?.value.trim()      || "",
      gh:      document.getElementById("edit-gh")?.value.trim()      || "",
    };

    const btn = document.getElementById("edit-save-btn");
    if (btn) { btn.disabled = true; btn.textContent = "Saving..."; }

    const res = await API.AUTH.updateProfile({
      userId:     SESSION.getUserId(),
      name, bio, profession, socialLinks,
      profilePic: _newPicB64 || undefined,
    });

    if (btn) { btn.disabled = false; btn.textContent = "Save Changes"; }

    if (res.success) {
      showToast("Profile updated! ✅", "success");
      _toggleEditPanel(false);
      // Reload profile section
      setTimeout(() => _loadProfile(), 400);
    } else {
      showToast(res.message || "Save failed", "error");
    }
  }

  // ── PROFILE PIC INPUT ─────────────────────────────────────────
  function _bindPicInput() {
    const input   = document.getElementById("edit-pic-input");
    const preview = document.getElementById("edit-pic-preview");
    const status  = document.getElementById("edit-pic-status");
    if (!input) return;

    input.addEventListener("change", async () => {
      const result = await IMAGE.handleFileInput(input, preview, status);
      if (result) {
        _newPicB64 = result.base64;
        // Also update the visible avatar immediately
        const avatarImg = document.getElementById("profile-avatar-img");
        if (avatarImg) avatarImg.src = result.base64;
      }
    });
  }

  // ── PERSONAL SHEET LINKING ────────────────────────────────────
  function _bindSheetForm() {
    document.getElementById("link-sheet-btn")?.addEventListener("click", async () => {
      const sheetId   = document.getElementById("edit-sheet-id")  ?.value.trim();
      const sheetName = document.getElementById("edit-sheet-name") ?.value.trim();

      if (!sheetId || !sheetName) {
        showToast("Enter both Spreadsheet ID and Tab name", "warning");
        return;
      }

      const btn = document.getElementById("link-sheet-btn");
      if (btn) { btn.disabled = true; btn.textContent = "Linking..."; }

      const res = await API.AUTH.linkSheet({
        userId: SESSION.getUserId(),
        sheetId, sheetName,
      });

      if (btn) { btn.disabled = false; btn.textContent = "🔗 Link Sheet"; }

      if (res.success) {
        showToast("Personal sheet linked! ✅", "success");
      } else {
        showToast(res.message || "Failed to link sheet", "error");
      }
    });
  }

  // ── LOGOUT ────────────────────────────────────────────────────
  function _bindLogout() {
    document.getElementById("logout-btn")?.addEventListener("click", () => {
      if (confirm("Log out of TOTKA?")) API.AUTH.logout();
    });
  }

  // ── TOP NAV ───────────────────────────────────────────────────
  function _updateTopNav() {
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
    }
  }

  // ── SKELETON HELPERS ──────────────────────────────────────────
  function showSkeleton(containerId, html) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  }

  function _profileSkeleton() {
    return `
    <div class="profile-header">
      <div class="skeleton" style="width:90px;height:90px;border-radius:50%;margin-bottom:12px"></div>
      <div class="skeleton skeleton-line skeleton-line--md" style="height:16px;margin-bottom:8px"></div>
      <div class="skeleton skeleton-line skeleton-line--sm" style="height:12px;margin-bottom:12px"></div>
      <div class="skeleton skeleton-line" style="width:200px;height:12px;margin-bottom:16px"></div>
      <div style="display:flex;gap:24px;justify-content:center">
        <div class="skeleton" style="width:50px;height:40px;border-radius:6px"></div>
        <div class="skeleton" style="width:50px;height:40px;border-radius:6px"></div>
      </div>
    </div>`;
  }

  function _postsSkeleton() {
    return Array(3).fill(0).map(() => `
    <div class="skeleton-card" style="margin-bottom:10px">
      <div class="skeleton skeleton-title"></div>
      <div class="skeleton skeleton-desc" style="width:70%"></div>
      <div class="skeleton-tags">
        <div class="skeleton skeleton-tag"></div>
        <div class="skeleton skeleton-tag"></div>
      </div>
      <div class="skeleton skeleton-meta"></div>
    </div>`).join("");
  }

  function esc(str) {
    return String(str||"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  return { init, deletePost };

})();

document.addEventListener("DOMContentLoaded", PROFILE_PAGE.init);
