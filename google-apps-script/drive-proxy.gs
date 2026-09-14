// ============================================================
//  Drive Proxy — Google Apps Script Web App
//
//  What this is: a free upload/download bridge to Google Drive for the
//  Review & Approval workflow (PLTS_AshDisposal_PM.html + storage-helper.js
//  + Review_Approval_Dashboard.html). Browsers can't call the Drive API
//  directly without per-user OAuth, and this project has no backend server
//  — this script fills that gap, running under ONE Google account (whoever
//  deploys it), reachable by every technician/reviewer's browser as a
//  plain POST/GET Web App.
//
//  DEPLOYMENT (one-time, done in the Google account that should own the
//  Drive folder — do this in script.google.com, NOT in this repo):
//   1. Create a folder in Google Drive for check-sheet uploads (e.g.
//      "POMI Check Sheet Files"). Open it, copy its id from the URL
//      (drive.google.com/drive/folders/<THIS PART>).
//   1b. LEVEL 1 SECURITY (2026-09): keep this folder PRIVATE ("Restricted").
//      doGet() below reads each file as the script owner ("Execute as:
//      Me"), so the app displays photos/PDFs fine without any public
//      sharing. Sharing the folder "Anyone with the link" makes every
//      uploaded evidence photo and report world-readable by URL — if an
//      earlier setup did that, right-click the folder -> Share -> General
//      access -> "Restricted". (The old workaround note about
//      DriveApp.setSharing() being blocked only mattered for a direct-
//      link download path this code does not use.) See SECURITY.md.
//   2. Go to https://script.google.com -> New project.
//   3. Delete the default Code.gs content, paste this ENTIRE file in.
//   4. Replace ROOT_FOLDER_ID below with the folder id from step 1.
//   5. Deploy -> New deployment -> type "Web app".
//        Execute as: Me
//        Who has access: Anyone
//   6. Authorize when prompted (this script only touches the one Drive
//      folder tree it creates/reads under ROOT_FOLDER_ID).
//   7. Copy the Web App URL (ends in /exec) — paste it into
//      DRIVE_PROXY_URL at the top of storage-helper.js in this repo.
//   8. Every time you edit this script after the first deploy, you must
//      do Deploy -> Manage deployments -> edit (pencil) -> New version,
//      or the live Web App keeps running the OLD code.
//
//   *** ACTION REQUIRED (2026-09-14): this file's doGet() gained chunked
//   *** byte-range reads to fix large final/manual-upload PDFs failing to
//   *** download. This does NOTHING on its own — you must paste this
//   *** UPDATED file into script.google.com and do step 8 (New version)
//   *** for the fix to take effect on the live site. Until you do, large
//   *** files keep failing to download exactly as before.
// ============================================================

const ROOT_FOLDER_ID = 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE';

// Shared secret with storage-helper.js's DRIVE_PROXY_TOKEN in the repo.
// '' = disabled (accept every request — the original behaviour). To turn
// it on: put the SAME random string here and in storage-helper.js, then
// Deploy -> Manage deployments -> New version. See SECURITY.md step 4.
const SHARED_SECRET = '';

function checkAuth(e, body) {
  if (!SHARED_SECRET) return true;
  var t = (e && e.parameter && e.parameter.token) || (body && body.token) || '';
  return t === SHARED_SECRET;
}

