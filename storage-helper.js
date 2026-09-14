// ============================================================
//  Storage Helper — Google Drive upload/download for check-sheet evidence
//  photos and generated PDFs (the review/approval workflow's file layer).
//
//  Routes through a Google Apps Script Web App (google-apps-script/
//  drive-proxy.gs in this repo) instead of Firebase Storage, because
//  Firebase Storage now requires the paid Blaze plan even to enable it —
//  this stays on the free Spark plan. See that file's header comment for
//  the one-time deployment steps.
//
//  PASTE YOUR DEPLOYED WEB APP URL HERE (ends in /exec):
// ============================================================
const DRIVE_PROXY_URL = 'https://script.google.com/macros/s/AKfycbxDDZffhNAInCHnlcWAwYLmenVvmIQXqpIvdeS3nXiaE4QCTfzngsrFeulPfYPUA-c/exec';

// Shared secret between this repo and google-apps-script/drive-proxy.gs.
// Empty string = disabled (proxy accepts every request — the pre-2026-09
// behaviour). To turn it on: set the SAME random string here AND in
// drive-proxy.gs's SHARED_SECRET, redeploy the Apps Script (Manage
// deployments -> New version), then bump ?v= repo-wide per CLAUDE.md so no
// browser keeps a tokenless copy of this file. See SECURITY.md step 4.
const DRIVE_PROXY_TOKEN = '';

// ---- Reliability: retry + timeout wrapper for every Drive-proxy call ----
// Apps Script Web Apps are genuinely flaky in ways a plain fetch() has no
// chance against: a cold-start on the free tier can take 10-20s before the
// first byte, a mobile connection in the field drops mid-request, and the
// proxy occasionally answers with a transient "Service invoked too many
// times" / a truncated response instead of real JSON. Before this, EVERY
// upload/download in this app (evidence photos, PDFs, drafts) was exactly
// one flaky round-trip away from failing outright and forcing the user to
// redo the whole thing — this is the actual root cause behind "upload/
// download sering gagal", not any one page's own code. Fixed once, here,
// so every caller (all 25+ check sheets via approval-helper.js, both
// dashboards' download/preview buttons, load-merge-modal.js, cloud-draft.js)
// gets automatic retries for free.
const STORAGE_RETRY_ATTEMPTS = 3;
const STORAGE_RETRY_BASE_MS = 900;      // exponential backoff: ~0.9s, 1.8s, 3.6s (+ jitter)
// Per-attempt timeout ESCALATES rather than staying flat: 60s, 2min, 4min.
// A flat short timeout (an earlier version of this used 45s for every
// attempt) is actively WRONG for a large file — a multi-page scanned PDF
// (e.g. a manually-uploaded calibration certificate, easily several MB,
// bigger again after base64 inflation) can legitimately need more than 45s
// to round-trip through the Apps Script proxy, especially on a mobile
// connection or during a cold start. Retrying that same transfer 3x at the
// SAME short timeout can never succeed — it just fails 3x faster than
// before this file had a timeout at all, and before this file had ANY
// timeout, a slow-but-real download just took a while and worked. Confirmed
// via a real user report: an approved manual-upload PDF stuck retrying at
// ~92% (the no-Content-Length progress curve) and ultimately failing to
// download. Escalating the timeout keeps the fast-fail benefit for a truly
// dead connection (first attempt still gives up in 60s) while giving a
// slow-but-alive large transfer real room to finish on a later attempt.
const STORAGE_TIMEOUT_SCHEDULE_MS = [60000, 120000, 240000];
function storageTimeoutFor(attempt) {
  return STORAGE_TIMEOUT_SCHEDULE_MS[Math.min(attempt - 1, STORAGE_TIMEOUT_SCHEDULE_MS.length - 1)];
}

