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
      status: 'submitted',
      review: null,       // {comments, recommendations, signature, reviewedBy, reviewedAt}
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

  async deleteById(id) {
    await db.collection(this.COLLECTION).doc(id).delete();
  },

  STATUS_LABELS: {
    submitted: 'Menunggu Review',
    reviewed: 'Menunggu Approval',
    approved: 'Disetujui',
    returned_to_technician: 'Dikembalikan ke Teknisi',
  },
};
