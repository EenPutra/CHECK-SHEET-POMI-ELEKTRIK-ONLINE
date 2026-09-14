/* table-nav.js — keyboard arrow-key navigation for form fields inside <table> grids.
 *
 * Self-installing, zero-config: just add
 *   <script src="table-nav.js"></script>
 * (anywhere, after the DOM or before it — it waits for DOMContentLoaded) and every
 * <input>/<textarea>/<select> that sits inside a table cell becomes navigable with
 * the arrow keys, so a technician filling a wide measurement matrix never has to
 * reach for the mouse or Tab through dozens of cells.
 *
 * Behaviour (only ever acts when focus is already in a table-cell field):
 *   ArrowUp / ArrowDown  → same column, previous / next row (skips rows with no
 *                          editable field, e.g. sub-header dividers). Native on a
 *                          <select> (arrows change the option there).
 *   ArrowLeft / ArrowRight → previous / next editable field in the row. For a text
 *                          field it only moves once the caret is at the very
 *                          start / end, so in-cell editing still works normally.
 *                          At a row edge it wraps to the adjacent row.
 *   Enter / Shift+Enter   → like ArrowDown / ArrowUp (not for <textarea>/<select>).
 *
 * Modifier combos (Ctrl/Alt/Meta + arrow) are left untouched. Readonly / disabled /
 * hidden fields are skipped. Navigation never crosses out of the current <table>.
 */
(function () {
  if (window.__tableNavInstalled) return;
  window.__tableNavInstalled = true;

  var SEL = 'input:not([type=hidden]):not([type=file]):not([type=checkbox]):not([type=radio])' +
            ':not([type=button]):not([type=submit]):not([type=reset]):not([disabled]):not([readonly]),' +
            'select:not([disabled]):not([readonly]),' +
            'textarea:not([disabled]):not([readonly])';

  function tag(el) { return (el.tagName || '').toLowerCase(); }

  function isTextEntry(el) {
    if (tag(el) === 'textarea') return true;
    if (tag(el) !== 'input') return false;
    var t = (el.getAttribute('type') || 'text').toLowerCase();
    return ['text', 'search', 'tel', 'url', 'email', 'password', 'number'].indexOf(t) >= 0;
  }

  function visible(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function caretAtStart(el) {
    try {
      if (el.type === 'number') return true; // number inputs expose no selection API
      return el.selectionStart === 0 && el.selectionEnd === 0;
    } catch (e) { return true; }
  }
  function caretAtEnd(el) {
    try {
      if (el.type === 'number') return true;
      var n = (el.value || '').length;
      return el.selectionStart === n && el.selectionEnd === n;
    } catch (e) { return true; }
  }

  // Visual start column of a cell within its row, honouring earlier cells' colSpan.
  function colStart(cell) {
    var row = cell.parentNode, c = 0;
    for (var i = 0; i < row.cells.length; i++) {
      if (row.cells[i] === cell) return c;
      c += row.cells[i].colSpan || 1;
    }
    return c;
  }

  // Editable fields in a row, each tagged with the visual column its cell starts at.
  function rowFields(row) {
    var out = [];
    for (var i = 0; i < row.cells.length; i++) {
      var cell = row.cells[i], cs = colStart(cell);
      var els = cell.querySelectorAll(SEL);
      for (var j = 0; j < els.length; j++) {
        if (visible(els[j])) out.push({ el: els[j], col: cs });
      }
    }
    return out;
  }

  function nearestByCol(list, col, exclude) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      if (list[i].el === exclude) continue;
      var d = Math.abs(list[i].col - col);
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best;
  }

  function land(el) {
    el.focus();
    try { if (isTextEntry(el) && el.type !== 'number') el.select(); } catch (e) {}
  }

  function vMove(table, curEl, step) {
    var cell = curEl.closest('td,th'); if (!cell) return false;
    var rows = Array.prototype.slice.call(table.rows);
    var ri = rows.indexOf(cell.parentNode); if (ri < 0) return false;
    var col = colStart(cell);
    for (var r = ri + step; r >= 0 && r < rows.length; r += step) {
      var list = rowFields(rows[r]);
      if (!list.length) continue;
      var t = nearestByCol(list, col, curEl);
      if (t) { land(t.el); return true; }
    }
    return false;
  }

  function hMove(table, curEl, step) {
    var cell = curEl.closest('td,th'); if (!cell) return false;
    var row = cell.parentNode;
    var list = rowFields(row);
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].el === curEl) { idx = i; break; }
    if (idx < 0) return false;
    var ni = idx + step;
    if (ni >= 0 && ni < list.length) { land(list[ni].el); return true; }
    // wrap to the adjacent row's far edge
    var rows = Array.prototype.slice.call(table.rows);
    var ri = rows.indexOf(row);
    for (var r = ri + step; r >= 0 && r < rows.length; r += step) {
      var rl = rowFields(rows[r]);
      if (!rl.length) continue;
      land((step > 0 ? rl[0] : rl[rl.length - 1]).el);
      return true;
    }
    return false;
  }

  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.altKey || e.metaKey || e.isComposing) return;
    var el = e.target;
    if (!el || !el.closest || (el.matches && !el.matches(SEL))) return;
    var cell = el.closest('td,th'); if (!cell) return;
    var table = cell.closest('table'); if (!table) return;

    var k = e.key, handled = false, isSelect = tag(el) === 'select', isArea = tag(el) === 'textarea';

    if (k === 'ArrowDown') { if (!isSelect) handled = vMove(table, el, 1); }
    else if (k === 'ArrowUp') { if (!isSelect) handled = vMove(table, el, -1); }
    else if (k === 'Enter' && !isArea && !isSelect) { handled = vMove(table, el, e.shiftKey ? -1 : 1); }
    else if (k === 'ArrowRight') {
      if (isTextEntry(el) && !caretAtEnd(el)) return;
      handled = hMove(table, el, 1);
    } else if (k === 'ArrowLeft') {
      if (isTextEntry(el) && !caretAtStart(el)) return;
      handled = hMove(table, el, -1);
    }

    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
