// ============================================================
//  Submit Guard — insert-vs-overwrite prompt + a real upload progress bar
//  for the "Submit to Database" action, reusable across every check sheet.
//
//  Built to fix a real, recurring problem: technicians re-submitting the
//  same visit multiple times (unsure whether the first click actually
//  saved, or just impatient) piles up duplicate checksheets + approvals
//  docs — see CLAUDE.md's "Review & Approval Workflow" duplicate-cleanup
//  writeups for how much of a mess this already caused downstream. This
//  module attacks the problem at the SOURCE (the moment of submission)
//  instead of only cleaning up after the fact:
//    1. Before saving, ask whether this looks like the same visit being
//       resubmitted — if so, let the technician choose to overwrite the
//       existing record instead of creating a new one.
//    2. During the (sometimes slow — photo/PDF uploads to Drive) submit
//       process, show a real, honest progress bar instead of a spinner or
//       nothing at all, so nobody re-clicks Submit out of impatience.
//
//  resolveSubmitTarget() itself locks the submit button(s) and shows the
//  progress overlay SYNCHRONOUSLY, in the same tick as the click, before its
//  own Firestore "is this a duplicate?" round-trip even starts — and a
//  second call made while one is already in flight resolves straight to
//  {mode:'cancel'} with no further work. This closes a real gap that used
//  to exist: with only the calling file's own post-await button-disable,
//  there was a window between click and the first visible feedback (the
//  duplicate-check network call) where nothing on screen indicated a submit
//  was in progress, so a technician would click Submit again and create a
//  genuine second submission. Because the lock/overlay live in this module,
//  every check sheet already wired to submit-guard.js gets this fix for
//  free with no per-file change needed.
//
//  Usage — one script include (after db-helper.js and approval-helper.js,
//  since it calls into both) + one init() call:
//    <script src="db-helper.js"></script>
//    <script src="approval-helper.js"></script>
//    <script src="submit-guard.js"></script>
//    ...
//    <script> SubmitGuard.init({ assetTag: 'XXX-TAG' }); </script>
//  (pass submitFnName:'yourFnName' too if the submit button isn't
//  onclick="submitToDb()" — see GEN_BrushGear_PM_Checksheet.html's
//  saveToDatabase() for the one file in this repo that needs it)
//
//  Then inside submitToDb(), BEFORE calling DB.save() — note the button
//  lock + progress overlay are already handled INSIDE resolveSubmitTarget()/
//  hideProgress(), so the caller doesn't need its own
//  document.querySelectorAll(...).disabled=true dance:
//    const target = await SubmitGuard.resolveSubmitTarget(base.woNumber);
//    if(target.mode === 'cancel') return;
//    let id;
//    try{
//      SubmitGuard.setProgress(5, 'Menyimpan data checklist...');
//      id = target.mode === 'overwrite' ? await DB.update(target.targetId, base) : await DB.save(base);
//    }catch(e){ SubmitGuard.hideProgress(); showNote('❌ Gagal simpan: '+e.message,'err'); return; }
//    try{
//      const filesOk = await Approvals.submitWithFiles(id, {
//        ...,
//        existingApprovalId: target.mode === 'overwrite' ? target.approvalId : null,
//        onProgress: (pct, label) => SubmitGuard.setProgress(10 + Math.round(pct*0.85), label),
//      });
//      SubmitGuard.markSubmitted(id, { woNumber: base.woNumber, executionDate: base.executionDate, checkedBy: base.checkedBy });
//    } finally { SubmitGuard.hideProgress(); }
// ============================================================

