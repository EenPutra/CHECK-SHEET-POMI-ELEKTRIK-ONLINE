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

const Storage = {
  // path: a slash-separated virtual path, e.g.
  // 'checksheets/<id>/photos/inv01-0.jpg' — everything before the last
  // '/' becomes nested Drive folders under the proxy's ROOT_FOLDER_ID,
  // the rest becomes the file name.
  // dataUrl: a 'data:image/jpeg;base64,...' string (PhotoKit entries, or
  // pdf.output('datauristring')). Returns a URL that always routes back
  // through this same Web App (never a raw drive.google.com link) — see
  // drive-proxy.gs's doGet for why (CORS).
  async uploadDataUrl(path, dataUrl, contentType) {
    const { subfolder, filename } = splitPath(path);
    const commaIdx = dataUrl.indexOf(',');
    const dataBase64 = commaIdx === -1 ? dataUrl : dataUrl.slice(commaIdx + 1);
    return uploadToDrive(filename, contentType, dataBase64, subfolder);
  },

  async uploadBlob(path, blob, contentType) {
    const { subfolder, filename } = splitPath(path);
    const dataBase64 = await blobToBase64(blob);
    return uploadToDrive(filename, contentType || blob.type, dataBase64, subfolder);
  },

  // Reads a file this helper uploaded back into {bytes, mimeType, filename}.
  // drive-proxy.gs's doGet ALWAYS returns JSON+base64, never raw binary —
  // confirmed by hand that `return file.getBlob()` from doGet does not
  // actually serve real file bytes (Apps Script sends back a generic HTML
  // page instead), so this JSON decode is the only path that works, for
  // both pdf-lib's byte needs AND for anything meant to be displayed.
  // onProgress (optional): called with {loaded, total} as bytes stream in
  // (total is 0 when the server doesn't send Content-Length — the caller
  // should then show an indeterminate/bytes-only indicator), then once with
  // {phase:'decode'} just before the base64 -> bytes step. When given, the
  // download uses XHR (progress events); without it, a plain fetch().
  async fetchMeta(url, onProgress) {
    let json;
    if (typeof onProgress === 'function') {
      json = await xhrGetJson(url, onProgress);
    } else {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('Gagal mengambil file (HTTP ' + resp.status + ')');
      json = await resp.json();
    }
    if (json.error) throw new Error(json.error);
    if (typeof onProgress === 'function') { try { onProgress({ phase: 'decode' }); } catch (e) {} }
    return {
      bytes: base64ToArrayBuffer(json.dataBase64),
      base64: json.dataBase64,
      mimeType: json.mimeType,
      filename: json.filename,
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
    const { base64, mimeType } = await this.fetchMeta(url, onProgress);
    return `data:${mimeType || 'image/jpeg'};base64,${base64}`;
  },

  // Best-effort delete — used only for local/dev cleanup of test uploads.
  // Never called from a check sheet's normal submit/review flow.
  async deleteByUrl(url) {
    try {
      const id = new URL(url).searchParams.get('id');
      if (!id) return;
      await fetch(DRIVE_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'delete', id }),
      });
    } catch (e) { /* already gone, ignore */ }
  },
};

// XHR GET returning parsed JSON, with download-progress callbacks. Used by
// fetchMeta() when a caller passes onProgress (fetch() has no widely-usable
// progress event). `total` is 0 unless the server sends Content-Length —
// Apps Script often doesn't, so the caller must handle an unknown total.
function xhrGetJson(url, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'text';
    xhr.onprogress = e => {
      try { onProgress({ loaded: e.loaded, total: e.lengthComputable ? e.total : 0 }); } catch (err) {}
    };
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('Gagal mengambil file (HTTP ' + xhr.status + ')'));
      try { resolve(JSON.parse(xhr.responseText || '{}')); }
      catch (err) { reject(new Error('Respon file tidak valid.')); }
    };
    xhr.onerror = () => reject(new Error('Gagal mengunduh file (jaringan).'));
    xhr.ontimeout = () => reject(new Error('Unduhan file timeout.'));
    xhr.send();
  });
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
async function uploadToDrive(filename, mimeType, dataBase64, subfolder) {
  if (DRIVE_PROXY_URL.includes('PASTE_YOUR')) {
    throw new Error('DRIVE_PROXY_URL belum diisi di storage-helper.js — deploy dulu google-apps-script/drive-proxy.gs.');
  }
  const resp = await fetch(DRIVE_PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ filename, mimeType, dataBase64, subfolder }),
  });
  const json = await resp.json();
  if (json.error) throw new Error(json.error);
  return json.url;
}
