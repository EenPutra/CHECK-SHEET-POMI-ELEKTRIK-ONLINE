/* ============================================================================
   photo-kit.js — Shared photo pipeline for every POMI check sheet
   ----------------------------------------------------------------------------
   Why this exists: each check sheet used to roll its own <input type=file>
   handler and then drew the photo into the PDF with a HARD-CODED width/height
   box (e.g. `pdf.addImage(src,'JPEG',x,y,cw,50)`). Any photo whose real aspect
   ratio differed from that box came out stretched/squashed, so text inside the
   photo (nameplates, meter readings, IR scans) became unreadable.

   PhotoKit replaces that with ONE pipeline used by every sheet:
     upload -> EXIF-normalise + downscale -> crop modal (Default / Preset /
     1:1 / Manual, plus 90 deg rotate) -> entry {src,w,h,widthCm,heightCm}
     -> PhotoKit.draw() into the PDF.

   The anti-stretch invariant lives in PhotoKit.fit(): the drawn width/height
   ALWAYS keeps the source pixel aspect ratio. The chosen cm size is only ever
   an upper bound (a box the photo is fitted + centered into), never a stretch
   target. It is therefore impossible for a caller to distort a photo, even by
   passing a box of the wrong shape.

   LAYERING: PhotoKit sits ON TOP of img-helper.js (window.IMG) and delegates
   the low-level work to it — IMG.read() for EXIF-upright downscaled intake,
   IMG.fit() for the letterbox maths, IMG.place() for the actual addImage(),
   IMG.measure() for photos restored from a draft/Firestore record. PhotoKit
   only adds what IMG deliberately has no opinion about: the crop UI, 90 deg
   rotation, and the per-photo print size in cm. Load BOTH, IMG first:
     <script src="img-helper.js"></script>
     <script src="photo-kit.js"></script>
   Local fallbacks exist for every IMG call, so a sheet that somehow loads
   photo-kit.js alone still works (just without IMG's getImageProperties
   ratio recovery for legacy photos).

   Usage in a check sheet:
     <script src="photo-kit.js"></script>
     PhotoKit.configure({maxWcm:17.4, maxHcm:24});         // from that PDF's margins
     PhotoKit.upload(anchorEl, {}, entry => { ...store entry... });
     PhotoKit.recrop(entry, updated => { ...replace entry... });
     await PhotoKit.prepare(listOfEntriesOrDataUrls);      // before generatePDF
     PhotoKit.draw(pdf, entry, x, y, boxW, boxH);          // mm, never stretches
   ========================================================================== */
