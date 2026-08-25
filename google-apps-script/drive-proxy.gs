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
//   1b. Right-click that SAME folder -> Share -> General access ->
//      "Anyone with the link" -> Viewer. Do this once, by hand, in the
//      normal Drive UI — NOT via DriveApp.setSharing() in code, which
//      Google blocks for unverified Apps Script projects even with full
//      Drive scope granted. Every file this script creates inside the
//      folder inherits this same link-access automatically.
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
// ============================================================

const ROOT_FOLDER_ID = 'PASTE_YOUR_DRIVE_FOLDER_ID_HERE';

function doGet(e) {
  const fileId = e.parameter.id;
  if (!fileId) return jsonOutput({ error: 'Parameter id diperlukan' });
  try {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
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
    return jsonOutput({
      dataBase64: Utilities.base64Encode(blob.getBytes()),
      mimeType: blob.getContentType(),
      filename: file.getName(),
    });
  } catch (err) {
    return jsonOutput({ error: err.message });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

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
  subfolderPath.split('/').filter(Boolean).forEach(name => {
    const existing = folder.getFoldersByName(name);
    folder = existing.hasNext() ? existing.next() : folder.createFolder(name);
  });
  return folder;
}

function jsonOutput(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
