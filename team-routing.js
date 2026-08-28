// ============================================================
//  Team Routing — shared team/area vocabulary + "which team+area does this
//  submission belong to" resolution, used by BOTH dashboards
//  (Review_Approval_Dashboard.html and dashboard.html) so a TechOp2 only
//  ever sees / acts on submissions from their own team+area.
//
//  Load AFTER db-helper.js. window.TeamRouting.
// ============================================================
(function () {
  if (window.TeamRouting) return;

  // Team -> valid areas. The one vocabulary for the whole app — keep in sync
  // with the <option> values in both dashboards' area pickers.
  const TEAM_AREAS = {
    E7: ['Common', 'Powerblock'],
    C7: ['Turbine', 'Boiler', 'Common (CHCB)', 'Common (WWTP-Ashdisposal)'],
  };

  // Submissions pushed in from other POMI mini-apps that can't hold
  // dashboard_users accounts send a fixed synthetic `submittedBy` per plant
  // area. Keyed lowercased. `src` is shown as a tag.
  const EXTERNAL_SUBMITTER_SCOPE = {
    'pm unit 7 - boiler':       { team: 'C7', area: 'Boiler',                     src: 'PM Unit 7' },
    'pm unit 7 - turbine':      { team: 'C7', area: 'Turbine',                    src: 'PM Unit 7' },
    'pm unit 7 - common chcb':  { team: 'C7', area: 'Common (CHCB)',              src: 'PM Unit 7' },
    'pm unit 7 - common wwtp':  { team: 'C7', area: 'Common (WWTP-Ashdisposal)',  src: 'PM Unit 7' },
  };

  // Firestore stores `area` as a string (legacy / technician) or an array
  // (multi-area TechOp2, or a JSON-stringified array in localStorage).
  function toAreaList(a) {
    if (Array.isArray(a)) return a.filter(Boolean);
    if (typeof a === 'string' && a) {
      try { const p = JSON.parse(a); if (Array.isArray(p)) return p.filter(Boolean); } catch (e) {}
      return [a];
    }
    return [];
  }

  // name/username (lowercased) -> {team, area:<first>} for every dashboard_users
  // account. Fetched once, cached; pass force to refetch.
  let _userDir = null;
  async function loadUserDir(force) {
    if (_userDir && !force) return _userDir;
    const dir = {};
    try {
      const snap = await db.collection('dashboard_users').get();
      snap.docs.forEach(d => {
        const u = d.data();
        const rec = { team: TEAM_AREAS[u.team] ? u.team : null, area: toAreaList(u.area)[0] || null };
        if (u.name) dir['n:' + u.name.trim().toLowerCase()] = rec;
        if (u.username) dir['u:' + u.username.trim().toLowerCase()] = rec;
      });
    } catch (e) { console.error('TeamRouting.loadUserDir gagal:', e); }
    _userDir = dir;
    return dir;
  }

  // Resolve a submission's routing scope -> {team, area, src}.
  //   rec.team / rec.area : explicit override (manual upload, or an external
  //     feed that sends them directly) — wins.
  //   rec.names : array of candidate submitter names (checkedBy, uploadedBy,
  //     the approval's submittedBy…) — first that resolves wins, checking the
  //     external-feed map before the dashboard_users directory.
  function resolveScope(rec) {
    rec = rec || {};
    if (rec.team && rec.area) return { team: rec.team, area: rec.area, src: rec.src || null };
    for (const n of (rec.names || [])) {
      const key = (n || '').trim().toLowerCase();
      if (!key) continue;
      const ext = EXTERNAL_SUBMITTER_SCOPE[key];
      if (ext) return { team: ext.team, area: ext.area, src: ext.src };
      const u = _userDir && (_userDir['n:' + key] || _userDir['u:' + key]);
      if (u && u.team && u.area) return { team: u.team, area: u.area, src: null };
    }
    return { team: null, area: null, src: rec.src || null };
  }

  // Is `scope` within a TechOp2's own team + area(s)? No scope set on the
  // reviewer -> sees everything (fail open). An unresolved submission
  // (team:null) is NOT in any specific scope.
  function inScope(scope, myTeam, myAreas) {
    if (!myTeam || !myAreas || !myAreas.length) return true;
    return !!scope && scope.team === myTeam && myAreas.indexOf(scope.area) !== -1;
  }

  window.TeamRouting = {
    TEAM_AREAS, EXTERNAL_SUBMITTER_SCOPE,
    toAreaList, loadUserDir, resolveScope, inScope,
    userDir: () => _userDir,
  };
})();
