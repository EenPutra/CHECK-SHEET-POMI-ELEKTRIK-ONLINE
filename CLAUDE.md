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

## Photos: `img-helper.js` + `photo-kit.js` — never size a photo by hand

Every check sheet that takes evidence photos now shares one pipeline. **Do not add a
`<input type="file">` handler or a `pdf.addImage(dataUrl,'JPEG',x,y,W,H)` call of your own** —
that is exactly what used to squash photos: jsPDF scales X and Y independently, so a portrait
phone shot forced into a landscape box came out distorted and the readings in it became
unreadable.

Two layers, loaded in this order, after `db-helper.js`:

```html
<script src="img-helper.js"></script>
<script src="photo-kit.js"></script>
```

- **`img-helper.js` (`window.IMG`)** — low level, no UI. `IMG.read(file,cb)` normalises a picked
  file (bakes in the EXIF rotation, downscales to 1600px longest edge, re-encodes JPEG, reports
  the true pixel size); `IMG.fit(boxW,boxH,nat)` is the letterbox maths; `IMG.place(pdf,…)` is an
  aspect-safe `addImage`; `IMG.measure`/`IMG.ratioOf` recover a ratio for photos with no stored
  size.
- **`photo-kit.js` (`window.PhotoKit`)** — the UI and the print size, built ON TOP of `IMG` (it
  delegates every low-level call to it, so there is one implementation of the maths, not two).
  Adds the source picker (Camera/Gallery), the crop modal (Default / ratio preset / 1:1 / manual
  cm) with 90° rotation, and a per-photo print size in cm.

### The contract

A photo is an **entry**: `{src, dataUrl, w, h, widthCm, heightCm, caption}` (`src` and `dataUrl`
are the same string, so older per-sheet code reading either key keeps working). `w/h` are pixels;
`widthCm/heightCm` are the size it prints at. On save the cm are snapped to the photo's real
aspect ratio, so **the label on screen equals what lands in the PDF**.

```js
PhotoKit.configure({maxWcm:8.8, maxHcm:15, defaultWcm:8.8, defaultHcm:5.6});  // once, at init
PhotoKit.upload(anchorEl, {multiple:true}, entry => { store(entry); render(); });
PhotoKit.fromFile(file, entry => { … });       // when the sheet has its own <input>
PhotoKit.recrop(entry, updated => { … });      // the ✂ button on a thumbnail
await PhotoKit.prepare(list);                  // fill in w/h for photos from a draft/Firestore
const d = PhotoKit.fit(entry, boxW, boxH);     // mm it will occupy; d.dx centres it in boxW
PhotoKit.draw(pdf, entry, x, y, boxW, boxH, {align:'center'});
```

`PhotoKit.fit()` holds the anti-stretch invariant: the returned width/height **always** keep the
source aspect ratio, and the chosen cm size is only ever an upper bound (a box the photo is
fitted and centred into), never a stretch target. A caller therefore cannot distort a photo even
by passing a box of the wrong shape.

### Rules when touching a sheet's photo code

- `configure()` per sheet, from that sheet's own page + grid geometry: `maxWcm` is the width of
  the column the photo lands in (a 3-up grid on landscape A4 with M=11 is 8.8cm), `maxHcm` the
  usable height. `PhotoKit.limitsFromMargins(mx,mtop,mbot,pageW,pageH)` computes the page-level
  caps when there is no grid.
