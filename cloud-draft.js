// ============================================================
//  Cloud Draft — "Simpan ke Database (Lanjut Nanti)" for every check sheet.
//
//  ONE system with Load & Merge, not a separate feature:
//   - "💾 Simpan ke Database" (CloudDraft.save) writes the whole form state to
//     the isolated `checksheet_drafts` collection — NEVER `checksheets`, so
//     the dashboard / trend charts / dedup / review workflow are untouched.
//     Re-saving UPDATES the same draft doc (one per formId+assetTag), and a
//     photo already on Drive from an earlier save is NOT re-uploaded (a small
//     signature per entry is remembered) — so repeated saves don't pile up
//     Drive files.
//   - Continuing a draft is done through the SAME "Muat / Lanjutkan dari
//     Database" button as Load & Merge: load-merge-modal.js lists drafts
//     alongside submitted history (badged "DRAFT") and, when a draft is
//     picked, calls CloudDraft.adopt() so this session keeps working on it.
//   - "Submit to Database" is only for a finished report. It creates the real
//     `checksheets` doc + review record as usual; Approvals.submitWithFiles()
//     REUSES the draft's already-uploaded photo URLs (no re-upload), and
//     CloudDraft.markSubmitted() then deletes the draft doc.
//
//  Firestore rule needed:
//    match /checksheet_drafts/{doc} { allow read, write: if true; }
//  On permission-denied the module degrades to localStorage-only + a toast.
//
//  Host wiring (done for every portal check sheet):
//    <script src="cloud-draft.js"></script>   (after load-merge-modal.js)
//    <button onclick="CloudDraft.save()">💾 Simpan ke Database</button>
//    CloudDraft.init({ formId, assetTag, assetName, frequency,
//                      photos?, collectExtra?, applyExtra?, afterRestore? });
//    // in submitToDb() on success:  CloudDraft.markSubmitted();
// ============================================================

