// ============================================================
//  PDF Preview — one shared "look at the PDF before it goes anywhere" modal,
//  reused across every check sheet the same self-injecting way as
//  submit-guard.js / load-merge-modal.js.
//
//  Two entry points:
//    1. Download path — auto-installed. Monkey-patches jsPDF's
//       `pdf.save(name)` so every "Download PDF" button first opens a
//       full-screen preview (the built PDF in an <iframe>); the real file
//       download only happens when the technician clicks "Unduh PDF" in that
//       modal. "Tutup & Perbaiki" just closes it so they can fix the form and
//       try again. ZERO per-file code — as long as pdf-preview.js is loaded
//       AFTER the jsPDF CDN script (window.jspdf must already exist).
//    2. Submit path — SubmitGuard.resolveSubmitTarget(wo, pdfBuilder) calls
//       PdfPreview.confirm(pdf) before DB.save(). Returns a Promise<boolean>:
//       true = "Lanjut Submit", false = "Perbaiki Dulu" (caller must abort
//       the submit).
//
//  A page that has its OWN preview modal (4000_Hours_Mill_PM.html,
//  PLTS_AshDisposal_PM.html) sets window.__pdfPreviewOwn = true BEFORE this
//  script loads (or just doesn't load this script) — the save hook then
//  stays out of the way.
// ============================================================

