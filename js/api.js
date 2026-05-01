// ============================================================
// js/api.js — TOTKA 2.0
// All GAS API call wrappers — single place for every network call
// Requires: config.js loaded first
// ============================================================

const API = (() => {

  // ── CORE FETCH WRAPPER ──────────────────────────────────────
  // GAS Web Apps only support GET and POST.
  // All GAS endpoints return JSON with either { success, ... } or { error, ... }

  async function gasGet(url, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const uri = qs ? `${url}?${qs}` : url;
    try {
      const res  = await fetch(uri, { method: "GET", redirect: "follow" });
      const data = await res.json();
      return data;
    } catch (err) {
      return { error: "NETWORK_ERROR", message: err.message };
    }
  }

  async function gasPost(url, body = {}) {
    try {
      const res  = await fetch(url, {
        method:  "POST",
        // GAS Web Apps require text/plain or no content-type for CORS
        // We stringify and parse on GAS side — this is the standard pattern
        body:    JSON.stringify(body),
        redirect:"follow",
      });
      const data = await res.json();
      return data;
    } catch (err) {
      return { error: "NETWORK_ERROR", message: err.message };
    }
  }

  // ── NOTIFY HELPER (fire and forget — never blocks UI) ───────
  function notify(action, payload = {}) {
    gasPost(TOTKA.GAS_NOTIFY, {
      ...payload,
      action,
      secret: TOTKA.NOTIFY_KEY,
    }).catch(() => {}); // Silently ignore notify errors
  }

  // ══════════════════════════════════════════════════════════
  // AUTH API (GAS 1)
  // ══════════════════════════════════════════════════════════

  const AUTH = {

    async signup({ username, name, loginId, password, bio, profession, socialLinks }) {
      const res = await gasPost(TOTKA.GAS_AUTH, {
        action: "signup",
        username, name, loginId, password,
        bio: bio || "", profession: profession || "",
        socialLinks: socialLinks || { twitter:"", ig:"", fb:"", gh:"" },
      });
      if (res.success) {
        notify("newUser", {
          userId: res.userId, username, name, loginId,
          bio: bio || "", profession: profession || "",
        });
      }
      return res;
    },

    async login({ loginId, password }) {
      const res = await gasPost(TOTKA.GAS_AUTH, {
        action: "login", loginId, password,
      });
      if (res.success) {
        SESSION.saveLogin(res);
      }
      return res;
    },

    async getProfile(userId) {
      return gasPost(TOTKA.GAS_AUTH, { action: "getProfile", userId });
    },

    async updateProfile({ userId, name, bio, profilePic, socialLinks, profession }) {
      const res = await gasPost(TOTKA.GAS_AUTH, {
        action: "updateProfile",
        userId, name, bio, profilePic, socialLinks, profession,
      });
      if (res.success) {
        // Update local session
        if (name)       SESSION.set(TOTKA.SESSION.NAME, name);
        if (profilePic) SESSION.set(TOTKA.SESSION.PIC,  profilePic);
        notify("profileUpdate", {
          userId, username: SESSION.getUsername(),
          name, bio, profession,
          sheetId: SESSION.getSheetId(),
        });
      }
      return res;
    },

    async linkSheet({ userId, sheetId, sheetName }) {
      const res = await gasPost(TOTKA.GAS_AUTH, {
        action: "linkSheet", userId, sheetId, sheetName,
      });
      if (res.success) {
        SESSION.set(TOTKA.SESSION.SHEET_ID, sheetId);
        SESSION.set(TOTKA.SESSION.SHEET_NM, sheetName);
      }
      return res;
    },

    // GET request for username availability (used in signup form live check)
    async checkUsername(username) {
      return gasGet(TOTKA.GAS_AUTH, { action: "checkUsername", username });
    },

    logout() {
      SESSION.clear();
      FEED_CACHE.clear();
      window.location.href = "index.html";
    },
  };

  // ══════════════════════════════════════════════════════════
  // FEED API (GAS 4)
  // ══════════════════════════════════════════════════════════

  const FEED = {

    async getFeed({ page = 1, perPage = 10, sort = "newest", tag = null, nsfw = false } = {}) {
      // Check cache first
      const cached = FEED_CACHE.get(page, sort, tag);
      if (cached) return cached;

      const params = { action: "feed", page, perPage, sort, nsfw: nsfw ? "true" : "false" };
      if (tag) params.tag = tag;

      const res = await gasGet(TOTKA.GAS_FEED, params);

      // Cache successful responses
      if (res.posts) FEED_CACHE.set(page, sort, tag, res);

      return res;
    },

    async search({ q, page = 1, sort = "newest", nsfw = false }) {
      if (!q || !q.trim()) return { posts: [], total: 0, page: 1 };
      return gasGet(TOTKA.GAS_FEED, {
        action: "search", q: q.trim(), page, sort,
        nsfw: nsfw ? "true" : "false",
      });
    },

    async getUserPosts(userId) {
      return gasGet(TOTKA.GAS_FEED, { action: "userPosts", userId });
    },

    async getPostMeta(postId) {
      return gasGet(TOTKA.GAS_FEED, { action: "postMeta", postId });
    },

    async getUserInfo(userId) {
      return gasGet(TOTKA.GAS_FEED, { action: "userInfo", userId });
    },

    async getTagList() {
      return gasGet(TOTKA.GAS_FEED, { action: "tagList" });
    },

    async getRecentTags(limit = 20) {
      return gasGet(TOTKA.GAS_FEED, { action: "recentTags", limit });
    },
  };

  // ══════════════════════════════════════════════════════════
  // WRITE API (GAS 3)
  // ══════════════════════════════════════════════════════════

  const WRITE = {

    async savePost({
      encoded, title, tags, description, alt,
      nsfw, originalSize, userId, username,
    }) {
      if (!SESSION.isLoggedIn()) return { error: "NOT_LOGGED_IN" };

      const res = await gasPost(TOTKA.GAS_WRITE, {
        action: "savePost",
        encoded, title, tags, description, alt,
        nsfw:         nsfw || false,
        originalSize: originalSize || "",
        encodedLen:   encoded.length,
        userId:       userId || SESSION.getUserId(),
        username:     username || SESSION.getUsername(),
        userSheetId:  SESSION.getSheetId()   || "",
        userSheetName:SESSION.getSheetName() || "",
      });

      if (res.success) {
        // Clear feed cache so new post appears
        FEED_CACHE.clear();
        // Notify admin
        notify("newPost", {
          postId:      res.postId,
          title, tags, description,
          nsfw:        nsfw || false,
          originalSize:originalSize || "",
          encodedLen:  encoded.length,
          chunks:      res.chunks,
          userId:      userId || SESSION.getUserId(),
          username:    username || SESSION.getUsername(),
          storageId:   res.storageId,
        });
      }

      return res;
    },

    async deletePost(postId) {
      if (!SESSION.isLoggedIn()) return { error: "NOT_LOGGED_IN" };
      const res = await gasPost(TOTKA.GAS_WRITE, {
        action:  "deletePost",
        postId,
        userId:  SESSION.getUserId(),
      });
      if (res.success) FEED_CACHE.clear();
      return res;
    },
  };

  // ══════════════════════════════════════════════════════════
  // DECODE API (GAS 5)
  // ══════════════════════════════════════════════════════════

  const DECODE = {

    async getEncodedData(postId) {
      if (!postId) return { error: "MISSING_POSTID" };
      return gasGet(TOTKA.GAS_DECODE, { postId });
    },
  };

  // ══════════════════════════════════════════════════════════
  // ADMIN API (GAS 6 — requires NOTIFY_KEY)
  // ══════════════════════════════════════════════════════════

  const ADMIN = {

    async getStats() {
      return gasGet(TOTKA.GAS_NOTIFY, { action: "stats", secret: TOTKA.NOTIFY_KEY });
    },

    async getRecentPosts(limit = 10) {
      return gasGet(TOTKA.GAS_NOTIFY, { action: "recentPosts", limit, secret: TOTKA.NOTIFY_KEY });
    },

    async getRecentUsers(limit = 10) {
      return gasGet(TOTKA.GAS_NOTIFY, { action: "recentUsers", limit, secret: TOTKA.NOTIFY_KEY });
    },

    async getStorageList() {
      return gasGet(TOTKA.GAS_NOTIFY, { action: "storageList", secret: TOTKA.NOTIFY_KEY });
    },

    async addStorage({ sheetId, spreadsheetId, sheetName, notes }) {
      return gasPost(TOTKA.GAS_NOTIFY, {
        action: "addStorage", secret: TOTKA.NOTIFY_KEY,
        sheetId, spreadsheetId, sheetName, notes: notes || "",
      });
    },

    async deletePost(postId, reason = "") {
      return gasPost(TOTKA.GAS_NOTIFY, {
        action: "deletePost", secret: TOTKA.NOTIFY_KEY,
        postId, reason,
      });
    },

    async sendNotification(message, targetUser = "all") {
      return gasPost(TOTKA.GAS_NOTIFY, {
        action: "adminNotify", secret: TOTKA.NOTIFY_KEY,
        message, targetUser,
      });
    },

    async broadcast(message) {
      return gasPost(TOTKA.GAS_NOTIFY, {
        action: "broadcastMsg", secret: TOTKA.NOTIFY_KEY,
        message,
      });
    },
  };

  // ══════════════════════════════════════════════════════════
  // REGISTRY API (GAS 2)
  // ══════════════════════════════════════════════════════════

  const REGISTRY = {
    async getActive() {
      return gasGet(TOTKA.GAS_REG, { action: "getActive" });
    },
    async listAll() {
      return gasGet(TOTKA.GAS_REG, { action: "listAll" });
    },
    async getStats() {
      return gasGet(TOTKA.GAS_REG, { action: "stats" });
    },
  };

  // ── PUBLIC API ──────────────────────────────────────────────
  return { AUTH, FEED, WRITE, DECODE, ADMIN, REGISTRY, notify };

})();