(function () {
  if (window.CloudDraft) return;

  const COLL = 'checksheet_drafts';
  let cfg = null;
  let _busy = false;
  let _domReady = false;
  let _activeDoc = null;   // cached payload of the adopted/last-saved draft

  const tagNow = () => {
    const t = cfg && cfg.assetTag;
    let v = '';
    try { v = String((typeof t === 'function' ? t() : t) || '').trim(); } catch (e) { v = ''; }
    return v || 'NO-TAG';
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
  function forgetDraftId() { try { localStorage.removeItem(idKey()); } catch (e) {} _activeDoc = null; }
  const sess = () => { try { return (window.AuthSession && AuthSession.get && AuthSession.get()) || {}; } catch (e) { return {}; } };
  const note = (m, t) => {
    if (typeof window.showNote === 'function') return window.showNote(m, t);
    if (typeof window.note === 'function') return window.note(m, t);
    console.log('[CloudDraft]', m);
  };
  const photoSig = src => { src = String(src || ''); return src.length + '~' + src.slice(0, 24) + src.slice(-24); };

  // ── progress overlay ──
  function injectDom() {
    if (_domReady) return;
    _domReady = true;
    const st = document.createElement('style');
    st.textContent = `
#cd-prog{display:none;position:fixed;inset:0;z-index:23500;background:rgba(15,23,42,.62);align-items:center;justify-content:center;font-family:system-ui,sans-serif}
#cd-prog.show{display:flex}
.cd-prog-box{background:#fff;border-radius:12px;padding:20px 24px;width:min(360px,90vw);box-shadow:0 20px 60px rgba(0,0,0,.4);text-align:center}
.cd-prog-lbl{font-size:13px;color:#0f172a;font-weight:600;margin-bottom:10px}
.cd-prog-bar{height:8px;background:#e2e8f0;border-radius:99px;overflow:hidden}
.cd-prog-bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2563eb,#1e3a5f);transition:width .2s}
.cd-prog-pct{font-size:11px;color:#64748b;margin-top:6px}`;
    document.head.appendChild(st);
    const pr = document.createElement('div');
    pr.id = 'cd-prog';
    pr.innerHTML = `<div class="cd-prog-box"><div class="cd-prog-lbl" id="cd-prog-lbl">Menyimpan…</div>
      <div class="cd-prog-bar"><i id="cd-prog-i"></i></div><div class="cd-prog-pct" id="cd-prog-pct"></div></div>`;
    document.body.appendChild(pr);
  }
  function progShow(l) { injectDom(); document.getElementById('cd-prog').classList.add('show'); progSet(0, l || 'Menyimpan…'); }
  function progSet(pct, lbl) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    const i = document.getElementById('cd-prog-i'); if (i) i.style.width = p + '%';
    const t = document.getElementById('cd-prog-pct'); if (t) t.textContent = p + '%';
    const l = document.getElementById('cd-prog-lbl'); if (l && lbl) l.textContent = lbl;
  }
  function progHide() { const e = document.getElementById('cd-prog'); if (e) e.classList.remove('show'); }
  function lockSubmit(lock) {
    document.querySelectorAll('[onclick*="submitToDb"],[onclick*="saveToDatabase"],[onclick*="CloudDraft.save"],[onclick*="saveSessionDraft"]').forEach(b => { b.disabled = !!lock; });
  }

  // Read a page global by name — works whether it's a `window.` property OR a
  // top-level `let`/`const` (a lexical global, which is NOT on `window`). Most
  // check sheets declare `let PHOTOS = ...` / `const PHOTOS = {}`, so the old
  // `window.PHOTOS` check always missed them and a "Simpan ke Database" draft
  // saved zero photos. `new Function` runs in true global scope.
  function _pageGlobal(name) {
    try { return (new Function('return (typeof ' + name + '!=="undefined")?' + name + ':undefined'))(); }
    catch (e) { return undefined; }
  }
  function autoPhotos() {
    try {
      const P = _pageGlobal('PHOTOS');
      if (P && typeof P === 'object') {
        if (Array.isArray(P)) return P.length ? { main: P } : null;
        const o = {}; let any = false;
        Object.keys(P).forEach(k => { if (Array.isArray(P[k]) && P[k].length) { o[k] = P[k]; any = true; } });
        return any ? o : null;
      }
      const F = _pageGlobal('FILES');
      if (Array.isArray(F)) {
        const imgs = F.filter(f => f && /^image\//.test(f.type || '') && (f.src || f.dataUrl));
        return imgs.length ? { main: imgs } : null;
      }
    } catch (e) {}
    return null;
  }
  function collectState() {
    let base = {};
    try { base = DB.collectCheckSheetData(cfg.formId, tagNow(), cfg.assetName || '', cfg.frequency || 'DRAFT') || {}; }
    catch (e) { console.warn('CloudDraft: collectCheckSheetData gagal', e); }
    return {
      inputValues: base.inputValues || {}, toggleStates: base.toggleStates || {},
      woNumber: base.woNumber || '', checkedBy: base.checkedBy || '', executionDate: base.executionDate || '',
    };
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

  async function save() {
    if (_busy) return;
    if (typeof db === 'undefined' || !db) { note('❌ Database belum siap.', 'err'); return; }
    try { if (typeof window.saveDraft === 'function') window.saveDraft(); else if (typeof window.persistDraft === 'function') window.persistDraft(true); } catch (e) {}

    const state = collectState();
    if (!draftHasContent(state)) { note('ℹ️ Belum ada data untuk disimpan.', 'info'); return; }

    _busy = true; lockSubmit(true); progShow('Menyimpan draft ke database…');
    const id = currentDraftId(true);
    const s = sess();
    // photos already on Drive from the last save of THIS draft. _activeDoc has
    // it after an adopt / a prior save this session; otherwise fetch the doc so
    // an unchanged photo is never re-uploaded — and, more importantly, so a save
    // made while photos are still loading never ERASES the group from the doc.
    let prevUrls = (_activeDoc && _activeDoc.photoUrls) || null;
    let prevCreatedAt = _activeDoc && _activeDoc.createdAt;
    if (!prevUrls || !prevCreatedAt) {
      try {
        const pd = await db.collection(COLL).doc(id).get();
        if (pd.exists && pd.data()) {
          if (!prevUrls) prevUrls = pd.data().photoUrls || null;
          if (!prevCreatedAt) prevCreatedAt = pd.data().createdAt || null;
        }
      } catch (e) {}
    }
    prevUrls = prevUrls || {};
    try {
      // 1. photos → Drive, skipping any unchanged since last save
      let photoUrls = null;
      const photos = (typeof cfg.photos === 'function') ? cfg.photos() : autoPhotos();
      if (photos && typeof Storage !== 'undefined' && Storage.uploadDataUrl) {
        photoUrls = {};
        const groups = Object.keys(photos).filter(g => (photos[g] || []).length);
        const total = groups.reduce((n, g) => n + photos[g].length, 0);
        let done = 0, uploaded = 0;
        for (const g of groups) {
          const urls = [];
          const prevG = Array.isArray(prevUrls[g]) ? prevUrls[g] : [];
          for (let i = 0; i < photos[g].length; i++) {
            const p = photos[g][i] || {};
            const src = p.src || p.dataUrl;
            const meta = { caption: p.caption || '', w: p.w, h: p.h, widthCm: p.widthCm, heightCm: p.heightCm };
            const sig = photoSig(src);
            // already on Drive: an entry we stamped before (sig match), OR a
            // pure reference with no local data URL (a not-yet-downloaded photo
            // from a session restore) — either way, keep the URL, don't upload.
            if (p.__cdUrl && (!src || p.__cdSig === sig)) { urls.push(Object.assign({ url: p.__cdUrl, _sig: p.__cdSig || sig }, meta)); done++; continue; }
            if (prevG[i] && prevG[i].url && prevG[i]._sig === sig) { urls.push(Object.assign({ url: prevG[i].url, _sig: sig }, meta)); p.__cdUrl = prevG[i].url; p.__cdSig = sig; done++; continue; }
            if (!src || String(src).indexOf('data:') !== 0) { done++; continue; }
            try {
              const url = await Storage.uploadDataUrl(`${COLL}/${id}/photos/${g}-${i}-${Date.now().toString(36)}.jpg`, src, 'image/jpeg');
              urls.push(Object.assign({ url, _sig: sig }, meta));
              p.__cdUrl = url; p.__cdSig = sig; uploaded++;
            } catch (e) { console.warn('CloudDraft: upload foto gagal', e); }
            done++; progSet(5 + Math.round(80 * done / Math.max(1, total)), `Menyimpan foto ${done}/${total}…`);
          }
          if (urls.length) photoUrls[g] = urls;
        }
        if (uploaded === 0 && total > 0) progSet(85, 'Foto tidak berubah — tidak diunggah ulang.');
      }
      // Safety net: if the host gave us NO photo state at all (cfg.photos()
      // returned null — a load-order race or a throw) but the draft already has
      // photos on Drive, keep them rather than erasing the group with a .set().
      // Not applied when cfg.photos() returned an object: there an absent group
      // is a real "these were deleted", which must stick.
      if (photos == null && Object.keys(prevUrls).length) {
        photoUrls = Object.assign({}, prevUrls);
      }
      progSet(92, 'Menyimpan data…');

      let createdAt = prevCreatedAt || new Date().toISOString();
      const payload = {
        formId: cfg.formId, assetTag: tagNow(), assetName: cfg.assetName || '', frequency: cfg.frequency || '',
        woNumber: state.woNumber, checkedBy: state.checkedBy, executionDate: state.executionDate,
        inputValues: state.inputValues, toggleStates: state.toggleStates,
        extra: (typeof cfg.collectExtra === 'function' ? (cfg.collectExtra() || null) : null),
        ...(photoUrls && Object.keys(photoUrls).length ? { photoUrls } : {}),
        photoCount: photoUrls ? Object.values(photoUrls).reduce((n, a) => n + a.length, 0) : 0,
        status: 'draft', savedBy: s.user || '', savedByName: s.name || state.checkedBy || '',
        device: (navigator.userAgent || '').slice(0, 140), createdAt, updatedAt: new Date().toISOString(),
      };
      await db.collection(COLL).doc(id).set(payload);
      _activeDoc = Object.assign({ id }, payload);
      progSet(100, 'Selesai');
      note('💾 Draft tersimpan ke database. Lanjutkan kapan saja lewat "Muat / Lanjutkan dari Database".', 'ok');
    } catch (e) {
      console.error('CloudDraft.save gagal:', e);
      if (e && (e.code === 'permission-denied' || e.code === 'unauthenticated'))
        note('⚠️ Simpan ke database gagal: koleksi "checksheet_drafts" belum diizinkan di Firestore Rules. Draft tetap tersimpan di perangkat ini.', 'err');
      else
        note('⚠️ Simpan draft ke database gagal: ' + (e && e.message || e) + '. Draft lokal tetap aman.', 'err');
    } finally {
      _busy = false; lockSubmit(false);
      setTimeout(progHide, 350);
    }
  }

  // ── called by load-merge-modal.js when a DRAFT row is picked ──
  function adopt(id, doc) {
    if (!id) return;
    try { localStorage.setItem(idKey(), id); } catch (e) {}
    _activeDoc = doc ? Object.assign({ id }, doc) : { id };
    if (typeof cfg.applyExtra === 'function' && doc) { try { cfg.applyExtra(doc.extra || null); } catch (e) {} }
  }
  function getActiveId() { return currentDraftId(false); }
  // Detach from the current draft WITHOUT deleting it (its Firestore doc stays as
  // a separate session). The next save() mints a fresh id. Used when a multi-session
  // sheet starts a brand-new session while an earlier draft should be kept.
  function forgetActive() { forgetDraftId(); }
  // photo URLs the active draft already uploaded — Approvals.submitWithFiles()
  // reuses these so a finished report never re-uploads its photos.
  function getReusePhotoUrls() {
    return (getActiveId() && _activeDoc && _activeDoc.photoUrls) ? _activeDoc.photoUrls : null;
  }
  // list drafts for load-merge-modal.js (query by assetTag; falls back to all for this formId)
  async function listDrafts() {
    if (typeof db === 'undefined' || !db) return [];
    try {
      let snap;
      try { snap = await db.collection(COLL).where('assetTag', '==', tagNow()).get(); }
      catch (e) { snap = await db.collection(COLL).where('formId', '==', cfg.formId).get(); }
      let arr = snap.docs.map(d => Object.assign({ id: d.id, _isDraft: true }, d.data()));
      // only drafts written by THIS module (they always carry formId + inputValues) —
      // excludes any pre-rollout / foreign-shape doc that happens to share the collection
      if (cfg && cfg.formId) arr = arr.filter(d => d.formId === cfg.formId && d.inputValues);
      arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
      return arr;
    } catch (e) { console.warn('CloudDraft.listDrafts gagal:', e); return []; }
  }
  async function deleteDraft(id) {
    if (typeof db === 'undefined' || !db) return;
    try { await db.collection(COLL).doc(id).delete(); } catch (e) {}
    if (currentDraftId(false) === id) forgetDraftId();
  }

  // ── called by the host's submitToDb() on a successful real submission ──
  async function markSubmitted() {
    const id = currentDraftId(false);
    forgetDraftId();
    if (!id || typeof db === 'undefined' || !db) return;
    try { await db.collection(COLL).doc(id).delete(); } catch (e) {}
  }

  function init(opts) { cfg = Object.assign({ formId: 'checksheet', assetName: '', frequency: 'DRAFT' }, opts || {}); }

  window.CloudDraft = {
    init, save, adopt, markSubmitted, forgetActive,
    getActiveId, getReusePhotoUrls, listDrafts, deleteDraft,
    // kept for any old inline onclick still pointing here — route to the unified modal
    openResume() { if (window.LoadMergeModal && LoadMergeModal.open) LoadMergeModal.open(); },
    _cfg: () => cfg,
  };
})();
