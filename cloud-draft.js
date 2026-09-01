// ============================================================
//  Cloud Draft — "Simpan ke Database (lanjut nanti)" for every check sheet.
//
//  Same self-injecting pattern as submit-guard.js / load-merge-modal.js.
//  A check sheet's "Save Draft" button now ALSO writes the whole form state
//  (every id'd input + the ST/resultState toggle map + evidence photos +
//  an optional host-specific `extra` blob) to the isolated Firestore
//  collection `checksheet_drafts` — NOT `checksheets`, so nothing about the
//  dashboard / trend charts / dedup / the review workflow is touched. A
//  technician can then pick that draft back up from ANY device to keep
//  working, and only "Submit ke Database" ever creates a real submission +
//  review record.
//
//  Host page wiring (see CLAUDE.md "Cloud Draft"):
//    <script src="db-helper.js"></script>
//    <script src="storage-helper.js"></script>
//    <script src="load-merge-modal.js"></script>
//    <script src="cloud-draft.js"></script>
//    ...
//    <button onclick="CloudDraft.save()">💾 Simpan ke Database</button>
//    <button onclick="CloudDraft.openResume()">📥 Lanjutkan dari Database</button>
//    <script>
//      CloudDraft.init({
//        formId: 'mca',                       // stable unique key per check sheet
//        assetTag: () => gv('asset-tag') || MCA_ASSET_TAG,   // string OR getter
//        assetName: 'Maintenance Corrective Action',
//        frequency: 'CORRECTIVE',
//        photos: () => collectPhotosForUpload(),   // {group:[{src,caption,w,h,widthCm,heightCm}]}|null
//        collectExtra: () => ({ narrativeBlocks: ... }),     // optional
//        applyExtra: (x) => { ... },                          // optional
//        afterRestore: () => { loadDraft(); },                // optional host re-render
//      });
//    </script>
//  Then in submitToDb() on success: CloudDraft.markSubmitted();
// ============================================================