(function (global) {
'use strict';

var CFG = {
  DEFAULT_W_CM: 7.2,
  DEFAULT_H_CM: 5.18,
  MAX_W_CM: 17.4,          // horizontal print cap (recomputed per sheet via configure)
  MAX_H_CM: 24,            // vertical print cap
  PRESET_LONG_CM: 7,
  MAX_PX: 1600,            // longest stored pixel side (keeps dataURLs small)
  QUALITY: 0.9
};

var PRESETS = [
  {label: '3:2', w: 3, h: 2}, {label: '4:3', w: 4, h: 3},
  {label: '5:4', w: 5, h: 4}, {label: '16:9', w: 16, h: 9},
  {label: 'A4', w: 210, h: 297}, {label: 'Letter', w: 216, h: 279}
];

/* modal state */
var S = {
  cb: null, queue: [], src: '', mode: 'default', ratioLocked: false,
  wcm: CFG.DEFAULT_W_CM, hcm: CFG.DEFAULT_H_CM, orientation: 'landscape',
  activePreset: -1, lastRatioPreset: -1, presetRatio: 1, caption: '', meta: null
};

var DIMS = {};   // dataUrl -> {w,h} cache, so fit() can stay synchronous
var built = false;

/* ── helpers ─────────────────────────────────────────────────────────────── */
function $(id) { return document.getElementById(id); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function clampCm(v, maxV) {
  v = parseFloat(v);
  if (!isFinite(v) || v <= 0) v = 0.5;
  if (v > maxV) v = maxV;
  if (v < 0.5) v = 0.5;
  return Math.round(v * 10) / 10;
}
function maxFor(field) { return field === 'w' ? CFG.MAX_W_CM : CFG.MAX_H_CM; }

/* Normalise anything a sheet might hold (bare dataURL string, {src}, {dataUrl})
   into the canonical entry shape. Both `src` and `dataUrl` are always set so
   older per-sheet code reading either key keeps working. */
function toEntry(v) {
  if (!v) return null;
  var e;
  if (typeof v === 'string') e = {src: v, dataUrl: v};
  else {
    e = {};
    for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) e[k] = v[k];
    e.src = v.src || v.dataUrl || v.url || '';
    e.dataUrl = e.src;
  }
  if (!e.src) return null;
  if ((!e.w || !e.h) && DIMS[e.src]) { e.w = DIMS[e.src].w; e.h = DIMS[e.src].h; }
  return e;
}

function measure(src) {
  return new Promise(function (res) {
    if (DIMS[src]) { res(DIMS[src]); return; }
    if (global.IMG && typeof global.IMG.measure === 'function') {
      global.IMG.measure(src, function (d) {
        if (d && d.w && d.h) DIMS[src] = {w: d.w, h: d.h};
        res(DIMS[src] || null);
      });
      return;
    }
    var im = new Image();
    im.onload = function () {
      DIMS[src] = {w: im.naturalWidth || im.width, h: im.naturalHeight || im.height};
      res(DIMS[src]);
    };
    im.onerror = function () { res(null); };
    im.src = src;
  });
}

/* Fill in missing pixel dimensions on a list of entries (or bare dataURLs).
   Call this once inside generatePDF() before drawing photos restored from a
   draft / Firestore record, which have no w/h of their own. */
function prepare(list) {
  var arr = Array.isArray(list) ? list : [list];
  return Promise.all(arr.map(function (v) {
    var e = toEntry(v);
    if (!e) return null;
    if (e.w && e.h) return e;
    return measure(e.src).then(function (d) {
      if (d) { e.w = d.w; e.h = d.h; }
      return e;
    });
  }));
}

/* ── file intake ─────────────────────────────────────────────────────────── */
/* Delegates to IMG.read() (img-helper.js): EXIF-upright, downscaled to
   IMG.MAX_EDGE, re-encoded JPEG, plus the true pixel size. The local fallback
   below is only reached when img-helper.js was not loaded. */
function fileToDataUrl(file, cb) {
  if (global.IMG && typeof global.IMG.read === 'function') {
    global.IMG.read(file, function (res) {
      if (!res || !res.dataUrl) { cb(null); return; }
      DIMS[res.dataUrl] = {w: res.w, h: res.h};
      cb(res.dataUrl);
    });
    return;
  }
  fallbackRead(file, cb);
}

function fallbackRead(file, cb) {
  var looksImg = file && (/^image\//i.test(file.type || '') ||
    /\.(jpe?g|png|gif|webp|bmp|heic|heif)$/i.test(file.name || ''));
  if (!looksImg) { alert('File harus berupa gambar (JPG/PNG).'); cb(null); return; }
  var reader = new FileReader();
  reader.onload = function (ev) {
    var raw = ev.target.result;
    var img = new Image();
    img.onload = function () {
      try {
        var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
        var sc = Math.min(1, CFG.MAX_PX / Math.max(W, H));
        var c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(W * sc));
        c.height = Math.max(1, Math.round(H * sc));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var out = c.toDataURL('image/jpeg', CFG.QUALITY);
        DIMS[out] = {w: c.width, h: c.height};
        cb(out);
      } catch (e) { cb(raw); }
    };
    img.onerror = function () {
      var ext = (file.name || '').split('.').pop().toLowerCase();
      if (ext === 'heic' || ext === 'heif')
        alert('Format HEIC belum didukung browser ini. Di iPhone: Settings > Camera > Formats > Most Compatible, atau kirim ulang sebagai JPG.');
      else alert('Format gambar tidak bisa diproses. Gunakan JPG atau PNG.');
      cb(null);
    };
    img.src = raw;
  };
  reader.onerror = function () { alert('Gagal membaca file.'); cb(null); };
  reader.readAsDataURL(file);
}

/* ── DOM (built once, on first use) ───────────────────────────────────────── */
var CSS = '' +
'#pkSrcMenu{display:none;position:fixed;z-index:100000;background:#fff;border:1px solid #cfdcd4;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);padding:5px;min-width:150px}' +
'#pkSrcMenu button{display:flex;align-items:center;gap:8px;width:100%;border:none;background:transparent;padding:9px 11px;font-size:13px;color:#2c3e30;cursor:pointer;border-radius:6px;text-align:left;font-family:inherit}' +
'#pkSrcMenu button:hover{background:#eaf3ed}' +
'#pkCrop{display:none;position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,.85);align-items:center;justify-content:center;padding:10px}' +
'#pkCrop.show{display:flex}' +
'.pk-dialog{background:#1a221e;border:1px solid #2a3a30;border-radius:10px;width:min(96vw,560px);max-height:96vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.5);font-family:system-ui,-apple-system,Segoe UI,sans-serif}' +
'.pk-head{background:#243228;padding:9px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px}' +
'.pk-title{font-weight:700;font-size:13px;color:#e0f0e8;letter-spacing:.5px}' +
'.pk-hint{font-size:10px;color:#8aab96}' +
'#pkWrap{position:relative;width:100%;height:min(58vw,320px);background:#111;overflow:hidden;user-select:none;-webkit-user-select:none;touch-action:none}' +
'#pkImg{position:absolute;max-width:none;pointer-events:none;display:block}' +
'#pkBox{position:absolute;border:2px solid #2ecc71;box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move;touch-action:none;min-width:36px;min-height:36px}' +
'.pk-h{position:absolute;width:12px;height:12px;background:#2ecc71;border-radius:2px}' +
'.pk-h.nw{top:-6px;left:-6px;cursor:nw-resize}.pk-h.ne{top:-6px;right:-6px;cursor:ne-resize}' +
'.pk-h.sw{bottom:-6px;left:-6px;cursor:sw-resize}.pk-h.se{bottom:-6px;right:-6px;cursor:se-resize}' +
'.pk-h.n{width:10px;height:10px;top:-5px;left:50%;transform:translateX(-50%);cursor:n-resize}' +
'.pk-h.s{width:10px;height:10px;bottom:-5px;left:50%;transform:translateX(-50%);cursor:s-resize}' +
'.pk-h.w{width:10px;height:10px;left:-5px;top:50%;transform:translateY(-50%);cursor:w-resize}' +
'.pk-h.e{width:10px;height:10px;right:-5px;top:50%;transform:translateY(-50%);cursor:e-resize}' +
'.pk-grid{position:absolute;inset:0;pointer-events:none;background:' +
 'repeating-linear-gradient(0deg,transparent,transparent 33.3%,rgba(255,255,255,.08) 33.3%,rgba(255,255,255,.08) 33.4%,transparent 33.4%,transparent 66.6%,rgba(255,255,255,.08) 66.6%,rgba(255,255,255,.08) 66.7%,transparent 66.7%),' +
 'repeating-linear-gradient(90deg,transparent,transparent 33.3%,rgba(255,255,255,.08) 33.3%,rgba(255,255,255,.08) 33.4%,transparent 33.4%,transparent 66.6%,rgba(255,255,255,.08) 66.6%,rgba(255,255,255,.08) 66.7%,transparent 66.7%)}' +
'.pk-rot{position:absolute;top:8px;right:8px;display:flex;gap:6px;z-index:6}' +
'.pk-rot button{width:34px;height:34px;border-radius:50%;border:none;background:rgba(0,0,0,.6);color:#fff;font-size:17px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.35)}' +
'.pk-rot button:active{background:rgba(0,0,0,.85)}' +
'.pk-foot{padding:10px 13px;background:#1a221e;border-top:1px solid #2a3a30}' +
'.pk-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
'.pk-btn{padding:5px 10px;border-radius:6px;border:1px solid #3a4f42;background:#222e26;color:#aac8b5;font-size:11px;font-weight:600;cursor:pointer;font-family:inherit}' +
'.pk-btn.active{background:#2ecc71;color:#0e150f;border-color:#2ecc71}' +
'.pk-mode{padding:6px 12px;font-size:12px}' +
'.pk-cm{display:flex;flex-direction:column;gap:2px}' +
'.pk-cm label{font-size:9px;color:#8aab96;font-weight:600}' +
'.pk-cm input{width:70px;padding:5px 6px;font-size:12px;border-radius:5px;border:1px solid #3a4f42;background:#0f1512;color:#e0f0e8;font-family:inherit}' +
'.pk-lbl{font-size:11px;color:#7fd9a4;font-weight:600;margin-left:4px}' +
'.pk-deflbl{font-size:12px;color:#7fd9a4;font-weight:600;padding:4px 2px}' +
'.pk-acts{display:flex;gap:8px;justify-content:flex-end;margin-top:9px;flex-wrap:wrap}' +
'.pk-act{padding:7px 15px;border:none;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit}' +
'.pk-out{background:transparent;border:1px solid #4a6a55;color:#aac8b5}' +
'.pk-save{background:#2ecc71;color:#fff}' +
'.pk-q{font-size:10px;color:#8aab96;margin-left:auto}';

var HTML = '' +
'<div class="pk-dialog">' +
  '<div class="pk-head"><div class="pk-title">&#9986; Crop &amp; Print Size</div>' +
    '<div class="pk-hint">Drag middle to move &bull; drag edge/corner to resize</div></div>' +
  '<div id="pkWrap">' +
    '<img id="pkImg" src="" alt="">' +
    '<div class="pk-rot">' +
      '<button type="button" title="Rotate 90&deg; left" data-rot="-1">&#8634;</button>' +
      '<button type="button" title="Rotate 90&deg; right" data-rot="1">&#8635;</button>' +
    '</div>' +
    '<div id="pkBox">' +
      '<div class="pk-h nw"></div><div class="pk-h ne"></div><div class="pk-h sw"></div><div class="pk-h se"></div>' +
      '<div class="pk-h n"></div><div class="pk-h s"></div><div class="pk-h w"></div><div class="pk-h e"></div>' +
      '<div class="pk-grid"></div>' +
    '</div>' +
  '</div>' +
  '<div class="pk-foot">' +
    '<div class="pk-row">' +
      '<button type="button" class="pk-btn pk-mode" id="pkModeDefault">&#11088; Default</button>' +
      '<button type="button" class="pk-btn pk-mode" id="pkModePreset">&#9638; Preset</button>' +
      '<button type="button" class="pk-btn pk-mode" id="pkModeManual">&#9995; Manual</button>' +
      '<span class="pk-q" id="pkQueue"></span>' +
    '</div>' +
    '<div class="pk-deflbl" id="pkDefLbl">Print size: 7.2 &times; 5.18 cm max &mdash; full photo, nothing cut off</div>' +
    '<div id="pkPresetBox" style="display:none">' +
      '<div class="pk-row" style="margin-top:8px" id="pkPresetRow"></div>' +
      '<div class="pk-row" style="margin-top:8px">' +
        '<button type="button" class="pk-btn" id="pkOriP">&#8942; Portrait</button>' +
        '<button type="button" class="pk-btn" id="pkOriL">&#8943; Landscape</button>' +
        '<button type="button" class="pk-btn" id="pkSquare" title="1:1 has no orientation">&#9723; 1:1</button>' +
      '</div>' +
    '</div>' +
    '<div class="pk-row" id="pkCmRow" style="margin-top:8px;display:none">' +
      '<div class="pk-cm"><label>Width (cm)</label><input type="number" id="pkWcm" min="0.5" step="0.1" value="7"></div>' +
      '<div class="pk-cm"><label>Height (cm)</label><input type="number" id="pkHcm" min="0.5" step="0.1" value="5"></div>' +
      '<div class="pk-lbl" id="pkSizeLbl"></div>' +
    '</div>' +
    '<div class="pk-acts">' +
      '<button type="button" class="pk-act pk-out" id="pkSkip">&#9197; Use full photo</button>' +
      '<button type="button" class="pk-act pk-out" id="pkReset">&#8634; Reset</button>' +
      '<button type="button" class="pk-act pk-out" id="pkCancel">Cancel</button>' +
      '<button type="button" class="pk-act pk-save" id="pkOk">&#10003; Save</button>' +
    '</div>' +
  '</div>' +
'</div>';

function build() {
  if (built) return;
  built = true;
  var st = document.createElement('style');
  st.id = 'pk-style'; st.textContent = CSS;
  document.head.appendChild(st);

  var menu = document.createElement('div');
  menu.id = 'pkSrcMenu';
  menu.innerHTML = '<button type="button" data-src="camera">&#128247; Camera</button>' +
                   '<button type="button" data-src="storage">&#128444; Gallery</button>';
  document.body.appendChild(menu);

  var modal = document.createElement('div');
  modal.id = 'pkCrop'; modal.innerHTML = HTML;
  document.body.appendChild(modal);

  renderPresets();
  $('pkModeDefault').onclick = function () { setMode('default'); };
  $('pkModePreset').onclick  = function () { setMode('preset'); };
  $('pkModeManual').onclick  = function () { setMode('manual'); };
  $('pkOriP').onclick = function () { setOrientation('portrait'); };
  $('pkOriL').onclick = function () { setOrientation('landscape'); };
  $('pkSquare').onclick = applySquare;
  $('pkWcm').oninput = function () { onCmInput('w'); };
  $('pkHcm').oninput = function () { onCmInput('h'); };
  $('pkWcm').onblur  = function () { onCmCommit('w'); };
  $('pkHcm').onblur  = function () { onCmCommit('h'); };
  $('pkReset').onclick = function () { setMode(S.mode); };
  $('pkCancel').onclick = function () { closeCrop(true); };
  $('pkSkip').onclick = saveFull;
  $('pkOk').onclick = saveCrop;
  modal.querySelectorAll('.pk-rot button').forEach(function (b) {
    b.onclick = function () { rotate(parseInt(b.getAttribute('data-rot'), 10)); };
  });
  $('pkImg').addEventListener('load', onImgLoad);
  initDrag();
  document.addEventListener('click', function (e) {
    if (!menu.contains(e.target)) menu.style.display = 'none';
  }, true);
}

/* ── source menu + file input ─────────────────────────────────────────────── */
var pendingPick = null;

function upload(anchor, opts, cb) {
  build();
  opts = opts || {};
  pendingPick = {opts: opts, cb: cb};
  var menu = $('pkSrcMenu');
  menu.querySelectorAll('button').forEach(function (b) {
    b.onclick = function (ev) {
      ev.stopPropagation();
      menu.style.display = 'none';
      openInput(b.getAttribute('data-src'));
    };
  });
  menu.style.display = 'block';
  var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect()
        : {left: window.innerWidth / 2, right: 0, top: window.innerHeight / 2, bottom: window.innerHeight / 2};
  var mw = menu.offsetWidth || 150, mh = menu.offsetHeight || 90;
  var left = clamp(r.left, 8, Math.max(8, window.innerWidth - mw - 8));
  var top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
}

function openInput(source) {
  var opts = pendingPick ? pendingPick.opts : {};
  var inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = 'image/*';
  if (opts.multiple) inp.multiple = true;
  if (source === 'camera') inp.setAttribute('capture', 'environment');
  inp.style.display = 'none';
  document.body.appendChild(inp);
  inp.onchange = function () {
    var files = Array.prototype.slice.call(inp.files || []);
    document.body.removeChild(inp);
    if (!files.length) return;
    var pick = pendingPick;
    var queue = files.slice();
    (function next() {
      if (!queue.length) return;
      var f = queue.shift();
      fileToDataUrl(f, function (url) {
        if (!url) { next(); return; }
        openCrop(url, null, pick.opts, function (entry) {
          if (entry && pick.cb) pick.cb(entry);
          next();
        }, queue.length);
      });
    })();
  };
  inp.click();
}

/* ── crop modal ───────────────────────────────────────────────────────────── */
function openCrop(dataUrl, prev, opts, cb, remaining) {
  build();
  opts = opts || {};
  S.cb = cb; S.src = dataUrl; S.meta = opts;
  S.wcm = (prev && (prev.reqWcm || prev.widthCm)) || opts.defaultWcm || CFG.DEFAULT_W_CM;
  S.hcm = (prev && (prev.reqHcm || prev.heightCm)) || opts.defaultHcm || CFG.DEFAULT_H_CM;
  S.mode = (prev && prev.cropMode) || 'default';
  S.orientation = (prev && prev.orientation) || 'landscape';
  S.activePreset = (prev && prev.presetIdx !== undefined) ? prev.presetIdx : -1;
  S.lastRatioPreset = -1;
  S.caption = (prev && prev.caption) || '';
  $('pkQueue').textContent = remaining ? (remaining + ' more photo(s) queued') : '';
  $('pkCrop').classList.add('show');
  $('pkImg').src = dataUrl;
  if ($('pkImg').complete) onImgLoad();
}

function onImgLoad() {
  var img = $('pkImg'), wrap = $('pkWrap');
  if (!img.naturalWidth) return;
  var ww = wrap.clientWidth, wh = wrap.clientHeight;
  var sc = Math.min(ww / img.naturalWidth, wh / img.naturalHeight);
  var w = Math.max(1, Math.round(img.naturalWidth * sc));
  var h = Math.max(1, Math.round(img.naturalHeight * sc));
  img.style.width = w + 'px'; img.style.height = h + 'px';
  img.style.left = Math.round((ww - w) / 2) + 'px';
  img.style.top = Math.round((wh - h) / 2) + 'px';
  setMode(S.mode);
}

function imgRect() {
  var img = $('pkImg');
  return {l: parseInt(img.style.left) || 0, t: parseInt(img.style.top) || 0,
          w: img.offsetWidth, h: img.offsetHeight};
}

function fitBoxFull() {
  var r = imgRect(), box = $('pkBox');
  if (!r.w || !r.h) return;
  box.style.left = r.l + 'px'; box.style.top = r.t + 'px';
  box.style.width = r.w + 'px'; box.style.height = r.h + 'px';
}

/* Reshape the crop box to the current cm ratio, starting from the full image
   (never from the previous, possibly stale, box) and re-centered on the old
   box centre so the user's framing is roughly kept. */
function reshapeToRatio() {
  var r = imgRect(), box = $('pkBox');
  if (!r.w || !r.h || !S.wcm || !S.hcm) return;
  var oldL = parseFloat(box.style.left), oldT = parseFloat(box.style.top);
  var cx = isFinite(oldL) ? oldL + box.offsetWidth / 2 : r.l + r.w / 2;
  var cy = isFinite(oldT) ? oldT + box.offsetHeight / 2 : r.t + r.h / 2;
  var ratio = S.wcm / S.hcm;
  var w = r.w, h = w / ratio;
  if (h > r.h) { h = r.h; w = h * ratio; }
  box.style.width = w + 'px'; box.style.height = h + 'px';
  box.style.left = clamp(cx - w / 2, r.l, r.l + r.w - w) + 'px';
  box.style.top = clamp(cy - h / 2, r.t, r.t + r.h - h) + 'px';
}

function renderPresets() {
  var row = $('pkPresetRow');
  row.innerHTML = '';
  PRESETS.forEach(function (p, i) {
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'pk-btn'; b.id = 'pkPreset-' + i; b.textContent = p.label;
    b.onclick = function () { applyPreset(i); };
    row.appendChild(b);
  });
}

function highlight(idx) {
  PRESETS.forEach(function (p, i) {
    var b = $('pkPreset-' + i);
    if (b) b.classList.toggle('active', i === idx);
  });
  $('pkSquare').classList.toggle('active', idx === 'square');
}

function setMode(mode) {
  S.mode = mode;
  ['Default', 'Preset', 'Manual'].forEach(function (m) {
    $('pkMode' + m).classList.toggle('active', mode === m.toLowerCase());
  });
  fitBoxFull();
  if (mode === 'default') {
    $('pkPresetBox').style.display = 'none';
    $('pkCmRow').style.display = 'none';
    $('pkDefLbl').style.display = 'block';
    highlight(-1);
    S.ratioLocked = false;
    S.wcm = (S.meta && S.meta.defaultWcm) || CFG.DEFAULT_W_CM;
    S.hcm = (S.meta && S.meta.defaultHcm) || CFG.DEFAULT_H_CM;
    updateLabel();
  } else if (mode === 'preset') {
    $('pkPresetBox').style.display = 'block';
    $('pkCmRow').style.display = 'flex';
    $('pkDefLbl').style.display = 'none';
    if (S.activePreset === 'square') applySquare();
    else applyPreset((S.activePreset === -1 || S.activePreset == null) ? 1 : S.activePreset);
  } else {
    $('pkPresetBox').style.display = 'none';
    $('pkCmRow').style.display = 'flex';
    $('pkDefLbl').style.display = 'none';
    highlight(-1);
    setLocked(S.wcm || 7, S.hcm || 5);
  }
}

function applyPreset(i) {
  var p = PRESETS[i];
  var ratio = Math.max(p.w, p.h) / Math.min(p.w, p.h);
  S.activePreset = i; S.lastRatioPreset = i;
  var lng = CFG.PRESET_LONG_CM, shrt = Math.round((lng / ratio) * 10) / 10;
  var w, h;
  if (S.orientation === 'landscape') { w = lng; h = shrt; } else { h = lng; w = shrt; }
  S.presetRatio = w / h;
  setLocked(w, h);
  highlight(i);
}

function applySquare() {
  S.activePreset = 'square';
  S.presetRatio = 1;
  fitBoxFull();
  var side = Math.min(CFG.PRESET_LONG_CM, CFG.MAX_W_CM, CFG.MAX_H_CM);
  setLocked(side, side);
  highlight('square');
  $('pkOriP').classList.remove('active');
  $('pkOriL').classList.remove('active');
}

function setOrientation(o) {
  S.orientation = o;
  $('pkOriP').classList.toggle('active', o === 'portrait');
  $('pkOriL').classList.toggle('active', o === 'landscape');
  fitBoxFull();
  if (S.activePreset === 'square') {
    // 1:1 has no orientation — drop it and go back to the full image so the
    // user picks a ratio next, instead of silently shrinking the box.
    S.activePreset = -1; S.ratioLocked = false;
    highlight(-1);
    $('pkSizeLbl').textContent = 'Pick a ratio below';
    return;
  }
  var lng = Math.max(S.wcm, S.hcm), shrt = Math.min(S.wcm, S.hcm);
  var w, h;
  if (o === 'landscape') { w = lng; h = shrt; } else { h = lng; w = shrt; }
  S.presetRatio = w / h;
  setLocked(w, h);
}

function setLocked(w, h, skipSync) {
  w = clampCm(w, maxFor('w')); h = clampCm(h, maxFor('h'));
  S.ratioLocked = true; S.wcm = w; S.hcm = h;
  if (!skipSync) { $('pkWcm').value = w; $('pkHcm').value = h; }
  updateLabel();
  reshapeToRatio();
}

/* oninput: only preview, never rewrite what the user is typing (so the field
   can be cleared). onblur commits + clamps. */
function onCmInput(field) {
  var wv = parseFloat($('pkWcm').value), hv = parseFloat($('pkHcm').value);
  if (S.mode === 'preset') {
    var ratio = S.presetRatio || 1, w, h;
    if (field === 'w') { if (!isFinite(wv) || wv <= 0) return; w = wv; h = w / ratio; }
    else { if (!isFinite(hv) || hv <= 0) return; h = hv; w = h * ratio; }
    var sc = Math.min(1, maxFor('w') / w, maxFor('h') / h);
    w *= sc; h *= sc;
    w = Math.round(w * 10) / 10; h = Math.round(h * 10) / 10;
    $((field === 'w') ? 'pkHcm' : 'pkWcm').value = (field === 'w') ? h : w;
    S.ratioLocked = true; S.wcm = w; S.hcm = h;
    updateLabel(); reshapeToRatio();
    return;
  }
  if (!isFinite(wv) || wv <= 0 || !isFinite(hv) || hv <= 0) return;
  S.ratioLocked = true;
  S.wcm = Math.min(wv, maxFor('w'));
  S.hcm = Math.min(hv, maxFor('h'));
  updateLabel(); reshapeToRatio();
}

function onCmCommit(field) {
  var el = $(field === 'w' ? 'pkWcm' : 'pkHcm');
  var v = clampCm(el.value, maxFor(field));
  el.value = v;
  if (field === 'w') S.wcm = v; else S.hcm = v;
  if (S.mode === 'preset') onCmInput(field);
  else setLocked(S.wcm, S.hcm);
}

function updateLabel() {
  var lbl = $('pkSizeLbl');
  if (lbl) lbl.textContent = 'Print: ' + S.wcm + ' x ' + S.hcm + ' cm' +
    (S.mode === 'preset' ? ' (ratio locked)' : '');
  var d = $('pkDefLbl');
  if (d) d.textContent = 'Print size: ' + CFG.DEFAULT_W_CM + ' x ' + CFG.DEFAULT_H_CM +
    ' cm max - full photo, nothing cut off';
}

function rotate(dir) {
  var img = $('pkImg');
  if (!img || !img.naturalWidth) return;
  var c = document.createElement('canvas');
  c.width = img.naturalHeight; c.height = img.naturalWidth;
  var ctx = c.getContext('2d');
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(dir * 90 * Math.PI / 180);
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
  var url = c.toDataURL('image/jpeg', 0.95);
  DIMS[url] = {w: c.width, h: c.height};
  S.src = url;
  img.src = url;   // retriggers onImgLoad -> refits image + crop box
}

/* drag / resize */
function initDrag() {
  var box = $('pkBox');
  box.addEventListener('mousedown', start, false);
  box.addEventListener('touchstart', start, {passive: false});
  function start(e) {
    e.preventDefault(); e.stopPropagation();
    var t = e.touches ? e.touches[0] : e;
    var sX = t.clientX, sY = t.clientY;
    var sL = parseFloat(box.style.left) || 0, sT = parseFloat(box.style.top) || 0;
    var sW = box.offsetWidth, sH = box.offsetHeight;
    var rect = box.getBoundingClientRect();
    var rx = t.clientX - rect.left, ry = t.clientY - rect.top, edge = 22;
    var eX = rx < edge ? 'l' : rx > sW - edge ? 'r' : '';
    var eY = ry < edge ? 't' : ry > sH - edge ? 'b' : '';
    var mode = (eX || eY) ? eX + eY : 'move';
    function move(ev) {
      ev.preventDefault();
      var m = ev.touches ? ev.touches[0] : ev;
      var dx = m.clientX - sX, dy = m.clientY - sY;
      var r = imgRect();
      if (mode === 'move') {
        box.style.left = clamp(sL + dx, r.l, r.l + r.w - sW) + 'px';
        box.style.top = clamp(sT + dy, r.t, r.t + r.h - sH) + 'px';
        return;
      }
      var left = mode.indexOf('l') >= 0, right = mode.indexOf('r') >= 0;
      var top = mode.indexOf('t') >= 0, bottom = mode.indexOf('b') >= 0;
      var corner = mode.length === 2;
      var aX = left ? (sL + sW) : sL, aY = top ? (sT + sH) : sT;
      var dxS = right ? dx : left ? -dx : 0;
      var dyS = bottom ? dy : top ? -dy : 0;
      var nW, nH, nl, nt;
      if (S.ratioLocked && S.wcm && S.hcm) {
        var ratio = S.wcm / S.hcm;
        if (corner) {
          if (Math.abs(dxS) >= Math.abs(dyS)) { nW = sW + dxS; nH = nW / ratio; }
          else { nH = sH + dyS; nW = nH * ratio; }
        } else if (left || right) { nW = sW + dxS; nH = nW / ratio; }
        else { nH = sH + dyS; nW = nH * ratio; }
        if (nW < 36) { nW = 36; nH = nW / ratio; }
        if (nH < 36) { nH = 36; nW = nH * ratio; }
        var mW = left ? (aX - r.l) : (r.l + r.w - aX);
        var mH = top ? (aY - r.t) : (r.t + r.h - aY);
        var sc = Math.min(1, mW > 0 ? mW / nW : 1, mH > 0 ? mH / nH : 1);
        nW *= sc; nH *= sc;
        if (corner || left || right) nl = left ? (aX - nW) : aX;
        else nl = sL + (sW - nW) / 2;
        if (corner || top || bottom) nt = top ? (aY - nH) : aY;
        else nt = sT + (sH - nH) / 2;
      } else {
        nW = sW + dxS; nH = sH + dyS;
        if (!left && !right) nW = sW;
        if (!top && !bottom) nH = sH;
        nW = Math.max(36, nW); nH = Math.max(36, nH);
        nl = left ? clamp(aX - nW, r.l, aX - 36) : sL;
        nt = top ? clamp(aY - nH, r.t, aY - 36) : sT;
        if (left) nW = aX - nl;
        if (top) nH = aY - nt;
        nW = Math.min(nW, r.l + r.w - nl);
        nH = Math.min(nH, r.t + r.h - nt);
      }
      box.style.left = nl + 'px'; box.style.top = nt + 'px';
      box.style.width = nW + 'px'; box.style.height = nH + 'px';
    }
    function up() {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('mouseup', up);
      document.removeEventListener('touchend', up);
    }
    document.addEventListener('mousemove', move);
    document.addEventListener('touchmove', move, {passive: false});
    document.addEventListener('mouseup', up);
    document.addEventListener('touchend', up);
  }
}

function closeCrop(cancelled) {
  $('pkCrop').classList.remove('show');
  var cb = S.cb; S.cb = null;
  if (cancelled && cb) cb(null);
}

function buildEntry(canvas) {
  var url = canvas.toDataURL('image/jpeg', CFG.QUALITY);
  DIMS[url] = {w: canvas.width, h: canvas.height};
  /* Snap the stored print size to the photo's REAL aspect ratio, shrinking the
     side that would otherwise be letterboxed. Rounding the cm fields to one
     decimal (and rounding the crop rect to whole pixels) leaves the chosen cm
     box a hair off the true ratio, so without this the PDF would draw e.g.
     68.8mm inside a box labelled 70mm. Both sides stay <= what the user asked
     for, and the label now equals exactly what gets printed. */
  var asp = canvas.width / canvas.height;
  var w = S.wcm, h = S.hcm;
  if (w / h > asp) w = h * asp; else h = w / asp;
  return {
    src: url, dataUrl: url, w: canvas.width, h: canvas.height,
    widthCm: Math.round(w * 100) / 100, heightCm: Math.round(h * 100) / 100,
    reqWcm: S.wcm, reqHcm: S.hcm,           // what the user picked, for re-crop
    cropMode: S.mode, orientation: S.orientation, presetIdx: S.activePreset,
    caption: S.caption || ''
  };
}

function saveCrop() {
  var img = $('pkImg'), box = $('pkBox');
  var r = imgRect();
  var scale = img.naturalWidth / (r.w || 1);
  var bx = (parseFloat(box.style.left) || 0) - r.l;
  var by = (parseFloat(box.style.top) || 0) - r.t;
  var bw = box.offsetWidth, bh = box.offsetHeight;
  var sx = clamp(Math.round(bx * scale), 0, img.naturalWidth - 1);
  var sy = clamp(Math.round(by * scale), 0, img.naturalHeight - 1);
  var sw = clamp(Math.round(bw * scale), 1, img.naturalWidth - sx);
  var sh = clamp(Math.round(bh * scale), 1, img.naturalHeight - sy);
  var out = Math.min(1, CFG.MAX_PX / Math.max(sw, sh));
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * out));
  c.height = Math.max(1, Math.round(sh * out));
  c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  var entry = buildEntry(c);
  var cb = S.cb; S.cb = null;
  $('pkCrop').classList.remove('show');
  if (cb) cb(entry);
}

