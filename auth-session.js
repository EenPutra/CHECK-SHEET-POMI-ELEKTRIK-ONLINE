// ============================================================
//  Auth Session — shared login-session storage + idle timeout for every
//  POMI check sheet and dashboard (dashboard.html,
//  Review_Approval_Dashboard.html, and every check sheet via
//  technician-auth.js). Load this BEFORE technician-auth.js / before the
//  page's own login code.
//
//  WHY: the login session used to live in sessionStorage, which is scoped
//  to a single tab — clicking a link that opened a new tab meant logging
//  in again. This moves it to localStorage so ONE login carries across
//  every tab / window / page in this app on the same computer, and adds a
//  hard idle timeout: the session auto-expires AUTH_IDLE_MS (1 hour) after
//  the last user activity in ANY of those pages.
//
//  Keys (all localStorage): dashboard_user / dashboard_role /
//  dashboard_name / dashboard_login_time / dashboard_last_activity, plus
//  Review_Approval_Dashboard.html's dashboard_team / dashboard_area /
//  dashboard_signature. clear() wipes all of them.
// ============================================================

(function () {
  if (window.AuthSession) return; // already loaded on this page

  const IDLE_MS = 60 * 60 * 1000; // 1 hour of no activity -> logout
  const K = {
    user: 'dashboard_user', role: 'dashboard_role', name: 'dashboard_name',
    loginTime: 'dashboard_login_time', act: 'dashboard_last_activity',
  };
  const ALL_KEYS = [
    'dashboard_user', 'dashboard_role', 'dashboard_name', 'dashboard_login_time',
    'dashboard_last_activity', 'dashboard_team', 'dashboard_area', 'dashboard_signature',
  ];

  const now = () => Date.now();
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const ssDel = k => { try { sessionStorage.removeItem(k); } catch (e) {} };
  function _clearLegacySession() { ALL_KEYS.forEach(ssDel); }

  // One-time migration: a tab already logged in under the old per-tab
  // sessionStorage scheme keeps its session (copied into localStorage), then
  // the sessionStorage copy is wiped so it can't resurrect the session after
  // a later Sign Out (the "can't sign out" bug — clear() nukes localStorage,
  // reload runs migrate() again, old sessionStorage keys re-import the user).
  (function migrate() {
    try {
      if (lsGet(K.user)) { _clearLegacySession(); return; }
      if (!sessionStorage.getItem('dashboard_user')) return;
      ['dashboard_user', 'dashboard_role', 'dashboard_name', 'dashboard_login_time',
       'dashboard_team', 'dashboard_area', 'dashboard_signature'].forEach(k => {
        const v = sessionStorage.getItem(k);
        if (v != null) lsSet(k, v);
      });
      lsSet(K.act, String(now()));
      _clearLegacySession();
    } catch (e) {}
  })();

  function isExpired() {
    const last = parseInt(lsGet(K.act) || lsGet(K.loginTime) || '0', 10);
    return !last || (now() - last) >= IDLE_MS;
  }

  // Returns the live session {user, role, name, team, area, signature} or
  // null. Clears storage on the way out if the session has gone idle.
  function get() {
    const user = lsGet(K.user);
    if (!user) return null;
    if (isExpired()) { clear(); return null; }
    return {
      user,
      role: lsGet(K.role) || '',
      name: lsGet(K.name) || user,
      team: lsGet('dashboard_team') || '',
      area: lsGet('dashboard_area') || '',
      signature: lsGet('dashboard_signature') || '',
    };
  }

  // Called on a successful login. Pass any subset of {user, role, name};
  // extra keys (team/area/signature) are written directly by the caller.
  function set(obj) {
    obj = obj || {};
    if (obj.user != null) lsSet(K.user, obj.user);
    if (obj.role != null) lsSet(K.role, obj.role || '');
    if (obj.name != null) lsSet(K.name, obj.name || obj.user || '');
    lsSet(K.loginTime, String(now()));
    _lastTouch = 0;
    touch();
  }

  let _lastTouch = 0;
  // Bump the "last activity" timestamp. Throttled so ambient events
  // (scroll/pointer) don't hammer localStorage.
  function touch() {
    const t = now();
    if (t - _lastTouch < 15000) return;
    _lastTouch = t;
    if (lsGet(K.user)) lsSet(K.act, String(t));
  }

  function clear() { ALL_KEYS.forEach(lsDel); _clearLegacySession(); }

  let _onExpire = null;
  function _fireExpire() {
    if (typeof _onExpire === 'function') { try { _onExpire(); return; } catch (e) {} }
    try { location.reload(); } catch (e) {}
  }
  function _check() {
    if (lsGet(K.user) && isExpired()) { clear(); _fireExpire(); }
  }

  function _wire() {
    ['click', 'keydown', 'pointerdown', 'scroll', 'touchstart'].forEach(ev =>
      window.addEventListener(ev, touch, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
      // check expiry FIRST — coming back to the tab after >1h must log out,
      // not have touch() reset the timer before _check() sees it.
      if (!document.hidden) { _check(); touch(); }
    });
    setInterval(_check, 60 * 1000);
    // Another tab logged out (or its session expired) -> follow suit here.
    window.addEventListener('storage', e => {
      if (e.key === K.user && !e.newValue) _fireExpire();
      if (e.key === null) _fireExpire(); // whole localStorage cleared
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _wire);
  else _wire();

  window.AuthSession = {
    IDLE_MS,
    get, set, touch, clear, isExpired,
    onExpire(fn) { _onExpire = fn; },
  };
})();
