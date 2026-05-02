// ============================================================
// js/engine.js — TOTKA 3.0 : 16‑BIT BMP + EMBEDDED METADATA
// Only BMP characters (U+0000–U+FFFF) – safe in GAS/JSON.
// Metadata (filename, mime type) is embedded in the string.
// Requires: pako.min.js (loaded before this file)
// ============================================================

const TOTKA_ENGINE = (() => {

  const CHUNK_BITS = 16;
  const MASK = (1 << CHUNK_BITS) - 1; // = 0xFFFF

  // Magic signature: 4 chars + compact JSON + null byte
  const MAGIC = "TOTK";
  const NULL_CHAR = "\x00";

  // ── ENCODE (raw bytes → BMP string, no metadata) ──────────
  function encode(uint8Array, onProgress) {
    return _encodeBits(uint8Array, onProgress);
  }

  // ── ENCODE WITH METADATA (recommended for files) ──────────
  function encodeWithMeta(uint8Array, meta, onProgress) {
    if (!meta || !meta.fileName) {
      return encode(uint8Array, onProgress);
    }
    // Compact header
    const m = {
      n: meta.fileName,
      t: meta.mimeType || "application/octet-stream",
      s: meta.originalSize || ""   // optional, for display
    };
    const header = MAGIC + JSON.stringify(m) + NULL_CHAR;
    if (onProgress) onProgress(0, 'Building header…', '');
    const body = _encodeBits(uint8Array, onProgress ? _shiftProgress(onProgress, 2, 98) : null);
    const result = header + body;
    if (onProgress) onProgress(100, 'Encode with meta done', `${result.length} chars`);
    return result;
  }

  // ── CORE BIT ENCODING (shared) ────────────────────────────
  function _encodeBits(uint8Array, onProgress) {
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
        onProgress(pct, 'Encoding…', `${i}/${totalBytes} bytes`);
      }
    }

    // leftover bits (if any) → zero-pad to 16 bits
    if (bits > 0) {
      const val = (buf << (16 - bits)) & MASK;
      chars.push(String.fromCharCode(val));
    }

    if (onProgress) onProgress(95, 'Joining…', '');
    const result = chars.join('');
    if (onProgress) onProgress(100, 'Encode done', `${result.length} chars`);
    return result;
  }

  // ── DECODE (string → { bytes, meta } ) ────────────────────
  function decode(encodedText, onProgress) {
    if (typeof encodedText !== 'string') {
      throw new Error('decode() requires a string');
    }

    let body = encodedText;
    let meta = null;

    // Check for TOTK header
    if (encodedText.startsWith(MAGIC)) {
      const idx = encodedText.indexOf(NULL_CHAR, MAGIC.length);
      if (idx !== -1) {
        const headerStr = encodedText.substring(MAGIC.length, idx);
        try {
          const m = JSON.parse(headerStr);
          meta = {
            fileName: m.n,
            mimeType: m.t,
            originalSize: m.s
          };
        } catch (_) {
          // corrupt header – fallback to bare decode
          meta = null;
        }
        body = encodedText.substring(idx + 1);
      }
    }

    const bytes = _decodeBits(body, onProgress);
    return { bytes, meta };
  }

  // ── CORE BIT DECODING ───────────────────────────────────
  function _decodeBits(encodedPart, onProgress) {
    const totalChars = encodedPart.length;
    const bytesArr = [];

    let buf = 0;
    let bits = 0;

    for (let i = 0; i < totalChars; i++) {
      const val = encodedPart.charCodeAt(i); // 0–65535
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
      throw new Error('Decompression failed — data corrupted: ' + e.message);
    }
    if (onProgress) onProgress(100, 'Decode done', formatSize(original.length));
    return original;
  }

  // ── HELPERS ──────────────────────────────────────────────
  function _shiftProgress(baseCallback, offset, scaleTo) {
    return (pct, status, detail) => {
      const newPct = offset + Math.floor((pct / 100) * (scaleTo - offset));
      baseCallback(newPct, status, detail);
    };
  }

  function formatSize(bytes) {
    if (!bytes) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + u[i];
  }

  // ── CONVENIENCE WRAPPERS ────────────────────────────────
  async function encodeFile(file, onProgress) {
    if (onProgress) onProgress(5, 'Reading…', formatSize(file.size));
    const buf = await file.arrayBuffer();
    const uint8 = new Uint8Array(buf);
    if (onProgress) onProgress(10, 'Compressing…', formatSize(file.size));
    const encoded = encodeWithMeta(uint8, {
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      originalSize: formatSize(file.size)
    }, (pct, status, detail) => {
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

  function decodeAndDownload(encodedText, onProgress) {
    const { bytes, meta } = decode(encodedText, onProgress);
    const fileName = meta ? meta.fileName : 'totka_decoded_file';
    const mimeType = meta ? meta.mimeType : 'application/octet-stream';
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { success: true, size: bytes.length, sizeFmt: formatSize(bytes.length), fileName, mimeType };
  }

  async function verify(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const encoded = encodeWithMeta(buf, {
      fileName: file.name,
      mimeType: file.type || 'app/octet-stream'
    });
    const { bytes, meta } = decode(encoded);
    const match = buf.length === bytes.length && buf.every((v, i) => v === bytes[i]);
    console.log(`TOTKA 3.0 verify: ${match ? '✅ PASS' : '❌ FAIL'}, Metadata: ${meta?.fileName || 'none'}`);
    return { match, originalLen: buf.length, encodedLen: encoded.length, decodedLen: bytes.length, meta };
  }

  return {
    encode,
    encodeWithMeta,
    decode,
    encodeFile,
    decodeAndDownload,
    verify,
    CHUNK_BITS,
    MAGIC
  };

})();

// ── WEB WORKER (returns bare BMP body, no header) ──────────
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
              postMessage({ type: 'progress', pct, status: 'Encoding…', detail: i + '/' + total });
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
        const copy = new Uint8Array(uint8Array);
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