const SubmitGuard = (function () {
  let _config = null;
  let _domReady = false;
  let _sessionLast = null; // {id, woNumber, executionDate, checkedBy, createdAt} — this TAB's last successful submit for this asset
  let _choiceResolve = null;
  let _pendingTargetId = null;
  let _pendingApprovalId = null;
  let _busy = false; // true from the instant resolveSubmitTarget() is called until hideProgress() (or a cancel) — see the reentrancy note below

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
#sg-choice-overlay,#sg-progress-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.85);z-index:25000;
  align-items:center;justify-content:center;backdrop-filter:blur(4px);padding:16px;
  font-family:'Barlow',system-ui,sans-serif}
#sg-choice-overlay.show,#sg-progress-overlay.show{display:flex}
.sg-box{background:#fff;border-radius:14px;width:min(440px,100%);overflow:hidden;
  box-shadow:0 20px 60px rgba(0,0,0,.35);color:#0f172a}
.sg-hdr{background:linear-gradient(90deg,#1e3a5f,#0f2744);padding:16px 20px}
.sg-title{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:16px;color:#7dd3fc;letter-spacing:1px}
.sg-body{padding:18px 20px}
.sg-meta{font-size:12.5px;color:#475569;background:#f0f7ff;border:1px solid #dbeafe;border-radius:8px;
  padding:10px 12px;line-height:1.5;margin-bottom:14px;font-family:'Share Tech Mono',monospace}
.sg-question{font-size:13.5px;color:#0f172a;margin-bottom:16px;line-height:1.5}
.sg-actions{display:flex;flex-direction:column;gap:8px}
.sg-btn{padding:11px 16px;border-radius:8px;border:1.5px solid #dbeafe;background:#fff;color:#1e3a5f;
  font-weight:700;font-size:13px;cursor:pointer;text-align:left;display:flex;flex-direction:column;gap:2px}
.sg-btn:hover{border-color:#2563eb}
.sg-btn small{font-weight:400;color:#64748b;font-size:11px}
.sg-btn-pri{background:#eff6ff;border-color:#2563eb}
.sg-btn-danger{background:#fff1f2;border-color:#fecdd3}
.sg-btn-danger:hover{border-color:#f43f5e}
.sg-cancel{width:100%;background:none;border:none;color:#64748b;font-size:12px;margin-top:12px;cursor:pointer}
.sg-progress-body{padding:26px 24px 24px;text-align:center}
.sg-progress-icon{font-size:32px;margin-bottom:10px}
.sg-progress-label{font-size:13px;color:#334155;margin-bottom:14px;min-height:18px}
.sg-progress-track{width:100%;height:14px;background:#e2e8f0;border-radius:999px;overflow:hidden;margin-bottom:8px}
.sg-progress-bar{height:100%;width:0%;background:linear-gradient(90deg,#2563eb,#7dd3fc);border-radius:999px;
  transition:width .25s ease}
.sg-progress-pct{font-family:'Share Tech Mono',monospace;font-size:13px;font-weight:700;color:#1e3a5f}
.sg-progress-hint{font-size:11px;color:#94a3b8;margin-top:10px}
    `;
    document.head.appendChild(style);

    const choiceOverlay = document.createElement('div');
    choiceOverlay.id = 'sg-choice-overlay';
    choiceOverlay.innerHTML = `
      <div class="sg-box">
        <div class="sg-hdr"><div class="sg-title">SUBMISSION SERUPA DITEMUKAN</div></div>
        <div class="sg-body">
          <div class="sg-meta" id="sg-choice-meta">—</div>
          <div class="sg-question">Sepertinya ini submission untuk visit yang sama. Pilih salah satu:</div>
          <div class="sg-actions">
            <button class="sg-btn sg-btn-danger" onclick="SubmitGuard._chooseOverwrite()">
              &#9888;&#65039; Timpa Data Sebelumnya
              <small>Update submission yang sudah ada — tidak membuat data baru. Data lama akan diganti sepenuhnya.</small>
            </button>
            <button class="sg-btn sg-btn-pri" onclick="SubmitGuard._chooseInsert()">
              &#128203; Buat Submission Baru
              <small>Simpan sebagai data terpisah — dua submission akan ada di database.</small>
            </button>
          </div>
          <button class="sg-cancel" onclick="SubmitGuard._chooseCancel()">&larr; Batal, saya cek ulang dulu</button>
        </div>
      </div>`;
    document.body.appendChild(choiceOverlay);

    const progressOverlay = document.createElement('div');
    progressOverlay.id = 'sg-progress-overlay';
    progressOverlay.innerHTML = `
      <div class="sg-box">
        <div class="sg-progress-body">
          <div class="sg-progress-icon">⏳</div>
          <div class="sg-progress-label" id="sg-progress-label">Memulai...</div>
          <div class="sg-progress-track"><div class="sg-progress-bar" id="sg-progress-bar"></div></div>
          <div class="sg-progress-pct" id="sg-progress-pct">0%</div>
          <div class="sg-progress-hint">Jangan tutup atau refresh halaman ini sampai selesai.</div>
        </div>
      </div>`;
    document.body.appendChild(progressOverlay);
  }

  // submitFnName: most check sheets' submit button is onclick="submitToDb()"
  // — a handful (e.g. GEN_BrushGear_PM_Checksheet.html's saveToDatabase())
  // use a different name, so this is overridable per file rather than
  // hardcoded.
  function init(config) {
    _config = Object.assign({ assetTag: null, submitFnName: 'submitToDb' }, config);
    injectDom();
  }

  function _submitBtnSelector() {
    return '[onclick="' + ((_config && _config.submitFnName) || 'submitToDb') + '()"]';
  }
  function _lockButtons() {
    document.querySelectorAll(_submitBtnSelector()).forEach(b => b.disabled = true);
  }
  function _unlockButtons() {
    document.querySelectorAll(_submitBtnSelector()).forEach(b => b.disabled = false);
  }

  // Decides insert vs. overwrite vs. cancel. See the file header for the
  // full usage snippet — call this BEFORE DB.save()/DB.update().
  //
  // Two ways a "same visit" candidate is found, cheapest first:
  //   1. Session-local: this exact browser tab already submitted for this
  //      asset earlier in the session (markSubmitted() below) — no network
  //      round-trip needed, and definitely still relevant since the form is
  //      still open.
  //   2. Firestore: a submission already exists for this asset tag with the
  //      SAME WO number (covers reopening the check sheet in a fresh tab
  //      later the same day/visit). Only searched when a WO number was
  //      actually typed — an empty WO number has nothing reliable to match
  //      against, so only the session-local check applies in that case.
  //
  // Either way, "Overwrite" is only ever OFFERED when the candidate's own
  // approvals record (if any) is still at status 'submitted' — nothing
  // reviewed/approved/returned is ever silently at risk of being
  // overwritten. If no candidate is found, or overwrite isn't safe, this
  // resolves straight to {mode:'insert'} with no prompt at all — the
  // common case (a genuinely new visit) is never interrupted.
  // Reentrancy + instant-feedback guard: everything from here to the button
  // click's next tick is still SYNCHRONOUS (an async function runs
  // synchronously up to its first `await`), so _busy/_lockButtons()/
  // showProgress() all take effect in the very same tick the technician
  // clicked Submit — before the Firestore round-trip below even starts.
  // This closes the exact gap that let a technician re-click Submit during
  // the "checking for a duplicate" network call (no visual feedback yet,
  // buttons not yet disabled by the caller's own code) and create a real
  // second submission: a second resolveSubmitTarget() call made anywhere in
  // that window now sees _busy===true synchronously and resolves straight
  // to {mode:'cancel'} with no further work, regardless of how slow the
  // network call turns out to be or whether the button's own `disabled`
  // attribute has visually taken effect yet.
  async function resolveSubmitTarget(woNumber) {
    if (!_config) throw new Error('SubmitGuard.init({assetTag}) belum dipanggil.');
    if (_busy) return { mode: 'cancel' };
    _busy = true;
    _lockButtons();
    showProgress();
    setProgress(0, 'Memeriksa submission sebelumnya...');

    try {
      // Revision mode: the technician opened this check sheet via
      // `?reviseOf=<approvalId>` (from the Review dashboard's "Perbaiki & kirim
      // ulang" link or the revision banner). A revision ALWAYS overwrites its
      // source approval in place — no "same visit?" WO matching, no choice
      // modal. approval-helper.js then flips a 'returned_to_technician' source
      // to 'revised' and keeps the return note as history.
      let reviseOfId = null;
      try { reviseOfId = window.LoadMergeModal && LoadMergeModal.getReviseOfApprovalId && LoadMergeModal.getReviseOfApprovalId(); } catch (e) {}
      if (reviseOfId && typeof Approvals !== 'undefined') {
        try {
          setProgress(0, 'Menyiapkan revisi...');
          const src = await Approvals.getById(reviseOfId);
          if (src && src.checksheetId) {
            return { mode: 'overwrite', targetId: src.checksheetId, approvalId: reviseOfId, revision: true };
          }
        } catch (e) { console.error('SubmitGuard: gagal resolve reviseOf', e); }
        // couldn't resolve the source approval — fall through to normal matching
      }

      const wo = (woNumber || '').trim().toLowerCase();

      let candidate = _sessionLast;
      if (candidate && wo && (candidate.woNumber || '').trim().toLowerCase() !== wo) {
        candidate = null; // session's last submit was for a different WO — not relevant to this one
      }

      if (!candidate && wo) {
        try {
          const docs = await DB.getAll({ assetTag: _config.assetTag });
          const match = docs.find(d => (d.woNumber || '').trim().toLowerCase() === wo);
          if (match) candidate = { id: match.id, woNumber: match.woNumber, executionDate: match.executionDate, checkedBy: match.checkedBy, createdAt: match.createdAt };
        } catch (e) { console.error('SubmitGuard: gagal cek submission sebelumnya', e); }
      }

      if (!candidate) return { mode: 'insert' }; // _busy stays true — caller proceeds straight into the real save/upload, hideProgress() clears it

      let approvalId = null, canOverwrite = true;
      try {
        if (typeof Approvals !== 'undefined') {
          const appr = await Approvals.getByChecksheetId(candidate.id);
          if (appr) {
            approvalId = appr.id;
            // Safe to overwrite when nothing a human has reviewed yet: a plain
            // 'submitted', OR a 'reviewed' that was auto-advanced because the
            // submitter is a TechOp2 (review.auto) — no real review to lose.
            const autoReviewed = appr.status === 'reviewed' && appr.review && appr.review.auto;
            if (appr.status !== 'submitted' && !autoReviewed) canOverwrite = false;
          }
        }
      } catch (e) { canOverwrite = false; } // uncertain -> never offer overwrite

      if (!canOverwrite) return { mode: 'insert' };

      // Hide the progress overlay while the choice modal is up (both are
      // full-screen overlays — showing both at once would just stack them),
      // then _chooseInsert()/_chooseOverwrite() bring it back; _chooseCancel()
      // clears _busy and unlocks the buttons instead.
      hideProgressOverlayOnly();
      return await showChoiceModal(candidate, approvalId);
    } catch (e) {
      // Truly unexpected — every known failure point above already has its
      // own try/catch and falls back to {mode:'insert'} on its own, so this
      // is only a last-resort safety net. _busy is intentionally left true;
      // the caller is expected to proceed to DB.save()/DB.update() and
      // eventually call hideProgress(), which is what actually clears it.
      console.error('SubmitGuard: unexpected error in resolveSubmitTarget', e);
      return { mode: 'insert' };
    }
  }

  function showChoiceModal(candidate, approvalId) {
    return new Promise(resolve => {
      injectDom();
      document.getElementById('sg-choice-meta').innerHTML =
        'WO ' + esc(candidate.woNumber || '—') + ' &middot; ' + esc(candidate.executionDate || 'tgl —') +
        ' &middot; oleh ' + esc(candidate.checkedBy || '—') + '<br>Disimpan ' + esc(fmtDate(candidate.createdAt));
      _pendingTargetId = candidate.id;
      _pendingApprovalId = approvalId;
      _choiceResolve = resolve;
      document.getElementById('sg-choice-overlay').classList.add('show');
    });
  }
  function _chooseInsert() {
    document.getElementById('sg-choice-overlay').classList.remove('show');
    showProgress(); // back to the upload progress view now that a choice was made — _busy stays true, caller proceeds to save
    if (_choiceResolve) { _choiceResolve({ mode: 'insert' }); _choiceResolve = null; }
  }
  function _chooseOverwrite() {
    document.getElementById('sg-choice-overlay').classList.remove('show');
    showProgress();
    if (_choiceResolve) { _choiceResolve({ mode: 'overwrite', targetId: _pendingTargetId, approvalId: _pendingApprovalId }); _choiceResolve = null; }
  }
  function _chooseCancel() {
    document.getElementById('sg-choice-overlay').classList.remove('show');
    _busy = false;
    _unlockButtons();
    if (_choiceResolve) { _choiceResolve({ mode: 'cancel' }); _choiceResolve = null; }
  }

  // Call once a submission has actually succeeded, so a second click in the
  // SAME tab (e.g. the technician immediately notices a typo and resubmits)
  // is recognized without needing a Firestore round-trip.
  function markSubmitted(id, meta) {
    _sessionLast = Object.assign({ id }, meta || {});
  }

  function showProgress() {
    injectDom();
    document.getElementById('sg-progress-overlay').classList.add('show');
    setProgress(0, 'Memulai...');
  }
  function setProgress(pct, label) {
    const clamped = Math.max(0, Math.min(100, Math.round(pct)));
    const bar = document.getElementById('sg-progress-bar');
    const pctEl = document.getElementById('sg-progress-pct');
    const lblEl = document.getElementById('sg-progress-label');
    if (bar) bar.style.width = clamped + '%';
    if (pctEl) pctEl.textContent = clamped + '%';
    if (lblEl && label) lblEl.textContent = label;
  }
  // Hides just the progress overlay's visibility, WITHOUT clearing _busy or
  // unlocking buttons — used only for the brief window the choice modal is
  // shown instead (see resolveSubmitTarget()). The public hideProgress()
  // below is the real "submit is fully done" signal.
  function hideProgressOverlayOnly() {
    const el = document.getElementById('sg-progress-overlay');
    if (el) el.classList.remove('show');
  }
  function hideProgress() {
    hideProgressOverlayOnly();
    _busy = false;
    _unlockButtons();
  }

  return {
    init, resolveSubmitTarget, markSubmitted,
    showProgress, setProgress, hideProgress,
    _chooseInsert, _chooseOverwrite, _chooseCancel,
  };
})();
