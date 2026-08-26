// ============================================================
//  Database Helper — Save, Load, Export for Check Sheets
// ============================================================

const DB = {
  COLLECTION: 'checksheets',

  // A technician re-submitting the same job to make sure it isn't lost creates
  // a brand-new Firestore document every time (save() always .add()s, never
  // updates) — so without de-duplication, the dashboard's stats/charts/table
  // count the same PM job 2x, 5x, sometimes 19x. See DEDUP_LATEST_SUBMISSION.md
  // for the full writeup, the real-data evidence, and how to port this to
  // another project's own "list latest submissions" query.
  //
  // Grouping on (assetTag, woNumber, executionDate) alone is NOT safe: some
  // check sheets pre-fill executionDate from the last draft, and a technician
  // can leave it unedited across REAL, DIFFERENT weekly visits — confirmed
  // directly against production data (one group of 16 "same" submissions
  // actually spanned two real weeks with different results each time). Two
  // submissions only count as "the same visit, resubmitted" if their
  // createdAt timestamps are also close together; CLUSTER_GAP_HOURS is that
  // cutoff. Real data shows a clean split: genuine resubmissions land within
  // ~21h of each other, genuinely different visits sharing a stale date are
  // ≥70h apart — 24h sits safely in that gap.
  CLUSTER_GAP_HOURS: 24,

  // Keeps the newest document per "visit cluster": documents that share
  // (assetTag, woNumber, executionDate) AND whose createdAt timestamps are
  // within CLUSTER_GAP_HOURS of their neighbors collapse to just the latest
  // one. A document missing assetTag or woNumber can't be grouped safely and
  // is always kept as its own row, rather than risking merging two unrelated
  // submissions under an empty key.
  dedupeLatest(docs) {
    const groups = new Map();
    docs.forEach(d => {
      const tag = (d.assetTag || '').trim();
      const wo = (d.woNumber || '').trim();
      if (!tag || !wo) return;
      const key = tag + '||' + wo + '||' + (d.executionDate || '').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });

    const keep = new Set();
    const gapMs = this.CLUSTER_GAP_HOURS * 3600 * 1000;
    groups.forEach(list => {
      const sorted = [...list].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      for (let i = 0; i < sorted.length; i++) {
        const isClusterEnd = i === sorted.length - 1 ||
          (new Date(sorted[i + 1].createdAt || 0) - new Date(sorted[i].createdAt || 0)) > gapMs;
        if (isClusterEnd) keep.add(sorted[i]);   // newest doc in this cluster (ascending sort -> last)
      }
    });

    return docs.filter(d => {
      const tag = (d.assetTag || '').trim();
      const wo = (d.woNumber || '').trim();
      return (!tag || !wo) || keep.has(d);
    });
  },

  async save(data) {
    data.submittedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.createdAt = new Date().toISOString();
    const ref = await db.collection(this.COLLECTION).add(data);
    return ref.id;
  },

  // The "Overwrite" half of submit-guard.js's insert-vs-overwrite prompt —
  // the only other place (besides attachFiles) an existing checksheet doc
  // is ever mutated rather than .add()'d. Deliberately preserves the
  // ORIGINAL createdAt (fetched from the doc being replaced) rather than
  // stamping a new one: the whole point of choosing "overwrite" is "this is
  // still the same visit, just corrected data", so anything that reads
  // createdAt to mean "when did this visit happen" (dedupe clustering,
  // dashboard trend charts, sort order) keeps working correctly across an
  // overwrite. `updatedAt` records when the overwrite itself happened.
  // Full replace via .set() (no {merge:true}) — an overwrite is meant to
  // wholly replace what's there, same as re-submitting the form from
  // scratch would, not patch a few fields.
  async update(id, data) {
    const existing = await this.getById(id);
    data.createdAt = existing?.createdAt || new Date().toISOString();
    data.submittedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.updatedAt = new Date().toISOString();
    await db.collection(this.COLLECTION).doc(id).set(data);
    return id;
  },

  async getAll(filters = {}) {
    let query = db.collection(this.COLLECTION).orderBy('createdAt', 'desc');
    if (filters.assetTag) query = query.where('assetTag', '==', filters.assetTag);
    if (filters.status) query = query.where('overallStatus', '==', filters.status);
    const snap = await query.get();
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Raw by default — dashboard.html keeps its own `allDataRaw` (exactly this
    // list, duplicates included) so its "Submission terbaru saja" toggle can
    // switch views without a network round-trip; call dedupeLatest() yourself
    // (or pass {dedupe:true}) where you specifically want the collapsed view.
    return filters.dedupe === true ? this.dedupeLatest(docs) : docs;
  },

  async getById(id) {
    const doc = await db.collection(this.COLLECTION).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
  },

  // The ONE place a checksheet doc is ever touched after save() — every
  // other write in this codebase is an immutable .add(). This exists only
  // for the review/approval workflow to attach Storage URLs (photoUrls,
  // pdfUrl) onto a doc once its id is known post-save (Storage paths are
  // keyed by doc id, so the upload can only happen after save() returns).
  // {merge:true} so it can ONLY add/overwrite the exact keys passed in —
  // it can never accidentally drop or replace the rest of a submission's
  // data, keeping every existing reader (dashboard trend charts, exports,
  // dedupe) safe against a field set they don't know about.
  async attachFiles(id, patch) {
    await db.collection(this.COLLECTION).doc(id).set(patch, { merge: true });
  },

  async deleteById(id) {
    await db.collection(this.COLLECTION).doc(id).delete();
    return true;
  },

  async deleteMultiple(ids) {
    const batch = db.batch();
    ids.forEach(id => {
      const ref = db.collection(this.COLLECTION).doc(id);
      batch.delete(ref);
    });
    await batch.commit();
    return true;
  },

  async getStats() {
    const snap = await db.collection(this.COLLECTION).get();
    const docs = snap.docs.map(d => d.data());
    const total = docs.length;
    const byAsset = {};
    const byMonth = {};
    let totalOk = 0, totalNg = 0, totalNa = 0;

    docs.forEach(d => {
      const tag = d.assetTag || 'Unknown';
      if (!byAsset[tag]) byAsset[tag] = { total: 0, ok: 0, ng: 0 };
      byAsset[tag].total++;

      const ok = parseInt(d.countOk) || 0;
      const ng = parseInt(d.countNg) || 0;
      const na = parseInt(d.countNa) || 0;
      totalOk += ok;
      totalNg += ng;
      totalNa += na;
      byAsset[tag].ok += ok;
      byAsset[tag].ng += ng;

      const month = (d.executionDate || d.createdAt || '').substring(0, 7);
      if (month) {
        if (!byMonth[month]) byMonth[month] = { submissions: 0, ok: 0, ng: 0 };
        byMonth[month].submissions++;
        byMonth[month].ok += ok;
        byMonth[month].ng += ng;
      }
    });

    return { total, totalOk, totalNg, totalNa, byAsset, byMonth };
  },

  // ── Enhanced data collection with full state preservation ──
  collectCheckSheetData(formId, assetTag, assetName, frequency) {
    const data = {
      assetTag,
      assetName,
      frequency,
      woNumber: document.getElementById('wo-no')?.value || '',
      executionDate: document.getElementById('wo-date')?.value || '',
      timeStart: document.getElementById('time-start')?.value || '',
      timeEnd: document.getElementById('time-end')?.value || '',
      checkedBy: document.getElementById('checked-by')?.value || '',
      nik: document.getElementById('nik')?.value || '',
      reviewedBy: document.getElementById('reviewed-by')?.value || '',
      shift: document.getElementById('shift')?.value || '',
      items: [],
      countOk: 0,
      countNg: 0,
      countNa: 0,
      overallStatus: 'OK'
    };

    // ── Save toggle states (ST or resultState object) for exact restoration ──
    if (typeof ST !== 'undefined' && ST !== null && Object.keys(ST).length > 0) {
      data.toggleStates = Object.assign({}, ST);
    } else if (typeof resultState !== 'undefined' && resultState !== null && Object.keys(resultState).length > 0) {
      data.toggleStates = Object.assign({}, resultState);
    }

    // ── Save all input values by ID for exact restoration ──
    const inputValues = {};
    document.querySelectorAll('input[type=number], input[type=text], input[type=date], select, textarea').forEach(input => {
      if (input.id && input.value) {
        inputValues[input.id] = input.value;
      }
    });
    data.inputValues = inputValues;

    // ── Collect items with column context ──
    // Helper: determine column header for a button's cell
    function getColumnHeader(btn) {
      const td = btn.closest('td');
      if (!td) return '';
      const tr = td.closest('tr');
      const table = td.closest('table');
      if (!tr || !table) return '';
      const tdIndex = [...tr.children].indexOf(td);
      const thead = table.querySelector('thead tr');
      if (thead && tdIndex >= 0 && thead.children[tdIndex]) {
        return thead.children[tdIndex].textContent.trim();
      }
      return '';
    }

    // Helper: extract toggle ID from onclick attribute
    function getToggleId(btn) {
      const onclick = btn.getAttribute('onclick') || '';
      const match = onclick.match(/(?:setBtn|setT|setResult|setLC)\(\s*'([^']+)'/);
      return match ? match[1] : '';
    }

    // Collect .r-btn.active (BYC125 style)
    document.querySelectorAll('.r-btn.active').forEach(btn => {
      const row = btn.closest('tr');
      if (!row) return;
      const labelCell = row.querySelector('.lbl, .task-desc, td:nth-child(2)');
      const label = labelCell ? labelCell.textContent.trim() : '';
      const isOk = btn.classList.contains('ok-btn') || btn.textContent.trim() === 'OK';
      const isNg = btn.classList.contains('ng-btn') || btn.textContent.trim() === 'NG';
      const isNa = btn.classList.contains('na-btn') || btn.textContent.trim() === 'N/A';

      if (isOk) data.countOk++;
      if (isNg) data.countNg++;
      if (isNa) data.countNa++;

      const toggleId = getToggleId(btn) || btn.dataset.id || '';
      const column = getColumnHeader(btn);

      data.items.push({
        label,
        result: isOk ? 'OK' : isNg ? 'NG' : 'N/A',
        id: toggleId,
        column: column
      });
    });

    // Collect .rb.ok-act / .rb.ng-act (most checksheets)
    document.querySelectorAll('.rb.ok-act, .rb.ng-act').forEach(btn => {
      const row = btn.closest('tr');
      if (!row) return;
      const labelCell = row.querySelector('.lbl, .task-desc, td:nth-child(2)');
      const label = labelCell ? labelCell.textContent.trim() : '';
      const isOk = btn.classList.contains('ok-act');
      const isNg = btn.classList.contains('ng-act');

      if (isOk) data.countOk++;
      if (isNg) data.countNg++;

      const toggleId = getToggleId(btn) || btn.dataset.id || '';
      const column = getColumnHeader(btn);

      data.items.push({
        label,
        result: isOk ? 'OK' : 'NG',
        id: toggleId,
        column: column
      });
    });

    if (data.countNg > 0) data.overallStatus = 'NG';

    // ── Collect measurements with ID ──
    const measurements = [];
    document.querySelectorAll('.mi, .meas-input').forEach(input => {
      if (input.value) {
        const row = input.closest('tr');
        const labelCell = row ? row.querySelector('.lbl, .task-desc, td:nth-child(2)') : null;
        const label = labelCell ? labelCell.textContent.trim() : input.name || input.id || '';

        // Get column header
        let column = '';
        const td = input.closest('td');
        if (td && row) {
          const table = td.closest('table');
          const tdIndex = [...row.children].indexOf(td);
          const thead = table?.querySelector('thead tr');
          if (thead && tdIndex >= 0 && thead.children[tdIndex]) {
            column = thead.children[tdIndex].textContent.trim();
          }
        }

        measurements.push({
          id: input.id || '',
          label,
          value: input.value,
          unit: input.dataset.unit || '',
          column: column
        });
      }
    });
    data.measurements = measurements;

    // ── Collect findings/recommendations ──
    const findings = document.getElementById('findings')?.value ||
                     document.querySelector('textarea[placeholder*="finding" i], textarea[placeholder*="temuan" i]')?.value || '';
    const recommendations = document.getElementById('recommendations')?.value ||
                            document.querySelector('textarea[placeholder*="recommend" i], textarea[placeholder*="rekomendasi" i]')?.value || '';
    data.findings = findings;
    data.recommendations = recommendations;

    return data;
  },

  // ── Load last submission back into a checksheet ──
  async loadLastSubmission(assetTag, options = {}) {
    try {
      const snap = await db.collection('checksheets')
        .where('assetTag', '==', assetTag)
        .orderBy('createdAt', 'desc').limit(1).get();
      if (snap.empty) return null;

      const d = snap.docs[0].data();

      // Restore header fields
      const headerMap = {
        'wo-no': d.woNumber,
        'wo-date': d.executionDate,
        'time-start': d.timeStart,
        'time-end': d.timeEnd,
        'checked-by': d.checkedBy,
        'nik': d.nik,
        'reviewed-by': d.reviewedBy,
        'shift': d.shift
      };
      Object.entries(headerMap).forEach(([elId, val]) => {
        if (val) {
          const el = document.getElementById(elId);
          if (el) el.value = val;
        }
      });

      // Restore all input values by ID (most reliable)
      if (d.inputValues) {
        Object.entries(d.inputValues).forEach(([id, val]) => {
          const el = document.getElementById(id);
          if (el) el.value = val;
        });
      }

      // Restore toggle states
      if (d.toggleStates) {
        // Assign to the correct state object
        if (typeof ST !== 'undefined' && ST !== null) Object.entries(d.toggleStates).forEach(([k,v]) => { ST[k] = v; });
        if (typeof resultState !== 'undefined' && resultState !== null) Object.entries(d.toggleStates).forEach(([k,v]) => { resultState[k] = v; });

        Object.entries(d.toggleStates).forEach(([id, val]) => {

          let found = false;

          // Strategy 1: .tog .rb with onclick match (7EPLCB4, 7EPMCC, DRY_TRAFO, ESP)
          if (!found) {
            const sel = `.rb[data-v="${val}"][onclick*="'${id}'"]`;
            const btn = document.querySelector(sel);
            if (btn) { btn.className = 'rb ' + (val === 'OK' ? 'ok-act' : 'ng-act'); found = true; }
          }

          // Strategy 2: buttons with data-id attribute (Transformer style)
          if (!found) {
            document.querySelectorAll(`[data-id="${id}"]`).forEach(btn => {
              if (btn.dataset.v === val || btn.textContent.trim() === val) {
                btn.classList.add('a');
                found = true;
              }
            });
          }

          // Strategy 3: .r-btn buttons with data-id (BYC125 style)
          if (!found) {
            document.querySelectorAll(`.r-btn[data-id="${id}"]`).forEach(btn => {
              const btnType = btn.dataset.type;
              const match = (val.toLowerCase() === btnType);
              if (match) { btn.classList.add('active'); found = true; }
            });
          }
        });
      }

      // Update stats if the function exists
      if (typeof updateStats === 'function') updateStats();
      if (typeof upStats === 'function') upStats();

      return d;
    } catch (e) {
      console.log('Auto-load skip:', e.message);
      return null;
    }
  },

  showSubmitResult(success, message) {
    const existing = document.getElementById('db-submit-notice');
    if (existing) existing.remove();

    const div = document.createElement('div');
    div.id = 'db-submit-notice';
    div.style.cssText = `position:fixed;top:60px;right:20px;z-index:9999;padding:14px 22px;border-radius:8px;font-size:14px;font-weight:500;
      box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:opacity 0.3s;max-width:400px;
      ${success ? 'background:#dcfce7;color:#166534;border:1px solid #86efac' : 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5'}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => { div.style.opacity = '0'; setTimeout(() => div.remove(), 300); }, 4000);
  }
};
