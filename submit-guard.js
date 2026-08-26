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
//  Usage — one script include (after db-helper.js and approval-helper.js,
//  since it calls into both) + one init() call:
//    <script src="db-helper.js"></script>
//    <script src="approval-helper.js"></script>
//    <script src="submit-guard.js"></script>
//    ...
//    <script> SubmitGuard.init({ assetTag: 'XXX-TAG' }); </script>
//
//  Then inside submitToDb(), BEFORE calling DB.save():
//    const target = await SubmitGuard.resolveSubmitTarget(base.woNumber);
//    if(target.mode === 'cancel') return;
//    SubmitGuard.showProgress();
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

  function init(config) {
    _config = Object.assign({ assetTag: null }, config);
    injectDom();
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
  async function resolveSubmitTarget(woNumber) {
    if (!_config) throw new Error('SubmitGuard.init({assetTag}) belum dipanggil.');
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

    if (!candidate) return { mode: 'insert' };

    let approvalId = null, canOverwrite = true;
    try {
      if (typeof Approvals !== 'undefined') {
        const appr = await Approvals.getByChecksheetId(candidate.id);
        if (appr) {
          approvalId = appr.id;
          if (appr.status !== 'submitted') canOverwrite = false;
        }
      }
    } catch (e) { canOverwrite = false; } // uncertain -> never offer overwrite

    if (!canOverwrite) return { mode: 'insert' };

    return showChoiceModal(candidate, approvalId);
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
    if (_choiceResolve) { _choiceResolve({ mode: 'insert' }); _choiceResolve = null; }
  }
  function _chooseOverwrite() {
    document.getElementById('sg-choice-overlay').classList.remove('show');
    if (_choiceResolve) { _choiceResolve({ mode: 'overwrite', targetId: _pendingTargetId, approvalId: _pendingApprovalId }); _choiceResolve = null; }
  }
  function _chooseCancel() {
    document.getElementById('sg-choice-overlay').classList.remove('show');
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
  function hideProgress() {
    const el = document.getElementById('sg-progress-overlay');
    if (el) el.classList.remove('show');
  }

  return {
    init, resolveSubmitTarget, markSubmitted,
    showProgress, setProgress, hideProgress,
    _chooseInsert, _chooseOverwrite, _chooseCancel,
  };
})();
