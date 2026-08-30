// ============================================================
//  Approval Helper — the review/approval workflow's own collection.
//
//  Deliberately a SEPARATE collection ('approvals'), not fields bolted onto
//  a checksheet doc, so the append-only 'checksheets' collection (relied on
//  by dashboard.html's trend charts, dedupe, exports — see CLAUDE.md) never
//  has to be mutated for workflow state. One approvals doc per submission,
//  referencing checksheetId. Unlike DB.save() this collection IS mutated in
//  place (status/review/approval change over the doc's life) — that's safe
//  here because nothing outside this workflow reads or depends on it.
//
//  Status states: 'submitted' -> 'reviewed' -> 'approved'
//                              -> 'returned_to_technician' (from either
//                                 review or approval stage; see `stage` on
//                                 the returned note for which one)
// ============================================================

// Normalize an `area` value to a single plain string. It can arrive as a real
// string ('Powerblock'), an array (['Powerblock']), or a JSON-stringified
// array ('["Powerblock"]') from localStorage['dashboard_area'] / older docs.
function _firstArea(a) {
  if (Array.isArray(a)) return a[0] || null;
  if (typeof a === 'string' && a) {
    try { const p = JSON.parse(a); if (Array.isArray(p)) return p[0] || null; } catch (e) {}
    return a;
  }
  return null;
}