(function () {
  if (window.PdfPreview) return;

  let _domReady = false;
  let _blobUrl = null;
  let _resolve = null;
  let _mode = 'download';       // 'download' | 'confirm'
  let _pendingSave = null;      // {pdf, name} for the download path
  let _bypass = false;          // set while OUR own "Unduh" button calls the real save

  function injectDom() {
    if (_domReady) return;
    _domReady = true;
    const style = document.createElement('style');
    style.textContent = `
#pdfprev-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.9);z-index:24000;
  align-items:center;justify-content:center;padding:14px;font-family:'Barlow',system-ui,sans-serif}
#pdfprev-overlay.show{display:flex}
.pdfprev-box{background:#fff;border-radius:14px;width:min(940px,100%);height:min(92vh,100%);
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.45);color:#0f172a}
.pdfprev-hdr{background:linear-gradient(90deg,#1e3a5f,#0f2744);padding:13px 18px;display:flex;
  align-items:center;justify-content:space-between;gap:10px;flex-shrink:0}
.pdfprev-title{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:15px;color:#7dd3fc;letter-spacing:1.5px}
.pdfprev-sub{font-size:10.5px;color:#9dc4e8;margin-top:1px}
.pdfprev-x{background:none;border:none;color:#9dc4e8;font-size:19px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:5px}
.pdfprev-x:hover{background:rgba(255,255,255,.15)}
.pdfprev-frame-wrap{flex:1;background:#334155;min-height:0}
#pdfprev-frame{width:100%;height:100%;border:none;background:#fff}
.pdfprev-note{font-size:12px;color:#475569;background:#fff7ed;border-top:1px solid #fed7aa;padding:8px 18px;flex-shrink:0}
.pdfprev-ftr{padding:11px 18px;display:flex;align-items:center;justify-content:flex-end;gap:10px;
  border-top:1px solid #dbeafe;background:#f0f7ff;flex-shrink:0;flex-wrap:wrap}
.pdfprev-btn{padding:9px 18px;border-radius:8px;border:1.5px solid #bfdbfe;background:#fff;color:#1e3a5f;
  font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.pdfprev-btn:hover{border-color:#2563eb;color:#2563eb}
.pdfprev-btn-pri{background:#2563eb;border-color:#2563eb;color:#fff}
.pdfprev-btn-pri:hover{background:#1d4ed8;color:#fff}
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'pdfprev-overlay';
    ov.innerHTML = `
      <div class="pdfprev-box">
        <div class="pdfprev-hdr">
          <div>
            <div class="pdfprev-title">PREVIEW PDF</div>
            <div class="pdfprev-sub" id="pdfprev-sub">Periksa hasil sebelum lanjut</div>
          </div>
          <button class="pdfprev-x" onclick="PdfPreview._close('close')">&#10005;</button>
        </div>
        <div class="pdfprev-frame-wrap"><iframe id="pdfprev-frame" title="PDF preview"></iframe></div>
        <div class="pdfprev-note" id="pdfprev-note" style="display:none"></div>
        <div class="pdfprev-ftr" id="pdfprev-ftr"></div>
      </div>`;
    document.body.appendChild(ov);
  }

  function _renderFooter() {
    const ftr = document.getElementById('pdfprev-ftr');
    if (_mode === 'confirm') {
      ftr.innerHTML =
        `<button class="pdfprev-btn" onclick="PdfPreview._close('secondary')">&#9999;&#65039; Perbaiki Dulu</button>` +
        `<button class="pdfprev-btn pdfprev-btn-pri" onclick="PdfPreview._close('primary')">&#128228; Lanjut Submit</button>`;
    } else {
      ftr.innerHTML =
        `<button class="pdfprev-btn" onclick="PdfPreview._close('secondary')">&#9999;&#65039; Tutup &amp; Perbaiki</button>` +
        `<button class="pdfprev-btn pdfprev-btn-pri" onclick="PdfPreview._close('primary')">&#11015;&#65039; Unduh PDF</button>`;
    }
  }

  function _openWithPdf(pdf, opts) {
    injectDom();
    opts = opts || {};
    try { if (_blobUrl) URL.revokeObjectURL(_blobUrl); } catch (e) {}
    _blobUrl = null;
    let src = 'about:blank';
    try { _blobUrl = pdf.output('bloburl'); src = _blobUrl; }
    catch (e) {
      try { src = pdf.output('datauristring'); } catch (e2) {}
    }
    const frame = document.getElementById('pdfprev-frame');
    frame.src = src;
    const sub = document.getElementById('pdfprev-sub');
    if (sub) sub.textContent = opts.filename || (_mode === 'confirm' ? 'Preview sebelum submit' : 'Preview sebelum unduh');
    const note = document.getElementById('pdfprev-note');
    if (note) {
      const txt = opts.note || (_mode === 'confirm'
        ? 'Jika ada kesalahan, pilih "Perbaiki Dulu" untuk kembali ke form — data BELUM disimpan.'
        : 'Jika ada kesalahan, tutup preview ini dan perbaiki form dulu.');
      note.textContent = txt; note.style.display = '';
    }
    _renderFooter();
    document.getElementById('pdfprev-overlay').classList.add('show');
  }

  function _close(which) {
    document.getElementById('pdfprev-overlay').classList.remove('show');
    const frame = document.getElementById('pdfprev-frame');
    try { if (_blobUrl) URL.revokeObjectURL(_blobUrl); } catch (e) {}
    _blobUrl = null;
    if (frame) frame.src = 'about:blank';

    if (_mode === 'download') {
      const ps = _pendingSave; _pendingSave = null;
      if (which === 'primary' && ps) {
        _bypass = true;
        try { PdfPreview._realSave.call(ps.pdf, ps.name); }
        finally { _bypass = false; }
      }
    }
    if (_resolve) { const r = _resolve; _resolve = null; r(which); }
  }

  // ── Download path: monkey-patch jsPDF's save ──
  function installSaveHook() {
    if (window.__pdfPreviewOwn) return false;
    const jspdf = window.jspdf && window.jspdf.jsPDF;
    if (!jspdf || !jspdf.API) return false;
    if (PdfPreview._realSave) return true; // already hooked
    PdfPreview._realSave = jspdf.API.save;
    jspdf.API.save = function (name) {
      if (_bypass) return PdfPreview._realSave.call(this, name);
      const self = this;
      const fname = name || 'document.pdf';
      _mode = 'download';
      _pendingSave = { pdf: self, name: fname };
      _resolve = null;
      _openWithPdf(self, { filename: fname });
      return self; // keep pdf.save() chainable
    };
    return true;
  }

  // ── Submit path: build -> preview -> boolean ──
  // pass an already-built jsPDF object (or a builder function).
  async function confirm(pdfOrBuilder, opts) {
    injectDom();
    let pdf = pdfOrBuilder;
    if (typeof pdfOrBuilder === 'function') {
      try { pdf = await pdfOrBuilder(); } catch (e) { console.error('PdfPreview: gagal build PDF', e); return true; }
    }
    if (!pdf || typeof pdf.output !== 'function') return true; // nothing to preview -> don't block
    _mode = 'confirm';
    _pendingSave = null;
    _openWithPdf(pdf, opts || {});
    const which = await new Promise(res => { _resolve = res; });
    return which === 'primary';
  }

  window.PdfPreview = {
    installSaveHook, confirm, _close,
    _realSave: null,
    // let a page force the real download (e.g. from its own preview modal)
    download(pdf, name) { _bypass = true; try { (PdfPreview._realSave || pdf.save).call(pdf, name); } finally { _bypass = false; } },
  };

  // Auto-install as soon as jsPDF is available.
  if (!installSaveHook()) {
    let tries = 0;
    const t = setInterval(() => { if (installSaveHook() || ++tries > 40) clearInterval(t); }, 150);
    window.addEventListener('load', installSaveHook);
  }
})();
