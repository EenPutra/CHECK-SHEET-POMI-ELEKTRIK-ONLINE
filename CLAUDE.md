# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A set of standalone HTML "PM check sheet" forms for POMI's Electric Unit 7/8 electrical
maintenance team (motors, transformers, switchgear, UPS, batteries, ESP, hoists, generator
brush gear, etc.), plus a shared `dashboard.html` that reads every submission back out of
Firestore for review, Excel export, and a Transformer PM parameter trend chart (see the
`dashboard.html` section below). There is **no build step, no bundler, no package.json,
no test suite** — every page is a single self-contained `.html` file with inline `<style>`
and `<script>`, sharing four small JS files (`firebase-config.js`, `db-helper.js`,
`img-helper.js`, `photo-kit.js` — the last two are the shared evidence-photo pipeline, see
"Photos" below) and a couple of PNG assets (`LOGO POMI.png`, `brush_magazine_diagram.png`) via
plain `<script src>`/`<img src>` tags.

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
- **There is no *committed* test harness, but headless Chrome driven over the DevTools Protocol
  (CDP) works well as an ad hoc one and was used throughout the photo-pipeline and
  `dashboard.html` trend-chart work** — don't assume "no test suite" means no way to verify JS
  logic without a human clicking through the UI. The pattern: serve the folder
  (`python3 -m http.server 8765`), launch
  `google-chrome --headless=new --disable-gpu --remote-debugging-port=9333 --remote-allow-origins=* <url>`,
  then drive it from Node with the `ws` package — `GET /json/list` on port 9333 to find the tab,
  open its `webSocketDebuggerUrl`, and send `Runtime.evaluate` (with `awaitPromise:true` for an
  async IIFE) to run arbitrary JS in the page and read back `window.__res`/`window.__done`. This
  lets a session inject synthetic data (`allData = [...]` for `dashboard.html`, fake `PHOTOS`/
  `FILES` entries for a check sheet), call the page's own functions directly (`renderParamTrend()`,
  `addTrendSeries()`, `generatePDF()`, …), and assert on real return values / DOM / Chart.js
  instance state — not just "did it throw". `Page.captureScreenshot` (full page, or a `clip` from
  an element's `getBoundingClientRect()`) gives a visual check without a human in the loop. Two
  gotchas that cost real debugging time: (1) a `<script>`-defined top-level `let`/`const` is a
  lexical binding, not a `window` property — assign to it directly (`allData = [...]`, no
  `window.` prefix) or a later `Runtime.evaluate` reading `allData` won't see the change; (2) give
  the page enough time to finish loading its CDN scripts (Chart.js, Firestore SDK, jsPDF) before
  the first `Runtime.evaluate` — 6–8s is not always enough, a `getElementById(...) === null`
  error on an element that definitely exists in the HTML is the symptom, not a real bug.
  `dashboard.html`'s login gate is a pure client-side check, not a Firestore security rule — for
  read-only investigation, `document.getElementById('login-overlay').style.display='none'` plus
  calling `loadData()` directly reaches real Firestore data without needing dashboard credentials
  (this is how the `TREND_LEGACY_SOURCE` gap was found and confirmed — see below). Never use this
  read access path to *write*; treat any write-triggering call (`DB.save`, `submitToDb()`,
  `generatePDF()`'s own `pdf.save()`) as a real action requiring the same care as if a human
  clicked the button, and confirm with the user first if a session's test plan would trigger one
  against production data.

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

- **`4000 Hours Mill/Mill 4000 Hours PM.html`** is a second, diverged duplicate — not linked from
  the portal either, and NOT the same shape as the canonical `4000_Hours_Mill_PM.html` (the
  5-asset tabbed sheet described below). It's actually a renamed clone of `HV_Motor_SWGR.html`
  (title still reads "HV Motor SWGR — PM Check Sheet"), single-asset, with its own
  `loadLastFromDb(tag)` that pulls the most recent Firestore submission for the selected tag and
  restores it into the form — auto-triggered from `selectTag()` right after a technician picks a
  motor tag, mirroring the same pattern `HV_Motor_SWGR.html` uses.
  **This auto-load never actually ran**, because `selectTag()` itself crashed first: it
  unconditionally sets `.textContent` on `#ol-code`/`#ol-plug`/`#ol-setting` (the OL/overload
  heater info box), but no entry in the `CHECKS` array carries `special:'ol'` — `chkRowHtml()`'s
  `if(chk.special==='ol')` branch that would render those elements is dead code, so
  `document.getElementById('ol-code')` returns `null` and the assignment throws, aborting
  `selectTag()` before it ever reaches the `loadLastFromDb(tag)` call at the end. Confirmed via a
  headless-Chrome call to `selectTag('7EB-HV-001')`, which threw `Cannot set properties of null
  (setting 'textContent')` before the fix and completed cleanly (with a stubbed Firestore response
  correctly restoring form values) after it. Fixed here by guarding every
  `ol-code`/`ol-plug`/`ol-setting`/`ol-range-body` DOM access (`selectTag`, `refreshOLTable`,
  `loadLastFromDb`, `resetForm`, `submitToDb`'s `olData` collection) with `?.`/null checks instead
  of assuming the elements exist — this only stops the crash, it does not restore the OL box's
  visibility (that would mean deciding which `CHECKS` item the `special:'ol'` marker belongs on,
  which isn't obvious from the current data: the OL box's hardcoded `mkSel('c6')`/`rmk-c6` ids
  point at check item 6, "Close the breaker manually…", whose task text has nothing to do with
  overload heater sizing — this looks like an older edit dropped the marker and/or swapped the
  item's text, and untangling which is now ambiguous without more context).
  **The identical dead-code bug existed in the canonical `HV_Motor_SWGR.html`** (same `CHECKS`
  array, same missing `special:'ol'` marker, same unguarded `selectTag()`) — that file is linked
  from the portal, so technicians were hitting this same crash. Patched there too with the same
  `?.`/null-guard treatment (`selectTag`, `refreshOLTable`, `resetForm`, `submitToDb`'s `olData`
  collection — this file has no `loadLastFromDb()` to begin with, unlike the Mill duplicate, so
  there was nothing further downstream to unblock). The OL box's own visibility is still not
  restored, same reasoning as above — the `special:'ol'` marker's correct home in `CHECKS` is
  still ambiguous.

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

  **A near-miss overflow (content only slightly over one page's budget) is usually better fixed by
  making it fit than by forcing an earlier break.** On the PVR-500 tab, the motor-data table plus
  its 20-row checklist measured ~255mm combined against a ~249mm page — over by only ~6mm. Forcing
  `checkY()` to break earlier just pushed the ENTIRE checklist onto a fresh page, leaving the
  motor-data table's page mostly blank and the checklist looking orphaned at the top of the next
  one (confirmed by rendering the actual PDF, not by reasoning about the numbers). The fix was to
  tighten that one table's `cellPadding` (2.2mm → 1.7mm, via a local `{...kvTheme.styles,
  cellPadding:1.7}` override passed as `styles:` on just that `autoTable()` call) to reclaim
  ~1mm/row, closing the gap so both tables render together as originally intended — and updating
  the `checkY()` row-height estimate to match the tightened padding (`rows.length*8.7+12`) so the
  pre-check still agrees with what autoTable will actually do. Don't reach for "force a page break
  sooner" as the default fix for an overflow this small; check whether shaving padding on the
  oversized table closes the gap first, and only fall back to an earlier break when the content
  is too long to ever fit on one page no matter how tight the padding gets.

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
  can't be checked with a normal print-to-PDF screenshot. Uses the same headless-Chrome/CDP
  technique as "Running / testing changes" above; two ways to capture the output without ever
  editing the committed file:
  - **Preferred — patch the method at runtime, not the file**: from the CDP driver, before calling
    `generatePDF()`, run
    `const API=window.jspdf.jsPDF.API; const orig=API.save; API.save=function(){window.__pdfDataUri=this.output('datauristring');return this;};`
    then call `generatePDF()` and restore `API.save=orig` after. No file edit, no debug hook to
    remember to revert — this is what the PhotoKit rollout used to generate real PDFs from
    synthetic photo data across a dozen check sheets.
  - **Older/simpler variant**: temporarily replace the `pdf.save(...)` line with
    `window.__pdfDataUri = pdf.output('datauristring'); window.__pdfDone = true;` in a scratch
    copy of the file, poll for `window.__pdfDone`. Only use this if the API-patch approach doesn't
    fit (e.g. the sheet doesn't expose `window.jspdf`); never leave the hook in the committed file.

  Either way, decode `window.__pdfDataUri` (strip the `data:...;base64,` prefix, `base64 -d`) to a
  real `.pdf`, then `pdftoppm`/`pdftotext` it to check the actual rendered page rather than
  trusting the JS didn't throw.

- **Charts in the PDF (e.g. megger insulation-resistance trend graphs)**: no charting library is
  needed — draw a plain `<canvas>` per chart with a small hand-rolled line-chart function (axes,
  gridlines, points; see `drawLineChart()`/`MEG_ROWS`/`MEG_TIMES` in `4000_Hours_Mill_PM.html`),
  then embed it with `pdf.addImage(canvas.toDataURL('image/png'), 'PNG', x, y, w, h)`. Force a
  fresh redraw of each canvas from its current input values *inside* `generatePDF()` right before
  capturing it — a canvas some other tab last touched may be stale or was never drawn if the user
  never visited that tab on screen, and `display:none` on an ancestor does not stop a canvas from
  rendering or being read back, so redrawing is cheap insurance.

- **Importing a megger tester's own exported report to auto-fill the 15s..10m matrix**:
  `4000_Hours_Mill_PM.html`'s PVR-500 megger matrix (`chk.special==='meggerMatrix'`) has a
  "📥 Import" button per test-point row (`triggerMegImport(prefix, rowKey)` → the shared hidden
  `#meg-import-file` picker → `handleMegImportFile()`) that reads the tester's own `.txt` export
  instead of the technician retyping 13 numbers off the instrument's screen. `parseMegSeriesFile()`
  only reads the file's "Series Readings" block (lines like `Aug 20, 2026 08:56:09 216 MΩ`, with
  `----` meaning no reading yet and a bare `Ω` meaning plain ohms) — the summary header above it
  (Resistance/PI/DAR/etc.) is a report of the FINAL result only, not a source of the 13
  intermediate points. Elapsed time for each reading is measured from the file's own first valid
  reading (test start), not the header's "Capture Date" (when the report was *saved*, not when
  the ramp began); each of the 13 targets (15s/30s/…/10m) takes whichever real logged reading is
  closest in elapsed time, since the tester logs far more samples than just those 13 checkpoints.
  Converts GΩ/kΩ/bare-Ω to the MΩ this file's matrix already uses everywhere else. Wired to
  `updateMeggerChart(prefix, rowKey)` afterward (redraws that row's chart, and recomputes PI/DAR
  too when `rowKey==='rst_g'`, same as a manual edit would) and `autoSaveNow()` (a JS-set `.value`
  doesn't fire the `input`/`change` events autosave's delegated listener depends on, so this has
  to be called explicitly — same reason photo actions do it, see the autosave section above).

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
- **Each asset's PDF section starts on a fresh page.** Force `pdf.addPage()` before every section
  except the first one that actually gets rendered so the exported report reads as N
  self-contained sub-reports back to back, not one continuous flow with assets bleeding into
  each other wherever a page happened to end. Once the PDF has selectable sheets (below), track
  this with a `firstSection` flag set on whichever sheet renders first, not `assetIdx===0` —
  skipping an unchecked asset must never leave a blank page where its `addPage()` would have
  landed.
- **Let the user pick which sheets go in the PDF, and preview before downloading.**
  `4000_Hours_Mill_PM.html`'s "Download PDF" button opens a checkbox modal
  (`PDF_SHEETS`/`_pdfSel`/`openPdfModal()`/`renderPdfModal()`/`toggleSheet()`) listing the cover
  block, each asset's own section, and the findings block; `generatePDF(selSet, opts)` takes an
  explicit `Set` of the checked sheet keys (defaulting to "all" when called with no args) and
  guards every section with `if(selSet.has(key))`. Confirming the modal calls
  `generatePDF(selSet, {preview:true})`, which builds the real `jsPDF` object but instead of
  `pdf.save(...)` calls `showPdfPreview(pdf, filename)` — that loads `pdf.output('bloburl')` into
  an `<iframe>` inside a second modal so the technician can actually look at the rendered pages
  (including whether photos came out at a sane size) before committing to a download. The preview
  modal's "Unduh PDF" button just calls `.save()` on that same already-built `pdf` object (no
  regeneration); "← Ubah Pilihan Sheet" reopens the sheet-selection modal. This is the pattern to
  copy for any check sheet where the report can get long enough that skipping irrelevant sections
  or catching a layout mistake before download is worth the extra click — the checkbox-modal +
  preview-modal pair, `generatePDF(selSet, opts)`'s signature, and `showPdfPreview()` are all
  reusable as-is.
- **Size photos to the space actually available, not one fixed box for every layout.** A fixed
  `PH_MAX` height (52mm in an earlier version) left portrait phone photos tiny and letterboxed
  inside a landscape-shaped column. Raise the cap generously (`PH_MAX=85` for a 2-up row) and, for
  whichever asset ends up with an odd photo count, give the trailing lone photo the FULL column
  width and a taller cap (`PH_MAX_SOLO=110`) instead of squeezing it into a half-width slot sized
  for a pair — `PhotoKit.fit()` still respects each photo's own aspect ratio either way, this only
  raises how much room it's allowed to use.
- **Auto-compress uploaded photos to stay under a byte budget, not just a pixel budget.**
  PhotoKit's own downscale is pixel-based and doesn't guarantee a file-size cap — a busy/detailed
  JPEG at PhotoKit's normal output size can still land over 1MB, and since this file's Firestore
  document stores every photo inline (no separate blob storage), one oversized photo bloats the
  whole submission. `compressUnder1MB(dataUrl, w, h)` (see `4000_Hours_Mill_PM.html`) checks
  `dataUrlBytes()` against a `PHOTO_MAX_BYTES` cap (~950KB, safely under 1MB either way it's
  counted) and only if over, re-encodes at successively lower JPEG quality
  (`[0.85,0.75,0.65,0.55,0.45]`), and only if quality alone still isn't enough, also shrinks pixel
  dimensions by 20% per pass — never below a still-legible 480px edge — repeating until it fits.
  Call this after every path that can produce a new photo blob: initial upload (`pickPhotos`),
  recrop (`recropPhotoAt`), and rotate (`rotatePhoto`) all await it before storing the result.
- **Persist uploaded photos and form state across an accidental browser refresh, not just on an
  explicit "Save Draft" click.** Discrete photo actions (upload, recrop, rotate, remove) call
  `autoSaveNow()` — an un-debounced, immediate `persistDraft(true)` — right after mutating
  `PHOTOS[key]`, because re-shooting/re-uploading a photo is real lost time on site and a save
  delayed by a debounce window can still be lost to a refresh that lands inside it. Everything
  else (typing, toggling a result, picking a Mill) is covered by one delegated pair of listeners —
  `document.addEventListener('input'/'change', e => { if(e.target.matches('input,select,textarea'))
  scheduleAutoSave(); })` — so autosave coverage for a new field never needs a dedicated
  `onchange` added by hand; `scheduleAutoSave()` just debounces (800ms) into the same
  `persistDraft(true)`. `persistDraft(silent)` writes both `localStorage['mill4000h_draft']`
  (every id'd field's value + toggle state) and `localStorage['mill4000h_photos']`
  (`JSON.stringify(PHOTOS)`) — a silent call flashes a small `#autosave-indicator` ("✓ Tersimpan
  otomatis HH:MM:SS") instead of the normal toast, and if the photos payload alone is too big for
  localStorage's quota it still keeps the non-photo draft and shows a warning state on the
  indicator rather than losing everything. `resetForm()` explicitly
  `localStorage.removeItem('mill4000h_draft'/'mill4000h_photos')` — autosave mirrors every change
  including Reset's own clearing, so without this a refresh right after Reset would silently
  restore the pre-reset data via `loadDraft()`.
- **When a source template's checklist is much larger than others being combined** (the ported HV
  motor checklist is 27 items with megger/PI-DAR/RTD/motor-protection/DCS sub-widgets, versus a
  15-item LV motor checklist), write ONE generic special-case renderer that switches on
  `chk.special` and takes a `prefix` argument, instead of copy-pasting each source file's own
  renderer per tab. It's more code up front but avoids five near-duplicate implementations
  drifting apart.
- **"Load last submission" is a physical button here, not automatic-on-select** — unlike the
  single-asset check sheets (`HV_Motor_SWGR.html`, the diverged Mill duplicate), where
  `loadLastFromDb()` fires the instant a tag is picked, this file's `loadLastFromDb()` only runs
  when the technician clicks "📥 Tarik Data Terakhir" next to the Mill selector (enabled/disabled
  in step with `onMillChange()`). Automatic-on-select doesn't fit here: picking a Mill letter
  ALSO auto-fills every tab's tag/description/motor-data fields from `MCC_MOTORS`/`ASSET_DEFS`
  immediately, so there's no clean moment to distinguish "just picked a Mill" from "user is done
  and wants historical data" the way a single-tag dropdown can. Queries Firestore directly for the
  newest `assetTag == 'MILL-<letter>-4000H'` doc (the synthetic per-visit tag `submitToDb()`
  saves under) and restores it with the same generic-sweep-by-id approach `loadDraft()` already
  uses for localStorage drafts — reuse that pattern rather than inventing a third restore
  mechanism if this needs to change. Two things `loadDraft()`'s restore doesn't have to deal with
  that this DOES: (1) RTD rows (`rtd-<prefix>-<n>-loc`/`-val`) only exist in the DOM once "+ Add
  RTD" has been clicked `n` times for that prefix — `loadLastFromDb()` pre-creates enough rows
  (`rtdCount[prefix]` vs the max `n` found in the saved `inputValues`) before setting their
  values, `loadDraft()` does not do this and will silently drop RTD values on a fresh page where
  no rows have been added yet if that's ever hit; (2) OL sizing state (`olState[prefix]`, LV tabs'
  item 6) wasn't being saved to Firestore at all before this feature — `submitToDb()` now also
  sets `base.olData = JSON.parse(JSON.stringify(olState))` (mirroring what `persistDraft()`
  already does for the local draft's `_ol` field) so it round-trips; older documents saved before
  this change simply have no `olData`, which `loadLastFromDb()` treats as "nothing to restore"
  rather than an error. Guards against clobbering in-progress work with a `confirm()` — but only
  when `resultState`, `checked-by`, `wo-no`, or a measurement/RTD/remark input already has real
  user-entered content, NOT just "some input has a value," since tag/desc/motor-data fields are
  auto-derived the instant a Mill is picked and would make every first use look "dirty."

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
"Transformer PM Trend Analysis" panel — pick a check sheet, a parameter, and a
piece of equipment, and see that parameter's value across every past PM for that
asset, compared against the immediately preceding submission. Multiple parameters
can be pinned into the same chart to compare them against each other. It started
scoped to the two **weekly Transformer AT** sheets only (`Transformer_AT_NoDGA_Weekly.html`
and `Transformer_AT_DGA_Weekly.html`) as a first rollout on one data set — since
extended to `ESP_7BGPCP800A_B.html` ("ESP Weekly Maintenance") and
`GEN_BrushGear_PM_Checksheet.html` ("Generator Brush Gear PM") too, see the
`TREND_SHEET_KEYS` bullet below for what a multi-sheet check sheet like ESP or
Brush Gear needs that a single-sheet one doesn't — and, for Brush Gear
specifically, for a `section`-like field that looked temporal but wasn't
(read the bullet before assuming a similar field elsewhere is safe to merge
without checking). Still not a blanket feature for every check sheet —
extending further means going through the `TREND_ASSETS` checklist below for
whichever sheet is next.

**Single vs multi-parameter is a chip builder, not two separate UIs.** The
Parameter/Equipment selects only ever *stage* a candidate; `TREND_SERIES` (an
array, module-level) is the definitive "what's actually charted" list, rendered
as removable chips above the chart. `renderParamTrend()` decides its data source
each call: if `TREND_SERIES` has 1+ entries it renders those; if empty, it treats
whatever is currently staged in the selects as an ad-hoc single series (so the
common one-parameter case needs no extra click — pick param + equipment and the
chart appears immediately, exactly like before this was added). Clicking
"+ Tambah ke Perbandingan" pins the current selection as a chip and resets the
selects so the next parameter can be picked. This means `renderParamTrend()`,
`renderTrendCompare()`, `renderTrendCrit()`, `renderTrendChart()`, and
`renderTrendTable()` all accept a `seriesData` array and must keep working for
`seriesData.length === 1` (reproducing the original single-parameter layout
exactly, including a "PM Sebelumnya" card and a per-row Δ table column that the
2+-series layout deliberately drops) — don't special-case away the 1-series path
when changing this.

- **Status (OK/NG) parameters can only be the sole chip.** A line/bar mix, or
  two differently-scaled status strips, isn't something one chart can show
  usefully. `trendAddBlockedReason()` is the single source of truth for why the
  "+ Tambah" button is disabled (also called by `updateAddState()` on every
  select change to keep the button/hint live) — extend that function, not the
  click handler, if another mixing rule is ever needed.
- **Units decide the Y-axis layout, not the caller.** 1 distinct unit among the
  pinned series → one axis. Exactly 2 → dual axis (left/right), each series
  assigned by which of the two units it has. 3+ → everyone shares the left axis
  and a `#trend-mixed-note` warning appears, because Chart.js has no clean way to
  show more than two axes at once and a wrong 3rd axis would be worse than a
  clear warning. This is computed fresh in `renderTrendChart()` every render, not
  cached — don't try to persist an axis assignment across an add/remove.
- **`TREND_MAX_SERIES` (6) exists to keep the legend and pivot table legible**,
  not for a technical reason — raise it if a real workflow needs more, but check
  the pivot table (`renderTrendTable()`'s 2+-series branch) still reads cleanly
  first, since it adds one full column per series with no horizontal limit
  beyond `.trend-table-wrap`'s `overflow-x:auto`.

- **`TREND_ASSETS`** (assetTag → label) is the whitelist of check sheets the panel
  offers. Extending to another weekly sheet only works if that sheet's rows
  follow the same shape everyone else already uses (see "The data contract"
  above): `{section, no, desc, crit, values}` with `values` keyed by an
  equipment/column tag. Add the tag to `TREND_ASSETS` and — if any of its
  numeric rows should show a unit — add a matching entry to `TREND_UNITS`.
- **`TREND_SHEET_KEYS`** covers a check sheet whose CURRENT data lives across
  more than one `sheets` key — not a legacy/pre-split case (that's
  `TREND_LEGACY_SOURCE` below), just how the sheet saves today.
  `ESP_7BGPCP800A_B.html` is the example: it saves `sA`..`sF` (one per
  equipment zone — Rectifier Transformer, four Rapping Motor zones, Hopper
  Heater) plus `sF2`, never a `main` key. `trendSheetKeysFor(tag)` returns
  `TREND_SHEET_KEYS[tag]` or `['main']` by default, and `trendMergedRowsFor(d,
  sheetKeys)` in `onTrendSheetChange()` flattens every listed key's rows/columns
  into one combined `(rows, columns)` pair per submission before anything else
  runs — every other function downstream (`buildSeriesPoints`, params/equips
  lists, `renderTrendCrit`, …) treats it exactly like a single `main` sheet
  after that point, no other special-casing needed.
  **This merge is NOT safe to do naively by no+desc alone.** ESP's four Rapping
  Motor zones (`sB`/`sC`/`sD`/`sE`) run the IDENTICAL 5-item checklist
  (`'1' — Overheating (°C)'`, `'2' — Lubrication Leakage'`, …) against 4
  different equipment sets that never overlap (`COLS_B`..`COLS_E`) — keying a
  parameter by `no+desc` alone would collapse all 4 zones' identical-looking
  rows into ONE dropdown entry (whichever sheet's row a submission happens to
  list first), making the other 3 zones' history completely unreachable from
  the trend selector. Confirmed against real data before shipping: naively
  keyed, only zone B's "Lubrication Leakage" was reachable; C/D/E's identical
  item silently vanished. The fix is `trendRowKey(r)` — `section + '||' + no +
  '||' + desc` instead of just `no + '||' + desc` — used everywhere a
  param/row key is built or matched (`buildSeriesPoints`, the params-list
  builder, `onTrendParamChange`, `renderTrendCrit`). `trendMergedRowsFor()`
  stamps `section` with the sheet's own `title` on any row that doesn't
  already carry one, so this costs nothing for sheets like Transformer's
  `main` whose rows already have unique `section` values within their one
  sheet — the extra key segment is a no-op there. Verified post-fix against
  real ESP data (20 submissions) that all 4 zones' "Lubrication Leakage" now
  appear as separate optgroup entries, each correctly scoped to its own 8
  equipment codes with zero overlap between zones.
  `onTrendParamChange()`'s existing "only offer equipment columns with real
  data for this row" filter (unchanged) is what keeps the Equipment dropdown
  narrowed to the right subset once a specific zone's parameter is picked —
  no separate equipment-scoping logic was needed on top of `trendRowKey()`.
- **`GEN_BrushGear_PM_Checksheet.html` ("Generator Brush Gear PM", assetTag
  `7TG-GEN-100`) saves two sheet keys, both wired in — `TREND_SHEET_KEYS` lists
  `['sA', 'sB']`. `sA` ("Inspection Tasks", 7 rows) fits the standard shape:
  `no`/`desc`/`crit`/`values` keyed by `'Pole + Result'`/`'Pole + Note'`/
  `'Pole − Result'`/`'Pole − Note'` (the generator's two brush poles). `sB`
  ("Brush Length & Spring Pressure") was initially left out on the assumption
  that its `section` field (`'Week 1'`..`'Week 5'`) was a historical week
  reference — i.e. that one submission bundles several PAST weeks' readings,
  which would misattribute old data to today's date if merged. **That
  assumption was wrong** — reading `getCurrentPMWeek()`/`getActiveMags()`/
  `getMagsForWeek()` in the check sheet itself (rather than guessing from the
  field name) shows `week` is a FIXED rotation-slot label: the check sheet
  inspects only 1/5 of the generator's magazines per visit on a repeating
  5-week cycle, and `getMagsForWeek()` is a static mag→slot mapping, not a
  moving date window. So a submission's `sB` rows only ever cover magazines
  actually inspected on THAT SAME visit, grouped by which of the 5 rotation
  slots they permanently belong to — this is exactly analogous to ESP's
  equipment-zone sections, not a different-dates problem at all. Confirmed
  against real data before re-enabling it: the one real submission containing
  "Mag #03 / Brush #1" is dated 2026-08-19, and its trend point comes back
  dated 2026-08-19 too — no shifting, no duplication. Lesson for extending
  this feature to another sheet: read what a `section`-like field's producing
  code actually computes it from before deciding it's temporal vs categorical
  — the field name alone (`'Week N'`) was actively misleading here.
  One real limitation this asset DOES have: `TREND_UNITS` is keyed by row
  (parameter), but in `sB` the "row" is the equipment identity (`Mag #NN /
  Brush #B`) and the actual measured quantity depends on which "equipment"
  COLUMN is picked (`Length (mm)`, `Spring (lb)`, `Brush Type`, `Replace`) —
  the opposite of every other sheet wired into this feature, where columns
  are the equipment and the row fixes the quantity/unit. There's no per-row
  entry that correctly gives `Length (mm)` a unit without also mislabeling
  `Spring (lb)`/`Brush Type`/`Replace` series with the same unit, so `sB` has
  no `TREND_UNITS` entries — its charts render without a unit label rather
  than a wrong one.
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

**`TREND_LEGACY_SOURCE` pulls in pre-split history.** Before the weekly Transformer
AT sheets existed as separate files, every week's inspection was ONE combined
submission — `assetTag: '7EX-XFMR'`, `assetName: 'Transformer Weekly Inspection'`
— with each section under its own `sheets` key (`s1` = AT+DGA, `s2` = AT without
DGA, `s3` = USST, `s4`/`s5` = Common SST, `gis`/`gis150`/`gis500` = GIS SF6).
Confirmed by pulling a real submission: `s1`/`s2` use the **exact same** row shape
and equipment tags as the split sheets' `main` sheet — same `no`/`desc`/`crit`
text, same columns — so `onTrendSheetChange()` merges them into one history
instead of the trend only going back to whenever the sheets were split apart.
Extending `TREND_ASSETS` to a currently-unlisted tag does **not** require a
legacy source — only add one to `TREND_LEGACY_SOURCE` if you've actually
confirmed a matching pre-split bundle exists in Firestore with the same row
shape; guessing at this produces confidently wrong trend data, worse than no
trend at all.

**Submissions are deduplicated to one point per calendar date, not one per
document**, inside `buildSeriesPoints()` — this matters because real data has
two distinct causes of same-date collisions, both confirmed by querying the
live `checksheets` collection directly:
1. A technician re-opens the same week's draft and submits again (same
   `executionDate`, same day) — a genuine duplicate.
2. `executionDate` is a free-text field a check sheet can leave stale from a
   prior week's auto-filled draft. One real cluster in the legacy
   `7EX-XFMR` data had **16 submissions** sharing a single `executionDate`
   while their `createdAt` timestamps actually spanned **two weeks** with
   visibly different readings each time — i.e. 16 real, distinct inspections
   mislabeled onto one day.

`onTrendSheetChange()` handles case 2 first: whenever ≥2 submissions for a tag
share an `executionDate`, each one's `.date` is reassigned to its own
`createdAt` date (the one field a technician can't leave stale — it's set once,
client-side, at the moment of `DB.save()`), which is what actually spread that
16-submission cluster back out across its true 4 real calendar days. Submissions
are then sorted by `(date, createdAt)` ascending, so `buildSeriesPoints()`'s
per-date `Map` — which keeps the *last* value written for a given key without
moving its position — ends up keeping the newest-created submission for any
date that still collides after that (case 1), consistent with how
`loadLastSubmission()` elsewhere in this codebase already treats "latest" via
`orderBy('createdAt','desc')`. **Never revert `buildSeriesPoints()` to pushing
one point per submission** — the compare card and table must show the same
per-date series the chart does, or a duplicate-heavy date silently renders as
several stacked identical-looking table rows instead of one.

**The Y-axis Min/Max inputs are presentation-only — they never touch
`TREND_SERIES` or re-fetch data.** `TREND_LAST_RENDER` caches the last
`{seriesData, soloStatus}` `renderTrendChart()` drew; the four number inputs
(`#trend-ymin`/`#trend-ymax` for the left axis, `#trend-y1min`/`#trend-y1max`
for the right, shown only when dual-axis is active) call `applyTrendScale()`
on every keystroke, which just re-invokes `renderTrendChart()` on that cached
data — `trendScaleOverride(axisId)` reads whatever's currently typed and
returns `{}` (Chart.js's own auto-scaling) for any field left blank, so a
value must be explicitly typed to override anything. `renderParamTrend()`
calls `resetTrendScaleInputs()` before every real re-render (new parameter,
equipment, or chip set) — a manually-typed 0–100°C range left over from a
previous parameter would silently mislead once the chart switches to, say,
kV. Hidden entirely for the status-strip chart (`soloStatus`), since OK/NG
bars have no magnitude to scale.

**The table/stat-cards/charts/export show one row per real visit by default,
not one row per Firestore document.** Field technicians sometimes hit "Submit
to Database" more than once for the same visit (a flaky connection, or just
wanting to be sure it saved), which piles up several near-identical documents
under one WO/date — `dedupeSubmissions(docs)` collapses each such cluster down
to the newest `createdAt` doc. It's a one-line delegate to `DB.dedupeLatest()`
in db-helper.js — the dedup algorithm lives there (shared with any other page
that wants it), not duplicated in dashboard.html. Full writeup, the real-data
evidence, and how to port this to another check sheet's own submission list:
see `DEDUP_LATEST_SUBMISSION.md`.

**Grouping on `assetTag + woNumber + executionDate` alone is NOT safe** — an
earlier version of this feature did exactly that and was caught before ship by
checking it against real production data: 191 documents, 38 same-key groups,
one of them (a transformer, key repeated 16 times) actually spanned **three
separate real weekly visits** with different `countOk` results each time, all
sharing one stale `executionDate` a technician never edited across drafts.
Naive key-only dedup would have silently thrown away 2 of those 3 real weeks.
The fix: two docs only count as "the same visit, resubmitted" if they also
share a key AND their `createdAt` timestamps land within `CLUSTER_GAP_HOURS`
(24h) of each other — real data shows a clean split, genuine resubmits
cluster within ~21h, genuinely different visits sharing a stale date are
≥70h apart (up to 358h), so 24h sits safely in the gap. `DB.dedupeLatest()`
sorts each key-group by `createdAt`, walks it, and starts a new cluster
whenever the gap to the previous doc exceeds `CLUSTER_GAP_HOURS`, keeping only
the last (newest) doc of each cluster. `createdAt` (not `executionDate`)
drives both the key-free tie-break and the clustering because it's the one
field that can't go stale — set once, client-side, at the moment of
`DB.save()` — the same reasoning `TREND_LEGACY_SOURCE`'s date-collision
handling above already relies on. A document missing `assetTag` or `woNumber`
can't be grouped safely and is always kept as its own row.

This never touches Firestore or deletes anything — `allDataRaw` always holds
every document `DB.getAll()` returned (raw, undeduped — that's `getAll()`'s
default now); `allData` (what the table, `computeStatsFrom()`, the charts,
and `exportExcel()` all actually read) is `allDataRaw` deduped, or
`allDataRaw` verbatim when the "Submission terbaru saja" checkbox
(`#toggle-history`) is unchecked — `toggleShowAllHistory()` flips
`showAllHistory` and calls `applyDedupeToggle()` to re-derive everything from
`allDataRaw` without a network round-trip. **`DB.getStats()` in db-helper.js
is intentionally no longer called from here** — it runs its own separate,
non-deduped Firestore query, which would silently disagree with what the
table shows; the stat cards are now driven by `computeStatsFrom(allData)` (a
local port of the same aggregation logic) so they always match.

**A "Hapus Duplikat" button permanently deletes exactly the documents
`dedupeSubmissions()` would hide** — next to `#dedupe-badge`, only visible
when `duplicateIds.length > 0` (computed alongside `allData` inside
`applyDedupeToggle()`: every `allDataRaw` doc whose `id` isn't in the deduped
set's id list). This is the one place in this feature that actually writes
to Firestore, so it shares the SAME confirm dialog as the existing manual
multi-select delete (`#confirm-del`/`confirm-msg`/`.btn-danger`) rather than
having its own: both `confirmDelete()` (checkbox selection) and
`confirmDeleteDuplicates()` just stage a different id list into one
module-level `pendingDeleteIds` before showing the modal, and `executeDelete()`
reads `pendingDeleteIds` and calls `DB.deleteMultiple()` — one delete code
path, two ways to fill it. `confirmDeleteDuplicates()`'s message spells out
that only older resubmits are deleted and that visits sharing a stale
`executionDate` are safe, since "duplicate" here means "whatever
`DB.dedupeLatest()`'s `CLUSTER_GAP_HOURS` clustering decided is a
duplicate" — the same validated logic the badge/toggle already use, not a
separate, looser definition. Verified via headless Chrome against real data
that the button's count matches `allDataRaw.length - allData.length` exactly
(105 of 191) and that `confirmDeleteDuplicates()` stages the right id list —
without ever calling `executeDelete()` in that verification, since that
would actually delete production data.

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