(function () {
  if (window.CloudDraft) return;

  const COLL = 'checksheet_drafts';
  let cfg = null;
  let _busy = false;
  let _domReady = false;
  let _drafts = [];

  // ── config helpers ──
  const tagNow = () => {
    const t = cfg && cfg.assetTag;
    return String((typeof t === 'function' ? t() : t) || '').trim() || 'NO-TAG';
  };
  const idKey = () => 'cd_' + (cfg ? cfg.formId : '?') + '_' + tagNow();
  function currentDraftId(create) {
    let id = null;
    try { id = localStorage.getItem(idKey()); } catch (e) {}
    if (!id && create) {
      id = cfg.formId + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(idKey(), id); } catch (e) {}
    }
    return id;
  }
  function forgetDraftId() { try { localStorage.removeItem(idKey()); } catch (e) {} }
  const sess = () => {
    try { return (window.AuthSession && AuthSession.get && AuthSession.get()) || {}; } catch (e) { return {}; }
  };
  const note = (m, t) => {
    if (typeof window.showNote === 'function') return window.showNote(m, t);
    if (typeof window.note === 'function') return window.note(m, t);
    console.log('[CloudDraft]', m);
  };

  // ── DOM (progress overlay + resume-picker modal) ──
  function injectDom() {
    if (_domReady) return;
    _domReady = true;
    const st = document.createElement('style');
    st.textContent = `
#cd-ov{display:none;position:fixed;inset:0;z-index:23000;background:rgba(15,23,42,.55);
  align-items:center;justify-content:center;padding:16px;font-family:system-ui,'Barlow',sans-serif}
#cd-ov.show{display:flex}
.cd-box{background:#fff;border-radius:14px;max-width:620px;width:100%;max-height:88vh;display:flex;flex-direction:column;
  overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.4);color:#0f172a}
.cd-hd{background:linear-gradient(90deg,#1e3a5f,#0f2744);color:#fff;padding:12px 16px;font-weight:700;font-size:14px;
  display:flex;justify-content:space-between;align-items:center;gap:10px}
.cd-hd button{background:rgba(255,255,255,.16);border:0;color:#fff;width:28px;height:28px;border-radius:6px;cursor:pointer;font-size:15px;line-height:1}
.cd-body{padding:12px 14px;overflow-y:auto}
.cd-hint{font-size:12px;color:#64748b;margin-bottom:10px;line-height:1.5}
.cd-row{border:1.5px solid #dbeafe;border-radius:10px;padding:10px 12px;margin-bottom:8px;display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap}
.cd-row .info{flex:1;min-width:180px;font-size:12.5px;line-height:1.5}
.cd-row .info b{font-size:13.5px}
.cd-row .meta{color:#64748b;font-size:11.5px}
.cd-row .acts{display:flex;gap:6px;flex-wrap:wrap}
.cd-btn{border:1.5px solid #bfdbfe;background:#fff;color:#1e3a5f;border-radius:7px;padding:7px 12px;font-weight:700;font-size:12px;cursor:pointer;font-family:inherit}
.cd-btn:hover{border-color:#2563eb;color:#2563eb}
.cd-btn.pri{background:#2563eb;border-color:#2563eb;color:#fff}
.cd-btn.pri:hover{background:#1d4ed8}
.cd-btn.danger{border-color:#fecaca;background:#fef2f2;color:#b91c1c}
.cd-empty{color:#64748b;font-size:12.5px;text-align:center;padding:22px 10px}
#cd-prog{display:none;position:fixed;inset:0;z-index:23500;background:rgba(15,23,42,.62);align-items:center;justify-content:center;font-family:system-ui,sans-serif}
#cd-prog.show{display:flex}
.cd-prog-box{background:#fff;border-radius:12px;padding:20px 24px;width:min(360px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center}
.cd-prog-lbl{font-size:13px;color:#0f172a;font-weight:600;margin-bottom:10px}
.cd-prog-bar{height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden}
.cd-prog-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2563eb,#1e3a5f);transition:width .2s}
.cd-prog-pct{font-size:11px;color:#64748b;margin-top:6px}
`;
    document.head.appendChild(st);

    const ov = document.createElement('div');
    ov.id = 'cd-ov';
    ov.innerHTML = `
      <div class="cd-box">
        <div class="cd-hd"><span>📥 Lanjutkan Draft dari Database</span><button type="button" onclick="CloudDraft._close()">✕</button></div>
        <div class="cd-body">
          <div class="cd-hint">Draft yang disimpan ke database untuk check sheet ini. Pilih satu untuk melanjutkan — data teks, hasil OK/NG, dan foto akan dipulihkan ke form (menimpa isian sekarang).</div>
          <div id="cd-list"><div class="cd-empty">Memuat…</div></div>
        </div>
      </div>`;
    document.body.appendChild(ov);

    const pr = document.createElement('div');
    pr.id = 'cd-prog';
    pr.innerHTML = `<div class="cd-prog-box"><div class="cd-prog-lbl" id="cd-prog-lbl">Menyimpan…</div>
      <div class="cd-prog-bar"><i id="cd-prog-i"></i></div><div class="cd-prog-pct" id="cd-prog-pct"></div></div>`;
    document.body.appendChild(pr);
  }
  function progShow(lbl) { injectDom(); document.getElementById('cd-prog').classList.add('show'); progSet(0, lbl || 'Menyimpan…'); }
  function progSet(pct, lbl) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const i = document.getElementById('cd-prog-i'); if (i) i.style.width = p + '%';
    const t = document.getElementById('cd-prog-pct'); if (t) t.textContent = p + '%';
    const l = document.getElementById('cd-prog-lbl'); if (l && lbl) l.textContent = lbl;
  }
  function progHide() { const e = document.getElementById('cd-prog'); if (e) e.classList.remove('show'); }

  function lockSubmit(lock) {
    document.querySelectorAll('[onclick*="submitToDb"],[onclick*="saveToDatabase"],[onclick*="CloudDraft.save"]').forEach(b => { b.disabled = !!lock; });
  }

  // ── collect form state ──
  function collectState() {
    // DB.collectCheckSheetData scrapes every id'd input + the ST/resultState
    // toggle map — exactly what we need to rebuild the form later.
    let base = {};
    try { base = DB.collectCheckSheetData(cfg.formId, tagNow(), cfg.assetName || '', cfg.frequency || 'DRAFT') || {}; }
    catch (e) { console.warn('CloudDraft: collectCheckSheetData gagal', e); }
    return {
      inputValues: base.inputValues || {},
      toggleStates: base.toggleStates || {},
      woNumber: base.woNumber || '',
      checkedBy: base.checkedBy || '',
      executionDate: base.executionDate || '',
    };
  }
  // Best-effort auto-detect of a check sheet's evidence photos when the host
  // didn't pass an explicit `photos` getter. Covers the common shapes; the
  // matching restore side is each sheet's own window.restorePhotosFromUrls().
  function autoPhotos() {
    try {
      if (window.PHOTOS && typeof PHOTOS === 'object') {
        if (Array.isArray(PHOTOS)) return PHOTOS.length ? { main: PHOTOS.slice() } : null;
        const o = {}; let any = false;
        Object.keys(PHOTOS).forEach(k => {
          if (Array.isArray(PHOTOS[k]) && PHOTOS[k].length) { o[k] = PHOTOS[k].slice(); any = true; }
        });
        return any ? o : null;
      }
      if (Array.isArray(window.FILES)) {
        const imgs = window.FILES.filter(f => f && /^image\//.test(f.type || '') && (f.src || f.dataUrl));
        return imgs.length ? { main: imgs } : null;
      }
    } catch (e) {}
    return null;
  }

  function draftHasContent(s) {
    if (Object.keys(s.toggleStates || {}).length) return true;
    return Object.entries(s.inputValues || {}).some(([id, v]) => {
      if (String(v || '').trim() === '') return false;
      const el = document.getElementById(id);
      if (!el) return false;
      if (el.tagName === 'TEXTAREA') return true;
      return el.tagName === 'INPUT' && /^(text|number|date|time|tel|email|search|url|)$/.test(el.type || '');
    });
  }

  // ── save ──
  async function save(opts) {
    opts = opts || {};
    if (_busy) return;
    if (typeof db === 'undefined' || !db) { note('❌ Database belum siap.', 'err'); return; }

    // local draft first (host's own mechanism) so nothing is lost if cloud fails
    try { if (typeof window.saveDraft === 'function' && !opts.silentLocal) window.saveDraft(); else if (typeof window.persistDraft === 'function') window.persistDraft(true); }
    catch (e) {}

    const state = collectState();
    if (!draftHasContent(state)) { note('ℹ️ Belum ada data untuk disimpan.', 'info'); return; }

    _busy = true; lockSubmit(true); progShow('Menyimpan draft ke database…');
    const id = currentDraftId(true);
    const s = sess();
    try {
      // 1. photos → Drive
      let photoUrls = null;
      const photos = (typeof cfg.photos === 'function') ? cfg.photos() : autoPhotos();
      if (photos && typeof Storage !== 'undefined' && Storage.uploadDataUrl) {
        photoUrls = {};
        const groups = Object.keys(photos).filter(g => (photos[g] || []).length);
        const total = groups.reduce((n, g) => n + photos[g].length, 0);
        let done = 0;
        for (const g of groups) {
          const urls = [];
          for (let i = 0; i < photos[g].length; i++) {
            const p = photos[g][i] || {};
            const src = p.src || p.dataUrl;
            if (!src || String(src).indexOf('data:') !== 0) { done++; continue; }
            try {
              const url = await Storage.uploadDataUrl(`${COLL}/${id}/photos/${g}-${i}.jpg`, src, 'image/jpeg');
              urls.push({ url, caption: p.caption || '', w: p.w, h: p.h, widthCm: p.widthCm, heightCm: p.heightCm });
            } catch (e) { console.warn('CloudDraft: upload foto gagal', e); }
            done++; progSet(5 + Math.round(85 * done / Math.max(1, total)), `Mengunggah foto ${done}/${total}…`);
          }
          if (urls.length) photoUrls[g] = urls;
        }
      }
      progSet(92, 'Menyimpan data…');

      // 2. Firestore doc
      let createdAt = new Date().toISOString();
      try {
        const prev = await db.collection(COLL).doc(id).get();
        if (prev.exists && prev.data() && prev.data().createdAt) createdAt = prev.data().createdAt;
      } catch (e) {}
      const payload = {
        formId: cfg.formId,
        assetTag: tagNow(),
        assetName: cfg.assetName || '',
        frequency: cfg.frequency || '',
        woNumber: state.woNumber, checkedBy: state.checkedBy, executionDate: state.executionDate,
        inputValues: state.inputValues,
        toggleStates: state.toggleStates,
        extra: (typeof cfg.collectExtra === 'function' ? (cfg.collectExtra() || null) : null),
        ...(photoUrls && Object.keys(photoUrls).length ? { photoUrls } : {}),
        photoCount: photoUrls ? Object.values(photoUrls).reduce((n, a) => n + a.length, 0) : 0,
        status: 'draft',
        savedBy: s.user || '', savedByName: s.name || state.checkedBy || '',
        device: (navigator.userAgent || '').slice(0, 140),
        createdAt, updatedAt: new Date().toISOString(),
      };
      await db.collection(COLL).doc(id).set(payload);
      progSet(100, 'Selesai');
      note('💾 Draft tersimpan ke database. Bisa dilanjutkan dari perangkat manapun lewat "Lanjutkan dari Database".', 'ok');
    } catch (e) {
      console.error('CloudDraft.save gagal:', e);
      if (e && (e.code === 'permission-denied' || e.code === 'unauthenticated')) {
        note('⚠️ Simpan ke database gagal: koleksi "checksheet_drafts" belum diizinkan di Firestore Rules. Draft tetap tersimpan di perangkat ini.', 'err');
      } else {
        note('⚠️ Simpan draft ke database gagal: ' + (e && e.message || e) + '. Draft lokal tetap aman.', 'err');
      }
    } finally {
      _busy = false; lockSubmit(false);
      setTimeout(progHide, 350);
    }
  }

  // ── resume picker ──
  async function openResume() {
    injectDom();
    if (typeof db === 'undefined' || !db) { note('❌ Database belum siap.', 'err'); return; }
    document.getElementById('cd-ov').classList.add('show');
    const list = document.getElementById('cd-list');
    list.innerHTML = '<div class="cd-empty">Memuat…</div>';
    try {
      const snap = await db.collection(COLL).where('formId', '==', cfg.formId).get();
      _drafts = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
      _drafts.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      renderList();
    } catch (e) {
      console.error('CloudDraft.openResume gagal:', e);
      list.innerHTML = '<div class="cd-empty">Gagal memuat daftar draft: ' + (e && e.message || e) +
        (e && e.code === 'permission-denied' ? '<br><br>Koleksi <code>checksheet_drafts</code> belum diizinkan di Firestore Rules.' : '') + '</div>';
    }
  }
  function renderList() {
    const list = document.getElementById('cd-list');
    const mineId = currentDraftId(false);
    if (!_drafts.length) { list.innerHTML = '<div class="cd-empty">Belum ada draft tersimpan di database untuk check sheet ini.</div>'; return; }
    list.innerHTML = _drafts.map((d, i) => {
      const when = d.updatedAt ? new Date(d.updatedAt).toLocaleString('id-ID') : '—';
      const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
      return `<div class="cd-row">
        <div class="info">
          <b>${esc(d.assetTag || 'Tanpa tag')}</b>${d.id === mineId ? ' <span class="meta">(draft tab ini)</span>' : ''}<br>
          <span class="meta">WO ${esc(d.woNumber || '—')} · ${esc(d.executionDate || 'tanggal —')} · ${d.photoCount || 0} foto</span><br>
          <span class="meta">oleh ${esc(d.savedByName || '—')} · terakhir ${esc(when)}</span>
        </div>
        <div class="acts">
          <button class="cd-btn pri" onclick="CloudDraft._resume(${i})">Lanjutkan</button>
          <button class="cd-btn danger" onclick="CloudDraft._delete(${i})">Hapus</button>
        </div>
      </div>`;
    }).join('');
  }
  function _close() { const e = document.getElementById('cd-ov'); if (e) e.classList.remove('show'); }

  async function _resume(i) {
    const d = _drafts[i];
    if (!d) return;
    if (!confirm('Muat draft ini? Isian form saat ini akan ditimpa dengan data draft.')) return;
    _close();
    _busy = true; lockSubmit(true); progShow('Memuat draft…');
    try {
      // text fields + toggles via LoadMergeModal's generic restorer
      const bundle = { header: {}, inputValues: d.inputValues || {}, panelStates: {}, toggleStates: d.toggleStates || {} };
      if (window.LoadMergeModal && typeof LoadMergeModal.applyMergedBundleToForm === 'function') {
        LoadMergeModal.applyMergedBundleToForm(bundle, true);
      } else {
        Object.entries(bundle.inputValues).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.value = v; });
      }
      progSet(35, 'Memulihkan data…');
      if (typeof cfg.applyExtra === 'function') { try { cfg.applyExtra(d.extra || null); } catch (e) { console.warn('CloudDraft applyExtra:', e); } }

      // photos
      if (d.photoUrls && Object.keys(d.photoUrls).length && typeof window.restorePhotosFromUrls === 'function') {
        progSet(50, 'Mengunduh foto…');
        try { await window.restorePhotosFromUrls(d.photoUrls, true); } catch (e) { console.warn('CloudDraft restore foto:', e); }
      }
      progSet(90, 'Menyelesaikan…');

      // this tab now continues THIS draft — subsequent saves update it
      try { localStorage.setItem(idKey(), d.id); } catch (e) {}
      if (typeof cfg.afterRestore === 'function') { try { cfg.afterRestore(); } catch (e) {} }
      if (typeof window.autoSaveNow === 'function') { try { window.autoSaveNow(); } catch (e) {} }
      progSet(100, 'Selesai');
      note('☁️ Draft dari database dimuat — lanjutkan pengisian lalu Submit ketika selesai.', 'ok');
    } catch (e) {
      console.error('CloudDraft._resume gagal:', e);
      note('❌ Gagal memuat draft: ' + (e && e.message || e), 'err');
    } finally {
      _busy = false; lockSubmit(false);
      setTimeout(progHide, 350);
    }
  }
  async function _delete(i) {
    const d = _drafts[i];
    if (!d) return;
    if (!confirm('Hapus draft ini dari database secara permanen?')) return;
    try {
      await db.collection(COLL).doc(d.id).delete();
      if (currentDraftId(false) === d.id) forgetDraftId();
      _drafts.splice(i, 1);
      renderList();
      note('🗑️ Draft dihapus.', 'info');
    } catch (e) { note('❌ Gagal menghapus draft: ' + (e && e.message || e), 'err'); }
  }

  // ── called by the host's submitToDb() on a successful real submission ──
  async function markSubmitted() {
    const id = currentDraftId(false);
    forgetDraftId();
    if (!id || typeof db === 'undefined' || !db) return;
    try { await db.collection(COLL).doc(id).delete(); } catch (e) {}
  }

  function init(opts) {
    cfg = Object.assign({ formId: 'checksheet', assetName: '', frequency: 'DRAFT' }, opts || {});
  }

  window.CloudDraft = { init, save, openResume, markSubmitted, _close, _resume, _delete, _reconfig: init };
})();
