// ============================================================
//  Database Helper — Save, Load, Export for Check Sheets
// ============================================================

const DB = {
  COLLECTION: 'checksheets',

  async save(data) {
    data.submittedAt = firebase.firestore.FieldValue.serverTimestamp();
    data.createdAt = new Date().toISOString();
    const ref = await db.collection(this.COLLECTION).add(data);
    return ref.id;
  },

  async getAll(filters = {}) {
    let query = db.collection(this.COLLECTION).orderBy('createdAt', 'desc');
    if (filters.assetTag) query = query.where('assetTag', '==', filters.assetTag);
    if (filters.status) query = query.where('overallStatus', '==', filters.status);
    const snap = await query.get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  async getById(id) {
    const doc = await db.collection(this.COLLECTION).doc(id).get();
    return doc.exists ? { id: doc.id, ...doc.data() } : null;
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

    document.querySelectorAll('.r-btn.active, .rb.ok-act, .rb.ng-act').forEach(btn => {
      const row = btn.closest('tr');
      if (!row) return;
      const labelCell = row.querySelector('.lbl, .task-desc, td:nth-child(2)');
      const label = labelCell ? labelCell.textContent.trim() : '';
      const isOk = btn.classList.contains('ok-act') || btn.classList.contains('active') && btn.textContent.trim() === 'OK';
      const isNg = btn.classList.contains('ng-act') || btn.classList.contains('active') && btn.textContent.trim() === 'NG';

      if (isOk) data.countOk++;
      if (isNg) data.countNg++;
      data.items.push({ label, result: isOk ? 'OK' : isNg ? 'NG' : 'N/A' });
    });

    document.querySelectorAll('.r-btn.na-btn.active').forEach(() => data.countNa++);

    if (data.countNg > 0) data.overallStatus = 'NG';

    const measurements = [];
    document.querySelectorAll('.mi, .meas-input').forEach(input => {
      if (input.value) {
        const row = input.closest('tr');
        const labelCell = row ? row.querySelector('.lbl, .task-desc, td:nth-child(2)') : null;
        measurements.push({
          label: labelCell ? labelCell.textContent.trim() : input.name || input.id || '',
          value: input.value,
          unit: input.dataset.unit || ''
        });
      }
    });
    data.measurements = measurements;

    const findings = document.getElementById('findings')?.value ||
                     document.querySelector('textarea[placeholder*="finding" i], textarea[placeholder*="temuan" i]')?.value || '';
    const recommendations = document.getElementById('recommendations')?.value ||
                            document.querySelector('textarea[placeholder*="recommend" i], textarea[placeholder*="rekomendasi" i]')?.value || '';
    data.findings = findings;
    data.recommendations = recommendations;

    return data;
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
