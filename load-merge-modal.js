// ============================================================
//  Load & Merge Modal — generic "pull from database" + multi-submission
//  merge picker + revision banner, reusable across every check sheet.
//
//  Generalizes the bespoke version originally built for
//  PLTS_AshDisposal_PM.html (see CLAUDE.md's "Multi-submission load &
//  merge" writeup for the full rationale) so 21 other check sheets don't
//  each need their own ~150-line copy. Injects its own DOM (modal +
//  revision banner) and <style> on first use — the host page only needs:
//
//    <script src="db-helper.js"></script>
//    <script src="approval-helper.js"></script>     (for the revision banner)
//    <script src="load-merge-modal.js"></script>
//    ...
//    <button onclick="LoadMergeModal.open()">Pilih & Gabung Data dari Database</button>
//    <script>
//      LoadMergeModal.init({ assetTag: 'XXX-TAG' });
//      LoadMergeModal.initRevisionBanner();   // no-op unless ?reviseOf= is in the URL
//    </script>
//
//  Then in submitToDb()/saveToDatabase(), pass the id this returns as
//  revisionOf to Approvals.submitWithFiles()/create():
//    revisionOf: LoadMergeModal.getReviseOfApprovalId()
//
//  Root problem this solves (same as the PLTS original): DB.save() always
//  .add()s a new document, never updates one in place. When different
//  technicians each fill part of a check sheet in separate sessions, a
//  later partial save can make an earlier save's data look "lost" from
//  the normal single-latest-doc "load last" flow, even though nothing was
//  actually deleted. This lets a technician pick ANY past submission(s)
//  and union them into the current form instead of a blind overwrite.
// ============================================================

