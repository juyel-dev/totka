// ============================================================
// js/engine.js — TOTKA 2.0 CORE ENCODING ENGINE
// JavaScript port of the Python reference implementation
// Requires: pako.min.js (loaded before this file)
// ============================================================

const TOTKA_ENGINE = (() => {

  // ── GLOBAL CONFIGURATION ────────────────────────────────────
  // These MUST match the Python reference exactly — never change
  const POOL         = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789০১২৩৪৫৬৭৮৯কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহঅআইঈউঊঋএঐওঔ";
  const START_UNICODE = 0x4E00;  // Unicode Private Use Area start
  const CHUNK_BITS    = 18;
  const MASK          = (1 << CHUNK_BITS) - 1; // = 262143 = 0x3FFFF
  const POOL_LEN      = POOL.length;            // = 86

  // Build O(1) reverse lookup map for decode
  const POOL_MAP = new Map();
  for (let i = 0; i < POOL_LEN; i++) POOL_MAP.set(POOL[i], i);

  // ── ENCODE (Uint8Array → encoded string) ──────────────────
  // Steps:
  //  1. zlib compress with pako.deflate (level 9)
  //  2. Read compressed bytes into bit buffer (8 bits at a time)
  //  3. Extract 18-bit chunks → map to POOL char or Unicode
  //  4. Leftover bits → zero-padded to 18 bits (zlib EOS cleans up on decode)
  function encode(uint8Array, onProgress) {
    if (!(uint8Array instanceof Uint8Array)) {
      throw new Error("encode() requires a Uint8Array");
    }

    // Step 1: Compress
    const compressed = pako.deflate(uint8Array, { level: 9 });
    const totalBytes = compressed.length;
    const chars      = [];

    // We use BigInt for the bit_buffer to safely handle large values
    // (JS bitwise ops are 32-bit signed — would overflow for 18-bit chunks)
    let bit_buffer = 0n;   // BigInt
    let bit_count  = 0;    // plain int (number of valid bits in buffer)

    const CHUNK_BITS_BIG = 18n;
    const MASK_BIG       = BigInt(MASK);
    const POOL_LEN_BIG   = BigInt(POOL_LEN);

    let lastProgressPct = 0;

    // Step 2 & 3: Process each compressed byte
    for (let i = 0; i < totalBytes; i++) {
      const byte = compressed[i];

      // Shift buffer left 8 bits, OR in new byte
      bit_buffer = (bit_buffer << 8n) | BigInt(byte);
      bit_count += 8;

      // Extract complete 18-bit chunks
      while (bit_count >= CHUNK_BITS) {
        const shift = BigInt(bit_count - CHUNK_BITS);
        const val   = (bit_buffer >> shift) & MASK_BIG;
        bit_count  -= CHUNK_BITS;

        if (val < POOL_LEN_BIG) {
          chars.push(POOL[Number(val)]);
        } else {
          chars.push(String.fromCodePoint(START_UNICODE + Number(val - POOL_LEN_BIG)));
        }
      }

      // Progress callback (every 2%)
      if (onProgress) {
        const pct = Math.floor((i / totalBytes) * 90); // 0–90% for encoding loop
        if (pct - lastProgressPct >= 2) {
          lastProgressPct = pct;
          onProgress(pct, "Encoding...", `${i.toLocaleString()} / ${totalBytes.toLocaleString()} bytes`);
        }
      }
    }

    // Step 4: Handle leftover bits — zero-pad right to 18 bits
    if (bit_count > 0) {
      const shift = BigInt(CHUNK_BITS - bit_count);
      const val   = (bit_buffer << shift) & MASK_BIG;
      if (val < POOL_LEN_BIG) {
        chars.push(POOL[Number(val)]);
      } else {
        chars.push(String.fromCodePoint(START_UNICODE + Number(val - POOL_LEN_BIG)));
      }
    }

    if (onProgress) onProgress(95, "Joining output...", "");
    const result = chars.join("");
    if (onProgress) onProgress(100, "Encoding complete!", `${result.length.toLocaleString()} characters`);

    return result;
  }

  // ── DECODE (encoded string → Uint8Array) ──────────────────
  // Steps:
  //  1. For each char: reverse-map to 18-bit value
  //  2. Push 18 bits into bit buffer
  //  3. Extract 8-bit bytes as they accumulate
  //  4. pako.inflate() → original file bytes
  //     (zlib EOS marker discards zero-padding garbage automatically)
  function decode(encodedText, onProgress) {
    if (typeof encodedText !== "string") {
      throw new Error("decode() requires a string");
    }
    if (encodedText.length === 0) {
      throw new Error("Empty encoded string");
    }

    const totalChars  = encodedText.length;
    const decodedInts = [];

    let bit_buffer = 0n;
    let bit_count  = 0;

    const CHUNK_BITS_BIG = 18n;
    const POOL_LEN_BIG   = BigInt(POOL_LEN);

    let lastProgressPct = 0;

    // Use for...of to correctly iterate Unicode codepoints
    // (important because some chars may be multi-byte surrogate pairs)
    let charIdx = 0;
    for (const char of encodedText) {
      // Step 1: Reverse mapping
      let val;
      if (POOL_MAP.has(char)) {
        val = BigInt(POOL_MAP.get(char));
      } else {
        const cp = char.codePointAt(0);
        val = BigInt(cp - START_UNICODE) + POOL_LEN_BIG;
      }

      // Step 2: Push 18 bits into buffer
      bit_buffer = (bit_buffer << CHUNK_BITS_BIG) | val;
      bit_count += CHUNK_BITS;

      // Step 3: Extract complete bytes (8 bits each)
      while (bit_count >= 8) {
        const shift = BigInt(bit_count - 8);
        decodedInts.push(Number((bit_buffer >> shift) & 0xFFn));
        bit_count -= 8;
      }

      // Progress callback
      charIdx++;
      if (onProgress) {
        const pct = Math.floor((charIdx / totalChars) * 85);
        if (pct - lastProgressPct >= 2) {
          lastProgressPct = pct;
          onProgress(pct, "Decoding bits...", `${charIdx.toLocaleString()} / ${totalChars.toLocaleString()} chars`);
        }
      }
    }

    if (onProgress) onProgress(88, "Decompressing...", "");

    // Step 4: Decompress — pako.inflate() = Python's zlib.decompress()
    // zlib's EOS marker automatically discards the zero-padding from leftover bits
    const compressed  = new Uint8Array(decodedInts);
    let originalBytes;
    try {
      originalBytes = pako.inflate(compressed);
    } catch (err) {
      throw new Error("Decompression failed — data may be corrupted. " + err.message);
    }

    if (onProgress) onProgress(100, "Decode complete!", formatSize(originalBytes.length));

    return originalBytes; // Uint8Array of original file
  }

  // ── ENCODE FROM FILE (convenience wrapper) ─────────────────
  // Reads a File object → Uint8Array → encode()
  // Returns: { encoded, originalSize, encodedLen }
  async function encodeFile(file, onProgress) {
    if (onProgress) onProgress(5, "Reading file...", formatSize(file.size));

    const buffer   = await file.arrayBuffer();
    const uint8    = new Uint8Array(buffer);

    if (onProgress) onProgress(10, "Compressing...", `${formatSize(file.size)} → ?`);

    const encoded  = encode(uint8, (pct, status, detail) => {
      // Map 0–100 of encode → 10–98 of overall
      if (onProgress) onProgress(10 + Math.floor(pct * 0.88), status, detail);
    });

    return {
      encoded,
      originalSize:   file.size,
      originalSizeFmt: formatSize(file.size),
      encodedLen:     encoded.length,
      fileName:       file.name,
      fileType:       file.type || "application/octet-stream",
    };
  }

  // ── DECODE TO DOWNLOAD (convenience wrapper) ────────────────
  // Takes encoded string + filename → triggers browser download
  async function decodeAndDownload(encodedText, fileName, fileType, onProgress) {
    const bytes = decode(encodedText, onProgress);
    const blob  = new Blob([bytes], { type: fileType || "application/octet-stream" });
    const url   = URL.createObjectURL(blob);

    const a     = document.createElement("a");
    a.href      = url;
    a.download  = fileName || "totka_decoded_file";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Release object URL after short delay
    setTimeout(() => URL.revokeObjectURL(url), 5000);

    return { success: true, size: bytes.length, sizeFmt: formatSize(bytes.length) };
  }

  // ── VERIFY ROUND-TRIP (for testing) ────────────────────────
  async function verify(file) {
    console.log(`[TOTKA ENGINE] Verifying: ${file.name} (${formatSize(file.size)})`);
    const t1       = performance.now();
    const buf      = new Uint8Array(await file.arrayBuffer());
    const encoded  = encode(buf);
    const decoded  = decode(encoded);
    const t2       = performance.now();

    const match    = buf.length === decoded.length &&
      buf.every((b, i) => b === decoded[i]);

    console.log(`[TOTKA ENGINE] Result: ${match ? "✅ PASS" : "❌ FAIL"}`);
    console.log(`[TOTKA ENGINE] Original: ${buf.length} bytes`);
    console.log(`[TOTKA ENGINE] Encoded:  ${encoded.length} chars`);
    console.log(`[TOTKA ENGINE] Decoded:  ${decoded.length} bytes`);
    console.log(`[TOTKA ENGINE] Time:     ${(t2-t1).toFixed(0)}ms`);
    console.log(`[TOTKA ENGINE] Ratio:    ${(encoded.length / buf.length).toFixed(2)}x`);

    return { match, originalLen: buf.length, encodedLen: encoded.length, decodedLen: decoded.length, ms: t2-t1 };
  }

  // ── INTERNAL: formatSize ────────────────────────────────────
  function formatSize(bytes) {
    if (!bytes || bytes === 0) return "0 B";
    const u = ["B","KB","MB","GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i===0?0:1) + " " + u[i];
  }

  // ── PUBLIC API ──────────────────────────────────────────────
  return {
    encode,
    decode,
    encodeFile,
    decodeAndDownload,
    verify,
    POOL,
    POOL_LEN,
    START_UNICODE,
    CHUNK_BITS,
  };

})(); // End TOTKA_ENGINE IIFE


// ── WEB WORKER SUPPORT ──────────────────────────────────────
// For large files (>20MB), the encoding can freeze the UI thread.
// This factory creates an inline worker that runs encoding off-thread.
//
// Usage in encode.js:
//   const worker = TOTKA_WORKER.create();
//   worker.encode(uint8Array, (pct, status, detail) => { ... })
//     .then(encoded => { ... })
//     .finally(() => worker.terminate());
//
const TOTKA_WORKER = {
  create() {
    // Build the worker source as a blob (no separate worker file needed)
    const workerSrc = `
      importScripts(
        "https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js"
      );

      const POOL          = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789০১২৩৪৫৬৭৮৯কখগঘঙচছজঝঞটঠডঢণতথদধনপফবভমযরলশষসহঅআইঈউঊঋএঐওঔ";
      const START_UNICODE = 0x4E00;
      const CHUNK_BITS    = 18;
      const MASK          = (1 << CHUNK_BITS) - 1;
      const POOL_LEN      = POOL.length;

      onmessage = function(e) {
        const { type, uint8Array } = e.data;
        if (type !== "encode") return;

        try {
          const compressed    = pako.deflate(uint8Array, { level: 9 });
          const totalBytes    = compressed.length;
          const chars         = [];
          let bit_buffer      = 0n;
          let bit_count       = 0;
          const CHUNK_BIG     = 18n;
          const MASK_BIG      = BigInt(MASK);
          const POOL_LEN_BIG  = BigInt(POOL_LEN);
          let lastPct         = 0;

          for (let i = 0; i < totalBytes; i++) {
            bit_buffer = (bit_buffer << 8n) | BigInt(compressed[i]);
            bit_count += 8;

            while (bit_count >= CHUNK_BITS) {
              const val   = (bit_buffer >> BigInt(bit_count - CHUNK_BITS)) & MASK_BIG;
              bit_count  -= CHUNK_BITS;
              chars.push(val < POOL_LEN_BIG
                ? POOL[Number(val)]
                : String.fromCodePoint(START_UNICODE + Number(val - POOL_LEN_BIG)));
            }

            const pct = Math.floor((i / totalBytes) * 90);
            if (pct - lastPct >= 2) {
              lastPct = pct;
              postMessage({ type: "progress", pct, status: "Encoding...",
                detail: i.toLocaleString() + " / " + totalBytes.toLocaleString() + " bytes" });
            }
          }

          if (bit_count > 0) {
            const val = (bit_buffer << BigInt(CHUNK_BITS - bit_count)) & MASK_BIG;
            chars.push(val < POOL_LEN_BIG
              ? POOL[Number(val)]
              : String.fromCodePoint(START_UNICODE + Number(val - POOL_LEN_BIG)));
          }

          postMessage({ type: "progress", pct: 98, status: "Joining...", detail: "" });
          const result = chars.join("");
          postMessage({ type: "done", encoded: result });

        } catch(err) {
          postMessage({ type: "error", message: err.message });
        }
      };
    `;

    const blob   = new Blob([workerSrc], { type: "application/javascript" });
    const url    = URL.createObjectURL(blob);
    const worker = new Worker(url);
    URL.revokeObjectURL(url);

    return {
      encode(uint8Array, onProgress) {
        return new Promise((resolve, reject) => {
          worker.onmessage = (e) => {
            const { type, pct, status, detail, encoded, message } = e.data;
            if (type === "progress" && onProgress) onProgress(pct, status, detail);
            else if (type === "done")    resolve(encoded);
            else if (type === "error")   reject(new Error(message));
          };
          worker.onerror = (err) => reject(new Error(err.message));
          worker.postMessage({ type: "encode", uint8Array }, [uint8Array.buffer]);
        });
      },
      terminate() { worker.terminate(); },
    };
  },
};
