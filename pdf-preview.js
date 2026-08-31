// ============================================================
//  PDF Preview — one shared "look at the whole PDF before it goes anywhere"
//  modal, reused across every check sheet the same self-injecting way as
//  submit-guard.js / load-merge-modal.js.
//
//  Renders EVERY page of the PDF (pdf.js -> stacked <canvas>) inside a
//  scrollable panel, so it works identically on desktop and mobile — an
//  <iframe src="blob:...pdf"> only ever showed page 1 (and rendered nothing
//  at all on most phones). If pdf.js can't load (offline), it falls back to
//  the iframe.
//
//  Two entry points:
//    1. Download path — auto-installed. Monkey-patches jsPDF's pdf.save() so
//       every "Download PDF" button opens the preview first; the real file
//       download only happens on "Unduh PDF".
//    2. Submit path — SubmitGuard.resolveSubmitTarget(wo, pdfBuilder) calls
//       PdfPreview.confirm(pdf) before DB.save(). Promise<boolean>:
//       true = "Lanjut Submit", false = "Perbaiki Dulu".
//
//  A page with its OWN preview modal sets window.__pdfPreviewOwn = true
//  before this script loads to keep the save hook out of the way.
// ============================================================

(function () {
  if (window.PdfPreview) return;

  const PDFJS_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
  const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  let _domReady = false;
  let _blobUrl = null;
  let _resolve = null;
  let _mode = 'download';       // 'download' | 'confirm'
  let _pendingSave = null;      // {pdf, name} for the download path
  let _bypass = false;          // set while OUR own "Unduh" button calls the real save
  let _pdfjsPromise = null;
  let _renderToken = 0;         // cancels a stale render if the modal is reopened fast
  let _lastPdf = null;          // for re-render on resize / orientation change
  let _resizeT = null;

  function injectDom() {
    if (_domReady) return;
    _domReady = true;
    const style = document.createElement('style');
    style.textContent = `
#pdfprev-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.92);z-index:24000;
  align-items:center;justify-content:center;padding:14px;font-family:'Barlow',system-ui,sans-serif}
#pdfprev-overlay.show{display:flex}
.pdfprev-box{background:#fff;border-radius:14px;width:min(960px,100%);height:min(94vh,100%);
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.5);color:#0f172a}
.pdfprev-hdr{background:linear-gradient(90deg,#1e3a5f,#0f2744);padding:11px 16px;display:flex;
  align-items:center;justify-content:space-between;gap:10px;flex-shrink:0}
.pdfprev-title{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:14px;color:#7dd3fc;letter-spacing:1.5px}
.pdfprev-sub{font-size:10px;color:#9dc4e8;margin-top:1px;max-width:60vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pdfprev-x{background:none;border:none;color:#9dc4e8;font-size:19px;cursor:pointer;line-height:1;padding:2px 8px;border-radius:5px}
.pdfprev-x:hover{background:rgba(255,255,255,.15)}
.pdfprev-pages{flex:1;min-height:0;min-width:0;overflow-y:auto;overflow-x:hidden;background:#475569;padding:14px 10px;
  display:flex;flex-direction:column;gap:12px;align-items:center;-webkit-overflow-scrolling:touch}
.pdfprev-pages canvas{width:100%;max-width:100%;height:auto;display:block;
  box-shadow:0 6px 20px rgba(0,0,0,.35);background:#fff;border-radius:2px}
.pdfprev-pages iframe{width:100%;height:100%;border:none;background:#fff;border-radius:2px}
.pdfprev-loading{color:#e2e8f0;font-size:13px;padding:40px 10px;text-align:center}
.pdfprev-note{font-size:11.5px;color:#7c2d12;background:#fff7ed;border-top:1px solid #fed7aa;padding:7px 16px;flex-shrink:0;line-height:1.4}
.pdfprev-ftr{padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:8px;
  border-top:1px solid #dbeafe;background:#f0f7ff;flex-shrink:0;flex-wrap:wrap}
.pdfprev-ftr .left{font-size:11px;color:#64748b}
.pdfprev-ftr .left a{color:#2563eb;text-decoration:none;font-weight:600}
.pdfprev-btns{display:flex;gap:8px;flex-wrap:wrap;margin-left:auto}
.pdfprev-btn{padding:9px 16px;border-radius:8px;border:1.5px solid #bfdbfe;background:#fff;color:#1e3a5f;
  font-weight:700;font-size:12.5px;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
.pdfprev-btn:hover{border-color:#2563eb;color:#2563eb}
.pdfprev-btn-pri{background:#2563eb;border-color:#2563eb;color:#fff}
.pdfprev-btn-pri:hover{background:#1d4ed8;color:#fff}
@media (max-width:640px){
  #pdfprev-overlay{padding:0}
  .pdfprev-box{width:100%;height:100%;border-radius:0}
  .pdfprev-sub{max-width:44vw}
  .pdfprev-pages{padding:8px 4px;gap:8px}
  .pdfprev-btn{flex:1;justify-content:center;padding:11px 8px;font-size:13px}
  .pdfprev-ftr .left{width:100%;text-align:center;order:3}
  .pdfprev-btns{width:100%}
}
    `;
    document.head.appendChild(style);

    const ov = document.createElement('div');
    ov.id = 'pdfprev-overlay';
    ov.innerHTML = `
      <div class="pdfprev-box">
        <div class="pdfprev-hdr">
          <div style="min-width:0">
            <div class="pdfprev-title">PREVIEW PDF</div>
            <div class="pdfprev-sub" id="pdfprev-sub">Periksa hasil sebelum lanjut</div>
          </div>
          <button class="pdfprev-x" onclick="PdfPreview._close('close')">&#10005;</button>
        </div>
        <div class="pdfprev-pages" id="pdfprev-pages"><div class="pdfprev-loading">Memuat preview…</div></div>
        <div class="pdfprev-note" id="pdfprev-note" style="display:none"></div>
        <div class="pdfprev-ftr">
          <span class="left" id="pdfprev-left"></span>
          <div class="pdfprev-btns" id="pdfprev-ftr-btns"></div>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }

  function _renderFooter() {
    const b = document.getElementById('pdfprev-ftr-btns');
    if (_mode === 'confirm') {
      b.innerHTML =
        `<button class="pdfprev-btn" onclick="PdfPreview._close('secondary')">&#9999;&#65039; Perbaiki Dulu</button>` +
        `<button class="pdfprev-btn pdfprev-btn-pri" onclick="PdfPreview._close('primary')">&#128228; Lanjut Submit</button>`;
    } else {
      b.innerHTML =
        `<button class="pdfprev-btn" onclick="PdfPreview._close('secondary')">&#9999;&#65039; Tutup &amp; Perbaiki</button>` +
        `<button class="pdfprev-btn pdfprev-btn-pri" onclick="PdfPreview._close('primary')">&#11015;&#65039; Unduh PDF</button>`;
    }
  }

  function _ensurePdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (_pdfjsPromise) return _pdfjsPromise;
    _pdfjsPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PDFJS_SRC;
      s.onload = () => {
        try { if (window.pdfjsLib) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; } catch (e) {}
        window.pdfjsLib ? res(window.pdfjsLib) : rej(new Error('pdfjsLib missing'));
      };
      s.onerror = () => rej(new Error('pdf.js gagal dimuat'));
      document.head.appendChild(s);
    });
    return _pdfjsPromise;
  }

  async function _renderAllPages(pdf) {
    _lastPdf = pdf;
    const token = ++_renderToken;
    const wrap = document.getElementById('pdfprev-pages');
    wrap.innerHTML = '<div class="pdfprev-loading">Merender halaman…</div>';
    let bytes;
    try { bytes = pdf.output('arraybuffer'); } catch (e) { bytes = null; }
    let lib;
    try { lib = await _ensurePdfJs(); } catch (e) { lib = null; }

    if (!lib || !bytes) {
      // fallback: native viewer in an iframe (desktop only, but better than nothing)
      wrap.innerHTML = '';
      const f = document.createElement('iframe');
      f.title = 'PDF preview';
      f.src = _blobUrl || 'about:blank';
      wrap.appendChild(f);
      return;
    }
    try {
      const doc = await lib.getDocument({ data: bytes.slice(0) }).promise;
      if (token !== _renderToken) return;
      wrap.innerHTML = '';
      document.getElementById('pdfprev-left').innerHTML =
        doc.numPages + ' halaman &middot; <a href="' + (_blobUrl || '#') + '" target="_blank" rel="noopener">buka di tab baru</a>';
      // Rasterize crisply regardless of screen size: aim for ~2x the panel's
      // CSS width, capped, so it stays sharp on retina/desktop AND scales down
      // cleanly on a phone (canvas is width:100% + max-width:native in CSS).
      const availW = Math.max(280, (wrap.clientWidth || window.innerWidth || 800) - 24);
      const renderW = Math.min(1400, Math.max(700, Math.round(availW * 2)));
      for (let n = 1; n <= doc.numPages; n++) {
        if (token !== _renderToken) return;
        const page = await doc.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: renderW / base.width });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        // CSS (width:100%;max-width:100%) does the fitting — the bitmap is ~2x
        // the panel width so it downscales sharply and never overflows.
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        if (token !== _renderToken) return;
        wrap.appendChild(c);
      }
    } catch (e) {
      console.error('PdfPreview: render gagal', e);
      wrap.innerHTML = '';
      const f = document.createElement('iframe');
      f.src = _blobUrl || 'about:blank'; wrap.appendChild(f);
    }
  }

  function _openWithPdf(pdf, opts) {
    injectDom();
    opts = opts || {};
    try { if (_blobUrl) URL.revokeObjectURL(_blobUrl); } catch (e) {}
    _blobUrl = null;
    try { _blobUrl = pdf.output('bloburl'); } catch (e) {}

    const sub = document.getElementById('pdfprev-sub');
    if (sub) sub.textContent = opts.filename || (_mode === 'confirm' ? 'Preview sebelum submit' : 'Preview sebelum unduh');
    const note = document.getElementById('pdfprev-note');
    if (note) {
      note.textContent = opts.note || (_mode === 'confirm'
        ? 'Jika ada kesalahan, pilih "Perbaiki Dulu" untuk kembali ke form — data BELUM disimpan.'
        : 'Jika ada kesalahan, tutup preview ini dan perbaiki form dulu.');
      note.style.display = '';
    }
    document.getElementById('pdfprev-left').textContent = '';
    _renderFooter();
    document.getElementById('pdfprev-overlay').classList.add('show');
    _renderAllPages(pdf);
  }

  // Re-rasterize on a real width change (phone rotate, desktop resize) so pages
  // stay crisp — debounced, and only while the modal is open.
  window.addEventListener('resize', () => {
    const ov = document.getElementById('pdfprev-overlay');
    if (!ov || !ov.classList.contains('show') || !_lastPdf) return;
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => { if (_lastPdf) _renderAllPages(_lastPdf); }, 300);
  });

  // Trigger a real file download from a built jsPDF object WITHOUT relying on
  // jsPDF's own pdf.save() (which we've monkey-patched) or on having captured
  // its original — pdf.output('blob') + a synthetic <a download> click is
  // exactly what jsPDF.save() does internally, and it can't recurse into our
  // hook. Falls back to the captured original, then to a last-resort save().
  function _forceDownload(pdf, name) {
    name = name || 'document.pdf';
    try {
      const blob = pdf.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name; a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} try { a.remove(); } catch (e) {} }, 6000);
      return true;
    } catch (e) {
      console.error('PdfPreview: unduh via blob gagal', e);
      try {
        if (typeof PdfPreview._realSave === 'function') {
          _bypass = true;
          try { PdfPreview._realSave.call(pdf, name); } finally { _bypass = false; }
          return true;
        }
      } catch (e2) { console.error('PdfPreview: fallback save gagal', e2); }
      return false;
    }
  }

  function _close(which) {
    _renderToken++; // cancel any in-flight render
    _lastPdf = null; clearTimeout(_resizeT);
    document.getElementById('pdfprev-overlay').classList.remove('show');
    const wrap = document.getElementById('pdfprev-pages');
    if (wrap) wrap.innerHTML = '<div class="pdfprev-loading">Memuat preview…</div>';

    if (_mode === 'download') {
      const ps = _pendingSave; _pendingSave = null;
      if (which === 'primary' && ps) _forceDownload(ps.pdf, ps.name);
    }
    try { if (_blobUrl) URL.revokeObjectURL(_blobUrl); } catch (e) {}
    _blobUrl = null;
    if (_resolve) { const r = _resolve; _resolve = null; r(which); }
  }

  // ── Download path: monkey-patch jsPDF's save ──
  function installSaveHook() {
    if (window.__pdfPreviewOwn) return false;
    const jspdf = window.jspdf && window.jspdf.jsPDF;
    if (!jspdf || !jspdf.API) return false;
    if (PdfPreview._installed) return true;
    // Only capture a genuine original (not a re-hook of our own wrapper, not
    // undefined on a jsPDF build that puts save elsewhere) — but hook anyway so
    // pdf.save() always previews; _forceDownload() no longer needs _realSave.
    if (typeof jspdf.API.save === 'function' && String(jspdf.API.save).indexOf('/*pdfprev*/') === -1) {
      PdfPreview._realSave = jspdf.API.save;
    }
    PdfPreview._installed = true;
    jspdf.API.save = function (name) {
      /*pdfprev*/
      if (_bypass) {
        if (typeof PdfPreview._realSave === 'function') return PdfPreview._realSave.call(this, name);
        return _forceDownload(this, name);
      }
      const self = this;
      _mode = 'download';
      _pendingSave = { pdf: self, name: name || 'document.pdf' };
      _resolve = null;
      _openWithPdf(self, { filename: name || 'document.pdf' });
      return self;
    };
    return true;
  }

  // ── Submit path ──
  async function confirm(pdfOrBuilder, opts) {
    injectDom();
    let pdf = pdfOrBuilder;
    if (typeof pdfOrBuilder === 'function') {
      try { pdf = await pdfOrBuilder(); } catch (e) { console.error('PdfPreview: gagal build PDF', e); return true; }
    }
    if (!pdf || typeof pdf.output !== 'function') return true;
    _mode = 'confirm';
    _pendingSave = null;
    _openWithPdf(pdf, opts || {});
    const which = await new Promise(res => { _resolve = res; });
    return which === 'primary';
  }

  window.PdfPreview = {
    installSaveHook, confirm, _close,
    _realSave: null,
    _installed: false,
    download(pdf, name) { return _forceDownload(pdf, name); },
  };

  if (!installSaveHook()) {
    let tries = 0;
    const t = setInterval(() => { if (installSaveHook() || ++tries > 40) clearInterval(t); }, 150);
    window.addEventListener('load', installSaveHook);
  }
})();
