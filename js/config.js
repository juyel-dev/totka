// ============================================================
// js/config.js — TOTKA 2.0
// THE ONLY FILE YOU EVER EDIT WHEN GAS URLS CHANGE
// Load this FIRST before any other script on every page
// ============================================================

const TOTKA = {

  // ── GAS SERVICE URLs ──────────────────────────────────────
  // Fill these after deploying all 6 GAS scripts
  GAS_AUTH:    "https://script.google.com/macros/s/AKfycbxciC7kuwzHk8M9qaYubrWLDOIaqD9sTpIHNAZHWNaK1Q4_2uEfKcWLf3EmrFKYOULsyA/exec",   // GAS 1 — Auth Service
  GAS_REG:     "https://script.google.com/macros/s/AKfycbwVVGNWyeNM1WXlgzuH5JYhiSL-9NRwApmeFi7vEvJ3YhkJmFRc6-LIUxOfXQIK0XqD/exec",   // GAS 2 — Registry Manager
  GAS_WRITE:   "https://script.google.com/macros/s/AKfycbxcJ2gb7cGXt37QRGYp0YycJas1anaqzSlEpxmrdxhg56hj9XU6EYi1SDjfG2NrsrB4lA/exec",   // GAS 3 — Write Service
  GAS_FEED:    "https://script.google.com/macros/s/AKfycbz4ZjPh3acdI4bzmbyaxI-_1ljSg8YZZ3Icn2KuYcRpGpVqtxkWWWY_TV673c4tTE2e/exec",   // GAS 4 — Feed Service
  GAS_DECODE:  "https://script.google.com/macros/s/AKfycbxvMexIX2Jkt7bd3lLrP5aTpM7uMSQsbCxcbxiK-ceDhvSoXEPwHHJK018L5vAo8sYr/exec",   // GAS 5 — Decode Service
  GAS_NOTIFY:  "https://script.google.com/macros/s/AKfycbz1mebV013C4jSglJR6AP7lmc9z_aFencG10a8iufAMpq9FsXsrXkWuPrcuMwjfNZYV/exec",   // GAS 6 — Notify + Admin Service

  // ── SECURITY KEYS ─────────────────────────────────────────
  // Must match SECRET constant in GAS 6
  NOTIFY_KEY:  "totka_secret_2025_bd",

  // SHA-256 hash of your admin panel password
  // To generate: open browser console → run:
  //   const b=new TextEncoder().encode("yourpassword");
  //   crypto.subtle.digest("SHA-256",b).then(h=>console.log([...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,"0")).join("")))
  ADMIN_PASS:  "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92",

  // ── SITE SETTINGS ─────────────────────────────────────────
  SITE_URL:    "https://juyel-dev.github.io/totka",
  SITE_NAME:   "TOTKA",
  SITE_TAGLINE:"Free File Sharing — Encode. Share. Decode.",

  // ── CACHE SETTINGS ────────────────────────────────────────
  CACHE_TTL:   5 * 60 * 1000,    // 5 minutes in ms
  FEED_PER_PAGE: 10,             // Posts per page in feed

  // ── LIMITS ────────────────────────────────────────────────
  MAX_FILE_SIZE:    500 * 1024 * 1024, // 500 MB hard limit (browser memory)
  MAX_PIC_SIZE:     50 * 1024,         // 50 KB profile picture limit
  MAX_BIO_LEN:      150,
  MAX_USERNAME_LEN: 20,
  MAX_TITLE_LEN:    100,
  MAX_DESC_LEN:     500,
  MAX_TAGS_LEN:     100,
  CHUNK_SIZE:       45000,             // Must match GAS 3 CHUNK_SIZE

  // ── STORAGE INFO ──────────────────────────────────────────
  STORAGE_001_ID:   "1ANPNl-9BnMzXD3XdrNw14sU86K-NX96r14H5d7xL0U0",

  // ── SESSION STORAGE KEYS ──────────────────────────────────
  SESSION: {
    TOKEN:    "totka_token",
    USER_ID:  "totka_uid",
    USERNAME: "totka_username",
    NAME:     "totka_name",
    PIC:      "totka_pic",
    SHEET_ID: "totka_sheet_id",
    SHEET_NM: "totka_sheet_name",
  },

  // ── FEED CACHE KEY PREFIX ─────────────────────────────────
  CACHE_PREFIX: "totka_feed_",
};