// ---- Reliability: chunked reads for large files ----
// Even with retries and a generous timeout, a large file (a multi-page
// scanned PDF from a manual upload — the one file type in this app with NO
// size cap or compression applied before upload, see submitManualUpload())
// reliably failed to download EVERY time, not just occasionally. That's the
// signature of a hard server-side ceiling on a single Apps Script Web App
// response, not a flaky network — no amount of client-side waiting or
// retrying can produce a response the server can't build in one piece.
// Fixed by never asking for more than STORAGE_CHUNK_BYTES in one request —
// drive-proxy.gs's doGet supports an optional &offset=&length= byte range
// (added 2026-09-14 alongside this) — and reassembling the chunks here.
// REQUIRES drive-proxy.gs to be redeployed (paste the updated file into
// script.google.com, Deploy -> Manage deployments -> New version) — an
// un-redeployed proxy ignores offset/length and returns the whole file in
// one response as before (detected via the missing `totalSize` field and
// treated as "this one response is already the complete file"), so this
// keeps working either way, just without the fix until redeployed.
const STORAGE_CHUNK_BYTES = 2 * 1024 * 1024; // 2MB raw (~2.8MB base64) per request

function _storageSleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// Runs attemptFn(attemptNo) with retry + exponential backoff + jitter.
// Throw an Error with `.noRetry = true` from attemptFn to skip retrying
// (used for configuration errors that a retry can never fix, e.g. a blank
// DRIVE_PROXY_URL). onRetry(attempt, max, err) — optional — fires just
// before each wait, so a caller can surface "mencoba lagi..." in its UI
// instead of the request silently going quiet for several seconds.
async function withStorageRetry(attemptFn, { attempts = STORAGE_RETRY_ATTEMPTS, onRetry } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await attemptFn(i);
    } catch (e) {
      lastErr = e;
      if (e && e.noRetry) throw e;
      if (i === attempts) break;
      if (typeof onRetry === 'function') { try { onRetry(i, attempts, e); } catch (_) {} }
      await _storageSleep(STORAGE_RETRY_BASE_MS * Math.pow(2, i - 1) + Math.random() * 400);
    }
  }
  throw lastErr;
}

// fetch() with a hard timeout via AbortController — a hung Apps Script
// request used to leave the UI stuck on "Mengunggah..." forever with no
// error and nothing to retry; this turns that into a normal, retryable
// failure after timeoutMs (see STORAGE_TIMEOUT_SCHEDULE_MS — callers pass
// an escalating value per attempt, not a flat constant).
function _storageFetchTimeout(url, opts, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || STORAGE_TIMEOUT_SCHEDULE_MS[0]);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