const Approvals = {
  COLLECTION: 'approvals',

  async create(checksheetId, meta = {}) {
    const data = {
      checksheetId,
      assetTag: meta.assetTag || '',
      assetName: meta.assetName || '',
      checksheetFile: meta.checksheetFile || '',   // e.g. 'PLTS_AshDisposal_PM.html' — lets the review dashboard link back to the right form for revisions
      submittedBy: meta.submittedBy || '',
      revisionOf: meta.revisionOf || null,          // approvals doc id this supersedes, if any
      // Explicit review routing — set for manual uploads (and anything else
      // that isn't routed by matching submittedBy to a dashboard_users
      // account). Review_Approval_Dashboard.html's scopeOfApproval() checks
      // these before the name lookup. Omitted (undefined) for normal check
      // sheets, so Firestore just doesn't store the keys.
      ...(meta.team ? { team: meta.team } : {}),
      ...(_firstArea(meta.area) ? { area: _firstArea(meta.area) } : {}),
      ...(meta.src ? { src: meta.src } : {}),
      // When the submitter is themselves a TechOp2 (level 2), the TechOp2
      // review step is auto-completed and the item goes straight to the
      // Supervisor's approval queue (status 'reviewed'). meta.autoReview holds
      // the synthetic review record; absent for a normal technician submit.
      status: meta.autoReview ? 'reviewed' : 'submitted',
      review: meta.autoReview || null,   // {comments, recommendations, signature, reviewedBy, reviewedAt, auto}
      approval: null,     // {notes, signature, approvedBy, approvedAt}
      returnedNote: null, // {note, by, stage, returnedAt}
      finalPdfUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const ref = await db.collection(this.COLLECTION).add(data);
    return ref.id;
  },

  async getAll(filters = {}) {
    let q = db.collection(this.COLLECTION).orderBy('createdAt', 'desc');
    if (filters.status) q = q.where('status', '==', filters.status);
    const snap = await q.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getById(id) {
    const doc = await db.collection(this.COLLECTION).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  async getByChecksheetId(checksheetId) {
    const snap = await db.collection(this.COLLECTION)
      .where('checksheetId', '==', checksheetId)
      .orderBy('createdAt', 'desc').limit(1).get();
    return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
  },

  async submitReview(id, { comments, recommendations, signature, reviewedBy }) {
    await db.collection(this.COLLECTION).doc(id).update({
      status: 'reviewed',
      review: { comments, recommendations, signature, reviewedBy, reviewedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    });
  },

  // stage: 'review' | 'approval' — which step the item bounced back from,
  // so the technician (and dashboard.html) can see who sent it back.
  async returnToTechnician(id, { note, by, stage }) {
    await db.collection(this.COLLECTION).doc(id).update({
      status: 'returned_to_technician',
      returnedNote: { note, by, stage, returnedAt: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    });
  },

  async approve(id, { notes, signature, approvedBy, finalPdfUrl }) {
    await db.collection(this.COLLECTION).doc(id).update({
      status: 'approved',
      approval: { notes, signature, approvedBy, approvedAt: new Date().toISOString() },
      finalPdfUrl,
      updatedAt: new Date().toISOString(),
    });
  },

  // ---- Admin corrections (Review_Approval_Dashboard.html, admin only) ----

  // Undo a "returned to technician" — puts the item back into the queue it
  // came from. stage 'review' -> back to 'submitted' (TechOp2 queue);
  // stage 'approval' -> back to 'reviewed' (Supervisor queue). The review
  // record (if any) is kept when going back to 'reviewed', cleared otherwise.
  async cancelReturn(id, { by } = {}) {
    const cur = await this.getById(id);
    if (!cur) throw new Error('Approval tidak ditemukan.');
    if (cur.status !== 'returned_to_technician') throw new Error('Item ini tidak sedang dikembalikan.');
    const backToReviewed = cur.returnedNote && cur.returnedNote.stage === 'approval' && cur.review;
    await db.collection(this.COLLECTION).doc(id).update({
      status: backToReviewed ? 'reviewed' : 'submitted',
      review: backToReviewed ? cur.review : null,
      returnedNote: null,
      adminNote: { action: 'cancel-return', by: by || '', at: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    });
  },

  // Undo a completed review — item drops back to the TechOp2 review queue
  // ('submitted') and the review record is discarded.
  async cancelReview(id, { by } = {}) {
    const cur = await this.getById(id);
    if (!cur) throw new Error('Approval tidak ditemukan.');
    if (cur.status !== 'reviewed') throw new Error('Item ini belum/tidak berstatus reviewed.');
    await db.collection(this.COLLECTION).doc(id).update({
      status: 'submitted',
      review: null,
      adminNote: { action: 'cancel-review', by: by || '', at: new Date().toISOString() },
      updatedAt: new Date().toISOString(),
    });
  },

  // Edit routing / display fields on the approval doc (name, team, area).
  // area is normalized to a single plain string (see _firstArea).
  async adminEditRouting(id, { submittedBy, team, area, by } = {}) {
    const patch = { updatedAt: new Date().toISOString(),
      adminNote: { action: 'edit-routing', by: by || '', at: new Date().toISOString() } };
    if (submittedBy !== undefined) patch.submittedBy = String(submittedBy || '').trim();
    if (team !== undefined) patch.team = team ? String(team).trim() : null;
    if (area !== undefined) patch.area = _firstArea(area) || null;
    await db.collection(this.COLLECTION).doc(id).set(patch, { merge: true });
  },

  async deleteById(id) {
    await db.collection(this.COLLECTION).doc(id).delete();
  },

  // Generic "wire this check sheet into the review/approval workflow"
  // entry point — call once from submitToDb()/saveToDatabase() AFTER
  // DB.save() has already succeeded and returned checksheetId. Uploads
  // every evidence photo + the archival PDF to Drive (via storage-helper.js
  // — must be loaded alongside firebase-storage's replacement, see that
  // file's header), attaches the resulting URLs to the checksheet doc, and
  // creates the approvals record. This mirrors PLTS_AshDisposal_PM.html's
  // hand-written version (see CLAUDE.md) but generalized so every other
  // check sheet can call ONE function instead of re-implementing it.
  //
  // opts:
  //   photos: {groupKey: [{src, caption}, ...]} — same shape PhotoKit /
  //     hand-rolled PHOTOS objects already use across this codebase. Pass
  //     null/undefined (or {}) for a sheet with no photo feature yet — the
  //     upload loop just does nothing, no error.
  //   pdfBuilder: async () => jsPDF — must return an already-built jsPDF
  //     object WITHOUT calling .save()/.output() itself (the sheet's own
  //     generatePDF() called in a "silent"/"no download" mode — see
  //     PLTS_AshDisposal_PM.html's opts.silent for the pattern). Pass null
  //     to skip PDF upload (e.g. sheet has no jsPDF export yet).
  //   assetTag, assetName, checksheetFile, submittedBy, revisionOf: same
  //     meaning as create()'s meta.
  //   existingApprovalId: set by submit-guard.js when the technician chose
  //     "Overwrite" over a fresh submission (see that file) — updates that
  //     SAME approvals doc in place (refreshing its photoUrls/pdfUrl-linked
  //     checksheet, submittedBy, and updatedAt) instead of calling create(),
  //     so overwriting a submission never leaves a second, duplicate
  //     approvals doc behind. submit-guard.js only ever offers this when
  //     the target approval's status is still 'submitted' (nothing reviewed
  //     yet), so this never overwrites real review/approval history — the
  //     status is deliberately reset to 'submitted' here regardless of what
  //     it already was, since an overwrite always means "the technician has
  //     new data for you to look at."
  //   onProgress: optional (pct:0-100, label:string) => void, called as
  //     photos upload (proportional to count), then the PDF, then the
  //     approvals record — lets the caller drive a real progress bar
  //     instead of a guessed animation. Never called if omitted.
  //   autoReview: pass false to force the normal review path even when the
  //     submitter is a TechOp2. Otherwise this is decided automatically from
  //     window.AuthSession.get(): a logged-in TechOp2 (role 'techop2')
  //     submitting their own work skips the review stage — the approvals doc
  //     is created at status 'reviewed' with a synthetic review record
  //     ({reviewedBy, reviewedAt, signature, auto:true}) so it goes straight
  //     to the Supervisor's approval queue. team/area are also backfilled
  //     from the session here when the caller didn't pass them.
  //
  // Returns true if photos/PDF/approval record all succeeded, false if
  // any part failed (logged to console) — the checksheet doc itself was
  // ALREADY saved by the caller before this runs, so a false return here
  // must never be treated as "the whole submission failed."
  async submitWithFiles(checksheetId, opts = {}) {
    const { photos, pdfBuilder, assetTag, assetName, checksheetFile, submittedBy, revisionOf, existingApprovalId, onProgress, src } = opts;
    let { team, area } = opts;
    const report = (pct, label) => { if (typeof onProgress === 'function') onProgress(pct, label); };
    let ok = true;

    // Who is submitting? A logged-in TechOp2 (level 2) submitting their own
    // work skips the TechOp2 review stage — the approval is created already
    // 'reviewed' so it lands straight in the Supervisor's approval queue.
    // Also backfills team/area routing from the session when the caller
    // didn't pass them. Fully optional: no session / plain technician =>
    // unchanged 'submitted' behaviour.
    let autoReview = null;
    try {
      const sess = (typeof window !== 'undefined' && window.AuthSession && window.AuthSession.get) ? window.AuthSession.get() : null;
      if (sess) {
        if (!team && sess.team) team = sess.team;
        // sess.area can be a string, an array, or a JSON-stringified array
        // ('["Powerblock"]') — normalize all three to the single area string
        // the approval doc / scope matching expect. team-routing.js isn't
        // loaded on check sheets, so parse inline.
        if (!area && sess.area) area = _firstArea(sess.area);
        if (opts.autoReview !== false && sess.role === 'techop2') {
          const who = sess.name || submittedBy || 'TechOp2';
          autoReview = {
            comments: 'Disubmit langsung oleh TechOp2 (' + who + ') — tahap review dilewati otomatis.',
            recommendations: '',
            signature: sess.signature || null,
            reviewedBy: who,
            reviewedAt: new Date().toISOString(),
            auto: true,
          };
        }
      }
    } catch (e) { /* session lookup is best-effort */ }
    try {
      const photoUrls = {};
      const groups = Object.keys(photos || {});
      const totalPhotos = groups.reduce((n, k) => n + (photos[k] || []).length, 0);
      let uploadedPhotos = 0;
      if (totalPhotos) report(0, 'Mengunggah foto...');
      for (const key of groups) {
        const list = photos[key] || [];
        if (!list.length) continue;
        const urls = [];
        for (let i = 0; i < list.length; i++) {
          const p = list[i];
          if (!p || !p.src) continue;
          const url = await Storage.uploadDataUrl(
            `checksheets/${checksheetId}/photos/${key}-${i}.jpg`, p.src, 'image/jpeg'
          );
          // w/h/widthCm/heightCm ride along so a later restore (revision
          // banner / Load & Merge — see load-merge-modal.js's
          // restorePhotosFromUrls hook) can recreate the exact same PhotoKit
          // entry shape, not just the picture. Per CLAUDE.md's "Photos"
          // section: without these, a restored photo falls back to
          // PhotoKit's default box instead of the crop the technician
          // actually chose. Harmless if the source entry doesn't have them
          // (older photos, or a sheet not using PhotoKit) — just omitted.
          urls.push({
            url, caption: p.caption || '',
            ...(p.w != null ? { w: p.w } : {}),
            ...(p.h != null ? { h: p.h } : {}),
            ...(p.widthCm != null ? { widthCm: p.widthCm } : {}),
            ...(p.heightCm != null ? { heightCm: p.heightCm } : {}),
          });
          uploadedPhotos++;
          if (totalPhotos) report(Math.round((uploadedPhotos / totalPhotos) * 70), `Mengunggah foto ${uploadedPhotos}/${totalPhotos}...`);
        }
        if (urls.length) photoUrls[key] = urls;
      }

      let pdfUrl = null;
      if (typeof pdfBuilder === 'function') {
        report(72, 'Membuat PDF arsip...');
        const pdf = await pdfBuilder();
        const blob = pdf.output('blob');
        report(80, 'Mengunggah PDF...');
        pdfUrl = await Storage.uploadBlob(`checksheets/${checksheetId}/original.pdf`, blob, 'application/pdf');
      }

      if (Object.keys(photoUrls).length || pdfUrl) {
        report(90, 'Menyimpan tautan file...');
        await DB.attachFiles(checksheetId, {
          ...(Object.keys(photoUrls).length ? { photoUrls } : {}),
          ...(pdfUrl ? { pdfUrl } : {}),
        });
      }

      report(95, 'Mencatat status approval...');
      if (existingApprovalId) {
        // Was this the "returned to technician" entry being re-submitted after
        // a fix? If so, the resubmit is a REVISION: the returned entry is
        // overwritten in place (new checksheetId/photos/pdf), its status
        // becomes 'revised' (a distinct, re-review-pending state — or straight
        // to 'reviewed' when the reviser is a TechOp2 auto-review), and the
        // return note is moved into returnedHistory[] so the trail survives.
        let prev = null;
        try { prev = await this.getById(existingApprovalId); } catch (e) { /* best effort */ }
        const wasReturned = prev && prev.status === 'returned_to_technician';
        const patch = {
          checksheetId,
          assetTag: assetTag || '', assetName: assetName || '', checksheetFile: checksheetFile || '',
          submittedBy: submittedBy || '',
          ...(team ? { team } : {}), ...(area ? { area } : {}),
          updatedAt: new Date().toISOString(),
        };
        if (wasReturned) {
          patch.status = autoReview ? 'reviewed' : 'revised';
          patch.review = autoReview || null;                  // discard the old (pre-return) review; a revision needs a fresh one
          patch.revisedAt = new Date().toISOString();
          patch.revisionCount = (prev.revisionCount || 0) + 1;
          const hist = Array.isArray(prev.returnedHistory) ? prev.returnedHistory.slice() : [];
          if (prev.returnedNote) hist.push(prev.returnedNote);
          patch.returnedHistory = hist;
          patch.returnedNote = null;
        } else {
          patch.status = autoReview ? 'reviewed' : 'submitted';
          if (autoReview) patch.review = autoReview;
        }
        await db.collection(this.COLLECTION).doc(existingApprovalId).set(patch, { merge: true });
      } else {
        await this.create(checksheetId, { assetTag, assetName, checksheetFile, submittedBy, revisionOf, team, area, src, autoReview });
      }
      report(100, 'Selesai');
    } catch (e) {
      ok = false;
      console.error('Approvals.submitWithFiles gagal:', e);
    }
    return ok;
  },

  STATUS_LABELS: {
    submitted: 'Menunggu Review',
    revised: 'Direvisi',
    reviewed: 'Menunggu Approval',
    approved: 'Disetujui',
    returned_to_technician: 'Dikembalikan ke Teknisi',
  },

  // A 'revised' entry is behaviourally identical to 'submitted' for queueing /
  // permissions — it's a distinct label only so reviewers can see the item
  // has been through a return→revise cycle. Everywhere the code asks "is this
  // waiting for TechOp2 review", use this instead of `=== 'submitted'`.
  isPendingReview(status) { return status === 'submitted' || status === 'revised'; },
};