// ── SESSION HELPERS (available globally) ──────────────────────
const SESSION = {
  get(key)        { return localStorage.getItem(key); },
  set(key, val)   { localStorage.setItem(key, val); },
  remove(key)     { localStorage.removeItem(key); },
  clear()         { Object.values(TOTKA.SESSION).forEach(k => localStorage.removeItem(k)); },

  isLoggedIn()    { return !!localStorage.getItem(TOTKA.SESSION.TOKEN); },
  getUserId()     { return localStorage.getItem(TOTKA.SESSION.USER_ID); },
  getUsername()   { return localStorage.getItem(TOTKA.SESSION.USERNAME); },
  getName()       { return localStorage.getItem(TOTKA.SESSION.NAME); },
  getPic()        { return localStorage.getItem(TOTKA.SESSION.PIC); },
  getSheetId()    { return localStorage.getItem(TOTKA.SESSION.SHEET_ID); },
  getSheetName()  { return localStorage.getItem(TOTKA.SESSION.SHEET_NM); },

  saveLogin(data) {
    localStorage.setItem(TOTKA.SESSION.TOKEN,    data.token    || "");
    localStorage.setItem(TOTKA.SESSION.USER_ID,  data.userId   || "");
    localStorage.setItem(TOTKA.SESSION.USERNAME, data.username || "");
    localStorage.setItem(TOTKA.SESSION.NAME,     data.name     || "");
    localStorage.setItem(TOTKA.SESSION.PIC,      data.profilePic || "");
    localStorage.setItem(TOTKA.SESSION.SHEET_ID, data.sheetId  || "");
    localStorage.setItem(TOTKA.SESSION.SHEET_NM, data.sheetName|| "");
  },
};

// ── FEED CACHE HELPERS ────────────────────────────────────────
const FEED_CACHE = {
  key(page, sort, tag) {
    return `${TOTKA.CACHE_PREFIX}${page}_${sort}_${tag || "all"}`;
  },
  get(page, sort, tag) {
    const k   = this.key(page, sort, tag);
    const hit = sessionStorage.getItem(k);
    const ts  = sessionStorage.getItem(k + "_ts");
    if (hit && ts && Date.now() - parseInt(ts) < TOTKA.CACHE_TTL) {
      return JSON.parse(hit);
    }
    return null;
  },
  set(page, sort, tag, data) {
    const k = this.key(page, sort, tag);
    sessionStorage.setItem(k, JSON.stringify(data));
    sessionStorage.setItem(k + "_ts", Date.now().toString());
  },
  clear() {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(TOTKA.CACHE_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  },
};

// ── UTILITY: Format file size ─────────────────────────────────
function formatSize(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + " " + units[i];
}

// ── UTILITY: Time ago ─────────────────────────────────────────
function timeAgo(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  if (s <    60) return `${s}s ago`;
  if (s <  3600) return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}

// ── UTILITY: Toast notification ───────────────────────────────
function showToast(msg, type = "info", duration = 3000) {
  const existing = document.getElementById("totka-toast");
  if (existing) existing.remove();

  const colors = {
    info:    "#58a6ff",
    success: "#238636",
    error:   "#da3633",
    warning: "#d29922",
  };

  const toast = document.createElement("div");
  toast.id = "totka-toast";
  toast.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%);
    background:${colors[type]||colors.info}; color:#fff;
    padding:10px 20px; border-radius:8px; font-family:'JetBrains Mono',monospace;
    font-size:13px; z-index:9999; box-shadow:0 4px 20px rgba(0,0,0,0.4);
    max-width:90vw; text-align:center; animation:fadeIn 0.2s ease;
  `;
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── UTILITY: Copy to clipboard ────────────────────────────────
async function copyToClipboard(text, successMsg = "Copied!") {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, "success");
  } catch (_) {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity  = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    showToast(successMsg, "success");
  }
}

// ── UTILITY: SHA-256 (browser native) ─────────────────────────
async function sha256(str) {
  const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── REDIRECT IF NOT LOGGED IN ──────────────────────────────────
function requireLogin(redirectTo = "login.html") {
  if (!SESSION.isLoggedIn()) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

// ── UPDATE NAV PROFILE ICON ───────────────────────────────────
function updateNavProfile() {
  const pic  = SESSION.getPic();
  const el   = document.getElementById("nav-profile-pic");
  if (!el) return;
  if (pic) {
    el.style.backgroundImage = `url(${pic})`;
    el.style.backgroundSize  = "cover";
    el.textContent           = "";
  } else {
    const name = SESSION.getName() || SESSION.getUsername() || "?";
    el.textContent = name.charAt(0).toUpperCase();
  }
}

// Run on every page load
document.addEventListener("DOMContentLoaded", updateNavProfile);
