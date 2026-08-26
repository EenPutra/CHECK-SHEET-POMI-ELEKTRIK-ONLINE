// ============================================================
//  Technician Auth — optional, non-blocking login widget for check sheets.
//
//  Lets a technician log in with their dashboard_users account (the SAME
//  collection/login already used by dashboard.html and
//  Review_Approval_Dashboard.html — including accounts they self-register
//  there, see CLAUDE.md's "Review & Approval Workflow" section) so their
//  "Checked By" field auto-fills with their real name instead of being
//  typed by hand every time, and the review dashboard can trust it
//  actually matches who submitted.
//
//  DELIBERATELY OPTIONAL, NOT a blocking gate: a technician who doesn't
//  log in can still type Checked By manually and submit exactly like
//  before this existed — no risk of a technician getting locked out in
//  the field over a forgotten password or bad signal. Logging in only
//  upgrades the experience (auto-fill + a lock so it can't drift from the
//  logged-in account by accident); it never restricts it.
//
//  Usage — one script include + one init() call, nothing else:
//    <script src="db-helper.js"></script>
//    <script src="technician-auth.js"></script>
//    ...
//    <script> TechnicianAuth.init({ checkedByFieldId: 'checked-by' }); </script>
//
//  Self-injects its own small widget right next to the Checked By field
//  and its own <style> — no HTML markup needed in the host page. Reuses
//  the exact same sessionStorage keys Review_Approval_Dashboard.html
//  already writes on login/register (dashboard_user/_role/_name/
//  _login_time), so a technician who's already logged in there and
//  navigates to a check sheet in the SAME browser tab is recognized
//  immediately with no second login.
// ============================================================