- **Rotating a photo 90° must swap `w`/`h` AND `widthCm`/`heightCm`.** A rotate that only rewrites
  `src` leaves the PDF sizing the photo to its pre-rotation shape (this bug existed in the motor
  sheets' `rotatePhoto()`).
- **Drafts and Firestore records must carry `w`, `h`, `widthCm`, `heightCm`.** Saving only
  `{src, caption}` silently throws away the crop: on reload every photo falls back to the default
  box (this bug existed in `HV_Motor_SWGR`'s draft save for both `PHOTOS` and `TREND_PHOTOS`).
- Re-crop must replace the entry **at the same index** (`arr[i] = updated`), never
  remove-then-push — otherwise the photo jumps to the end of the gallery and the captions, which
  are indexed, end up attached to the wrong photos.
- Thumbnails use `object-fit:contain`, not `cover`, so the on-screen preview shows what will
  print.
- For a sheet that prints via `window.print()` instead of jsPDF (`Hoist_Inspection_Maintenance`),
  carry the cm into print CSS as `max-width`/`max-height` custom properties
  (`--pk-w`/`--pk-h`) with `width:auto;height:auto` — max-only constraints cannot force a ratio.

`Transformer_AT_NoDGA_Weekly.html` (slot-based) and `4000_Hours_Mill_PM.html` (per-tab galleries)
are the reference integrations. `Battery_7EB-BY-125-250.html` / `ESP_7BGPCP800A_B.html` show the
shape to copy when a sheet has **no** photo feature yet: an "Evidence Photos" panel placed just
before "Findings & Conclusion", a free-count gallery (`PHOTOS[]` with crop / rotate / delete /
caption per thumbnail), photos persisted under their own `<draftKey>_photos` localStorage key
(separate from the draft, so a quota error on the photos cannot take the draft down with it),
and a matching photo section in `generatePDF()` just before its Findings block. `FITUR_REUSABLE_REFERENCE.md` in this folder is where the crop
modal's UX rules come from (it documents the same feature set as implemented in another repo).

## PDF export — direct download, not the browser print dialog

Newer check sheets (starting with `Work_Activity_Record.html`) generate the PDF directly with
jsPDF + jsPDF-autoTable and trigger a real file download via `pdf.save(...)` — they do **not**
rely on `window.print()` / "Save as PDF" from the browser's print dialog. The print-dialog route
was tried first and abandoned: browser print margins, scaling, and "headers and footers" options
are outside our control and produced inconsistent output across machines. Any new check sheet's
"Download PDF" button should call a `generatePDF()` function that builds and downloads the file
itself, following this same pattern for consistency:

- **Script includes**: load both
  `https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` and
  `https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.6.0/jspdf.plugin.autotable.min.js`.
  Use `pdf.autoTable({...})` for any tabular section (label/value pairs, checkbox rows, results
  grids) instead of hand-drawn `pdf.rect()`/`pdf.line()`/`pdf.text()` — autoTable auto-wraps long
  cell text within its column and computes row heights, which avoids the label-overflow bugs that
  manual pixel-math tables are prone to. `colSpan`/`rowSpan` on body cell objects work for merged
  cells — see the Work Order Type checkbox block in `Work_Activity_Record.html` for a worked
  example: a `rowSpan:3` label cell plus per-row `_chk` marker cells drawn via `didDrawCell`.

- **Letterhead background**: every PDF page should get the full-page POMI/Paiton Energy letterhead
  (swoosh header band + POMI VALUE/Kerjaku Bermakna footer band) as a single full-bleed background
  image drawn at `(0,0,210,297)`, not as two separately-positioned header/footer bands — trying to
  reconstruct the header and footer separately from cropped pieces is what caused the original
  mismatch in `Work_Activity_Record.html`. The canonical source is `war-pdf-background.jpg` (a
  resized, ~40KB copy of the client-provided `DRAFT PM KOSONG.jpg` letterhead template) — reuse
  this exact file for any new check sheet's PDF export rather than re-deriving the letterhead from
  a different reference each time.

- **Embed the background as base64, not as a runtime-loaded `<img>`**: opening these files via
  `file://` (the normal way a technician opens them — double-click, no server) taints the canvas
  when `imgToDataUrl()` tries to convert a sibling image file to a data URL, so `pdf.addImage()`
  silently gets nothing and the letterhead just doesn't appear, with no visible error. Avoid this
  for the full-page background by precomputing its base64 once and embedding it as a
  `const ..._URI = "data:image/jpeg;base64,...";` directly in the `<script>` block (see
  `WAR_BG_URI` in `Work_Activity_Record.html`). `imgToDataUrl()` at runtime is still fine for small
  logos that aren't essential to letterhead fidelity (see `GEN_BrushGear_PM_Checksheet.html`), but
  don't rely on it for anything the letterhead match depends on.

- **Repeat the background on every page**: use an `ensureBg()` helper keyed by
  `pdf.internal.getCurrentPageInfo().pageNumber` so the background is drawn exactly once per page,
  called (a) once at the very start and (b) after every manual `pdf.addPage()` in your own
  page-break/`checkY()` logic. Also set `margin:{top:TOP_START, bottom:H-BOTTOM_LIMIT, left:M,
  right:M}` on every `autoTable()` call's theme object — without it, autoTable's own internal
  pagination uses jsPDF's default margins and ignores your safe content band.

  **Never rely on `didDrawPage` to draw the background for autoTable's own internal page
  breaks.** It's tempting to add `didDrawPage: () => ensureBg()` to the shared table theme so
  a table that splits mid-page gets the background on its continuation page too — but
  `didDrawPage` fires *after* that page's rows have already been drawn, not before. jsPDF has no
  z-index, so `ensureBg()` firing there paints the background **over** the rows that just
  landed on the new page, silently erasing them (confirmed by instrumenting `data.cursor.y` in
  `didDrawPage`, which matches `finalY` — i.e. the *end* state, not the start). The page renders
  as a blank gap under the letterhead followed by whatever content comes after the table in your
  script, which looks like a layout bug but is actually erased data.

  The real fix: never let a table paginate internally in the first place. Before every
  `autoTable()` call whose row count isn't fixed/small, estimate its height and pre-check with
  `checkY()` so it always starts fresh on a page with enough room for the *whole* table:
  ```js
  checkY(Math.min(BOTTOM_LIMIT-TOP_START, rows.length*9+10));  // force a clean page break first
  pdf.autoTable({...kvTheme, startY:y, body: rows, ...});
  ```
  `Math.min(..., BOTTOM_LIMIT-TOP_START)` caps the estimate at one page's usable height so this
  doesn't loop forever for a table too long to ever fit on a single page. See the per-asset check
  list table in `4000_Hours_Mill_PM.html` (up to 27 rows) for a worked example — it forces a page
  break instead of trusting autoTable to split cleanly.

- **Content margins**: reserve roughly the top ~27mm and bottom ~21mm of each A4 page (i.e. keep
  body content between y≈27mm and y≈276mm) so text never overlaps the letterhead's header/footer
  artwork. These numbers come from measuring `war-pdf-background.jpg` itself — recompute them if
  the letterhead image ever changes.

- **Button label**: "⬇️ Download PDF" calling `generatePDF()`, not "🖨️ Print / Save PDF".

- **Only ASCII in `pdf.text()` unless the sheet embeds a font**: jsPDF's built-in helvetica/times
  have no `▶`, so section headers written as `pdf.text('▶  '+title,…)` printed as `%¶` in
  `Battery_7EB-BY-125-250.html`, `ESP_7BGPCP800A_B.html` and `esp_checksheet.html` — every header
  on every page. Use `'>'`. Sheets with a `sanitizeText()` helper already strip these; the ones
  without it must avoid the glyph at the call site.

- **Photos inside the PDF**: never call `pdf.addImage()` on an evidence photo directly — use
  `PhotoKit.draw()`/`PhotoKit.fit()` (see the photo section above). Passing a fixed width/height
  box to `addImage()` stretches the photo, because jsPDF scales the axes independently.

- **Verifying changes to `generatePDF()`**: `pdf.save()` triggers a real browser download, so it
  can't be checked with a normal print-to-PDF screenshot. To inspect actual output, temporarily
  replace the `pdf.save(...)` line with
  `window.__pdfDataUri = pdf.output('datauristring'); window.__pdfDone = true;` in a scratch copy,
  drive it with headless Chrome over the DevTools protocol (`--remote-debugging-port`,
  `--remote-allow-origins=*`), poll for `window.__pdfDone`, then read back `window.__pdfDataUri`
  and decode it to a `.pdf` file. Never leave this debug hook in the committed file.

- **Charts in the PDF (e.g. megger insulation-resistance trend graphs)**: no charting library is
  needed — draw a plain `<canvas>` per chart with a small hand-rolled line-chart function (axes,
  gridlines, points; see `drawLineChart()`/`MEG_ROWS`/`MEG_TIMES` in `4000_Hours_Mill_PM.html`),
  then embed it with `pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h)`. Force a
  fresh redraw of each canvas from its current input values *inside* `generatePDF()` right before
  capturing it — a canvas some other tab last touched may be stale or was never drawn if the user
  never visited that tab on screen, and `display:none` on an ancestor does not stop a canvas from
  rendering or being read back, so redrawing is cheap insurance.

- **Never double-escape unicode/JS escapes when a tool writes literal file content.** `Write` and
  `Edit` write the exact bytes you give them — there is no extra string-literal layer to account
  for. If you want the JS source to contain the escape sequence `—` (so the browser renders
  an em dash), the tool content must contain a *single* backslash. Typing `\\u2014` (a habit
  carried over from authoring Python string literals) produces a file with two literal characters
  `\` `\` followed by `u2014`, which JS then parses as an escaped backslash plus literal text —
  so the page displays the literal string `—` instead of `—`. This is easy to miss visually
  in a diff; grep the assembled output for `\\\\u[0-9a-fA-F]\{4\}` before considering unicode-
  heavy JS content done.

## Multi-asset tabbed check sheets (e.g. "4000 Hours Mill PM")

Some PM events cover several distinct physical assets in one visit (a Mill's pulverizer motor,
feeder, cleanout conveyor, lube oil pump, and oil tank heater are five separate tags maintained
together). `4000_Hours_Mill_PM.html` is the reference implementation for this shape — reuse its
pattern rather than inventing a new one:

- **One selector cascades tags across N tabs.** A single dropdown (e.g. Mill A–F) resolves each
  tab's asset tag (`prefix + letter`) and, where a master data source exists, auto-fills that
  tab's Basic Motor Data. Keep the tag fields read-only in each tab — they're derived, not typed.
- **Namespace every field ID by a per-tab prefix** (`res-${prefix}-${id}`, `rmk-${prefix}-${id}`,
  `meg-${prefix}-${rowKey}-${timeKey}`, …) so the same generic checklist-rendering code can serve
  every tab without ID collisions, and so `resultState`/`olState`/`PHOTOS` can all be plain
  objects keyed by prefix instead of duplicated per-tab globals.
- **One combined Firestore record, not N separate ones** (confirm this with the user — it was an
  explicit choice here, not a default): call `DB.collectCheckSheetData()` once with a synthetic
  asset tag representing the whole visit (e.g. `MILL-B-4000H`), then build `base.sheets` by
  merging each asset's contribution under prefixed flat keys (`pvr_check`, `pvr_motor`,
  `fdr500_check`, …) — still flat per the existing data contract, just with more entries than a
  single-asset check sheet has.
- **Photos belong to the sheet that took them, not one shared gallery.** Give every tab its own
  upload zone and its own array (`PHOTOS[key]`), not one array for the whole submission — otherwise
  a photo taken for one asset visually and semantically leaks into another asset's report.
- **Each asset's PDF section starts on a fresh page.** Force `pdf.addPage()` before every asset
  except the first (`if(assetIdx > 0){ pdf.addPage(); y=TOP_START; ensureBg(); }`) so the exported
  report reads as N self-contained sub-reports back to back, not one continuous flow with assets
  bleeding into each other wherever a page happened to end.
- **When a source template's checklist is much larger than others being combined** (the ported HV
  motor checklist is 27 items with megger/PI-DAR/RTD/motor-protection/DCS sub-widgets, versus a
  15-item LV motor checklist), write ONE generic special-case renderer that switches on
  `chk.special` and takes a `prefix` argument, instead of copy-pasting each source file's own
  renderer per tab. It's more code up front but avoids five near-duplicate implementations
  drifting apart.

## The portal (`index.html`) is a bundled single-page app — do not "fix" it

`index.html` does **not** look like a normal static HTML page when read as raw text (`cat`,
`grep`, `Read`) — it's a self-contained bundle: the real portal markup/JS/data lives inside an
escaped JS string, unpacked by a small loader at runtime. Reading the raw file shows what looks
like garbage (base64 font data, a `#__bundler_loading` placeholder, escaped `\n`s) — **this is
normal and does not mean the file is broken.** Load it in an actual browser (or headless Chrome)
before concluding anything is wrong with it; commit `cc6fc49` exists specifically because a past
session made this exact mistake and clobbered the live bundle with an old unbundled backup,
changing the deployed look by accident.

To add a new check sheet's card to the portal, do **not** try to reconstruct or replace
`index.html`. Instead:
1. `grep -o "id:'<some-existing-id>'[^}]*}" index.html` to see the exact object shape:
   `{id:'...', cat:'...', tag:'...', name:'...', freq:'...', status:'live'|'ready'|'soon',
   prog:N|null, href:'....html', desc:'...'}`. `cat` must be one of the existing category codes
   (`dc`, `tx`, `sg`, `gen`, `motor`, `prot`, `ups`, `esp`, `gnd`, `lifting`, `report` — note the
   sidebar's "MTR"-style labels are display abbreviations, the actual `cat` value is the full
   word, e.g. `motor`).
2. Use `Edit` to insert a new object literal next to a thematically similar existing one,
   matching its exact formatting (including the literal `\n\n      ` between entries — that's
   part of the bundle's embedded string, not a real newline you can reformat).
3. Verify by actually loading `index.html` in headless Chrome and checking the card and category
   counts (`Semua Aset` total, the per-category sidebar numbers) update — both are computed from
   the array length at runtime, so a correctly-inserted entry updates them automatically with no
   further edits needed.

## `dashboard.html` — Transformer PM Trend Analysis (parameter trend chart)

`dashboard.html` (the analytics dashboard, separate from the check sheets) has a
"Transformer PM Trend Analysis" panel — pick one check sheet, one parameter, one
piece of equipment, and see that parameter's value across every past PM for that
asset, compared against the immediately preceding submission. It is deliberately
scoped to the two **weekly Transformer AT** sheets only (`Transformer_AT_NoDGA_Weekly.html`
and `Transformer_AT_DGA_Weekly.html`) — this was a first rollout on one data set,
not a general trend feature for every check sheet.

- **`TREND_ASSETS`** (assetTag → label) is the whitelist of check sheets the panel
  offers. Extending to another weekly sheet only works if that sheet's
  `base.sheets.main.rows` follow the same shape everyone else already uses (see
  "The data contract" above): `{section, no, desc, crit, values}` with `values`
  keyed by an equipment/column tag. Add the tag to `TREND_ASSETS` and — if any of
  its numeric rows should show a unit — add a matching entry to `TREND_UNITS`.
- **`TREND_UNITS`** exists because `collectSheetData()` in the check sheets never
  saves the unit into `values` (only the technician's raw number — the unit is a
  sibling `<span>` in the DOM, not part of the saved value). The map mirrors each
  row's unit as labelled in that sheet's own `mkSheet()`, keyed by `"no||desc"`,
  **kept separate per asset tag** — the No-DGA and +DGA weekly sheets diverge on
  which rows are numeric (e.g. `B.1`/`B.2` are OK/NG toggles in the DGA sheet but
  `%` measurements in the other). Getting one row's unit wrong here only mislabels
  an axis/table cell, it never changes what's plotted.
- **Numeric vs status is auto-detected from the data**, not hardcoded per row:
  if any historical value for the chosen (parameter, equipment) pair is one of
  `TREND_STATUS_TOKENS` (`OK`/`NG`/`Leak`/`No Leak`/`Clean`/`Dirty`/`Noise`/`Normal`),
  the whole series renders as a colored status strip (bar chart, green/red/gray
  per `trendGoodness()`) instead of a line chart. Otherwise every value is run
  through `trendParseNumeric()` (averages every number found in the string, so a
  multi-input field saved as `"34/56/78%"` — the silicagel breakdown — still
  plots a sensible point) and rendered as a line.
- **No guessed threshold lines.** Row `crit` text (e.g. `"SST/EXC ≤85°C ·
  UAT/SUT/GSUT ≤95°C alarm"`) is shown verbatim under the chart, not parsed into
  a drawn limit line — the per-equipment-column threshold can't be split
  reliably out of that free text, and a wrong line would be worse than no line.
- **Delta color-coding is deliberately split in two:** a numeric parameter's
  up/down arrow uses neutral blue/indigo (`.up`/`.down` — we don't know whether
  *any* given parameter trending up is good or bad), while a status parameter's
  change uses real green/red (`.good`/`.bad`, `trendGoodness()`) because OK↔NG
  genuinely is a quality judgement the technician already made. Don't collapse
  these back into one color scheme — that was tried in an earlier draft of this
  feature and silently implied "higher = worse" for parameters where that isn't
  true.

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