function proxyUrlWithToken(u) {
  if (!DRIVE_PROXY_TOKEN) return u;
  return u + (u.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(DRIVE_PROXY_TOKEN);
}

const Storage = {
  // path: a slash-separated virtual path, e.g.
  // 'checksheets/<id>/photos/inv01-0.jpg' — everything before the last
  // '/' becomes nested Drive folders under the proxy's ROOT_FOLDER_ID,
  // the rest becomes the file name.
  // dataUrl: a 'data:image/jpeg;base64,...' string (PhotoKit entries, or
  // pdf.output('datauristring')). Returns a URL that always routes back
  // through this same Web App (never a raw drive.google.com link) — see
  // drive-proxy.gs's doGet for why (CORS).
  // onProgress (optional): called with {phase:'retry', attempt, max, error}
  // if a transient failure triggers an automatic retry — lets a caller show
  // "koneksi bermasalah, mencoba lagi..." instead of looking frozen.
  async uploadDataUrl(path, dataUrl, contentType, onProgress) {
    const { subfolder, filename } = splitPath(path);
    const commaIdx = dataUrl.indexOf(',');
    const dataBase64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
    return uploadToDrive(filename, contentType, dataBase64, subfolder, onProgress);
  },

  async uploadBlob(path, blob, contentType, onProgress) {
    const { subfolder, filename } = splitPath(path);
    const dataBase64 = await blobToBase64(blob);
    return uploadToDrive(filename, contentType || blob.type, dataBase64, subfolder, onProgress);
  },

  // Reads a file this helper uploaded back into {bytes, mimeType, filename}.
  // drive-proxy.gs's doGet ALWAYS returns JSON+base64, never raw binary —
  // confirmed by hand that `return file.getBlob()` from doGet does not
  // actually serve real file bytes (Apps Script sends back a generic HTML
  // page instead), so this JSON decode is the only path that works, for
  // both pdf-lib's byte needs AND for anything meant to be displayed.
  // onProgress (optional): called with {loaded, total} as bytes accumulate
  // across chunks (real byte counts — total is the file's true size, known
  // from the first chunk's response), {phase:'retry', attempt, max, error}
  // if one chunk's transient failure is being retried, then once with
  // {phase:'decode'} just before chunks are reassembled into one buffer.
  // Always fetches in bounded pieces — see STORAGE_CHUNK_BYTES above.
  async fetchMeta(url, onProgress) {
    const reqUrl = proxyUrlWithToken(url);
    const hasQuery = reqUrl.indexOf('?') !== -1;
    const parts = [];
    let offset = 0, totalSize = null, mimeType, filename;
    for (;;) {
      const chunkUrl = reqUrl + (hasQuery ? '&' : '?') + 'offset=' + offset + '&length=' + STORAGE_CHUNK_BYTES;
      const json = await withStorageRetry(async (attempt) => {
        let resp;
        try {
          resp = await _storageFetchTimeout(chunkUrl, {}, storageTimeoutFor(attempt));
        } catch (e) {
          throw new Error(e && e.name === 'AbortError' ? 'Unduhan file timeout.' : 'Gagal mengambil file (jaringan).');
        }
        if (!resp.ok) throw new Error('Gagal mengambil file (HTTP ' + resp.status + ')');
        let j;
        try { j = await resp.json(); } catch (e) { throw new Error('Respon file tidak valid.'); }
        if (j.error) throw new Error(j.error);
        return j;
      }, {
        onRetry: (attempt, max, err) => {
          if (typeof onProgress === 'function') { try { onProgress({ phase: 'retry', attempt, max, error: err && err.message }); } catch (e) {} }
        },
      });
      if (mimeType === undefined) { mimeType = json.mimeType; filename = json.filename; }
      const chunkBytes = new Uint8Array(base64ToArrayBuffer(json.dataBase64));
      parts.push(chunkBytes);
      // An un-redeployed old proxy ignores offset/length and always returns
      // the WHOLE file with no `totalSize` field — treat that single
      // response as already complete instead of looping forever.
      const oldStyleWholeFile = json.totalSize == null;
      offset += chunkBytes.length;
      totalSize = oldStyleWholeFile ? offset : json.totalSize;
      if (typeof onProgress === 'function') { try { onProgress({ loaded: offset, total: totalSize }); } catch (e) {} }
      if (oldStyleWholeFile || chunkBytes.length === 0 || offset >= totalSize) break;
    }
    if (typeof onProgress === 'function') { try { onProgress({ phase: 'decode' }); } catch (e) {} }
    const combined = parts.length === 1 ? parts[0] : concatUint8Arrays(parts, offset);
    return {
      bytes: combined.buffer,
      base64: _bytesToBase64(combined),
      mimeType,
      filename,
    };
  },

  // For pdf-lib (buildFinalPdf in Review_Approval_Dashboard.html), which
  // needs raw bytes, not something a browser can merely display.
  async fetchAsBytes(url, onProgress) {
    return (await this.fetchMeta(url, onProgress)).bytes;
  },

  // For <img src>, "buka di tab baru", and download links — a drive-proxy
  // URL is a JSON API endpoint, not a directly displayable resource (see
  // fetchMeta's comment), so anything that shows a photo/PDF to a human
  // must convert it to a blob: URL first via this. Caller is responsible
  // for URL.revokeObjectURL() once done with it, if it's short-lived.
  async toObjectUrl(url, onProgress) {
    const { bytes, mimeType } = await this.fetchMeta(url, onProgress);
    return URL.createObjectURL(new Blob([bytes], { type: mimeType || 'application/octet-stream' }));
  },

  // For restoring an evidence photo back into a check sheet's own PHOTOS-like
  // state (see load-merge-modal.js's restorePhotosFromUrls hook) — those
  // structures store a photo as a 'data:...;base64,...' string (PhotoKit's
  // own `src`/`dataUrl` convention, and what pdf.addImage()/PhotoKit.draw()
  // expect), not a blob: URL. Reuses fetchMeta's already-decoded base64
  // string directly — no redundant decode+re-encode round trip.
  async toDataUrl(url, onProgress) {
    // Short-lived in-memory cache. load-merge-modal.js pre-fetches every photo
    // (with a progress bar) before calling the host page's
    // restorePhotosFromUrls(), which then calls toDataUrl() again for the same
    // URLs — the cache makes that second pass instant, and also means a
    // double-clicked "Muat Data" button re-downloads nothing. Capped so a big
    // restore can't grow it without bound; callers may Storage.clearDataUrlCache()
    // when done.
    if (!this._dataUrlCache) this._dataUrlCache = new Map();
    const hit = this._dataUrlCache.get(url);
    if (hit) { if (typeof onProgress === 'function') { try { onProgress({ loaded: 1, total: 1 }); } catch (e) {} } return hit; }
    const { base64, mimeType } = await this.fetchMeta(url, onProgress);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${base64}`;
    if (this._dataUrlCache.size >= 60) this._dataUrlCache.delete(this._dataUrlCache.keys().next().value);
    this._dataUrlCache.set(url, dataUrl);
    return dataUrl;
  },
  clearDataUrlCache() { if (this._dataUrlCache) this._dataUrlCache.clear(); },

  // Best-effort delete — used only for local/dev cleanup of test uploads.
  // Never called from a check sheet's normal submit/review flow.
  async deleteByUrl(url) {
    try {
      const id = new URL(url).searchParams.get('id');
      if (!id) return;
      await fetch(DRIVE_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'delete', id, token: DRIVE_PROXY_TOKEN }),
      });
    } catch (e) { /* already gone, ignore */ }
  },
};

// Joins chunked Uint8Arrays (from fetchMeta's byte-range loop) into one
// contiguous buffer. totalLen is passed in rather than re-summed — the
// caller already tracked it as chunks arrived.
function concatUint8Arrays(parts, totalLen) {
  const out = new Uint8Array(totalLen);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

// bytes -> base64, chunked through String.fromCharCode so a multi-MB
// combined buffer (a reassembled large PDF) doesn't blow the argument-count
// limit that String.fromCharCode.apply(null, hugeArray) hits directly.
function _bytesToBase64(bytes) {
  let binary = '';
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + STEP));
  }
  return btoa(binary);
}

function splitPath(path) {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? { subfolder: '', filename: path } : { subfolder: path.slice(0, idx), filename: path.slice(idx + 1) };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Content-Type text/plain (not application/json) is deliberate — it keeps
// this a CORS "simple request" with no preflight OPTIONS, which Apps
// Script Web Apps don't handle by default. drive-proxy.gs's doPost parses
// the body as JSON regardless of the declared content type.
// Wrapped in withStorageRetry(): a transient network blip, a cold-start
// timeout, or a momentary Apps Script quota error no longer means the whole
// upload has to be redone by hand — it's retried automatically, with
// backoff, before ever surfacing an error to the user.
async function uploadToDrive(filename, mimeType, dataBase64, subfolder, onProgress) {
  if (DRIVE_PROXY_URL.includes('PASTE_YOUR')) {
    const err = new Error('DRIVE_PROXY_URL belum diisi di storage-helper.js — deploy dulu google-apps-script/drive-proxy.gs.');
    err.noRetry = true;
    throw err;
  }
  return withStorageRetry(async (attempt) => {
    let resp;
    try {
      resp = await _storageFetchTimeout(DRIVE_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ filename, mimeType, dataBase64, subfolder, token: DRIVE_PROXY_TOKEN }),
      }, storageTimeoutFor(attempt));
    } catch (e) {
      throw new Error(e && e.name === 'AbortError' ? 'Upload ke Drive timeout.' : 'Upload ke Drive gagal (jaringan).');
    }
    if (!resp.ok) throw new Error('Upload ke Drive gagal (HTTP ' + resp.status + ').');
    let json;
    try { json = await resp.json(); } catch (e) { throw new Error('Respon upload tidak valid dari Drive proxy.'); }
    if (json.error) throw new Error(json.error);
    if (!json.url) throw new Error('Drive proxy tidak mengembalikan URL file.');
    return json.url;
  }, {
    onRetry: (attempt, max, err) => {
      if (typeof onProgress === 'function') { try { onProgress({ phase: 'retry', attempt, max, error: err && err.message }); } catch (e) {} }
    },
  });
}