function doGet(e) {
  if (!checkAuth(e)) return jsonOutput({ error: 'unauthorized' });
  const fileId = e.parameter.id;
  if (!fileId) return jsonOutput({ error: 'Parameter id diperlukan' });
  try {
    const file = DriveApp.getFileById(fileId);
    // Always JSON+base64, never a raw binary passthrough. An earlier
    // version tried `return file.getBlob();` directly from doGet expecting
    // Apps Script to serve it as a real image/PDF response (a pattern
    // several online examples show) — confirmed by hand that it does NOT
    // work: the actual response Google sends back is a generic ~5KB HTML
    // page, not the file's bytes, so <img src> and fetch() both silently
    // fail. JSON+base64 is the one path confirmed to actually carry the
    // real bytes through — the client (storage-helper.js) decodes this
    // into a blob: URL for display instead of using this endpoint as a
    // direct resource URL.
    //
    // CHUNKED READS (2026-09): a Web App's own ContentService response has
    // a real, fairly low ceiling — a large file (a multi-page scanned PDF
    // from a manual upload, which unlike every other file in this app has
    // no size cap/compression applied before upload) returned it in ONE
    // giant base64 JSON body reliably failed every single time, not just
    // occasionally, which is the signature of a hard server-side limit
    // rather than a flaky network — retrying or waiting longer on the
    // CLIENT side can never fix a response the SERVER can't produce in one
    // piece. storage-helper.js now always requests a bounded byte range via
    // &offset=N&length=N and reassembles the chunks client-side, so no
    // single response is ever large enough to hit that ceiling regardless
    // of the file's total size. offset/length are optional — omitted (or
    // an un-redeployed older client), this still returns the WHOLE file in
    // one response, unchanged from before.
    const hasRange = e.parameter.offset != null || e.parameter.length != null;
    const offset = hasRange ? Math.max(0, parseInt(e.parameter.offset, 10) || 0) : 0;

    // TRUE partial reads (2026-09, follow-up): the FIRST version of chunking
    // above was correct but very slow for a large file — file.getBlob()
    // downloads and holds the ENTIRE file in memory, so every single chunk
    // request paid the cost of re-reading the WHOLE file again just to slice
    // out a couple MB of it (confirmed by a real user report: chunking made
    // a large download reliable but painfully slow, and — because the cost
    // scales with file size on EVERY chunk, not just once — large enough
    // files could still exhaust the retry budget). file.getSize() is Drive
    // metadata only (no download); fetchDriveRange() below does a true HTTP
    // Range request against Drive's own download endpoint, so each chunk
    // costs only its OWN size, not the whole file's. Falls back to the
    // original whole-blob-then-slice approach (still correct, just slower)
    // if the range fetch fails for any reason — never a hard failure just
    // because the faster path didn't work this time.
    let total = null;
    try { total = file.getSize(); } catch (szErr) { total = null; }
    const length = hasRange && e.parameter.length != null ? parseInt(e.parameter.length, 10) : total;

    let slice = null;
    let mimeType = null;
    if (hasRange && total != null) {
      const end = Math.min(total, offset + Math.max(0, length || 0)) - 1;
      if (end >= offset) {
        try {
          slice = fetchDriveRange(fileId, offset, end);
        } catch (rangeErr) {
          slice = null; // fall through to the full-blob path below
        }
      } else {
        slice = []; // requested a zero/negative-length range — empty chunk, not an error
      }
    }

    if (slice === null) {
      // Fallback: whole-file read (works even for a range request — just
      // slower), and the ONLY path when no range was requested at all.
      const blob = file.getBlob();
      mimeType = blob.getContentType();
      const bytes = blob.getBytes();
      if (total == null) total = bytes.length;
      if (hasRange) {
        const end = Math.min(total, offset + Math.max(0, length || 0));
        slice = (offset === 0 && end === total) ? bytes : bytes.slice(offset, Math.max(offset, end));
      } else {
        slice = bytes;
      }
    }
    if (!mimeType) mimeType = file.getMimeType();

    return jsonOutput({
      dataBase64: Utilities.base64Encode(slice),
      mimeType: mimeType,
      filename: file.getName(),
      totalSize: total,
      offset: offset,
      chunkSize: slice.length,
    });
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

// True HTTP byte-range read against Drive's own download endpoint — avoids
// ever loading the whole file into Apps Script's memory just to return a
// small slice of it. Google Drive's `alt=media` download supports the
// standard Range header (206 Partial Content); ScriptApp.getOAuthToken()
// already carries Drive read access because DriveApp is used elsewhere in
// this file, so no extra authorization/scope is needed. Throws on any
// unexpected response so the caller can fall back to the slower-but-always-
// correct whole-blob read rather than silently returning wrong bytes.
function fetchDriveRange(fileId, start, end) {
  const url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true';
  const resp = UrlFetchApp.fetch(url, {
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
      Range: 'bytes=' + start + '-' + end,
    },
    muteHttpExceptions: true,
  });
  const code = resp.getResponseCode();
  if (code !== 206 && code !== 200) throw new Error('range fetch http ' + code);
  const content = resp.getContent();
  const wantLen = end - start + 1;
  // A server that ignores Range (some proxies/edge cases do, returning the
  // whole file with code 200 instead of a 206 partial) must be detected and
  // sliced manually here — otherwise every "chunk" would silently contain
  // the entire file, defeating the whole point and likely re-triggering the
  // original giant-response failure one level down.
  if (content.length === wantLen) return content;
  if (content.length > wantLen) return content.slice(start, end + 1);
  throw new Error('range fetch returned ' + content.length + ' bytes, expected ' + wantLen);
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    if (!checkAuth(e, body)) return jsonOutput({ error: 'unauthorized' });

    if (body.action === 'delete') {
      DriveApp.getFileById(body.id).setTrashed(true);
      return jsonOutput({ ok: true });
    }

    const { filename, mimeType, dataBase64, subfolder } = body;
    if (!filename || !dataBase64) {
      return jsonOutput({ error: 'filename dan dataBase64 diperlukan' });
    }
    const folder = getOrCreateFolder(subfolder);
    const bytes = Utilities.base64Decode(dataBase64);
    const blob = Utilities.newBlob(bytes, mimeType || 'application/octet-stream', filename);
    const file = folder.createFile(blob);
    // Deliberately NOT calling file.setSharing() here — Google blocks
    // *programmatic* "Anyone with the link" sharing for unverified Apps
    // Script projects with "Access denied: DriveApp." even when the full
    // Drive OAuth scope has been granted (confirmed by hand: getFolderById,
    // createFile all succeed, setSharing alone throws, on the SAME file,
    // even right after a from-scratch re-authorization). The workaround:
    // share ROOT_FOLDER_ID itself "Anyone with the link" ONCE, manually,
    // in the normal Drive UI (not via API) — every file created inside it
    // inherits that same link-access permission automatically, since
    // Drive permissions are folder-hierarchy-inherited regardless of how
    // a file was created. See this file's header step 1b.

    const webAppUrl = ScriptApp.getService().getUrl();
    return jsonOutput({ id: file.getId(), url: webAppUrl + '?id=' + file.getId() });
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

// subfolderPath like 'checksheets/abc123/photos' -> nested folders created
// on demand under ROOT_FOLDER_ID, reused on subsequent calls.
function getOrCreateFolder(subfolderPath) {
  let folder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  if (!subfolderPath) return folder;
  // LOCKED (2026-09): several evidence photos for the SAME submission now
  // upload CONCURRENTLY (approval-helper.js parallelizes the photo-upload
  // loop up to 4 at a time) — all racing to resolve/create the exact same
  // subfolder path (e.g. checksheets/<id>/photos) at once. Without a lock,
  // each concurrent execution independently checks getFoldersByName()
  // before any of them has finished creating it, so several see "doesn't
  // exist" and each calls createFolder() — Drive allows multiple folders
  // with the identical name under one parent (no uniqueness error), so
  // this silently created several near-duplicate "photos" folders instead
  // of throwing, scattering one submission's photos across them. This is
  // very likely the real cause behind "koneksi bermasalah saat upload"
  // reports right after concurrent uploads shipped — a lock-starved Drive
  // operation under this race can surface to the client as a slow/failed
  // request that then retries, not just a silently wrong folder.
  // getScriptLock() serializes just this folder-resolution step (fast — a
  // few hundred ms at most) across every concurrent execution of this
  // script, so only the FIRST request racing for a given path actually
  // creates it; the rest wait briefly, then find it already there.
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    subfolderPath.split('/').filter(Boolean).forEach(name => {
      const existing = folder.getFoldersByName(name);
      folder = existing.hasNext() ? existing.next() : folder.createFolder(name);
    });
  } finally {
    lock.releaseLock();
  }
  return folder;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
