# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A set of standalone HTML "PM check sheet" forms for POMI's Electric Unit 7/8 electrical
maintenance team (motors, transformers, switchgear, UPS, batteries, ESP, hoists, generator
brush gear, etc.), plus a shared `dashboard.html` that reads every submission back out of
Firestore for review and Excel export. There is **no build step, no bundler, no package.json,
no test suite** — every page is a single self-contained `.html` file with inline `<style>`
and `<script>`, sharing two small JS files (`firebase-config.js`, `db-helper.js`) and a couple
of PNG assets (`LOGO POMI.png`, `brush_magazine_diagram.png`) via plain `<script src>`/`<img src>`
tags.

## Running / testing changes

- Open the `.html` file directly in a browser, or serve the folder with any static server
  (e.g. `python3 -m http.server 8765`) if you need clean relative-path loading.
- All CDN dependencies (jsPDF, jsPDF-autotable, Firebase App/Firestore compat SDKs, Google Fonts)
  are loaded from `<script src="https://...">` tags at the top of each file — an internet
  connection is required even when running locally.
- Firestore project credentials live in `firebase-config.js` (shared by every check sheet).
  There is no local emulator config (`firebase.json` doesn't exist) — writes go to the real
  `pomi-checksheet-e7` project.
- There is no linter or test command. Verify JS changes with `node --check` on the extracted
  inline `<script>` body before considering an edit done, since a syntax error inside one
  `<script>` block silently kills every function defined after it on that page.
- No headless/browser test harness exists in this repo; manual verification means opening the
  page and clicking through Draft/Submit DB/Download PDF.

## The data contract that must stay consistent

This is the part most likely to regress if a check sheet is edited without checking it:

- Every check sheet's "Submit DB" button calls `submitToDb()`/`saveToDatabase()`, which must end
  by calling `DB.save(base)` (from `db-helper.js`). `DB.save` **always** writes to the single
  shared Firestore collection `checksheets` — this is what `dashboard.html`'s `DB.getAll()`
  reads. A check sheet that writes to its own `db.collection('something').add(...)` instead of
  going through `DB.save()` will never show up in the dashboard. (This bug existed in
  `HV_Motor_6Monthly_PM.html`, `HV_Motor_SWGR.html`, `LV_Motor_MCC.html`, and
  `Hoist_Inspection_Maintenance.html` and was fixed by adding `<script src="db-helper.js">` and
  switching their submit function to `DB.collectCheckSheetData(...)` + `DB.save(...)`.)

- `DB.collectCheckSheetData(formId, assetTag, assetName, frequency)` auto-scrapes header fields
  by a **fixed set of element ids**: `wo-no`, `wo-date`, `time-start`, `time-end`, `checked-by`,
  `nik`, `reviewed-by`, `shift`, `findings`, `recommendations`. Several check sheets use
  different ids for the same concept (e.g. `done-by` instead of `checked-by`, `comments`/
  `actions-taken` instead of `findings`/`recommendations`). When adding a new check sheet, either
  match those exact ids, or after calling `collectCheckSheetData` explicitly backfill the
  mismatched fields, e.g.:
  ```js
  const base = DB.collectCheckSheetData('formid', assetTag, assetName, 'FREQUENCY');
  base.checkedBy = base.checkedBy || document.getElementById('done-by')?.value.trim() || '';
  base.recommendations = base.recommendations || document.getElementById('actions-taken')?.value.trim() || '';
  ```
  Getting this wrong silently blocks submission (the "Isi nama teknisi terlebih dahulu" check
  fails) or drops findings/recommendations text without any visible error.

- Before saving, set `base.sheets` to a structured object — this is what `dashboard.html`'s
  detail modal (`showDetail()`) and `exportExcel()` render with full fidelity (criteria text,
  section dividers, multi-column tables). Without it, dashboard falls back to a much thinner
  auto-scraped `items`/`measurements` shape that loses criteria and grouping. Shape:
  ```js
  base.sheets = {
    sectionKey: {
      title: 'A — Section Title',
      columns: ['TAG1', 'TAG2'],            // equipment tags, or e.g. ['Result','Remark']
      rows: [
        { no: '1', desc: 'Inspection item', crit: '< 40°C', section: 'optional group label',
          values: { TAG1: '23', TAG2: '25' } },
      ],
      remark: 'optional whole-sheet remark',
    },
  };
  ```
  `ESP_7BGPCP800A_B.html` is the canonical reference implementation of this pattern (see its
  `mkSheet()` helper and `submitToDb()`) — copy its approach for any new check sheet rather than
  inventing a new shape. Value-getter conventions to reuse: `tv(id)` reads a toggle result from
  the page's `ST` state object (`'OK'|'NG'|'—'`), `iv(id)`/`gv(id)` reads a trimmed input value or
  `'—'`.

- `index.html` is the portal page linking to every active check sheet. `esp_checksheet.html` is
  a legacy duplicate of `ESP_7BGPCP800A_B.html` (older layout, different asset tag
  `7BG-ESP-V1`) kept for compatibility but not linked from the portal — don't treat it as the
  reference implementation.

## Per-file conventions worth matching

- Toggle OK/NG widgets: a page-level `const ST = {}` state object, a `mkTog(id)` helper that
  renders two buttons (`.rb.ok-idle/ng-idle` → `.ok-act/ng-act` on click via a `setTog`/`setBtn`
  function), and `ST[id]` read back as the value. Some files use a `.r-sel` `<select>`
  (OK/NG/N/A) instead — check which pattern a file already uses before adding rows.
- PDF export uses `jsPDF` + `jspdf-autotable`; local images (logos, diagrams) must be converted
  to a data URL first via a small `imgToDataUrl(src)` helper (draw an `<img>` onto a `<canvas>`,
  `toDataURL()`) before `pdf.addImage()` — see `GEN_BrushGear_PM_Checksheet.html` for the
  current version of this helper.
- Draft persistence uses `localStorage` with a per-file key (e.g. `'gen_brush_draft'`), saving
  every input's value plus the `ST` toggle map, restored via a `loadDraft()` called on init.
