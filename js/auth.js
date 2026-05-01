// ============================================================
// js/auth.js — TOTKA 2.0
// Login, signup, session management
// Requires: config.js, api.js, image.js loaded first
// ============================================================

const AUTH_UI = (() => {

  // ── STATE ────────────────────────────────────────────────────
  let _mode          = "login";    // "login" | "signup"
  let _picBase64     = "";         // Compressed profile pic
  let _usernameTimer = null;       // Debounce timer for username check
  let _usernameOk    = false;      // Whether current username passed live check

  // ── INIT (call on DOMContentLoaded) ─────────────────────────
  function init() {
    // If already logged in, redirect to home
    if (SESSION.isLoggedIn()) {
      window.location.href = "index.html";
      return;
    }

    _bindTabSwitchers();
    _bindLoginForm();
    _bindSignupForm();
    _bindPicInput();

    // Check URL param ?mode=signup
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "signup") switchMode("signup");
  }

  // ── SWITCH BETWEEN LOGIN / SIGNUP ───────────────────────────
  function switchMode(mode) {
    _mode = mode;

    const loginPanel  = document.getElementById("login-panel");
    const signupPanel = document.getElementById("signup-panel");
    const tabLogin    = document.getElementById("tab-login");
    const tabSignup   = document.getElementById("tab-signup");

    if (mode === "signup") {
      loginPanel ?.classList.add("hidden");
      signupPanel?.classList.remove("hidden");
      tabLogin ?.classList.remove("tab--active");
      tabSignup?.classList.add("tab--active");
    } else {
      signupPanel?.classList.add("hidden");
      loginPanel ?.classList.remove("hidden");
      tabSignup?.classList.remove("tab--active");
      tabLogin ?.classList.add("tab--active");
    }

    clearErrors();
  }

  // ── BIND TAB SWITCHERS ───────────────────────────────────────
  function _bindTabSwitchers() {
    document.getElementById("tab-login") ?.addEventListener("click", () => switchMode("login"));
    document.getElementById("tab-signup")?.addEventListener("click", () => switchMode("signup"));
    document.getElementById("go-signup") ?.addEventListener("click", (e) => {
      e.preventDefault(); switchMode("signup");
    });
    document.getElementById("go-login")  ?.addEventListener("click", (e) => {
      e.preventDefault(); switchMode("login");
    });
  }

  // ── BIND LOGIN FORM ─────────────────────────────────────────
  function _bindLoginForm() {
    const form = document.getElementById("login-form");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors();

      const loginId  = document.getElementById("login-id")?.value.trim();
      const password = document.getElementById("login-pass")?.value;
      const btn      = document.getElementById("login-btn");

      // Basic validation
      if (!loginId)  return setError("login-id-err",  "Enter your email or username");
      if (!password) return setError("login-pass-err", "Enter your password");

      setLoading(btn, true, "Logging in...");

      const res = await API.AUTH.login({ loginId, password });

      setLoading(btn, false, "Login");

      if (res.error) {
        const msgs = {
          INVALID_CREDENTIALS: "Wrong email/username or password",
          MISSING_FIELDS:      "Please fill all fields",
          NETWORK_ERROR:       "Network error — check your connection",
        };
        setError("login-general-err", msgs[res.error] || res.message || "Login failed");
        return;
      }

      // Success
      showToast(`Welcome back, ${res.name || res.username}! 👋`, "success");
      setTimeout(() => {
        const redirect = new URLSearchParams(window.location.search).get("next") || "index.html";
        window.location.href = redirect;
      }, 800);
    });
  }

  // ── BIND SIGNUP FORM ─────────────────────────────────────────
  function _bindSignupForm() {
    const form = document.getElementById("signup-form");
    if (!form) return;

    // Live username availability check
    const usernameInput = document.getElementById("signup-username");
    usernameInput?.addEventListener("input", () => {
      clearTimeout(_usernameTimer);
      const val = usernameInput.value.trim();
      _usernameOk = false;
      setError("signup-username-err", "");

      if (!val) return;

      if (!/^[a-zA-Z0-9_]{3,20}$/.test(val)) {
        setError("signup-username-err", "3–20 chars · letters, numbers, underscore only");
        return;
      }

      setFieldHint("signup-username-err", "⏳ Checking...", "#8b949e");

      _usernameTimer = setTimeout(async () => {
        const res = await API.AUTH.checkUsername(val);
        if (res.available) {
          setFieldHint("signup-username-err", "✅ Available!", "#3fb950");
          _usernameOk = true;
        } else {
          setError("signup-username-err", "❌ Username taken");
          _usernameOk = false;
        }
      }, 500); // 500ms debounce
    });

    // Password strength indicator
    document.getElementById("signup-pass")?.addEventListener("input", _updatePasswordStrength);

    // Form submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      clearErrors();

      const name       = document.getElementById("signup-name")    ?.value.trim();
      const username   = document.getElementById("signup-username") ?.value.trim();
      const loginId    = document.getElementById("signup-loginid")  ?.value.trim();
      const password   = document.getElementById("signup-pass")     ?.value;
      const passConf   = document.getElementById("signup-passconf") ?.value;
      const bio        = document.getElementById("signup-bio")      ?.value.trim() || "";
      const profession = document.getElementById("signup-profession")?.value.trim() || "";
      const btn        = document.getElementById("signup-btn");

      // ── Validations ──────────────────────────────────────────
      if (!name)     return setError("signup-name-err",    "Enter your display name");
      if (name.length > 50) return setError("signup-name-err", "Name max 50 characters");

      if (!username) return setError("signup-username-err","Choose a username");
      if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        return setError("signup-username-err", "3–20 chars · letters, numbers, underscore only");
      }
      if (!_usernameOk) {
        // Force-check if user didn't wait for debounce
        const chk = await API.AUTH.checkUsername(username);
        if (!chk.available) {
          return setError("signup-username-err", "Username already taken");
        }
        _usernameOk = true;
      }

      if (!loginId)  return setError("signup-loginid-err", "Enter email or phone");
      if (bio.length > TOTKA.MAX_BIO_LEN) {
        return setError("signup-bio-err", `Bio max ${TOTKA.MAX_BIO_LEN} characters`);
      }

      if (!password)           return setError("signup-pass-err", "Choose a password");
      if (password.length < 6) return setError("signup-pass-err", "Min 6 characters");
      if (password !== passConf) return setError("signup-passconf-err", "Passwords don't match");

      setLoading(btn, true, "Creating account...");

      const res = await API.AUTH.signup({
        name, username, loginId, password, bio, profession,
        profilePic: _picBase64 || "",
      });

      setLoading(btn, false, "Create Account");

      if (res.error) {
        const msgs = {
          USERNAME_TAKEN:  "Username already taken — try another",
          LOGIN_EXISTS:    "This email/phone is already registered",
          MISSING_FIELDS:  "Please fill all required fields",
          NETWORK_ERROR:   "Network error — check your connection",
        };
        setError("signup-general-err", msgs[res.error] || res.message || "Signup failed");
        return;
      }

      // Auto-login after signup
      const loginRes = await API.AUTH.login({ loginId, password });
      if (loginRes.success) {
        showToast(`Welcome to TOTKA, ${name}! 🎉`, "success", 2500);
        setTimeout(() => window.location.href = "index.html", 1000);
      } else {
        showToast("Account created! Please log in.", "success");
        switchMode("login");
        document.getElementById("login-id").value = loginId;
      }
    });
  }

  // ── BIND PROFILE PIC INPUT ───────────────────────────────────
  function _bindPicInput() {
    const input   = document.getElementById("signup-pic-input");
    const preview = document.getElementById("signup-pic-preview");
    const status  = document.getElementById("signup-pic-status");
    if (!input) return;

    input.addEventListener("change", async () => {
      const result = await IMAGE.handleFileInput(input, preview, status);
      if (result) {
        _picBase64 = result.base64;
        // Show ring around avatar
        preview?.classList.add("pic-preview--loaded");
      }
    });

    // Clicking preview also opens file picker
    preview?.addEventListener("click", () => input.click());
  }

  // ── PASSWORD STRENGTH INDICATOR ─────────────────────────────
  function _updatePasswordStrength() {
    const pass   = document.getElementById("signup-pass")?.value || "";
    const bar    = document.getElementById("pass-strength-bar");
    const label  = document.getElementById("pass-strength-label");
    if (!bar || !label) return;

    let score = 0;
    if (pass.length >= 6)                        score++;
    if (pass.length >= 10)                       score++;
    if (/[A-Z]/.test(pass))                      score++;
    if (/[0-9]/.test(pass))                      score++;
    if (/[^A-Za-z0-9]/.test(pass))              score++;

    const levels = [
      { pct: 0,   color: "transparent", text: "" },
      { pct: 20,  color: "#da3633",     text: "Weak" },
      { pct: 40,  color: "#d29922",     text: "Fair" },
      { pct: 60,  color: "#d29922",     text: "Good" },
      { pct: 80,  color: "#3fb950",     text: "Strong" },
      { pct: 100, color: "#58a6ff",     text: "Very Strong" },
    ];

    const lvl         = levels[Math.min(score, 5)];
    bar.style.width   = lvl.pct + "%";
    bar.style.background = lvl.color;
    label.textContent = lvl.text;
    label.style.color = lvl.color;
  }

  // ── HELPERS ──────────────────────────────────────────────────
  function setError(elementId, msg) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent   = msg;
    el.style.color   = "var(--accent-red)";
    el.style.display = msg ? "block" : "none";
  }

  function setFieldHint(elementId, msg, color) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent   = msg;
    el.style.color   = color || "var(--text-muted)";
    el.style.display = msg ? "block" : "none";
  }

  function clearErrors() {
    document.querySelectorAll(".field-error").forEach(el => {
      el.textContent = "";
      el.style.display = "none";
    });
  }

  function setLoading(btn, loading, label) {
    if (!btn) return;
    btn.disabled     = loading;
    btn.textContent  = loading ? label : btn.dataset.label || label;
    if (!btn.dataset.label) btn.dataset.label = label;
  }

  // ── PUBLIC API ───────────────────────────────────────────────
  return { init, switchMode };

})();

// Auto-init on DOM ready
document.addEventListener("DOMContentLoaded", AUTH_UI.init);
