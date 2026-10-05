// ============================================================
//  Feedback Widget — "Laporkan Bug / Masukan" floating button.
//
//  Self-installing, zero-config: one <script src="feedback-widget.js">
//  (after auth-session.js; `../` prefix in a subfolder) adds a small round
//  button in the bottom-right corner of the page. Clicking it opens a
//  compact panel where anyone can report a bug, a missing feature, a UI
//  problem or a suggestion — with optional screenshots (pick, or paste
//  with Ctrl+V) and an automatic technical context (page, browser, screen
//  size, the last console errors this page threw) so a developer can
//  reproduce it without a back-and-forth.
//
//  Reports go to the Firestore collection `feedback_reports` (status
//  starts at 'baru'); `Feedback_Reports.html` lists them for triage
//  (status baru -> ditinjau -> dikerjakan -> selesai / ditolak).
//  If the write fails (offline, or the rules for this collection are not
//  deployed yet) the report is kept in localStorage['fb_queue'] and sent
//  automatically on the next page load — nothing typed is ever lost.
//
//  Needs `db` (firebase-config.js) only at send time, so it can be loaded
//  anywhere in the page. Reads the reporter from window.AuthSession when
//  the person is logged in.
// ============================================================
(function () {
  if (window.FeedbackWidget) return;

  const COLL = 'feedback_reports';
  const QUEUE_KEY = 'fb_queue';
  const DRAFT_KEY = 'fb_draft';
  const MAX_SHOTS = 3;
  const SHOT_BUDGET = 600 * 1024;   // all screenshots together, base64 chars (Firestore doc cap is 1MB)
  const MAX_ERRORS = 20;

  const TYPES = [
    { v: 'bug', label: '🐞 Bug / Error' },
    { v: 'kekurangan', label: '🧩 Kekurangan' },
    { v: 'saran', label: '💡 Saran / Fitur' },
    { v: 'tampilan', label: '🎨 Tampilan' },
    { v: 'lainnya', label: '❓ Lainnya' },
  ];
  const PRIORITIES = [
    { v: 'rendah', label: 'Rendah' },
    { v: 'sedang', label: 'Sedang' },
    { v: 'tinggi', label: 'Tinggi' },
    { v: 'kritis', label: 'Kritis — pekerjaan terhenti' },
  ];

  // Where this script lives — so the "lihat semua laporan" link works from a
  // subfolder page too.
  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || '';
  const REPORTS_URL = (() => { try { return new URL('Feedback_Reports.html', SCRIPT_SRC || location.href).href; } catch (e) { return 'Feedback_Reports.html'; } })();
  const APP_VERSION = (() => { const m = SCRIPT_SRC.match(/[?&]v=([^&]+)/); return m ? m[1] : ''; })();

  // ── Console-error capture (installed immediately) ──
  const ERRORS = [];
  function pushErr(kind, msg) {
    try {
      msg = String(msg == null ? '' : msg).slice(0, 500);
      if (!msg) return;
      const last = ERRORS[ERRORS.length - 1];
      if (last && last.msg === msg) { last.n = (last.n || 1) + 1; return; }
      ERRORS.push({ at: new Date().toISOString(), kind, msg });
      if (ERRORS.length > MAX_ERRORS) ERRORS.shift();
    } catch (e) { /* never break the page */ }
  }
  window.addEventListener('error', e => {
    if (e && e.target && e.target !== window && (e.target.src || e.target.href)) {
      pushErr('resource', 'Gagal memuat: ' + (e.target.src || e.target.href));
    } else {
      pushErr('error', (e.message || 'Error') + (e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''));
    }
  }, true);
  window.addEventListener('unhandledrejection', e => {
    const r = e && e.reason;
    pushErr('promise', r == null ? 'Unhandled rejection' : (r.message || String(r)));
  });
  const _origConsoleError = console.error;
  console.error = function () {
    try { pushErr('console', Array.from(arguments).map(a => a instanceof Error ? a.message : (typeof a === 'object' ? safeJson(a) : String(a))).join(' ')); } catch (e) {}
    return _origConsoleError.apply(console, arguments);
  };
  function safeJson(o) { try { return JSON.stringify(o).slice(0, 300); } catch (e) { return String(o); } }

  // ── helpers ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }
  function getDb() {
    try { if (typeof db !== 'undefined' && db) return db; } catch (e) {}
    try { if (window.firebase && firebase.apps && firebase.apps.length) return firebase.firestore(); } catch (e) {}
    return null;
  }
  function session() {
    try { return window.AuthSession ? window.AuthSession.get() : null; } catch (e) { return null; }
  }
  function pageFile() {
    try { return decodeURIComponent(location.pathname.split('/').pop() || 'index.html'); } catch (e) { return location.pathname; }
  }
  function context() {
    const s = session();
    return {
      page: {
        title: document.title || '',
        file: pageFile(),
        path: (() => { try { return decodeURIComponent(location.pathname); } catch (e) { return location.pathname; } })(),
        url: location.href.split('#')[0].slice(0, 500),
      },
      env: {
        userAgent: navigator.userAgent,
        platform: navigator.platform || '',
        language: navigator.language || '',
        viewport: window.innerWidth + 'x' + window.innerHeight,
        screen: (screen.width || 0) + 'x' + (screen.height || 0) + ' @' + (window.devicePixelRatio || 1) + 'x',
        online: navigator.onLine,
        theme: document.documentElement.getAttribute('data-theme') || '',
        appVersion: APP_VERSION,
      },
      session: s ? { user: s.user || '', role: s.role || '', team: s.team || '', area: s.area || '' } : null,
      consoleErrors: ERRORS.slice(),
    };
  }

  // ── styles + DOM ──
  const CSS = `
#fbw-btn{position:fixed;right:14px;bottom:14px;z-index:24500;width:40px;height:40px;border-radius:50%;
  background:#1e3a5f;color:#fff;border:2px solid #fff;box-shadow:0 4px 14px rgba(15,23,42,.3);cursor:pointer;
  display:flex;align-items:center;justify-content:center;font-size:18px;line-height:1;padding:0;
  transition:transform .15s,background .15s,bottom .2s}
#fbw-btn:hover{transform:scale(1.08);background:#2563eb}
#fbw-btn .fbw-dot{position:absolute;top:-3px;right:-3px;min-width:16px;height:16px;border-radius:8px;background:#dc2626;
  color:#fff;font:700 10px/16px system-ui,sans-serif;padding:0 4px;display:none;border:1.5px solid #fff}
#fbw-tip{position:fixed;right:62px;z-index:24500;background:#0f172a;color:#fff;font:600 11.5px/1.3 system-ui,sans-serif;
  padding:6px 10px;border-radius:6px;pointer-events:none;opacity:0;transition:opacity .15s;white-space:nowrap}
#fbw-panel{position:fixed;right:14px;bottom:62px;z-index:24600;width:360px;max-width:calc(100vw - 28px);
  max-height:calc(100vh - 90px);overflow:auto;background:#fff;color:#0f172a;border-radius:12px;
  box-shadow:0 12px 40px rgba(15,23,42,.35);border:1px solid #cbd5e1;display:none;
  font-family:'Barlow',system-ui,-apple-system,sans-serif;font-size:13px}
#fbw-panel.show{display:block;animation:fbwIn .16s ease-out}
@keyframes fbwIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
#fbw-panel *{box-sizing:border-box}
.fbw-hd{background:#1e3a5f;color:#fff;padding:10px 12px;display:flex;align-items:center;gap:8px;position:sticky;top:0;z-index:1}
.fbw-hd b{font-size:13.5px;flex:1}
.fbw-hd button{background:transparent;border:0;color:#cbd5e1;font-size:18px;cursor:pointer;line-height:1;padding:2px 4px}
.fbw-hd button:hover{color:#fff}
.fbw-bd{padding:10px 12px 12px}
.fbw-sub{color:#64748b;font-size:11.5px;margin:0 0 8px}
.fbw-lbl{display:block;font-weight:700;font-size:11.5px;color:#334155;margin:9px 0 4px;text-transform:uppercase;letter-spacing:.03em}
.fbw-lbl i{font-style:normal;color:#dc2626}
.fbw-chips{display:flex;flex-wrap:wrap;gap:5px}
.fbw-chip{border:1.5px solid #cbd5e1;background:#f8fafc;color:#334155;border-radius:999px;padding:4px 9px;font:600 11.5px system-ui,sans-serif;cursor:pointer}
.fbw-chip.on{background:#1e3a5f;border-color:#1e3a5f;color:#fff}
#fbw-panel input[type=text],#fbw-panel textarea,#fbw-panel select{width:100%;border:1.5px solid #cbd5e1;border-radius:7px;
  padding:6px 8px;font:13px system-ui,sans-serif;color:#0f172a;background:#fff}
#fbw-panel textarea{resize:vertical;min-height:62px}
#fbw-panel input:focus,#fbw-panel textarea:focus,#fbw-panel select:focus{outline:none;border-color:#2563eb}
.fbw-row{display:flex;gap:8px}.fbw-row>div{flex:1;min-width:0}
.fbw-shots{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}
.fbw-shot{position:relative;width:70px;height:52px;border:1px solid #cbd5e1;border-radius:6px;overflow:hidden;background:#f1f5f9}
.fbw-shot img{width:100%;height:100%;object-fit:contain}
.fbw-shot button{position:absolute;top:1px;right:1px;width:17px;height:17px;border-radius:50%;border:0;background:rgba(15,23,42,.75);
  color:#fff;font-size:11px;line-height:17px;cursor:pointer;padding:0}
.fbw-add{width:70px;height:52px;border:1.5px dashed #94a3b8;border-radius:6px;background:#f8fafc;color:#475569;cursor:pointer;
  font:600 10.5px/1.2 system-ui,sans-serif}
.fbw-hint{color:#64748b;font-size:11px;margin-top:3px}
.fbw-ctx{margin-top:9px;background:#f1f5f9;border-radius:7px;padding:7px 8px;font-size:11.5px;color:#334155}
.fbw-ctx label{display:flex;gap:6px;align-items:flex-start;cursor:pointer}
.fbw-ctx a{color:#2563eb;cursor:pointer;text-decoration:underline}
.fbw-ctx pre{white-space:pre-wrap;word-break:break-all;font:10.5px/1.35 ui-monospace,Menlo,monospace;max-height:140px;overflow:auto;
  background:#fff;border:1px solid #e2e8f0;border-radius:5px;padding:6px;margin:6px 0 0;display:none}
.fbw-err{color:#dc2626;font-size:12px;margin-top:8px;min-height:0}
.fbw-act{display:flex;gap:8px;margin-top:10px}
.fbw-act button{flex:1;border-radius:7px;padding:8px;font:700 12.5px system-ui,sans-serif;cursor:pointer;border:1.5px solid #1e3a5f}
.fbw-send{background:#1e3a5f;color:#fff}.fbw-send:hover{background:#2563eb;border-color:#2563eb}
.fbw-send:disabled{opacity:.6;cursor:wait}
.fbw-cancel{background:#fff;color:#1e3a5f}
.fbw-ok{text-align:center;padding:18px 14px}
.fbw-ok .big{font-size:34px}.fbw-ok b{display:block;font-size:14px;margin:6px 0 4px}
.fbw-ok code{background:#eff6ff;color:#1e3a5f;padding:2px 7px;border-radius:5px;font-weight:700}
.fbw-foot{border-top:1px solid #e2e8f0;padding:7px 12px;font-size:11.5px;display:flex;justify-content:space-between;gap:8px;color:#64748b}
.fbw-foot a{color:#2563eb;text-decoration:none;font-weight:600}
#fbw-panel.fbw-over{outline:3px dashed #2563eb;outline-offset:-3px}
#fbw-panel.fbw-over .fbw-shots{background:#eff6ff}
#fbw-btn.fbw-over{transform:scale(1.15);background:#2563eb}
.fbw-shots{border-radius:7px;transition:background .15s}
@media(max-width:480px){#fbw-panel{right:8px;left:8px;width:auto;max-width:none;bottom:60px}}
@media print{#fbw-btn,#fbw-panel,#fbw-tip{display:none!important}}
`;

  let _built = false;
  let _state = { type: 'bug', shots: [] };

  function build() {
    if (_built) return;
    _built = true;
    const st = document.createElement('style');
    st.id = 'fbw-style';
    st.textContent = CSS;
    document.head.appendChild(st);

    const btn = document.createElement('button');
    btn.id = 'fbw-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Laporkan bug / masukan');
    btn.innerHTML = '💬<span class="fbw-dot" id="fbw-dot"></span>';
    btn.onclick = toggle;
    document.body.appendChild(btn);

    const tip = document.createElement('div');
    tip.id = 'fbw-tip';
    tip.textContent = 'Laporkan bug / masukan';
    document.body.appendChild(tip);
    btn.addEventListener('mouseenter', () => { if (!isOpen()) { placeTip(); tip.style.opacity = '1'; } });
    btn.addEventListener('mouseleave', () => { tip.style.opacity = '0'; });

    const panel = document.createElement('div');
    panel.id = 'fbw-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Laporkan bug atau masukan');
    document.body.appendChild(panel);

    // Paste a screenshot straight into the open panel.
    document.addEventListener('paste', e => {
      if (!isOpen() || !e.clipboardData) return;
      const files = Array.from(e.clipboardData.items || []).filter(i => i.type && i.type.startsWith('image/')).map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); addFiles(files); }
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) close(); });

    // Drag & drop images onto the open panel, or onto the 💬 button (opens the
    // panel). Only these two targets — drops elsewhere stay with the page.
    const hasFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
    const imgsOf = e => Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => f.type && f.type.startsWith('image/'));
    [panel, btn].forEach(el => {
      el.addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('fbw-over'); });
      el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('fbw-over'); });
      el.addEventListener('drop', e => {
        if (!hasFiles(e)) return;
        e.preventDefault(); e.stopPropagation(); el.classList.remove('fbw-over');
        const files = imgsOf(e);
        if (!isOpen()) open();
        if (files.length) addFiles(files);
        else { const err = document.getElementById('fbw-err'); if (err) err.textContent = 'Hanya file gambar yang bisa dilampirkan.'; }
      });
    });

    reposition();
    // Sit above submit-guard.js's "Mode Hemat Data" badge (same corner).
    try { new MutationObserver(reposition).observe(document.body, { childList: true }); } catch (e) {}
    window.addEventListener('resize', reposition);
    updateQueueDot();
  }

  function reposition() {
    const btn = document.getElementById('fbw-btn');
    if (!btn) return;
    const badge = document.getElementById('sg-datasaver-badge');
    // (offsetParent is always null for a position:fixed element — measure instead)
    const bh = badge ? badge.getBoundingClientRect().height : 0;
    const lift = bh > 0 ? Math.round(bh) + 22 : 14;
    btn.style.bottom = lift + 'px';
    const panel = document.getElementById('fbw-panel');
    if (panel) panel.style.bottom = (lift + 48) + 'px';
  }
  function placeTip() {
    const btn = document.getElementById('fbw-btn'), tip = document.getElementById('fbw-tip');
    if (!btn || !tip) return;
    const r = btn.getBoundingClientRect();
    tip.style.bottom = (window.innerHeight - r.bottom + 10) + 'px';
  }
  function isOpen() { const p = document.getElementById('fbw-panel'); return !!(p && p.classList.contains('show')); }
  function toggle() { isOpen() ? close() : open(); }

  function open(prefill) {
    build();
    renderForm(prefill || {});
    document.getElementById('fbw-panel').classList.add('show');
    document.getElementById('fbw-tip').style.opacity = '0';
    flushQueue();
  }
  function close() {
    const p = document.getElementById('fbw-panel');
    if (p) { saveDraft(); p.classList.remove('show'); }
  }

  // ── form ──
  function renderForm(prefill) {
    const d = Object.assign({}, loadDraft(), prefill);
    if (d.type) _state.type = d.type;
    const s = session();
    const reporter = d.reporter || (s ? s.name : '') || lsGet('fb_last_name') || '';
    const panel = document.getElementById('fbw-panel');
    panel.innerHTML = `
      <div class="fbw-hd"><b>💬 Laporkan Bug / Masukan</b><button type="button" title="Tutup" onclick="FeedbackWidget.close()">×</button></div>
      <div class="fbw-bd">
        <p class="fbw-sub">Temukan error, ada yang kurang, atau punya ide? Laporan langsung masuk ke tim development.</p>
        <span class="fbw-lbl">Jenis</span>
        <div class="fbw-chips" id="fbw-types">${TYPES.map(t => `<button type="button" class="fbw-chip${t.v === _state.type ? ' on' : ''}" data-v="${t.v}">${t.label}</button>`).join('')}</div>
        <div class="fbw-row">
          <div><label class="fbw-lbl" for="fbw-prio">Prioritas</label>
            <select id="fbw-prio">${PRIORITIES.map(p => `<option value="${p.v}"${p.v === (d.priority || 'sedang') ? ' selected' : ''}>${p.label}</option>`).join('')}</select></div>
        </div>
        <label class="fbw-lbl" for="fbw-title">Judul singkat <i>*</i></label>
        <input type="text" id="fbw-title" maxlength="140" placeholder="mis. Foto tidak muncul di PDF" value="${esc(d.title || '')}">
        <label class="fbw-lbl" for="fbw-desc">Penjelasan <i>*</i></label>
        <textarea id="fbw-desc" maxlength="4000" placeholder="Apa yang terjadi, dan apa yang seharusnya terjadi?">${esc(d.description || '')}</textarea>
        <div id="fbw-steps-wrap">
          <label class="fbw-lbl" for="fbw-steps">Langkah untuk mengulang <span style="text-transform:none;font-weight:500;color:#64748b">(opsional)</span></label>
          <textarea id="fbw-steps" maxlength="3000" placeholder="1. Buka ...&#10;2. Klik ...&#10;3. Muncul error ...">${esc(d.steps || '')}</textarea>
        </div>
        <span class="fbw-lbl">Screenshot <span style="text-transform:none;font-weight:500;color:#64748b">(maks ${MAX_SHOTS})</span></span>
        <div class="fbw-shots" id="fbw-shots"></div>
        <div class="fbw-hint">Klik ＋, <b>tarik &amp; lepas</b> gambar ke panel ini, atau <b>tempel</b> (Ctrl+V / ⌘V) — tidak perlu simpan file dulu.</div>
        <input type="file" id="fbw-file" accept="image/*" multiple style="display:none">
        <div class="fbw-row">
          <div><label class="fbw-lbl" for="fbw-name">Nama pelapor</label>
            <input type="text" id="fbw-name" maxlength="80" value="${esc(reporter)}" placeholder="Nama Anda"></div>
          <div><label class="fbw-lbl" for="fbw-contact">Kontak <span style="text-transform:none;font-weight:500;color:#64748b">(opsional)</span></label>
            <input type="text" id="fbw-contact" maxlength="80" value="${esc(d.contact || lsGet('fb_last_contact') || '')}" placeholder="WA / email"></div>
        </div>
        <div class="fbw-ctx">
          <label><input type="checkbox" id="fbw-ctx-on" ${d.ctxOff ? '' : 'checked'}>
            <span>Sertakan info teknis (halaman, browser, ukuran layar, ${ERRORS.length} error terakhir di halaman ini). <a onclick="FeedbackWidget._toggleCtx(event)">lihat</a></span></label>
          <pre id="fbw-ctx-pre"></pre>
        </div>
        <div class="fbw-err" id="fbw-err"></div>
        <div class="fbw-act">
          <button type="button" class="fbw-cancel" onclick="FeedbackWidget.close()">Tutup</button>
          <button type="button" class="fbw-send" id="fbw-send" onclick="FeedbackWidget.send()">Kirim Laporan</button>
        </div>
      </div>
      <div class="fbw-foot"><span id="fbw-qinfo"></span><a href="${esc(REPORTS_URL)}" target="_blank" rel="noopener">Lihat semua laporan ↗</a></div>`;

    panel.querySelectorAll('#fbw-types .fbw-chip').forEach(c => c.onclick = () => {
      _state.type = c.dataset.v;
      panel.querySelectorAll('#fbw-types .fbw-chip').forEach(x => x.classList.toggle('on', x === c));
      syncStepsVisibility();
      saveDraft();
    });
    panel.querySelectorAll('input[type=text],textarea,select,#fbw-ctx-on').forEach(el => el.addEventListener('input', saveDraft));
    document.getElementById('fbw-file').onchange = e => { addFiles(Array.from(e.target.files || [])); e.target.value = ''; };
    syncStepsVisibility();
    renderShots();
    updateQueueDot();
    setTimeout(() => { const t = document.getElementById('fbw-title'); if (t && !t.value) t.focus(); }, 40);
  }
  function syncStepsVisibility() {
    const w = document.getElementById('fbw-steps-wrap');
    if (w) w.style.display = _state.type === 'bug' ? '' : 'none';
  }
  function toggleCtx(e) {
    if (e) e.preventDefault();
    const pre = document.getElementById('fbw-ctx-pre');
    if (!pre) return;
    const showing = pre.style.display === 'block';
    if (!showing) pre.textContent = JSON.stringify(context(), null, 2);
    pre.style.display = showing ? 'none' : 'block';
  }

  // ── screenshots ──
  function renderShots() {
    const box = document.getElementById('fbw-shots');
    if (!box) return;
    box.innerHTML = _state.shots.map((s, i) =>
      `<div class="fbw-shot"><img src="${s.dataUrl}" alt="screenshot ${i + 1}"><button type="button" title="Hapus" onclick="FeedbackWidget._rmShot(${i})">×</button></div>`).join('')
      + (_state.shots.length < MAX_SHOTS ? `<button type="button" class="fbw-add" onclick="document.getElementById('fbw-file').click()">＋ Tambah<br>gambar</button>` : '');
  }
  function rmShot(i) { _state.shots.splice(i, 1); renderShots(); }
  async function addFiles(files) {
    const err = document.getElementById('fbw-err');
    for (const f of files) {
      if (_state.shots.length >= MAX_SHOTS) { if (err) err.textContent = 'Maksimal ' + MAX_SHOTS + ' gambar.'; break; }
      if (!f.type || !f.type.startsWith('image/')) continue;
      try { _state.shots.push(await shrink(f, 1280, 0.72)); } catch (e) { if (err) err.textContent = 'Gambar gagal dibaca: ' + e.message; }
    }
    fitShotBudget();
    renderShots();
  }
  function shrink(file, maxEdge, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ dataUrl: c.toDataURL('image/jpeg', quality), w, h, name: (file.name || 'screenshot').slice(0, 80), _canvas: c });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('format tidak didukung')); };
      img.src = url;
    });
  }
  // Keep all screenshots together under SHOT_BUDGET: lower quality, then size.
  function fitShotBudget() {
    const total = () => _state.shots.reduce((n, s) => n + s.dataUrl.length, 0);
    let q = 0.62, guard = 0;
    while (total() > SHOT_BUDGET && guard++ < 8) {
      _state.shots.forEach(s => {
        let c = s._canvas;
        if (!c) return;
        if (q < 0.45) {
          const nc = document.createElement('canvas');
          nc.width = Math.max(1, Math.round(c.width * 0.8)); nc.height = Math.max(1, Math.round(c.height * 0.8));
          nc.getContext('2d').drawImage(c, 0, 0, nc.width, nc.height);
          s._canvas = c = nc; s.w = nc.width; s.h = nc.height;
        }
        s.dataUrl = c.toDataURL('image/jpeg', Math.max(q, 0.4));
      });
      q -= 0.08;
    }
  }

  // ── draft (survives closing the panel / reloading) ──
  function readForm() {
    const v = id => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const ctxEl = document.getElementById('fbw-ctx-on');
    return {
      type: _state.type, priority: v('fbw-prio') || 'sedang', title: v('fbw-title'), description: v('fbw-desc'),
      steps: v('fbw-steps'), reporter: v('fbw-name'), contact: v('fbw-contact'), ctxOff: ctxEl ? !ctxEl.checked : false,
    };
  }
  function saveDraft() {
    if (!document.getElementById('fbw-title')) return;
    const f = readForm();
    if (f.title || f.description || f.steps) lsSet(DRAFT_KEY, JSON.stringify(f)); else lsDel(DRAFT_KEY);
  }
  function loadDraft() { try { return JSON.parse(lsGet(DRAFT_KEY) || '{}') || {}; } catch (e) { return {}; } }

  // ── send ──
  function buildDoc(f) {
    const ctx = f.ctxOff ? null : context();
    const s = session();
    const now = new Date().toISOString();
    return {
      type: f.type, priority: f.priority, title: f.title, description: f.description,
      steps: f.type === 'bug' ? f.steps : '',
      reporter: { name: f.reporter || (s && s.name) || 'Anonim', contact: f.contact || '', user: (s && s.user) || '', role: (s && s.role) || '' },
      page: ctx ? ctx.page : { title: document.title || '', file: pageFile(), path: location.pathname, url: location.href.split('#')[0].slice(0, 500) },
      env: ctx ? ctx.env : null,
      session: ctx ? ctx.session : null,
      consoleErrors: ctx ? ctx.consoleErrors : [],
      screenshots: _state.shots.map(s => ({ dataUrl: s.dataUrl, w: s.w, h: s.h, name: s.name })),
      status: 'baru',
      devNote: '',
      history: [{ status: 'baru', by: f.reporter || 'Anonim', at: now, note: 'Laporan dibuat' }],
      createdAt: now,
      updatedAt: now,
    };
  }
  async function write(doc) {
    const d = getDb();
    if (!d) throw new Error('Koneksi database belum siap di halaman ini.');
    const ref = await d.collection(COLL).add(doc);
    return ref.id;
  }
  async function send() {
    const f = readForm();
    const err = document.getElementById('fbw-err');
    const btn = document.getElementById('fbw-send');
    err.textContent = '';
    if (!f.title) { err.textContent = 'Isi judul singkat dulu.'; document.getElementById('fbw-title').focus(); return; }
    if (!f.description) { err.textContent = 'Isi penjelasannya dulu.'; document.getElementById('fbw-desc').focus(); return; }
    btn.disabled = true; btn.textContent = 'Mengirim...';
    if (f.reporter) lsSet('fb_last_name', f.reporter);
    if (f.contact) lsSet('fb_last_contact', f.contact);
    const doc = buildDoc(f);
    try {
      const id = await write(doc);
      done(id, false);
    } catch (e) {
      // Keep it locally and retry later — never lose a report.
      const q = readQueue();
      q.push(doc);
      let saved = lsSet(QUEUE_KEY, JSON.stringify(q));
      if (!saved) { doc.screenshots = []; q[q.length - 1] = doc; saved = lsSet(QUEUE_KEY, JSON.stringify(q)); }
      if (saved) done(null, true, e);
      else { btn.disabled = false; btn.textContent = 'Kirim Laporan'; err.textContent = 'Gagal mengirim: ' + e.message; }
    }
  }
  function done(id, queued, e) {
    lsDel(DRAFT_KEY);
    _state = { type: 'bug', shots: [] };
    const panel = document.getElementById('fbw-panel');
    const ticket = id ? 'FB-' + id.slice(0, 6).toUpperCase() : '';
    panel.innerHTML = `
      <div class="fbw-hd"><b>💬 Laporkan Bug / Masukan</b><button type="button" title="Tutup" onclick="FeedbackWidget.close()">×</button></div>
      <div class="fbw-ok">
        <div class="big">${queued ? '📦' : '✅'}</div>
        <b>${queued ? 'Laporan disimpan di perangkat ini' : 'Terima kasih, laporan terkirim!'}</b>
        ${queued
          ? `<div class="fbw-sub" style="margin:6px 0 0">Belum bisa terkirim ke database (${esc(e && e.message ? e.message : 'offline')}). Akan dikirim otomatis saat halaman dibuka lagi dengan koneksi normal.</div>`
          : `<div class="fbw-sub" style="margin:6px 0 0">Nomor laporan: <code>${ticket}</code><br>Tim development akan meninjaunya.</div>`}
        <div class="fbw-act" style="margin-top:14px">
          <button type="button" class="fbw-cancel" onclick="FeedbackWidget.open()">Lapor lagi</button>
          <button type="button" class="fbw-send" onclick="FeedbackWidget.close()">Selesai</button>
        </div>
      </div>
      <div class="fbw-foot"><span id="fbw-qinfo"></span><a href="${esc(REPORTS_URL)}" target="_blank" rel="noopener">Lihat semua laporan ↗</a></div>`;
    updateQueueDot();
  }

  // ── offline queue ──
  function readQueue() { try { const q = JSON.parse(lsGet(QUEUE_KEY) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
  let _flushing = false;
  async function flushQueue() {
    if (_flushing) return;
    const q = readQueue();
    if (!q.length || !getDb()) { updateQueueDot(); return; }
    _flushing = true;
    const left = [];
    for (const doc of q) {
      try { await write(doc); } catch (e) { left.push(doc); }
    }
    if (left.length) lsSet(QUEUE_KEY, JSON.stringify(left)); else lsDel(QUEUE_KEY);
    _flushing = false;
    updateQueueDot();
  }
  function updateQueueDot() {
    const n = readQueue().length;
    const dot = document.getElementById('fbw-dot');
    if (dot) { dot.textContent = n; dot.style.display = n ? 'block' : 'none'; }
    const qi = document.getElementById('fbw-qinfo');
    if (qi) qi.textContent = n ? n + ' laporan menunggu terkirim' : '';
  }

  function init() {
    if (!document.body) return;
    build();
    // Retry anything queued from an earlier offline session, once the page's
    // own Firebase init has had a moment to run.
    setTimeout(flushQueue, 4000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.FeedbackWidget = {
    open, close, send, flushQueue,
    getErrors: () => ERRORS.slice(),
    _toggleCtx: toggleCtx, _rmShot: rmShot,
  };
})();
