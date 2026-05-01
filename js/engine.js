// ============================================================
// js/engine.js — TOTKA 3.0 : MINIMUM KB / MAXIMUM SAFETY
// 16‑bit BMP encoding → equal size to compressed data
// Requires: pako.min.js
// ============================================================

const TOTKA_ENGINE = (() => {

  const CHUNK_BITS = 16;
  const MASK = (1 << CHUNK_BITS) - 1; // = 0xFFFF

  // ── ENCODE (Uint8Array → JS string of BMP chars) ────────
  function encode(uint8Array, onProgress) {
    if (!(uint8Array instanceof Uint8Array)) {
      throw new Error("encode() requires a Uint8Array");
    }

    const compressed = pako.deflate(uint8Array, { level: 9 });
    const totalBytes = compressed.length;
    const chars = [];

    let buf = 0;
    let bits = 0;

    for (let i = 0; i < totalBytes; i++) {
      buf = (buf << 8) | compressed[i];
      bits += 8;

      while (bits >= 16) {
        const val = (buf >>> (bits - 16)) & MASK;
        bits -= 16;
        chars.push(String.fromCharCode(val));
      }

      if (onProgress && i % 1024 === 0) {
        const pct = Math.floor((i / totalBytes) * 90);
        onProgress(pct, 'Encoding...', `${i} / ${totalBytes} bytes`);
      }
    }

    // leftover bits (always <16)
    if (bits > 0) {
      const val = (buf << (16 - bits)) & MASK; // zero-pad
      chars.push(String.fromCharCode(val));
    }

    if (onProgress) onProgress(95, 'Joining…', '');
    const result = chars.join('');
    if (onProgress) onProgress(100, 'Encode done', `${result.length} chars`);
    return result;
  }

  // ── DECODE (BMP string → Uint8Array of original) ─────────
  function decode(encodedText, onProgress) {
    if (typeof encodedText !== 'string') {
      throw new Error('decode() requires a string');
    }

    const totalChars = encodedText.length;
    const bytesArr = [];

    let buf = 0;
    let bits = 0;

    for (let i = 0; i < totalChars; i++) {
      const val = encodedText.charCodeAt(i); // 0–65535
      buf = (buf << 16) | val;
      bits += 16;

      while (bits >= 8) {
        bytesArr.push((buf >>> (bits - 8)) & 0xFF);
        bits -= 8;
      }

      if (onProgress && i % 1024 === 0) {
        onProgress(Math.floor((i / totalChars) * 85), 'Decoding…', `${i}/${totalChars}`);
      }
    }

    if (onProgress) onProgress(88, 'Decompressing…', '');
    const compressed = new Uint8Array(bytesArr);
    let original;
    try {
      original = pako.inflate(compressed);
    } catch (e) {
      throw new Error('Decompression failed: ' + e.message);
    }

    if (onProgress) onProgress(100, 'Decode done', formatSize(original.length));
    return original;
  }

  // ── ENCODE FILE (File → encoded string + meta) ───────────
  async function encodeFile(file, onProgress) {
    if (onProgress) onProgress(5, 'Reading…', formatSize(file.size));
    const buf = await file.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    if (onProgress) onProgress(10, 'Compressing…', formatSize(file.size));
    const encoded = encode(uint8, (pct, status, detail) => {
      if (onProgress) onProgress(10 + Math.floor(pct * 0.88), status, detail);
    });
    return {
      encoded,
      originalSize: file.size,
      originalSizeFmt: formatSize(file.size),
      encodedLen: encoded.length,
      fileName: file.name,
      fileType: file.type || 'application/octet-stream',
    };
  }

  // ── DECODE & DOWNLOAD (raw bytes, no text encoding) ─────
  function decodeAndDownload(encodedText, fileName, fileType, onProgress) {
    const bytes = decode(encodedText, onProgress);
    // সরাসরি বাইনারি ব্লব — কোনো ইউনিকোড ট্রান্সফর্মেশন নয়
    const blob = new Blob([bytes], {
      type: fileType || 'application/octet-stream'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'totka_decoded_file';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { success: true, size: bytes.length, sizeFmt: formatSize(bytes.length) };
  }

  // ── VERIFY ───────────────────────────────────────────────
  async function verify(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const encoded = encode(buf);
    const decoded = decode(encoded);
    const match = buf.length === decoded.length &&
                  buf.every((v, i) => v === decoded[i]);
    console.log(`Verify: ${match ? '✅ PASS' : '❌ FAIL'} | ` +
                `Original: ${buf.length} B → Encoded: ${encoded.length} chars → Decoded: ${decoded.length} B`);
    return { match, originalLen: buf.length, encodedLen: encoded.length, decodedLen: decoded.length };
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  return { encode, decode, encodeFile, decodeAndDownload, verify, CHUNK_BITS };

})();

// ── WEB WORKER (updated for 16‑bit) ────────────────────────
const TOTKA_WORKER = {
  create() {
    const workerSrc = `
      importScripts('https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js');
      const CHUNK_BITS = 16, MASK = 0xFFFF;

      onmessage = e => {
        if (e.data.type !== 'encode') return;
        try {
          const compressed = pako.deflate(e.data.uint8Array, { level: 9 });
          const total = compressed.length;
          const chars = [];
          let buf = 0, bits = 0, lastPct = 0;

          for (let i = 0; i < total; i++) {
            buf = (buf << 8) | compressed[i];
            bits += 8;
            while (bits >= CHUNK_BITS) {
              chars.push(String.fromCharCode((buf >>> (bits - CHUNK_BITS)) & MASK));
              bits -= CHUNK_BITS;
            }
            const pct = Math.floor((i / total) * 90);
            if (pct - lastPct >= 2) {
              lastPct = pct;
              postMessage({ type: 'progress', pct, status: 'Encoding…', detail: i + ' / ' + total });
            }
          }
          if (bits > 0) chars.push(String.fromCharCode((buf << (CHUNK_BITS - bits)) & MASK));
          postMessage({ type: 'progress', pct: 98, status: 'Joining…', detail: '' });
          postMessage({ type: 'done', encoded: chars.join('') });
        } catch (err) {
          postMessage({ type: 'error', message: err.message });
        }
      };
    `;
    const blob = new Blob([workerSrc], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);
    return {
      encode(uint8Array, onProgress) {
        const copy = new Uint8Array(uint8Array); // কপি, ট্রান্সফার নয়
        return new Promise((resolve, reject) => {
          worker.onmessage = e => {
            const { type, pct, status, detail, encoded, message } = e.data;
            if (type === 'progress' && onProgress) onProgress(pct, status, detail);
            else if (type === 'done') resolve(encoded);
            else if (type === 'error') reject(new Error(message));
          };
          worker.onerror = err => reject(new Error(err.message));
          worker.postMessage({ type: 'encode', uint8Array: copy });
        });
      },
      terminate() { worker.terminate(); },
    };
  },
};