function saveFull() {
  var img = $('pkImg');
  var c = document.createElement('canvas');
  var out = Math.min(1, CFG.MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  c.width = Math.max(1, Math.round(img.naturalWidth * out));
  c.height = Math.max(1, Math.round(img.naturalHeight * out));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  S.wcm = (S.meta && S.meta.defaultWcm) || CFG.DEFAULT_W_CM;
  S.hcm = (S.meta && S.meta.defaultHcm) || CFG.DEFAULT_H_CM;
  S.mode = 'default';
  var entry = buildEntry(c);
  var cb = S.cb; S.cb = null;
  $('pkCrop').classList.remove('show');
  if (cb) cb(entry);
}

/* Take a File the caller already has (its own <input>, a drag-and-drop, a
   camera capture) straight into the crop modal. Same result shape as upload(). */
function fromFile(file, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  build();
  fileToDataUrl(file, function (url) {
    if (!url) { if (cb) cb(null); return; }
    openCrop(url, null, opts || {}, cb, 0);
  });
}

function recrop(entry, cb, opts) {
  var e = toEntry(entry);
  if (!e) return;
  build();
  openCrop(e.src, e, opts || {}, function (updated) {
    if (updated && cb) { updated.caption = e.caption || updated.caption || ''; cb(updated); }
  }, 0);
}

/* ── PDF placement (the anti-stretch core) ────────────────────────────────── */
/* Returns the mm size to draw `entry` at: the requested cm size capped by the
   available box, with the SOURCE aspect ratio always preserved. */
function fit(entry, maxWmm, maxHmm) {
  var e = toEntry(entry) || {};
  var boxW = Math.min((e.widthCm || CFG.DEFAULT_W_CM) * 10, maxWmm || Infinity);
  var boxH = Math.min((e.heightCm || CFG.DEFAULT_H_CM) * 10, maxHmm || Infinity);
  var nat = (e.w && e.h) ? {w: e.w, h: e.h} : null;
  var f = (global.IMG && global.IMG.fit) ? global.IMG.fit(boxW, boxH, nat)
                                         : localFit(boxW, boxH, nat);
  /* dx centres the photo in the CALLER's box (the PDF column), not in the
     smaller cm box -- callers that draw at `x + f.dx` expect column centring,
     and centring inside the cm box would leave every photo hugging the left
     edge of its column. dy stays 0 because those same callers top-align. */
  var outerW = isFinite(maxWmm) ? maxWmm : f.w;
  return {w: f.w, h: f.h, dx: Math.max(0, (outerW - f.w) / 2), dy: 0,
          boxW: boxW, boxH: boxH};
}

function localFit(boxW, boxH, nat) {
  var ratio = (nat && nat.w > 0 && nat.h > 0) ? nat.w / nat.h : 4 / 3;
  var w = boxW, h = w / ratio;
  if (h > boxH) { h = boxH; w = h * ratio; }
  return {w: w, h: h, dx: (boxW - w) / 2, dy: (boxH - h) / 2};
}

/* Draw `entry` inside the box (x,y,boxW,boxH) without ever stretching it.
   opts: {align:'center'|'left'|'right', valign:'top'|'middle'|'bottom',
          offsetX:mm, compression:'FAST'|'MEDIUM'|'SLOW'}
   The photo is drawn at its chosen cm size (capped to the box) with its own
   aspect ratio; IMG.place() does the final letterboxing, which also recovers
   the ratio via jsPDF getImageProperties() for legacy photos that carry no
   stored pixel size. Returns the painted rect {x,y,w,h}. */
function draw(pdf, entry, x, y, boxW, boxH, opts) {
  var e = toEntry(entry);
  if (!e || !e.src) return null;
  opts = opts || {};
  var d = fit(e, boxW, boxH);
  var align = opts.align || 'center', valign = opts.valign || 'top';
  var dx = align === 'left' ? x : align === 'right' ? (x + boxW - d.w) : (x + (boxW - d.w) / 2);
  var dy = valign === 'middle' ? (y + (boxH - d.h) / 2) : valign === 'bottom' ? (y + boxH - d.h) : y;
  if (opts.offsetX) dx += opts.offsetX;
  var nat = (e.w && e.h) ? {w: e.w, h: e.h} : null;
  var fmt = /^data:image\/png/i.test(e.src) ? 'PNG' : 'JPEG';
  if (global.IMG && typeof global.IMG.place === 'function')
    return global.IMG.place(pdf, e.src, dx, dy, d.w, d.h, nat, fmt);
  try {
    pdf.addImage(e.src, fmt, dx, dy, d.w, d.h, undefined, opts.compression || 'MEDIUM');
  } catch (err) { return null; }
  return {x: dx, y: dy, w: d.w, h: d.h};
}

function configure(o) {
  o = o || {};
  ['DEFAULT_W_CM', 'DEFAULT_H_CM', 'MAX_PX', 'QUALITY', 'PRESET_LONG_CM'].forEach(function (k) {
    if (o[k] !== undefined) CFG[k] = o[k];
  });
  if (o.maxWcm) CFG.MAX_W_CM = o.maxWcm;
  if (o.maxHcm) CFG.MAX_H_CM = o.maxHcm;
  if (o.defaultWcm) CFG.DEFAULT_W_CM = o.defaultWcm;
  if (o.defaultHcm) CFG.DEFAULT_H_CM = o.defaultHcm;
  if (built) {
    $('pkWcm').max = CFG.MAX_W_CM;
    $('pkHcm').max = CFG.MAX_H_CM;
  }
}

/* Compute the cm caps from a sheet's own PDF margins (mm), per the reference
   doc: width cap leaves a 6mm buffer, height cap a 7mm buffer. */
function limitsFromMargins(marginX, marginTop, marginBottom, pageW, pageH) {
  pageW = pageW || 210; pageH = pageH || 297;
  return {
    maxWcm: Math.round(((pageW - marginX * 2 - 6) / 10) * 10) / 10,
    maxHcm: Math.round(((pageH - marginTop - marginBottom - 7) / 10) * 10) / 10
  };
}

global.PhotoKit = {
  configure: configure,
  limitsFromMargins: limitsFromMargins,
  upload: upload,
  fromFile: fromFile,
  recrop: recrop,
  prepare: prepare,
  measure: measure,
  toEntry: toEntry,
  fit: fit,
  draw: draw,
  fileToDataUrl: fileToDataUrl,
  get config() { return CFG; }
};

})(window);