const TechnicianAuth = (function () {
  const SESSION_MS = 8 * 60 * 60 * 1000; // matches Review_Approval_Dashboard.html's own session length

  let _config = null;
  let _domReady = false;

  async function hashPass(str) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function currentSession() {
    const user = sessionStorage.getItem('dashboard_user');
    const loginTime = parseInt(sessionStorage.getItem('dashboard_login_time') || '0', 10);
    if (!user || (Date.now() - loginTime) >= SESSION_MS) return null;
    return {
      user,
      role: sessionStorage.getItem('dashboard_role') || '',
      name: sessionStorage.getItem('dashboard_name') || user,
    };
  }

  function injectDom() {
    if (_domReady) return;
    _domReady = true;

    const style = document.createElement('style');
    style.textContent = `
#ta-widget{display:inline-flex;align-items:center;gap:8px;margin-top:6px;font-family:'Barlow',system-ui,sans-serif;font-size:12px}
#ta-login-btn{background:#eff6ff;border:1.5px solid #bfdbfe;color:#1e3a5f;border-radius:6px;padding:5px 12px;
  font-size:11.5px;font-weight:700;cursor:pointer;display:inline-flex;align-items:center;gap:5px}
#ta-login-btn:hover{border-color:#2563eb;color:#2563eb}
#ta-badge{background:#dcfce7;border:1.5px solid #86efac;color:#166534;border-radius:20px;padding:5px 12px;
  font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;gap:6px}
#ta-badge a{color:#166534;text-decoration:underline;cursor:pointer;font-weight:600}
#ta-modal-overlay{display:none;position:fixed;inset:0;background:rgba(15,23,42,.7);z-index:30000;
  align-items:center;justify-content:center;padding:16px;font-family:'Barlow',system-ui,sans-serif}
#ta-modal-overlay.show{display:flex}
.ta-modal-box{background:#fff;border-radius:14px;width:min(340px,100%);padding:24px 22px;box-shadow:0 20px 60px rgba(0,0,0,.35)}
.ta-modal-title{font-family:'Rajdhani',sans-serif;font-weight:700;font-size:16px;color:#1e3a5f;letter-spacing:.5px;margin-bottom:4px}
.ta-modal-sub{font-size:11.5px;color:#64748b;margin-bottom:16px}
.ta-field{width:100%;border:1.5px solid #dbeafe;border-radius:8px;padding:9px 12px;font-size:13px;margin-bottom:10px;outline:none}
.ta-field:focus{border-color:#2563eb}
.ta-submit{width:100%;background:#2563eb;color:#fff;border:none;border-radius:8px;padding:10px;font-weight:700;
  font-size:13px;cursor:pointer;letter-spacing:.3px}
.ta-submit:hover{background:#1d4ed8}
.ta-submit:disabled{opacity:.6;cursor:not-allowed}
.ta-err{font-size:11.5px;color:#dc2626;margin-top:8px;min-height:16px}
.ta-cancel{width:100%;background:none;border:none;color:#64748b;font-size:12px;margin-top:10px;cursor:pointer}
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'ta-modal-overlay';
    overlay.innerHTML = `
      <div class="ta-modal-box">
        <div class="ta-modal-title">🔑 Login Teknisi</div>
        <div class="ta-modal-sub">Isi "Checked By" otomatis sesuai akun Anda. Belum punya akun? Daftar dulu di <a href="Review_Approval_Dashboard.html" target="_blank" style="color:#2563eb">Review &amp; Approval Dashboard</a>.</div>
        <input type="text" class="ta-field" id="ta-user" placeholder="Username" autocomplete="username">
        <input type="password" class="ta-field" id="ta-pass" placeholder="Password" autocomplete="current-password">
        <button class="ta-submit" id="ta-submit-btn" onclick="TechnicianAuth._submit()">MASUK</button>
        <div class="ta-err" id="ta-err"></div>
        <button class="ta-cancel" onclick="TechnicianAuth._closeModal()">Batal</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
    document.getElementById('ta-pass').addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  }

  function widgetAnchor() {
    const field = document.getElementById(_config.checkedByFieldId);
    if (!field) return null;
    let wrap = document.getElementById('ta-widget');
    if (wrap) return wrap;
    wrap = document.createElement('div');
    wrap.id = 'ta-widget';
    // Insert right after the Checked By field's own immediate wrapper if it
    // has one (this codebase's common `<div class="mf"><label>...</label>
    // <input>...</div>` pattern), otherwise right after the field itself —
    // works regardless of which check sheet's markup this runs in.
    const container = field.closest('.mf') || field.parentElement;
    container.insertAdjacentElement('afterend', wrap);
    return wrap;
  }

  function renderLoggedOut() {
    const wrap = widgetAnchor();
    if (!wrap) return;
    wrap.innerHTML = `<button id="ta-login-btn" onclick="TechnicianAuth.openModal()">🔑 Login untuk isi otomatis</button>`;
  }

  function renderLoggedIn(session) {
    const wrap = widgetAnchor();
    if (!wrap) return;
    wrap.innerHTML = `<span id="ta-badge">✅ Login: ${escHtmlTA(session.name)}<a onclick="TechnicianAuth.logout()">Bukan Anda?</a></span>`;
  }

  function escHtmlTA(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function applySession(session) {
    const field = document.getElementById(_config.checkedByFieldId);
    if (field) {
      field.value = session.name;
      field.readOnly = true;
      field.style.background = '#f0f7ff';
      field.style.cursor = 'not-allowed';
      // Fires the delegated input/change autosave listeners several check
      // sheets already wire up generically (see CLAUDE.md's autosave
      // notes) — a script-set .value alone doesn't trigger them.
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    renderLoggedIn(session);
  }

  function clearSession() {
    const field = document.getElementById(_config.checkedByFieldId);
    if (field) {
      field.readOnly = false;
      field.style.background = '';
      field.style.cursor = '';
    }
    renderLoggedOut();
  }

  function openModal() {
    injectDom();
    document.getElementById('ta-user').value = '';
    document.getElementById('ta-pass').value = '';
    document.getElementById('ta-err').textContent = '';
    document.getElementById('ta-modal-overlay').classList.add('show');
    setTimeout(() => document.getElementById('ta-user').focus(), 50);
  }
  function closeModal() {
    const el = document.getElementById('ta-modal-overlay');
    if (el) el.classList.remove('show');
  }

  async function submit() {
    const user = document.getElementById('ta-user').value.trim().toLowerCase();
    const pass = document.getElementById('ta-pass').value;
    const errEl = document.getElementById('ta-err');
    const btn = document.getElementById('ta-submit-btn');
    if (!user || !pass) { errEl.textContent = 'Isi username dan password.'; return; }
    btn.disabled = true; btn.textContent = 'Memverifikasi...'; errEl.textContent = '';
    try {
      const hashed = await hashPass(pass);
      const snap = await db.collection('dashboard_users').where('username', '==', user).limit(1).get();
      if (snap.empty) { errEl.textContent = 'Username tidak ditemukan.'; btn.disabled = false; btn.textContent = 'MASUK'; return; }
      const data = snap.docs[0].data();
      if (data.password !== hashed) { errEl.textContent = 'Password salah.'; btn.disabled = false; btn.textContent = 'MASUK'; return; }

      sessionStorage.setItem('dashboard_user', data.username);
      sessionStorage.setItem('dashboard_login_time', Date.now().toString());
      sessionStorage.setItem('dashboard_role', data.role || '');
      sessionStorage.setItem('dashboard_name', data.name || data.username);

      closeModal();
      applySession({ user: data.username, role: data.role || '', name: data.name || data.username });
      if (typeof showNote === 'function') showNote('✅ Login berhasil sebagai ' + (data.name || data.username) + '.', 'ok');
    } catch (e) {
      errEl.textContent = 'Gagal login: ' + e.message;
      btn.disabled = false; btn.textContent = 'MASUK';
    }
  }

  function logout() {
    // Only clears THIS widget's effect on the form + the shared session —
    // does not touch anything else on the page. A technician sharing a
    // device with a colleague uses this to switch accounts between visits.
    sessionStorage.removeItem('dashboard_user');
    sessionStorage.removeItem('dashboard_login_time');
    sessionStorage.removeItem('dashboard_role');
    sessionStorage.removeItem('dashboard_name');
    const field = document.getElementById(_config.checkedByFieldId);
    if (field) field.value = '';
    clearSession();
    if (typeof showNote === 'function') showNote('👋 Logout — isi Checked By manual atau login lagi.', 'info');
  }

  function init(config) {
    _config = Object.assign({ checkedByFieldId: 'checked-by' }, config);
    if (!document.getElementById(_config.checkedByFieldId)) return; // this sheet doesn't have that field — nothing to do
    injectDom();
    const session = currentSession();
    if (session) applySession(session);
    else renderLoggedOut();
  }

  return { init, openModal, logout, _submit: submit, _closeModal: closeModal };
})();