const LoadMergeModal = (function () {
  const HEADER_MAP_DEFAULT = {
    woNumber: 'wo-no', executionDate: 'wo-date', timeStart: 'time-start', timeEnd: 'time-end',
    checkedBy: 'checked-by', nik: 'nik', reviewedBy: 'reviewed-by', shift: 'shift',
  };

  let _config = null;
  let _docs = [];
  let _sel = new Set();
  let _reviseOfApprovalId = null;
  let _reviseOfChecksheetId = null;
  let _domReady = false;
  let _lmmBusy = false;   // true while a revision-load / merge is running — blocks re-entry

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fmtDate(iso) {
    if (!iso) return '—';
    try { return new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return iso; }
  }

  function injectDom() {
    if (_domReady) return;
    _domReady = true;

    const style = document.createElement('style');
    style.textContent = `
#lmm-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:20000;
  align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:14px;
  font-family:'Barlow',system-ui,sans-serif}
#lmm-overlay.show{display:flex}
.lmm-box{background:#fff;border-radius:14px;width:min(560px,100%);max-height:90vh;
  display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.35);color:#0f172a}
.lmm-hdr{background:linear-gradient(90deg,#1e3a5f,#0f2744);padding:14px 18px;
  display:flex;align-items:center;justify-content:space-between;gap:10px}
.lmm-title{font-weight:700;font-size:15px;color:#7dd3fc;letter-spacing:1px}
.lmm-sub{font-size:10.5px;color:#9dc4e8;margin-top:2px}
.lmm-x{background:none;border:none;color:#9dc4e8;font-size:18px;cursor:pointer;line-height:1;padding:2px 6px;border-radius:4px}
.lmm-x:hover{background:rgba(255,255,255,.15)}
.lmm-quick{display:flex;gap:8px;padding:10px 12px 4px}
.lmm-quick button{background:#f0f7ff;border:1px solid #bfdbfe;border-radius:6px;padding:5px 12px;
  font-size:11px;color:#1e3a5f;cursor:pointer}
.lmm-quick button:hover{border-color:#2563eb;color:#2563eb}
.lmm-overwrite{display:flex;align-items:flex-start;gap:8px;padding:8px 10px;margin:6px 10px;
  background:#fef3c7;border:1px solid #fde68a;border-radius:8px;font-size:11px;line-height:1.4;
  color:#92400e;cursor:pointer}
.lmm-overwrite input{accent-color:#b45309;margin-top:2px;flex-shrink:0}
.lmm-body{flex:1;overflow-y:auto;padding:6px 10px}
.lmm-item{display:flex;align-items:flex-start;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;
  border:1.5px solid transparent}
.lmm-item:hover{background:#f0f7ff}
.lmm-item.on{background:#eff6ff;border-color:#2563eb}
.lmm-item input{width:16px;height:16px;accent-color:#2563eb;cursor:pointer;flex-shrink:0;margin-top:3px}
.lmm-info{flex:1;min-width:0}
.lmm-name{font-weight:700;font-size:13px;color:#0f172a}
.lmm-meta{font-size:10.5px;color:#64748b;font-family:'Share Tech Mono',monospace;margin-top:2px}
.lmm-empty{padding:30px 10px;text-align:center;color:#64748b;font-size:12.5px}
.lmm-ftr{padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:10px;
  border-top:1px solid #dbeafe;background:#f0f7ff}
.lmm-count{font-size:11px;color:#64748b;font-family:'Share Tech Mono',monospace}
.lmm-btn{padding:8px 16px;border-radius:6px;border:1.5px solid #bfdbfe;background:#fff;color:#1e3a5f;
  font-weight:600;font-size:12.5px;cursor:pointer}
.lmm-btn:hover{border-color:#2563eb;color:#2563eb}
.lmm-btn-pri{background:#2563eb;border-color:#2563eb;color:#fff}
.lmm-btn-pri:hover{background:#1d4ed8;color:#fff}
.lmm-btn:disabled{opacity:.5;cursor:not-allowed}
#lmm-revision-banner{display:none;align-items:flex-start;gap:10px;margin:10px;padding:12px 14px;
  background:#fef3c7;border:1.5px solid #f59e0b;border-radius:10px;font-size:12.5px;color:#92400e;
  line-height:1.5;font-family:'Barlow',system-ui,sans-serif;position:relative;z-index:500}
#lmm-revision-banner b{display:block;margin-bottom:2px}
#lmm-progress-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.86);z-index:26000;
  align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:16px;
  font-family:'Barlow',system-ui,sans-serif}
#lmm-progress-overlay.show{display:flex}
.lmm-pbox{background:#fff;border-radius:14px;width:min(420px,100%);overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.35);color:#0f172a}
.lmm-pbody{padding:26px 24px 24px;text-align:center}
.lmm-picon{font-size:30px;margin-bottom:10px}
.lmm-plabel{font-size:13px;color:#334155;margin-bottom:14px;min-height:18px}
.lmm-ptrack{width:100%;height:14px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-bottom:8px}
.lmm-pbar{height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#7dd3fc);border-radius:999px;transition:width .25s ease}
.lmm-ppct{font-family:'Share Tech Mono',monospace;font-size:13px;font-weight:700;color:#1e3a5f}
.lmm-phint{font-size:11px;color:#94a3b8;margin-top:10px}
    `;
    document.head.appendChild(style);

    const banner = document.createElement('div');
    banner.id = 'lmm-revision-banner';
    banner.innerHTML = `
      <span style="font-size:18px;flex-shrink:0">&#9888;&#65039;</span>
      <div style="flex:1">
        <b id="lmm-revision-title">Form ini dibuka untuk merevisi submission.</b>
        <div id="lmm-revision-note">Memuat catatan revisi...</div>
        <button class="lmm-btn" id="lmm-rev-load-btn" style="margin-top:8px" onclick="LoadMergeModal.loadRevisionSource()">&#128229; Muat Data Submission untuk Direvisi</button>
      </div>`;
    // Insert as the very first element of <body> so it's visible
    // regardless of the host page's own layout structure.
    document.body.insertBefore(banner, document.body.firstChild);

    const pOverlay = document.createElement('div');
    pOverlay.id = 'lmm-progress-overlay';
    pOverlay.innerHTML = `
      <div class="lmm-pbox">
        <div class="lmm-pbody">
          <div class="lmm-picon">&#8987;</div>
          <div class="lmm-plabel" id="lmm-plabel">Memuat...</div>
          <div class="lmm-ptrack"><div class="lmm-pbar" id="lmm-pbar"></div></div>
          <div class="lmm-ppct" id="lmm-ppct">0%</div>
          <div class="lmm-phint">Jangan tutup atau tekan tombol lagi &mdash; tunggu sampai selesai.</div>
        </div>
      </div>`;
    document.body.appendChild(pOverlay);

    const overlay = document.createElement('div');
    overlay.id = 'lmm-overlay';
    overlay.innerHTML = `
      <div class="lmm-box">
        <div class="lmm-hdr">
          <div>
            <div class="lmm-title">PILIH DATA UNTUK DIGABUNG</div>
            <div class="lmm-sub" id="lmm-sub">&mdash;</div>
          </div>
          <button class="lmm-x" onclick="LoadMergeModal.close()">&#10005;</button>
        </div>
        <div class="lmm-quick">
          <button onclick="LoadMergeModal._selectAll(true)">Pilih Semua</button>
          <button onclick="LoadMergeModal._selectAll(false)">Kosongkan</button>
        </div>
        <label class="lmm-overwrite">
          <input type="checkbox" id="lmm-overwrite-toggle" onchange="LoadMergeModal._render()">
          <span>Mode Timpa: ganti field yang <b>sudah diisi</b> di form ini. Default (tidak dicentang) = Mode Gabung: hanya mengisi field yang masih kosong &mdash; aman, tidak menghapus data yang sedang diketik.</span>
        </label>
        <div class="lmm-body" id="lmm-list"><div class="lmm-empty">&#8987; Memuat submission...</div></div>
        <div class="lmm-ftr">
          <span class="lmm-count" id="lmm-count">0 dipilih</span>
          <div style="display:flex;gap:10px">
            <button class="lmm-btn" onclick="LoadMergeModal.close()">&larr; Batal</button>
            <button class="lmm-btn lmm-btn-pri" id="lmm-confirm" onclick="LoadMergeModal._confirm()">&#128229; Gabungkan ke Form</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }

  function init(config) {
    _config = Object.assign({ headerMap: HEADER_MAP_DEFAULT }, config);
    injectDom();
  }

  async function open() {
    if (!_config) throw new Error('LoadMergeModal.init({assetTag}) belum dipanggil.');
    injectDom();
    document.getElementById('lmm-overlay').classList.add('show');
    document.getElementById('lmm-sub').textContent = 'Memuat submission...';
    document.getElementById('lmm-list').innerHTML = '<div class="lmm-empty">&#8987; Memuat submission...</div>';
    try {
      const docs = await DB.getAll({ assetTag: _config.assetTag });
      docs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      // "Simpan ke Database" drafts (checksheet_drafts) are listed here too —
      // one unified place to pull data back, badged so a draft is obvious.
      let drafts = [];
      try { if (window.CloudDraft && CloudDraft.listDrafts) drafts = await CloudDraft.listDrafts(); } catch (e) {}
      _docs = drafts.concat(docs);
      _sel = new Set(_docs.length ? [_docs[0].id] : []);
      const dPart = drafts.length ? drafts.length + ' draft + ' : '';
      document.getElementById('lmm-sub').textContent = dPart + docs.length + ' submission ditemukan · pilih untuk memuat / melanjutkan';
    } catch (e) {
      _docs = []; _sel = new Set();
      document.getElementById('lmm-sub').textContent = 'Gagal memuat: ' + e.message;
    }
    _render();
  }
  function close() {
    const el = document.getElementById('lmm-overlay');
    if (el) el.classList.remove('show');
  }
  function _selectAll(all) {
    _sel = all ? new Set(_docs.map(d => d.id)) : new Set();
    _render();
  }
  function _toggle(id) {
    if (_sel.has(id)) _sel.delete(id); else _sel.add(id);
    _render();
  }
  function _render() {
    const wrap = document.getElementById('lmm-list');
    if (!_docs.length) {
      wrap.innerHTML = '<div class="lmm-empty">Belum ada submission sebelumnya untuk asset ini.</div>';
    } else {
      wrap.innerHTML = _docs.map(d => {
        const when = fmtDate(d.updatedAt || d.createdAt);
        const badge = d._isDraft
          ? '<span style="background:#f59e0b;color:#fff;font-size:9px;font-weight:800;letter-spacing:.5px;padding:1px 6px;border-radius:4px;margin-right:6px;vertical-align:1px">DRAFT</span>'
          : '';
        const label = badge + 'WO ' + esc(d.woNumber || '—') + ' · ' + esc(d.executionDate || 'tgl —') + ' · ' + esc(d.checkedBy || '—');
        const meta = d._isDraft
          ? 'Draft — terakhir disimpan ' + when + (d.savedByName ? ' oleh ' + esc(d.savedByName) : '') + ' · ' + (d.photoCount || 0) + ' foto'
          : 'Disimpan ' + when + ' · Status: ' + esc(d.overallStatus || '—');
        return `
        <label class="lmm-item${_sel.has(d.id) ? ' on' : ''}">
          <input type="checkbox" ${_sel.has(d.id) ? 'checked' : ''} onchange="LoadMergeModal._toggle('${d.id}')">
          <div class="lmm-info">
            <div class="lmm-name">${label}</div>
            <div class="lmm-meta">${meta}</div>
          </div>
        </label>`;
      }).join('');
    }
    document.getElementById('lmm-count').textContent = _sel.size + ' dari ' + _docs.length + ' submission dipilih';
    const btn = document.getElementById('lmm-confirm');
    btn.disabled = _sel.size === 0;
    btn.style.opacity = _sel.size === 0 ? '.5' : '1';
  }

  // Oldest-first fold so a newer selected doc's value wins over an older
  // one for the same key.
  function buildMergedBundle(docs, headerMap) {
    const sorted = [...docs].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    const header = {}, inputValues = {}, panelStates = {}, toggleStates = {}, photoUrls = {};
    sorted.forEach(d => {
      Object.entries(headerMap).forEach(([f, id]) => { if (d[f]) header[id] = d[f]; });
      if (d.inputValues) Object.assign(inputValues, d.inputValues);
      if (d.panelStates) Object.assign(panelStates, d.panelStates);
      if (d.toggleStates) Object.assign(toggleStates, d.toggleStates);
      // Photos are additive, not "newest wins" like a scalar field — union
      // every selected doc's photos per group instead of overwriting, so
      // picking multiple submissions never silently drops one's photos.
      if (d.photoUrls) {
        Object.entries(d.photoUrls).forEach(([group, list]) => {
          if (!Array.isArray(list) || !list.length) return;
          photoUrls[group] = (photoUrls[group] || []).concat(list);
        });
      }
    });
    return { header, inputValues, panelStates, toggleStates, photoUrls };
  }

  // Fill-blank-only unless overwrite=true, for header/inputValues/panelStates
  // (the things where "is it already filled" is a simple, reliable check).
  // Toggle-button states (the .rb/ST or similar per-file convention — see
  // CLAUDE.md's "Per-file conventions worth matching") are always applied
  // even in merge mode: this codebase has at least 3 different DOM
  // conventions for a toggle's "currently set" state (mirrored from
  // DB.loadLastSubmission()'s own 3-strategy restore in db-helper.js), and
  // reliably detecting "already set" across all of them generically isn't
  // safe to get to guess at. Text/measurement fields — where a technician's
  // typed work actually lives — are never touched unless already blank;
  // OK/NG toggles are coarse enough that refreshing them from the merged
  // bundle is an acceptable trade-off for a single generic implementation
  // covering every check sheet's differing toggle widget.
  function applyMergedBundleToForm(bundle, overwrite) {
    const { header, inputValues, panelStates, toggleStates } = bundle;
    let filled = 0;

    if (overwrite && typeof setPanelState === 'function') {
      document.querySelectorAll('.panel-chk[id^="pchk-"]').forEach(el => setPanelState(el, ''));
    }

    [header, inputValues].forEach(map => {
      Object.entries(map).forEach(([id, val]) => {
        const el = document.getElementById(id);
        if (!el) return;
        if ((overwrite || !el.value) && el.value !== val) { el.value = val; filled++; }
      });
    });

    // .r-sel OK/NG/N-A color coding resync (PLTS-style convention) — only
    // does anything if the host page defines onResChange.
    if (typeof onResChange === 'function') {
      document.querySelectorAll('.r-sel').forEach(sel => {
        if (!sel.id.startsWith('res-') || !sel.value) return;
        onResChange(sel, sel.id.slice(4));
      });
    }

    if (typeof setPanelState === 'function') {
      Object.entries(panelStates).forEach(([id, st]) => {
        const el = document.getElementById(id);
        if (!el) return;
        const cur = el.dataset.state || '';
        if ((overwrite || !cur) && cur !== st) { setPanelState(el, st); filled++; }
      });
    }

    const toggleIds = Object.keys(toggleStates);
    if (toggleIds.length) {
      if (typeof ST !== 'undefined' && ST !== null) toggleIds.forEach(k => { ST[k] = toggleStates[k]; });
      if (typeof resultState !== 'undefined' && resultState !== null) toggleIds.forEach(k => { resultState[k] = toggleStates[k]; });
      toggleIds.forEach(id => {
        const val = toggleStates[id];
        let found = false;
        if (!found) {
          const btn = document.querySelector(`.rb[data-v="${val}"][onclick*="'${id}'"]`);
          if (btn) { btn.className = 'rb ' + (val === 'OK' ? 'ok-act' : 'ng-act'); found = true; }
        }
        if (!found) {
          document.querySelectorAll(`[data-id="${id}"]`).forEach(btn => {
            if (btn.dataset.v === val || btn.textContent.trim() === val) { btn.classList.add('a'); found = true; }
          });
        }
        if (!found) {
          document.querySelectorAll(`.r-btn[data-id="${id}"]`).forEach(btn => {
            if (val.toLowerCase() === btn.dataset.type) { btn.classList.add('active'); found = true; }
          });
        }
      });
      filled += toggleIds.length;
    }

    if (typeof updateStats === 'function') updateStats();
    if (typeof upStats === 'function') upStats();
    return filled;
  }

  // Fetches every photo in `photoUrls` back into a real data: URL and hands
  // the whole {groupKey:[{url,caption,w,h,widthCm,heightCm}]} bundle to the
  // HOST PAGE's own `restorePhotosFromUrls(photoUrls, overwrite)` function,
  // if it defines one. This module can't generically restore photos itself
  // — the 22 check sheets in this repo use at least 6 different in-memory
  // photo-state shapes (PHOTOS as {group:[...]} or a flat array, PE/PS/PSD
  // per-slot triples, photoStore[slotId], FILES, ATTACH — see CLAUDE.md's
  // "Review & Approval Workflow" section), so each file that wants restored
  // photos on merge/revision implements this one hook itself, the same way
  // several already implement a `collectPhotosForUpload()`-style helper for
  // the upload direction. A sheet with no photo feature, or one that hasn't
  // added the hook yet, silently gets 0 — merge/revision still succeeds for
  // every other field, it just leaves the photo gallery empty like before.
  // Returns however many photos the hook reports restoring (for the toast).
  async function restorePhotosIfSupported(photoUrls, overwrite) {
    if (!photoUrls || !Object.keys(photoUrls).length) return 0;
    if (typeof window.restorePhotosFromUrls !== 'function') return 0;
    try {
      const n = await window.restorePhotosFromUrls(photoUrls, overwrite);
      return typeof n === 'number' ? n : 0;
    } catch (e) {
      console.error('restorePhotosFromUrls gagal:', e);
      return 0;
    }
  }

  // ── Progress overlay (revision load / merge) ──
  function _pShow(label) {
    injectDom();
    const o = document.getElementById('lmm-progress-overlay');
    if (o) o.classList.add('show');
    _pSet(0, label || 'Memulai...');
  }
  function _pSet(pct, label) {
    const c = Math.max(0, Math.min(100, Math.round(pct)));
    const bar = document.getElementById('lmm-pbar');
    const p = document.getElementById('lmm-ppct');
    const l = document.getElementById('lmm-plabel');
    if (bar) bar.style.width = c + '%';
    if (p) p.textContent = c + '%';
    if (l && label) l.textContent = label;
  }
  function _pHide() {
    const o = document.getElementById('lmm-progress-overlay');
    if (o) o.classList.remove('show');
  }
  function _setRevBtn(disabled) {
    const b = document.getElementById('lmm-rev-load-btn');
    if (b) b.disabled = !!disabled;
  }

  // Downloads every photo URL in the bundle into Storage.toDataUrl()'s cache,
  // reporting real 0..1 progress as (done photos)/(total photos), with a small
  // in-photo fraction from each XHR's byte events. The host page's
  // restorePhotosFromUrls() then hits the cache — instant, and a double-click
  // re-downloads nothing.
  async function _prefetchPhotos(photoUrls, onFrac) {
    if (!photoUrls || typeof Storage === 'undefined' || typeof Storage.toDataUrl !== 'function') return;
    const all = [];
    Object.keys(photoUrls).forEach(g => (photoUrls[g] || []).forEach(e => { if (e && e.url) all.push(e.url); }));
    const total = all.length;
    if (!total) return;
    for (let i = 0; i < total; i++) {
      try {
        await Storage.toDataUrl(all[i], ev => {
          let inPhoto = 0;
          if (ev && ev.total) inPhoto = Math.min(1, (ev.loaded || 0) / ev.total);
          else if (ev && ev.phase === 'decode') inPhoto = 0.95;
          if (typeof onFrac === 'function') onFrac((i + inPhoto) / total);
        });
      } catch (e) { console.error('prefetch foto gagal:', all[i], e); }
      if (typeof onFrac === 'function') onFrac((i + 1) / total);
    }
  }

  async function _confirm() {
    if (_lmmBusy) return;
    if (_sel.size === 0) return;
    const chosen = _docs.filter(d => _sel.has(d.id));
    // Continuing a single DRAFT = full restore (overwrite), and this session
    // then keeps working on that draft doc.
    const soleDraft = chosen.length === 1 && chosen[0]._isDraft ? chosen[0] : null;
    const overwrite = soleDraft ? true : document.getElementById('lmm-overwrite-toggle').checked;
    if (overwrite && !soleDraft && !confirm('Mode Timpa akan mengganti field yang SUDAH diisi di form ini dengan data dari ' + chosen.length + ' submission terpilih. Lanjutkan?')) return;

    _lmmBusy = true;
    _pShow('Menyiapkan data...');
    try {
      // Adopt the draft FIRST — so cfg.applyExtra() (e.g. MCA's narrativeBlocks
      // structure into _cloudNB) is in place before restorePhotosFromUrls()
      // runs, letting it slice photos into the right blocks.
      if (soleDraft && window.CloudDraft && CloudDraft.adopt) CloudDraft.adopt(soleDraft.id, soleDraft);
      const bundle = buildMergedBundle(chosen, _config.headerMap);
      _pSet(10, 'Mengisi field form...');
      const filled = applyMergedBundleToForm(bundle, overwrite);
      close();

      const hasPhotos = Object.keys(bundle.photoUrls).length > 0;
      let photosRestored = 0;
      if (hasPhotos) {
        _pSet(15, 'Mengunduh foto...');
        await _prefetchPhotos(bundle.photoUrls, frac => _pSet(15 + Math.round(78 * frac), 'Mengunduh foto... ' + Math.round(frac * 100) + '%'));
        _pSet(94, 'Memulihkan foto ke form...');
        photosRestored = await restorePhotosIfSupported(bundle.photoUrls, overwrite);
      }
      _pSet(100, 'Selesai');
      if (typeof Storage !== 'undefined' && Storage.clearDataUrlCache) Storage.clearDataUrlCache();
      if (typeof showNote === 'function') {
        const photoPart = photosRestored ? ', ' + photosRestored + ' foto dipulihkan' : '';
        if (soleDraft) showNote('☁️ Draft dimuat — lanjutkan pengisian, lalu "Submit" saat sudah lengkap. ' + filled + ' field' + photoPart + '.', 'ok');
        else showNote('✅ ' + chosen.length + ' submission digabungkan' + (overwrite ? ' (mode timpa)' : '') + ' — ' + filled + ' field terisi' + photoPart + '.', 'ok');
      }
      if (typeof autoSaveNow === 'function') autoSaveNow();
    } catch (e) {
      if (typeof showNote === 'function') showNote('❌ Gagal menggabungkan: ' + e.message, 'err');
    } finally {
      setTimeout(_pHide, 350);
      _lmmBusy = false;
    }
  }

  // ── Revision banner (?reviseOf=<approvalId>) ──
  async function initRevisionBanner() {
    _reviseOfApprovalId = new URLSearchParams(location.search).get('reviseOf') || null;
    if (!_reviseOfApprovalId) return;
    injectDom();
    const banner = document.getElementById('lmm-revision-banner');
    banner.style.display = 'flex';
    const noteEl = document.getElementById('lmm-revision-note');
    noteEl.textContent = 'Memuat catatan revisi...';
    try {
      if (typeof Approvals === 'undefined') throw new Error('approval-helper.js belum dimuat di halaman ini.');
      const approval = await Approvals.getById(_reviseOfApprovalId);
      if (!approval) { noteEl.textContent = 'Submission rujukan tidak ditemukan (mungkin sudah dihapus).'; return; }
      _reviseOfChecksheetId = approval.checksheetId;
      const n = approval.returnedNote;
      const titleEl = document.getElementById('lmm-revision-title');
      if (n) {
        if (titleEl) titleEl.textContent = 'Form ini dibuka untuk merevisi submission yang dikembalikan.';
        noteEl.textContent = `Dikembalikan oleh ${n.by || '—'} (tahap ${n.stage === 'approval' ? 'Approval' : 'Review'}): "${n.note || '—'}"`;
      } else if (approval.status === 'submitted') {
        // Opened by a reviewer (TechOp2) mid-review to fix the report before
        // deciding — not a returned revision.
        if (titleEl) titleEl.textContent = 'Form ini dibuka oleh reviewer untuk memperbaiki isian submission.';
        noteEl.textContent = 'Muat datanya, perbaiki seperlunya, lalu Submit ulang — submission ini akan diperbarui di tempat (pilih "Timpa" saat diminta).';
      } else {
        noteEl.textContent = 'Muat data submission ini untuk dilihat / diperbaiki.';
      }
    } catch (e) {
      noteEl.textContent = 'Gagal memuat catatan revisi: ' + e.message;
    }
  }
  async function loadRevisionSource() {
    // Reentrancy guard — set SYNCHRONOUSLY so a double/triple-click on "Muat
    // Data Submission untuk Direvisi" can't kick off parallel photo downloads
    // (which is exactly what made restored photos pile up).
    if (_lmmBusy) return;
    if (!_reviseOfChecksheetId) { if (typeof showNote === 'function') showNote('❌ Data submission untuk direvisi belum siap dimuat.', 'err'); return; }
    _lmmBusy = true;
    _setRevBtn(true);
    _pShow('Mengambil data submission sebelumnya...');
    try {
      _pSet(5, 'Mengambil data submission sebelumnya...');
      const doc = await DB.getById(_reviseOfChecksheetId);
      if (!doc) { if (typeof showNote === 'function') showNote('❌ Submission sebelumnya tidak ditemukan.', 'err'); return; }
      const bundle = buildMergedBundle([doc], _config.headerMap);
      _pSet(12, 'Mengisi field form...');
      const filled = applyMergedBundleToForm(bundle, true); // overwrite: restore the flagged submission in full, not a partial merge

      const hasPhotos = Object.keys(bundle.photoUrls).length > 0;
      let photosRestored = 0;
      if (hasPhotos) {
        _pSet(15, 'Mengunduh foto...');
        await _prefetchPhotos(bundle.photoUrls, frac => _pSet(15 + Math.round(78 * frac), 'Mengunduh foto... ' + Math.round(frac * 100) + '%'));
        _pSet(94, 'Memulihkan foto ke form...');
        photosRestored = await restorePhotosIfSupported(bundle.photoUrls, true);
      }
      _pSet(100, 'Selesai');
      if (typeof Storage !== 'undefined' && Storage.clearDataUrlCache) Storage.clearDataUrlCache();
      const photoPart = photosRestored ? ', ' + photosRestored + ' foto dipulihkan' : '';
      if (typeof showNote === 'function') showNote('✅ Data submission dimuat (' + filled + ' field' + photoPart + ') — perbaiki sesuai catatan lalu Submit.', 'ok');
      if (typeof autoSaveNow === 'function') autoSaveNow();
    } catch (e) {
      if (typeof showNote === 'function') showNote('❌ Gagal memuat: ' + e.message, 'err');
    } finally {
      setTimeout(_pHide, 350);
      _setRevBtn(false);
      _lmmBusy = false;
    }
  }

  return {
    init, open, close, initRevisionBanner, loadRevisionSource,
    getReviseOfApprovalId: () => _reviseOfApprovalId,
    // Let a host set/clear the revise target itself (not just from ?reviseOf=)
    // — used by Motor_Witness_Test_Vendor.html when a technician chooses to
    // overwrite an already-submitted test session as a revision.
    setReviseOf: (approvalId, checksheetId) => { _reviseOfApprovalId = approvalId || null; if (checksheetId != null) _reviseOfChecksheetId = checksheetId; },
    buildMergedBundle, applyMergedBundleToForm,
    _selectAll, _toggle, _render, _confirm,
  };
})();
