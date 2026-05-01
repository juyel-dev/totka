// ============================================================
// js/feed.js — TOTKA 2.0
// Home feed: infinite scroll, tag filter, sort, search,
// NSFW toggle, skeleton loaders, deep link handling
// Requires: config.js, api.js, image.js, share.js loaded first
// ============================================================

const FEED = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _page       = 1;
  let _sort       = "newest";
  let _tag        = null;
  let _query      = "";
  let _nsfw       = false;
  let _loading    = false;
  let _hasMore    = true;
  let _observer   = null;   // IntersectionObserver for infinite scroll
  let _searchTimer= null;   // debounce timer

  // ── DOM REFS (cached after DOMContentLoaded) ─────────────────
  let _feedList, _loadTrigger, _emptyState, _searchInput,
      _sortWrap, _tagWrap, _nsfwToggle, _skeletonWrap;

  // ── INIT ─────────────────────────────────────────────────────
  function init() {
    _cacheDom();
    _handleDeepLink();   // Check URL params first
    _bindTagPills();
    _bindSortPills();
    _bindSearch();
    _bindNsfwToggle();
    _bindNavProfile();
    _setupInfiniteScroll();
    loadFeed(true); // Initial load
  }

  // ── CACHE DOM REFS ───────────────────────────────────────────
  function _cacheDom() {
    _feedList    = document.getElementById("feed-list");
    _loadTrigger = document.getElementById("load-trigger");
    _emptyState  = document.getElementById("empty-state");
    _searchInput = document.getElementById("search-input");
    _sortWrap    = document.getElementById("sort-wrap");
    _tagWrap     = document.getElementById("tag-wrap");
    _nsfwToggle  = document.getElementById("nsfw-toggle");
    _skeletonWrap= document.getElementById("skeleton-wrap");
  }

  // ── HANDLE DEEP LINKS (?id=im00001, ?tag=photo, ?profile=ur001)
  function _handleDeepLink() {
    const p = new URLSearchParams(window.location.search);

    if (p.get("id")) {
      _openSinglePost(p.get("id"));
      return;
    }
    if (p.get("profile")) {
      window.location.href = `profile.html?uid=${p.get("profile")}`;
      return;
    }
    if (p.get("tag")) {
      _tag = p.get("tag").toLowerCase();
      _setActiveTag(_tag);
    }
    if (p.get("q")) {
      _query = p.get("q");
      if (_searchInput) _searchInput.value = _query;
    }
  }

  // ── OPEN SINGLE POST MODAL ───────────────────────────────────
  async function _openSinglePost(postId) {
    // Show skeleton while fetching
    showPostModal(null, true);

    const res = await API.FEED.getPostMeta(postId);
    if (res.error) {
      showToast("Post not found", "error");
      closePostModal();
      return;
    }
    showPostModal(res, false);
  }

  // ── LOAD FEED (core function) ─────────────────────────────────
  async function loadFeed(reset = false) {
    if (_loading) return;
    if (!reset && !_hasMore) return;

    _loading = true;

    if (reset) {
      _page    = 1;
      _hasMore = true;
      if (_feedList)  _feedList.innerHTML   = "";
      if (_emptyState)_emptyState.style.display = "none";
      showSkeletons(3);
    } else {
      showLoadingSpinner(true);
    }

    // Choose: search or regular feed
    let res;
    try {
      if (_query.trim()) {
        res = await API.FEED.search({ q: _query, page: _page, sort: _sort, nsfw: _nsfw });
      } else {
        res = await API.FEED.getFeed({ page: _page, sort: _sort, tag: _tag, nsfw: _nsfw });
      }
    } catch (err) {
      hideSkeletons();
      showLoadingSpinner(false);
      showToast("Failed to load feed — check connection", "error");
      _loading = false;
      return;
    }

    hideSkeletons();
    showLoadingSpinner(false);

    if (res.error) {
      showToast(res.message || "Feed error", "error");
      _loading = false;
      return;
    }

    const posts = res.posts || [];
    _hasMore    = res.hasMore || false;

    if (posts.length === 0 && _page === 1) {
      showEmpty();
    } else {
      posts.forEach(post => renderCard(post));
      _page++;
    }

    _loading = false;
  }

  // ── RENDER A SINGLE FEED CARD ─────────────────────────────────
  function renderCard(post) {
    if (!_feedList) return;

    const isOwner = SESSION.isLoggedIn() && SESSION.getUserId() === post.userId;
    const tags    = parseTags(post.tags);
    const timeStr = timeAgo(post.timestamp);
    const picSrc  = IMAGE.generateAvatar(post.username, 32);

    const card = document.createElement("div");
    card.className        = "feed-card anim-fade-in";
    card.dataset.postId   = post.postId;

    card.innerHTML = `
      <!-- Header -->
      <div class="card-header">
        <a class="card-author" href="profile.html?uid=${post.userId}" title="View profile">
          <img class="card-avatar" src="${picSrc}"
            alt="${esc(post.username)}" id="avatar-${post.postId}"/>
          <div class="card-author-info">
            <span class="card-username">@${esc(post.username)}</span>
            <span class="card-time">${timeStr}</span>
          </div>
        </a>
        <div style="position:relative">
          <button class="card-menu-btn" onclick="FEED.toggleMenu('${post.postId}')" 
            title="Options">⋯</button>
          <div class="card-dropdown hidden" id="menu-${post.postId}">
            <div class="card-dropdown__item"
              onclick="copyToClipboard('${post.postId}','Post ID copied!')">
              📋 Copy Post ID
            </div>
            <div class="card-dropdown__item"
              onclick="FEED.sharePost('${post.postId}','${esc(post.title)}')">
              🔗 Share
            </div>
            ${isOwner ? `
            <div class="card-dropdown__item card-dropdown__item--danger"
              onclick="FEED.confirmDelete('${post.postId}')">
              🗑️ Delete
            </div>` : ''}
          </div>
        </div>
      </div>

      <!-- NSFW blur or normal body -->
      ${post.nsfw ? `
      <div class="card-nsfw-wrap" id="nsfw-${post.postId}"
        onclick="FEED.revealNsfw('${post.postId}')">
        <div class="card-nsfw-blur">
          <div class="card-body" style="min-height:60px">
            <div class="card-title">${esc(post.title)}</div>
            ${post.description ? `<div class="card-desc">${esc(post.description)}</div>` : ''}
          </div>
        </div>
        <div class="nsfw-overlay">
          <span class="nsfw-overlay__badge">🔞 NSFW</span>
          <span class="nsfw-overlay__hint">Tap to reveal</span>
        </div>
      </div>` : ''}

      <!-- Body (always shown if not NSFW, or after reveal) -->
      ${!post.nsfw ? `
      <div class="card-body">
        <div class="card-title">${esc(post.title)}</div>
        ${post.description ? `<div class="card-desc">${esc(post.description)}</div>` : ''}
        ${tags.length ? `
        <div class="card-tags">
          ${tags.map(t => `<span class="card-tag" onclick="FEED.filterTag('${t}')">#${esc(t)}</span>`).join('')}
        </div>` : ''}
      </div>` : ''}

      <!-- Meta row -->
      <div class="card-meta">
        ${post.originalSize ? `
        <span class="card-meta__item">💾 ${esc(String(post.originalSize))}</span>
        <span class="card-meta__dot"></span>` : ''}
        <span class="card-meta__item">📊 ${Number(post.encodedLen||0).toLocaleString()} chars</span>
        <span class="card-meta__dot"></span>
        <span class="card-meta__item">🧩 ${post.totalChunks} chunk${post.totalChunks!==1?'s':''}</span>
        <span class="card-meta__dot"></span>
        <span class="card-meta__item" style="color:var(--text-muted);font-size:10px">
          ${esc(post.storageId || '')}
        </span>
        ${post.nsfw ? `<span class="badge badge--nsfw" style="margin-left:auto">NSFW</span>` : ''}
      </div>

      <!-- Action buttons -->
      <div class="card-actions">
        <a class="card-btn card-btn--decode"
          href="decode.html?id=${post.postId}">
          🔓 Decode
        </a>
        <button class="card-btn"
          onclick="copyToClipboard('${post.postId}','Post ID copied!')">
          📋 Copy ID
        </button>
        <button class="card-btn"
          onclick="FEED.sharePost('${post.postId}','${esc(post.title)}')">
          🔗 Share
        </button>
        ${isOwner ? `
        <button class="card-btn card-btn--danger"
          onclick="FEED.confirmDelete('${post.postId}')">
          🗑️
        </button>` : ''}
      </div>
    `;

    _feedList.appendChild(card);

    // Load real avatar async (non-blocking)
    _loadAvatar(post.userId, `avatar-${post.postId}`);
  }

  // ── LOAD REAL AVATAR (replace SVG fallback) ───────────────────
  async function _loadAvatar(userId, imgId) {
    try {
      const info = await API.FEED.getUserInfo(userId);
      if (info.profilePic) {
        const el = document.getElementById(imgId);
        if (el) el.src = info.profilePic;
      }
    } catch (_) {}
  }

  // ── TAG FILTER ────────────────────────────────────────────────
  function filterTag(tag) {
    _tag   = (_tag === tag) ? null : tag; // toggle
    _query = "";
    if (_searchInput) _searchInput.value = "";
    _setActiveTag(_tag);
    loadFeed(true);
  }

  function _setActiveTag(tag) {
    document.querySelectorAll(".tag-pill").forEach(el => {
      el.classList.toggle("tag-pill--active", el.dataset.tag === tag);
    });
  }

  function _bindTagPills() {
    if (!_tagWrap) return;
    _tagWrap.querySelectorAll(".tag-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        const t = pill.dataset.tag || null;
        filterTag(t);
      });
    });
  }

  // ── SORT ──────────────────────────────────────────────────────
  function _bindSortPills() {
    if (!_sortWrap) return;
    _sortWrap.querySelectorAll(".sort-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        _sort = pill.dataset.sort || "newest";
        _sortWrap.querySelectorAll(".sort-pill")
          .forEach(p => p.classList.remove("sort-pill--active"));
        pill.classList.add("sort-pill--active");
        loadFeed(true);
      });
    });
  }

  // ── SEARCH ────────────────────────────────────────────────────
  function _bindSearch() {
    if (!_searchInput) return;

    _searchInput.addEventListener("input", () => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => {
        _query = _searchInput.value.trim();
        _tag   = null;
        _setActiveTag(null);
        loadFeed(true);
      }, 450);
    });

    _searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        _searchInput.value = "";
        _query = "";
        loadFeed(true);
      }
    });
  }

  // ── NSFW TOGGLE ───────────────────────────────────────────────
  function _bindNsfwToggle() {
    if (!_nsfwToggle) return;
    _nsfwToggle.addEventListener("click", () => {
      _nsfw = !_nsfw;
      _nsfwToggle.classList.toggle("on", _nsfw);
      _nsfwToggle.title = _nsfw ? "NSFW shown — click to hide" : "Show NSFW";
      loadFeed(true);
    });
  }

  // ── REVEAL NSFW CARD ──────────────────────────────────────────
  function revealNsfw(postId) {
    const wrap = document.getElementById(`nsfw-${postId}`);
    if (wrap) {
      wrap.classList.add("revealed");
      wrap.onclick = null; // disable after reveal
    }
  }

  // ── SHARE ─────────────────────────────────────────────────────
  async function sharePost(postId, title) {
    const url = `${TOTKA.SITE_URL}/?id=${postId}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: `TOTKA: ${title}`, url });
      } catch (_) {}
    } else {
      await copyToClipboard(url, "Share link copied!");
    }
    closeMenus();
  }

  // ── DELETE WITH CONFIRM ───────────────────────────────────────
  async function confirmDelete(postId) {
    closeMenus();
    if (!confirm(`Delete post ${postId}?\nThis cannot be undone.`)) return;

    const res = await API.WRITE.deletePost(postId);
    if (res.success) {
      // Remove card from DOM
      const card = _feedList?.querySelector(`[data-post-id="${postId}"]`);
      if (card) {
        card.style.opacity   = "0";
        card.style.transform = "scale(0.97)";
        card.style.transition= "all 0.3s";
        setTimeout(() => card.remove(), 300);
      }
      showToast("Post deleted", "success");
    } else {
      showToast(res.message || "Delete failed", "error");
    }
  }

  // ── MENU TOGGLE ───────────────────────────────────────────────
  function toggleMenu(postId) {
    const menu = document.getElementById(`menu-${postId}`);
    if (!menu) return;
    const isOpen = !menu.classList.contains("hidden");
    closeMenus();
    if (!isOpen) menu.classList.remove("hidden");
  }

  function closeMenus() {
    document.querySelectorAll(".card-dropdown").forEach(m => m.classList.add("hidden"));
  }

  // Close menus on outside click
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".card-menu-btn") && !e.target.closest(".card-dropdown")) {
      closeMenus();
    }
  });

  // ── INFINITE SCROLL ───────────────────────────────────────────
  function _setupInfiniteScroll() {
    if (!_loadTrigger) return;

    _observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && !_loading && _hasMore) {
        loadFeed(false);
      }
    }, { rootMargin: "200px" });

    _observer.observe(_loadTrigger);
  }

  // ── SKELETON LOADERS ──────────────────────────────────────────
  function showSkeletons(count = 3) {
    if (!_skeletonWrap) return;
    _skeletonWrap.innerHTML = Array(count).fill(0).map(() => `
      <div class="skeleton-card">
        <div class="skeleton-card__header">
          <div class="skeleton skeleton-avatar"></div>
          <div style="flex:1">
            <div class="skeleton skeleton-line skeleton-line--md" style="margin-bottom:6px"></div>
            <div class="skeleton skeleton-line skeleton-line--sm"></div>
          </div>
        </div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-desc" style="width:90%"></div>
        <div class="skeleton skeleton-desc" style="width:65%"></div>
        <div class="skeleton-tags">
          <div class="skeleton skeleton-tag"></div>
          <div class="skeleton skeleton-tag"></div>
          <div class="skeleton skeleton-tag" style="width:40px"></div>
        </div>
        <div class="skeleton skeleton-meta"></div>
        <div class="skeleton-btns">
          <div class="skeleton skeleton-btn" style="width:90px"></div>
          <div class="skeleton skeleton-btn"></div>
          <div class="skeleton skeleton-btn"></div>
        </div>
      </div>
    `).join("");
    _skeletonWrap.style.display = "flex";
    _skeletonWrap.style.flexDirection = "column";
    _skeletonWrap.style.gap = "16px";
  }

  function hideSkeletons() {
    if (!_skeletonWrap) return;
    _skeletonWrap.innerHTML = "";
    _skeletonWrap.style.display = "none";
  }

  // ── LOAD MORE SPINNER ─────────────────────────────────────────
  function showLoadingSpinner(show) {
    const el = document.getElementById("load-spinner");
    if (el) el.style.display = show ? "flex" : "none";
  }

  // ── EMPTY STATE ───────────────────────────────────────────────
  function showEmpty() {
    if (!_emptyState) return;
    _emptyState.style.display = "block";
    const q = _query.trim();
    const t = _tag;
    if (q) {
      _emptyState.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🔍</div>
          <div class="empty-state__title">No results for "${esc(q)}"</div>
          <p class="empty-state__text">Try different keywords or browse all posts.</p>
        </div>`;
    } else if (t) {
      _emptyState.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🏷️</div>
          <div class="empty-state__title">No posts tagged #${esc(t)}</div>
          <p class="empty-state__text">Be the first to upload something with this tag!</p>
        </div>`;
    } else {
      _emptyState.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">📭</div>
          <div class="empty-state__title">Nothing here yet</div>
          <p class="empty-state__text">
            Be the first to share a file!
            <br><a href="encode.html" class="text-accent">Upload something →</a>
          </p>
        </div>`;
    }
  }

  // ── NAV PROFILE BUTTON ────────────────────────────────────────
  function _bindNavProfile() {
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
        el.textContent = (SESSION.getName() || SESSION.getUsername() || "?").charAt(0).toUpperCase();
      }
    } else {
      el.href        = "login.html";
      el.textContent = "Login";
      el.style.fontSize = "11px";
      el.style.padding  = "0 8px";
      el.style.borderRadius = "var(--radius-sm)";
    }
  }

  // ── SINGLE POST MODAL ─────────────────────────────────────────
  function showPostModal(post, skeleton = false) {
    // Remove any existing modal
    document.getElementById("post-modal-backdrop")?.remove();

    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.id        = "post-modal-backdrop";

    if (skeleton) {
      backdrop.innerHTML = `
        <div class="modal" style="max-width:var(--max-width)">
          <div class="modal__handle"></div>
          <div class="skeleton-card">
            <div class="skeleton-card__header">
              <div class="skeleton skeleton-avatar"></div>
              <div style="flex:1">
                <div class="skeleton skeleton-line skeleton-line--md" style="margin-bottom:6px"></div>
                <div class="skeleton skeleton-line skeleton-line--sm"></div>
              </div>
            </div>
            <div class="skeleton skeleton-title"></div>
            <div class="skeleton skeleton-desc" style="width:90%"></div>
            <div class="skeleton skeleton-desc" style="width:60%"></div>
          </div>
        </div>`;
    } else {
      const tags = parseTags(post.tags);
      backdrop.innerHTML = `
        <div class="modal" style="max-width:var(--max-width)">
          <div class="modal__handle"></div>
          <div class="modal__title">${esc(post.title)}</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
            <span style="font-size:12px;color:var(--text-muted)">by @${esc(post.username)}</span>
            <span style="font-size:10px;color:var(--text-muted)">${timeAgo(post.timestamp)}</span>
            ${post.nsfw ? '<span class="badge badge--nsfw">NSFW</span>' : ''}
          </div>
          ${post.description ? `<p style="font-size:13px;margin-bottom:12px">${esc(post.description)}</p>` : ''}
          ${tags.length ? `
          <div class="card-tags" style="margin-bottom:12px">
            ${tags.map(t=>`<span class="card-tag">#${esc(t)}</span>`).join('')}
          </div>` : ''}
          <div class="card-meta" style="border:1px solid var(--glass-border);border-radius:8px;padding:10px 14px;margin-bottom:16px">
            ${post.originalSize ? `<span class="card-meta__item">💾 ${esc(String(post.originalSize))}</span><span class="card-meta__dot"></span>` : ''}
            <span class="card-meta__item">📊 ${Number(post.encodedLen||0).toLocaleString()} chars</span>
            <span class="card-meta__dot"></span>
            <span class="card-meta__item">🧩 ${post.totalChunks} chunks</span>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="decode.html?id=${post.postId}" class="btn btn--primary btn--full">
              🔓 Decode &amp; Download
            </a>
            <button class="btn btn--ghost btn--full"
              onclick="copyToClipboard('${post.postId}','Copied!')">
              📋 Copy Post ID: <code>${post.postId}</code>
            </button>
          </div>
        </div>`;
    }

    // Close on backdrop click
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closePostModal();
    });

    document.body.appendChild(backdrop);
  }

  function closePostModal() {
    document.getElementById("post-modal-backdrop")?.remove();
  }

  // ── HELPERS ───────────────────────────────────────────────────
  function parseTags(tagsStr) {
    if (!tagsStr) return [];
    return String(tagsStr).split(",").map(t => t.trim().toLowerCase()).filter(Boolean);
  }

  function esc(str) {
    return String(str || "")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;")
      .replace(/>/g,"&gt;").replace(/"/g,"&quot;")
      .replace(/'/g,"&#39;");
  }

  // ── PUBLIC API ────────────────────────────────────────────────
  return {
    init,
    loadFeed,
    filterTag,
    sharePost,
    confirmDelete,
    toggleMenu,
    revealNsfw,
    showPostModal,
    closePostModal,
  };

})();

// Auto-init
document.addEventListener("DOMContentLoaded", FEED.init);
