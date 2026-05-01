// ============================================================
// js/image.js — TOTKA 2.0
// Profile picture compression using Canvas API
// Target: ≤50KB, 300×300px, center-cropped, JPEG
// Requires: config.js loaded first
// ============================================================

const IMAGE = (() => {

  const TARGET_DIM  = 300;                    // Output size: 300×300 px
  const MAX_BYTES   = TOTKA.MAX_PIC_SIZE;     // 50 * 1024 = 51200 bytes
  const MAX_BYTES_SOFT = MAX_BYTES * 1.4;     // 70KB soft cap (with warning)
  const ACCEPTED    = ["image/jpeg","image/png","image/gif","image/webp"];

  // ── MAIN COMPRESS FUNCTION ──────────────────────────────────
  // Returns: Promise<{ base64, sizeKB, quality, width, height }>
  async function compressProfilePic(file) {
    return new Promise((resolve, reject) => {

      // Validate file type
      if (!ACCEPTED.includes(file.type)) {
        return reject(new Error(`INVALID_TYPE: Accepted formats: JPG, PNG, GIF, WEBP`));
      }

      // Validate raw file size (don't even try if > 20MB)
      if (file.size > 20 * 1024 * 1024) {
        return reject(new Error(`FILE_TOO_LARGE: Max 20MB source image`));
      }

      const reader = new FileReader();
      reader.readAsDataURL(file);

      reader.onerror = () => reject(new Error("FILE_READ_FAILED"));

      reader.onload = (e) => {
        const img = new Image();
        img.src = e.target.result;

        img.onerror = () => reject(new Error("IMAGE_LOAD_FAILED: Invalid image data"));

        img.onload = () => {
          // ── Create canvas ──────────────────────────────────
          const canvas  = document.createElement("canvas");
          canvas.width  = TARGET_DIM;
          canvas.height = TARGET_DIM;
          const ctx     = canvas.getContext("2d");

          // ── Center-crop to square ──────────────────────────
          // Take the largest square from the center of the image
          const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
          const srcX    = Math.floor((img.naturalWidth  - srcSize) / 2);
          const srcY    = Math.floor((img.naturalHeight - srcSize) / 2);

          // Draw source square → 300×300 canvas
          ctx.drawImage(
            img,
            srcX, srcY, srcSize, srcSize,  // source: center-cropped square
            0,    0,    TARGET_DIM, TARGET_DIM  // dest: full 300×300 canvas
          );

          // ── Iterative quality reduction ────────────────────
          // Start at 80% quality, step down by 8% each iteration
          let quality  = 0.80;
          let base64   = canvas.toDataURL("image/jpeg", quality);
          let sizeBytes = _b64Size(base64);

          while (sizeBytes > MAX_BYTES && quality > 0.10) {
            quality  -= 0.08;
            quality   = Math.max(0.10, quality); // floor at 10%
            base64    = canvas.toDataURL("image/jpeg", quality);
            sizeBytes = _b64Size(base64);
          }

          const sizeKB = Math.round(sizeBytes / 1024 * 10) / 10;

          // Hard reject if still too large even at minimum quality
          if (sizeBytes > MAX_BYTES_SOFT) {
            return reject(new Error(
              `STILL_TOO_LARGE: ${sizeKB}KB after max compression. ` +
              `Please use a simpler/smaller image.`
            ));
          }

          resolve({
            base64,
            sizeKB,
            sizeBytes,
            quality:    Math.round(quality * 100),
            width:      TARGET_DIM,
            height:     TARGET_DIM,
            format:     "image/jpeg",
          });
        };
      };
    });
  }

  // ── PREVIEW IN <img> ELEMENT ────────────────────────────────
  // Reads a file and displays it in an img element before compression
  function previewFile(file, imgElement) {
    return new Promise((resolve, reject) => {
      if (!file || !imgElement) return reject(new Error("Missing file or element"));
      const reader  = new FileReader();
      reader.onload = (e) => {
        imgElement.src = e.target.result;
        resolve(e.target.result);
      };
      reader.onerror = () => reject(new Error("Preview read failed"));
      reader.readAsDataURL(file);
    });
  }

  // ── HANDLE FILE INPUT CHANGE EVENT ─────────────────────────
  // Use this directly on an <input type="file"> change handler
  // Returns compressed result or shows error toast
  async function handleFileInput(inputElement, previewImgElement, statusElement) {
    const file = inputElement.files && inputElement.files[0];
    if (!file) return null;

    // Show preview immediately (before compression)
    if (previewImgElement) {
      await previewFile(file, previewImgElement).catch(() => {});
    }

    // Show loading state
    if (statusElement) {
      statusElement.textContent = "Compressing...";
      statusElement.style.color = "var(--text-muted)";
    }

    try {
      const result = await compressProfilePic(file);

      if (statusElement) {
        statusElement.textContent = `✅ ${result.sizeKB}KB · ${result.quality}% quality · 300×300px`;
        statusElement.style.color = "var(--accent-green)";
      }

      // Update preview with compressed version
      if (previewImgElement) {
        previewImgElement.src = result.base64;
      }

      return result;

    } catch (err) {
      const msg = err.message.includes(":") ? err.message.split(":")[1].trim() : err.message;

      if (statusElement) {
        statusElement.textContent = `❌ ${msg}`;
        statusElement.style.color = "var(--accent-red)";
      }

      showToast(msg, "error");
      return null;
    }
  }

  // ── VALIDATE BASE64 SIZE (before storing) ──────────────────
  function validateBase64(base64) {
    if (!base64) return { valid: false, error: "Empty" };
    const sizeBytes = _b64Size(base64);
    const sizeKB    = Math.round(sizeBytes / 1024 * 10) / 10;
    if (sizeBytes > MAX_BYTES_SOFT) {
      return { valid: false, error: `Too large: ${sizeKB}KB (max 50KB)`, sizeKB };
    }
    return { valid: true, sizeKB };
  }

  // ── AVATAR PLACEHOLDER (when no pic) ───────────────────────
  // Generates a colored SVG avatar with initials
  function generateAvatar(name, size = 80) {
    const initial = (name || "?").charAt(0).toUpperCase();
    const colors  = [
      "#58a6ff","#238636","#d29922","#da3633",
      "#8957e5","#3fb950","#f0883e","#79c0ff",
    ];
    // Pick color based on char code (consistent per name)
    const color   = colors[initial.charCodeAt(0) % colors.length];
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <rect width="${size}" height="${size}" rx="${size/2}" fill="${color}"/>
        <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
          fill="white" font-size="${size*0.42}" font-family="JetBrains Mono,monospace"
          font-weight="700">${initial}</text>
      </svg>`.trim();
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  }

  // ── RENDER PROFILE PIC (in any img element) ─────────────────
  // Uses base64 if available, falls back to SVG avatar
  function renderProfilePic(imgElement, base64, name, size = 80) {
    if (!imgElement) return;
    if (base64 && base64.startsWith("data:")) {
      imgElement.src = base64;
    } else {
      imgElement.src = generateAvatar(name || "?", size);
    }
    imgElement.style.width     = size + "px";
    imgElement.style.height    = size + "px";
    imgElement.style.objectFit = "cover";
    imgElement.style.borderRadius = "50%";
  }

  // ── INTERNAL: Calculate byte size of base64 string ─────────
  function _b64Size(base64) {
    // Remove data URL prefix (e.g. "data:image/jpeg;base64,")
    const b64 = base64.includes(",") ? base64.split(",")[1] : base64;
    // base64 encodes 3 bytes as 4 chars; padding '=' means fewer bytes
    const padding = (b64.match(/=/g) || []).length;
    return Math.floor(b64.length * 3 / 4) - padding;
  }

  // ── PUBLIC API ──────────────────────────────────────────────
  return {
    compressProfilePic,
    previewFile,
    handleFileInput,
    validateBase64,
    generateAvatar,
    renderProfilePic,
    TARGET_DIM,
    MAX_BYTES,
  };

})();
