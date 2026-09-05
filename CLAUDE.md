# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A set of standalone HTML "PM check sheet" forms for POMI's Electric Unit 7/8 electrical
maintenance team (motors, transformers, switchgear, UPS, batteries, ESP, hoists, generator
brush gear, etc.), plus a shared `dashboard.html` that reads every submission back out of
Firestore for review, Excel export, and a Transformer PM parameter trend chart (see the
`dashboard.html` section below), and `Review_Approval_Dashboard.html`, a TechOp2 → Supervisor
sign-off workflow layered on top of every check sheet's submissions (see "Review & Approval
Workflow" below). There is **no build step, no bundler, no package.json, no test suite** —
every page is a single self-contained `.html` file with inline `<style>` and `<script>`,
sharing a handful of small JS files via plain `<script src>` tags: `firebase-config.js`,
`db-helper.js` (the Firestore data contract), `img-helper.js` + `photo-kit.js` (the shared
evidence-photo pipeline, see "Photos" below), `storage-helper.js` + `approval-helper.js` +
`load-merge-modal.js` (the Review & Approval workflow's file-storage/approvals-collection/
merge-modal layer — not every check sheet needs these last three, but all 22 currently do),
`auth-session.js` (the shared `localStorage` login session + 1-hour idle timeout, loaded before
`technician-auth.js` everywhere — see "Technician login on check sheets" below), and
`technician-auth.js` (the optional Checked-By auto-fill widget) — plus a couple of PNG assets
(`LOGO POMI.png`, `brush_magazine_diagram.png`) via plain `<img src>` tags.

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

## Submit Guard: `submit-guard.js` — insert-vs-overwrite prompt + real upload progress bar

Built to attack the duplicate-submission problem at its SOURCE, rather than only cleaning up
after the fact like the `approvals`-collection dedup work above — a technician resubmitting the
same visit (unsure if the first click saved, or just impatient) used to always create a brand-new
`checksheets` doc with no way to know a near-identical one already exists. Piloted on
`UPS_7EB-UPS-AB_Monthly.html` first — an explicit, deliberate choice (discussed and confirmed
before writing any code) to build the shared module + verify it thoroughly on one file before
touching the other ~23, given how invasive and easy to get subtly wrong a change to every check
sheet's `submitToDb()` is.

**Now rolled out to all 25 active, portal-linked check sheets** — every check sheet in this repo
has it as of this writing, check a given file's own script includes for `submit-guard.js` if in
doubt. The 3 files that do NOT have it are the documented legacy duplicates, deliberately skipped
since they're not linked from the portal and not the reference implementation for anything:
`esp_checksheet.html`, `4000 Hours Mill/LV_Motor_MCC.html`, `4000 Hours Mill/Mill 4000 Hours PM.html`.
If a brand-new check sheet is ever added, give it the same treatment: add
`<script src="submit-guard.js"></script>` after `approval-helper.js`, call
`SubmitGuard.init({assetTag:'...'})` near the file's existing `LoadMergeModal.init()`/
`TechnicianAuth.init()` calls (pass `submitFnName:'yourFnName'` too if the submit button isn't
`onclick="submitToDb()"` — `GEN_BrushGear_PM_Checksheet.html`'s `saveToDatabase()` is the one file
in this repo that needs this), then wire `submitToDb()` to call `resolveSubmitTarget()` before
saving (the button lock + progress overlay are handled INSIDE `resolveSubmitTarget()`/
`hideProgress()` now — see the reentrancy bullet below — so the caller does NOT need its own
`document.querySelectorAll(...).disabled=true` dance), branch `DB.update()` vs `DB.save()` on the
resolved mode, thread `existingApprovalId`/`onProgress` into `Approvals.submitWithFiles()`, and
call `markSubmitted()` on success — adapting to that file's own field-id/asset-tag/photo-shape
quirks per the per-file variance already documented elsewhere in this file (e.g. `done-by` vs
`checked-by`, different `PHOTOS` shapes). **A multi-asset / no-fixed-tag sheet (a dropdown/search
box picking one of many possible tags — `4000_Hours_Mill_PM.html`, `DMH_Motor_PM_Checksheet.html`,
`HV_Motor_6Monthly_PM.html`, `HV_Motor_SWGR.html`, `Hoist_Inspection_Maintenance.html`,
`LV_Motor_MCC.html`) must re-call `SubmitGuard.init({assetTag: <current tag>})` immediately before
`resolveSubmitTarget()` inside `submitToDb()` itself** (not just once at page load) — the module
is a page-level singleton, so without this the duplicate-check would silently query whichever
tag was selected first, not whichever asset the technician is actually submitting right now.
Verify each new file with the same fail-loud-mock headless-Chrome technique described below
(insert path, overwrite path via the real choice modal, and the progress bar/button-disable
timing under an artificially slowed mock) before committing — a copy-paste field-id or asset-tag
mistake here fails the same way a `checkedBy` mismatch does elsewhere in this codebase: silently,
not with a thrown error. `PLTS_AshDisposal_PM.html` is a partial exception: it predates
`Approvals.submitWithFiles()` and has its own hand-written photo/PDF-upload + `Approvals.create()`
sequence (see CLAUDE.md's Review & Approval Workflow section), so its overwrite path replicates
`submitWithFiles()`'s "merge into the SAME approval doc" behavior manually via a direct
`db.collection('approvals').doc(id).set({...},{merge:true})` call instead of passing
`existingApprovalId` — same end result, just not routed through the shared helper.

Two independent pieces, both self-injecting DOM/CSS like `load-merge-modal.js`/
`technician-auth.js`:

- **Insert-vs-overwrite prompt** (`SubmitGuard.resolveSubmitTarget(woNumber)`, called BEFORE
  `DB.save()`). Finds a "same visit, probably a resubmit" candidate two ways, cheapest first: (1)
  session-local — this exact tab already submitted for this asset earlier (`markSubmitted()`
  after a prior successful submit, no network round-trip needed), or (2) Firestore — a doc already
  exists for this asset tag with the same WO number (covers reopening the sheet in a fresh tab).
  **Overwrite is only ever OFFERED when the candidate's own `approvals` record (if any) is still
  at status `'submitted'`** — nothing already reviewed/approved/returned is ever at risk, an
  explicit safety decision confirmed with the user up front (mirrors the same
  never-touch-real-history rule the `approvals`-dedup work above already established). No
  candidate found, or overwrite isn't safe → resolves straight to `{mode:'insert'}` with **no
  prompt at all** — the common case (a genuinely new visit) is never interrupted. The modal's
  three outcomes: `{mode:'insert'}`, `{mode:'overwrite', targetId, approvalId}`, or
  `{mode:'cancel'}` (caller must `return` immediately on cancel — see the usage snippet in
  `submit-guard.js`'s own header comment).
- **Real, honest progress bar** (`showProgress()`/`setProgress(pct,label)`/`hideProgress()`), not
  a guessed animation — another explicit, confirmed-up-front choice. `Approvals.submitWithFiles()`
  gained an `onProgress(pct,label)` callback that reports its OWN 0–100 internally (0–70%
  proportional to photos uploaded so far, 72–80% building/uploading the PDF, 90–100% attaching
  file links and writing the approval record) — the calling check sheet blends that into its own
  overall bar (e.g. `10 + Math.round(pct*0.85)`, reserving the first ~10% for the `DB.save()`/
  `DB.update()` step that runs before `submitWithFiles()` is even called). The overlay has no
  close button and the submit button(s) are explicitly `.disabled` for the duration — internally,
  `_lockButtons()`/`_unlockButtons()` select `[onclick="<submitFnName>()"]` (`submitFnName`
  defaults to `'submitToDb'`, overridable via `SubmitGuard.init()` — see the
  `GEN_BrushGear_PM_Checksheet.html` note above), no id needed, works even when a file has more
  than one Submit button, as `UPS_7EB-UPS-AB_Monthly.html` does — this is the literal fix for
  "technicians re-clicking Submit out of impatience," not just a cosmetic nicety.

**New capabilities added to support this, both backward-compatible (every existing caller keeps
working unmodified):**
- `DB.update(id, data)` (db-helper.js) — the "Overwrite" half. Full replace via `.set()` (an
  overwrite means "this is corrected data for the same visit," not a partial patch), but
  deliberately **preserves the original `createdAt`** (fetched from the doc being replaced) so
  anything reading `createdAt` to mean "when did this visit happen" — dedupe clustering, trend
  charts, sort order — keeps working correctly across an overwrite; only `updatedAt` reflects when
  the overwrite itself happened.
- `Approvals.submitWithFiles()` gained `existingApprovalId` (approval-helper.js) — when set
  (overwrite path), updates that SAME approval doc in place (`status` reset to `'submitted'`,
  since new data always means "please look at this again") instead of calling `create()`, so
  overwriting a submission never leaves a second, duplicate approval behind.

**Bug found after the UPS/Battery rollout: the progress popup didn't appear until well into the
submit, leaving a real double-submit window.** User report: clicking Submit still showed no
loading animation/percentage until the data was already saved, so technicians were still
double/multi-submitting. Root cause: the ORIGINAL `resolveSubmitTarget()` only did its
duplicate-check Firestore round-trip (`DB.getAll()`, then `Approvals.getByChecksheetId()`) — the
calling file's own `submitBtns.forEach(b=>b.disabled=true)` + `SubmitGuard.showProgress()` only
ran AFTER that promise resolved. On a slow connection that round-trip could take seconds with
**zero visual feedback and the buttons not yet disabled**, so a technician would click Submit
again during that exact window — and since there was no reentrancy guard either, the second click
ran a fully independent `submitToDb()` call that could create a genuine second `checksheets`
doc. Fixed entirely inside `submit-guard.js` (no per-file changes needed — every already-rolled-
out file gets this for free): `resolveSubmitTarget()` now sets a module-level `_busy` flag, locks
every `[onclick="submitToDb()"]` button, and calls `showProgress()`/`setProgress(0, 'Memeriksa
submission sebelumnya...')` **synchronously, before its first `await`** — since a JS async
function runs synchronously up to its first `await`, this all takes effect in the exact same tick
as the click, before the Firestore call even starts. A second `resolveSubmitTarget()` call made
anywhere before `hideProgress()` clears `_busy` (i.e. anywhere in the whole submit lifecycle, not
just during the duplicate-check) now sees `_busy===true` synchronously and resolves straight to
`{mode:'cancel'}` with no further work — this is a true reentrancy guard, not just a UI-disabled
hint, so it still holds even if the click races ahead of the button's own `disabled` attribute
taking visual effect. `_chooseCancel()` (the choice modal's "Batal" button) explicitly clears
`_busy`/unlocks the buttons since the calling file's own `if(target.mode==='cancel') return;`
never gets to call `hideProgress()` in that path; `_chooseInsert()`/`_chooseOverwrite()` re-show
the progress overlay (hidden while the choice modal itself was up, so the two full-screen overlays
never stack) before resolving. Verified via headless Chrome against both `UPS_7EB-UPS-AB_Monthly.
html` and `Battery_7EB-BY-125-250.html`: (1) calling `submitToDb()` and checking the DOM
*synchronously, before awaiting it* shows the progress overlay already visible and both buttons
already `disabled`; (2) firing two overlapping `submitToDb()` calls against a mock with an
artificial 500ms duplicate-check delay results in exactly ONE `checksheets` doc and ONE
`approvals` doc, never two; (3) the existing insert/overwrite/cancel flows and the real
climbing-percentage progress bar still work exactly as before this fix, including a normal fresh
submit succeeding right after a cancel (confirming `_busy` doesn't get stuck `true`).

**A real near-miss while testing this, worth remembering for next time**: an early test run's
mock for `db.collection()` had a bug (missing methods in the chained-call shape it returned) that
caused it to silently fail and fall through to calling the REAL Firestore/Drive APIs — writing
several fake test documents into the actual production `checksheets`/`approvals` collections
before being caught and cleaned up. The fix going forward: any headless-Chrome test that mocks
`db.collection`/`Storage.uploadDataUrl`/`Storage.uploadBlob` for this kind of test should make the
mock **fail loudly** for any collection/method it doesn't explicitly handle (`throw new
Error(...)` instead of silently returning `undefined` or falling through) — a thrown error during
a test is cheap and obvious; a silent real write to production is not. Verify the mock's own
chain shape carefully against the REAL method being tested (e.g. `Approvals.getByChecksheetId()`
calls `.where().orderBy().limit().get()` — a mock missing `orderBy()` in that chain throws
`orderBy is not a function`, which — if the surrounding code has its own try/catch, as
`resolveSubmitTarget()`'s safety fallback does — can silently produce a *plausible-looking but
wrong* test result instead of an obvious failure).

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

  **Use `willDrawPage`, not `didDrawPage`, to draw the background for autoTable's own internal
  page breaks — this is the actual root-cause fix, not just a workaround.** An earlier version of
  this file used `didDrawPage: () => ensureBg()` on the shared table theme, reasoning that a table
  splitting mid-page needed the background on its continuation page too — but `didDrawPage` fires
  *after* that page's rows have already been drawn, not before. jsPDF has no z-index, so
  `ensureBg()` firing there paints the background **over** the rows that just landed on the new
  page, silently erasing them (confirmed by instrumenting `data.cursor.y` in `didDrawPage`, which
  matches `finalY` — i.e. the *end* state, not the start). The page renders as a blank gap under
  the letterhead, which looks like a layout bug but is actually erased data — this shipped once,
  was caught, "fixed" by the workaround below, then resurfaced on a real PVR-500 submission long
  enough that even a single checklist table's own content spanned two pages by itself, no matter
  how well pre-estimated. **`willDrawPage` fires *before* that page's rows are drawn, for every
  page a table lands on — including ones autoTable creates via its own internal pagination, not
  just pages this file's own `checkY()`/`pdf.addPage()` calls create.** Swapping the one hook name
  (`willDrawPage:()=>ensureBg()` instead of `didDrawPage:()=>ensureBg()` on the shared `kvTheme`)
  fixes the erasure at its root for every table in the file, permanently, regardless of how long
  any given table's content turns out to be — confirmed by re-rendering a real submission whose
  20-row checklist table (with realistic-length remarks) now genuinely spans two pages on its own,
  and every row on both pages renders correctly with no erased gap.

  **The pre-check-and-force-an-early-break approach below is still worth keeping, but only as a
  compactness optimization now, not as the safety mechanism** — it avoids pointless early page
  breaks when content is short enough to actually fit, it no longer stands between a long table
  and losing rows. Before an `autoTable()` call whose row count/content length isn't fixed/small,
  estimate its height and pre-check with `checkY()` so short content still starts on a page with
  enough room to stay together:
  ```js
  checkY(Math.min(BOTTOM_LIMIT-TOP_START, rows.length*9+10));  // keeps SHORT content compact
  pdf.autoTable({...kvTheme, startY:y, body: rows, ...});
  ```
  A flat `rows.length * average` estimate is fragile against arbitrary real content, though — it
  was tuned against one real render's remark lengths and silently undershot once a technician
  typed longer ones, which is what let autoTable's internal pagination fire in the first place
  (harmless now that `willDrawPage` covers the erasure risk, but still means the estimate's
  compactness benefit doesn't reliably apply). `estimateTableHeight()` in `4000_Hours_Mill_PM.html`
  measures the actual wrapped height of a table's real content via `pdf.splitTextToSize()` per
  column instead of guessing a flat average — reuse that pattern for any table whose cells can
  hold free text of unpredictable length, rather than a hardcoded rows-length multiplier.
  `Math.min(..., BOTTOM_LIMIT-TOP_START)` still caps the estimate at one page's usable height so
  this doesn't loop forever for a table that's never going to fit on a single page.

  **A near-miss overflow (content only slightly over one page's budget) is usually better fixed by
  making it fit than by forcing an earlier break** — this is still good advice for keeping the
  document compact, on top of `willDrawPage` making it safe either way. On the PVR-500 tab, the
  motor-data table plus its 20-row checklist measured ~255mm combined against a ~249mm page — over
  by only ~6mm for one real render. Tightening that one table's `cellPadding` (2.2mm → 1.7mm, via
  a local `{...kvTheme.styles, cellPadding:1.7}` override passed as `styles:` on just that
  `autoTable()` call) reclaimed ~1mm/row, closing the gap so both tables rendered together as
  originally intended for that particular submission's content — though as above, don't trust a
  padding tweak alone to guarantee this for every future submission's remark lengths; the safety
  net is `willDrawPage`, this is only about avoiding an unnecessary early break when possible.

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

- **A report with many photos can balloon to tens of MB — re-encode each photo for the PRINT BOX
  it lands in, not for its on-screen working resolution.** `Motor_Witness_Test_Vendor.html`
  embedded each `PHOTOS[k]` entry at PhotoKit's full working size (up to 1600px) straight into the
  PDF; a report with dozens of photos across 8 sections could exceed the client's 15MB upload
  limit. This is a DIFFERENT problem from the upload-time `compressUnder1MB()` bullet above (which
  caps a photo's *stored/Firestore* size) — a photo already under ~950KB for storage is still far
  bigger than it needs to be once it's only ever drawn inside a small fixed PDF box (a 2-up grid
  here is ≈89×58mm). `pdfPhotoSrc(entry, boxWmm, boxHmm)` re-encodes a COPY sized for that exact
  box at a print-adequate DPI (160) and quality (0.7, stepping down to 0.32 only if an unusually
  detailed photo still exceeds a ~110KB per-photo safety cap), cached by `src+box` so regenerating
  (preview, then the real download) doesn't redo the work. `sectionPhotos()` awaits this per photo
  and draws a shallow-copied entry (`{...p, src: compressed}`, original `w`/`h`/`widthCm`/
  `heightCm` kept so `PhotoKit.fit()`'s aspect-ratio math is unaffected) — the on-screen `PHOTOS`
  entry itself is never mutated, so crop/rotate/re-export at full quality still works normally.
  Verified with 40 synthetic worst-case (random-noise, hardest to compress) 1600×1200 photos
  totalling 60MB at their original quality: the resulting PDF was 2.3MB, each embedded photo
  ~43KB, generated in ~1.4s. A sheet with a different fixed photo-grid box size than this file's
  2-up 89×58mm should pass its own `cw`/`MAXH` into `pdfPhotoSrc()` — the function is generic.

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
  **Every on-screen auto-chart must be wired into `generatePDF()` explicitly — adding a chart to
  the page does NOT add it to the report.** `Motor_Witness_Test_Vendor.html` shipped with its two
  IR-trend charts (`ir-chart-stator`/`-hipot`) in the PDF but its later-added Solo-Run temperature
  charts (`chart-ulw` winding / `chart-ulb` bearing) missing entirely. Fixed with a shared
  `chartImage(canvas, series, title)` helper inside `generatePDF()` that redraws, checks the
  series actually has data (so an empty chart's "isi tabel dulu" placeholder is never embedded),
  `addImage`s it, and draws a wrapped `chartLegend()` row beneath it (the on-screen legend is
  separate HTML — `#leg-ulw` etc — and does NOT ride along in `toDataURL()`, so without this a
  10-line RTD chart in the PDF was unreadable). `cssColorToRgb()` converts the `#hex` / `hsl()`
  series colours (`_seriesColor()` returns HSL once there are >4 RTDs) to jsPDF `[r,g,b]`. The
  series data comes from `_soloTempSeries()` — one function feeding BOTH `drawSoloTempCharts()`
  and the PDF so they can't drift. `chartImage()` reserves subtitle+chart+legend height in ONE
  `checkY()` before drawing the subtitle so a page break never strands the title from its chart.

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
  **Read the file as bytes (`reader.readAsArrayBuffer`), never as text.** The first version of
  this used `reader.readAsText(file)`, which assumes UTF-8 — instrument-exported `.txt` reports
  from Windows measurement software are frequently NOT UTF-8 (UTF-16 with or without a BOM, or a
  legacy ANSI codepage, are both common), and decoding those bytes as UTF-8 turns every character
  into garbage, so the regex silently matches zero lines and the import looks like it does
  nothing. `decodeMegFileAttempts(buffer)` sniffs a UTF-16 BOM (`FF FE`/`FE FF`) or UTF-8 BOM
  first; with no BOM, it counts null bytes at even vs. odd offsets in the first 400 bytes (a long
  run of one or the other is the tell for un-BOM'd UTF-16 on otherwise-ASCII content) to pick
  UTF-16LE/BE, and always also tries plain UTF-8 and `windows-1252` as fallbacks —
  `handleMegImportFile()` runs every candidate decode through `parseMegSeriesFile()` and keeps
  whichever one actually produced readings, rather than betting on one encoding up front. Verified
  by round-tripping the same sample data through UTF-8, UTF-16LE+BOM, and UTF-16LE-without-BOM
  encodings and confirming all three parse to identical values.

  **This still wasn't the actual bug the user hit.** Their real export files were already valid
  UTF-8 — the real problem was a look-alike-character mismatch: `lineRe`'s literal `Ω` was typed
  as U+03A9 GREEK CAPITAL LETTER OMEGA, but this tester's export software writes U+2126 OHM SIGN
  instead — a different codepoint that renders as an IDENTICAL glyph in every font, so nothing
  about looking at the file (even a careful visual diff) would reveal the mismatch. Confirmed via
  a hex dump of a real file (`xxd`): the bytes after a value are `e2 84 a6`, which is U+2126 in
  UTF-8, not `ce a9` (U+03A9). Since a regex match against the wrong codepoint fails silently —
  no exception, just zero matched lines — this produced the exact same "file tidak dikenali"
  symptom as a genuine encoding problem, and both need checking whenever a text-format import
  "doesn't recognize" a file that looks correct on screen. Fixed by matching a character class of
  both codepoints (`[ΩΩ]`), not just changing which one glyph is used in the source —
  don't revert to a single literal `Ω` even if it "looks right" in an editor, since a different
  tester/software could just as easily use the other one. Verified against all 6 of the user's
  real per-terminal-pair export files (T4/T5/T6 × ground, plus the 3 phase-to-phase pairs) —
  every one now returns all 13/13 points with the computed 10-minute value matching that file's
  own reported final resistance.

  **Recognizing a real export set**: this site's megger tester (Model 1555) names each saved
  report after the two terminals it tested — `T4 gr.txt`/`T5 gr.txt`/`T6 gr.txt` (one terminal to
  ground) and `T4 T5.txt`/`T4 T6.txt`/`T5 T6.txt` (terminal to terminal) — six files per full test
  round, one per non-combined `MEG_ROWS` entry (`r_stg`/`s_rtg`/`t_rsg` and `r_s`/`r_t`/`s_t`; no
  file for `rst_g`, the all-three-combined-to-ground row, since the tester doesn't run that as one
  test). **`T4`/`T5`/`T6` → R/S/T is this instrument's/site's own terminal labeling, not something
  confirmed against `MEG_ROWS`'s own R/S/T convention** — the import button is per-row by design
  specifically so the technician (who knows which physical terminal is R/S/T) picks the matching
  file when they click a given row's "📥 Import", rather than the code guessing a mapping. Don't
  hardcode a `T4`→`r`/`T5`→`s`/`T6`→`t` assumption anywhere; if that mapping is ever needed in
  code (e.g. to auto-suggest a row from a filename), confirm it with the user first.

  **The tester's own language setting changes its export's date and number format —
  handle both, don't pick one.** A second real file from the *same* Model 1555 tester
  (`measurement_data.txt`, re-exported with the tool set to Indonesian instead of English) broke
  the parser again after the Ω-codepoint fix, with the identical "file tidak dikenali" symptom
  but a completely different cause: the whole layout changes with the language, not just labels —
  `"Aug 20, 2026 08:56:09 216 MΩ"` (English: month first, comma after day, `.` decimal) versus
  `"20 Agu 2026 14:38:35 12,9 MΩ"` (Indonesian: day first, no comma, localized month
  abbreviation, `,` decimal). Since the same physical instrument can produce either depending on
  a setting the technician controls (not the file's origin or age), `lineRe` captures the
  date/time prefix as one non-greedy blob (`.+?\d{2}:\d{2}:\d{2}`) instead of assuming a layout,
  and `parseMegTimestampMs()` tries the English pattern first, then the Indonesian one — a single
  hardcoded format will break again the next time this export happens to come out in the other
  language. `MEG_MONTH_ABBR` holds both English and Indonesian 3-letter month abbreviations in
  one table (most months are spelled identically either way; only May/Aug/Oct/Dec differ:
  Mei/Agu(or Ags)/Okt/Des). The reading value itself also switches decimal separator with the
  locale (`,` vs `.`) — `val = parseFloat(raw.replace(',', '.'))` handles both since the value
  ranges seen here never need a thousands separator. Verified against both the English 6-file set
  and this Indonesian file together: all 7 now return 13/13 points, with `measurement_data.txt`'s
  computed 10-minute value (22400 MΩ) matching its own header's "Resistance: 22,4 GΩ" exactly.

- **A "special" `HV_CHECKS` row's OWN Result/Remark toggle needs pulling back in separately —
  `buildCheckRows()` (used by both `submitToDb()` and `generatePDF()`) skips every `chk.special`
  row unconditionally, since specials need custom rendering instead of the generic Result/Remark
  columns.** That's correct for the row's *custom content* (the RTD inputs, the 7×13 megger
  matrix, the motor-protection value table, …) but five of `HV_CHECKS`' special rows ALSO render
  their own item-level `mkSel(prefix,'cNN')`/`mkRmk(prefix,'cNN')` Result/Remark pair below that
  custom content (16 meggerMatrix→`c16`, 17 piDar→`c17`, 20 rtdInputs→`c20`, 21
  motorProtection→`c21`, 22 dcsReadings→`c22`) — and until this was fixed, NONE of those five
  were captured anywhere: not in `base.sheets` (so never saved to Firestore either, not just
  missing from the PDF), because each special's own `out[prefix+'_xxx']` sheet in
  `collectAssetSheets()` only held its custom measurements, never its own Result/Remark. Worse,
  **RTD (item 20) had no sheet entry AT ALL** — not even its measurements — so the whole "Measure
  RTD values for winding and bearing" section was silently dropped end to end. Confirmed by
  filling in all five, rendering a real PDF, and `pdftotext`-ing it: the RTD section was entirely
  absent, and the other four sheets existed but were missing their Result/Remark rows. Fixed with
  one small helper, `srr(id) => ({Result: gv('res-'+prefix+'-'+id)||'—', Remark: gv('rmk-'+prefix+'-'+id)||'—'})`,
  called once per affected item's own crit id and folded into that item's sheet (`_pidar` now
  also carries item 16's and 17's Result/Remark; `_motorprotection`/`_dcs` each gained a trailing
  Result/Remark row); a new `_rtd` sheet (columns `Location`/`Value (°C)`, one row per
  `rtdCount[prefix]` dynamically-added RTD point, plus its own Result/Remark) was added and
  wired into the PDF's `['_pidar','_resistance','_rtd','_motorprotection','_dcs']` extras loop.
  **If a future special row gains its own item-level Result/Remark, it needs the same treatment —
  `buildCheckRows()` skipping it is not enough on its own.** Item 18 (`resistance`) is the one
  special that's fine as-is: its Result/Remark are genuinely per-test-point (`c12a`/`c12b`/`c12c`,
  one per phase pair), already collected individually in `_resistance`, not a single item-level
  toggle to pull back in.

  **A second, separate bug hid behind the first one and looked identical from the outside:**
  after the fix above shipped, the user reported RTD (item 20) "still not showing in the PDF."
  Re-verifying the exact same checkbox-modal → Preview PDF flow the user actually uses (not just
  calling `generatePDF()` directly, which is what the first fix was verified against) confirmed
  the PDF content itself was correct — the real cause was upstream, in `loadDraft()`. RTD rows
  are created on demand (`addRTDInput(prefix)`, incrementing `rtdCount[prefix]`), so a fresh page
  load always starts at zero of them; `persistDraft()`'s generic `document.querySelectorAll(...)`
  sweep saves `rtd-<prefix>-<n>-loc`/`-val` values into the draft fine (the rows exist at save
  time, from earlier in that session), but `loadDraft()`'s matching generic sweep only sets values
  on elements that ALREADY exist — with zero RTD rows present after a refresh, it silently found
  nothing to restore into, and the RTD data effectively vanished (still present in the exported
  PDF's underlying draft blob if you dug into localStorage directly, but never applied to the
  page, so a refresh mid-session before downloading was enough to make the PDF's RTD section
  correctly render as "no readings, just an empty Result/Remark row"). Fixed by pre-creating the
  right number of rows before the generic sweep runs — same technique `loadLastFromDb()` in this
  same file already uses to pre-create RTD rows from a Firestore doc, ported to `loadDraft()`'s
  localStorage draft. Verified against a REAL `Page.reload()` (not a re-navigate, an actual
  browser refresh) with a genuine draft saved beforehand: `rtdCount['pvr']` and both RTD rows'
  values come back correctly post-refresh, and the resulting PDF shows real RTD data again.
  **When a report says "the export is missing X" after a to-storage bug in X was already fixed,
  verify the FULL real user flow (draft persistence included) before concluding the report is
  stale or user error — the export code being correct doesn't mean the data reaching it still is.**

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

## `team-routing.js` — shared team/area vocabulary + routing resolution

`window.TeamRouting`, loaded (after `db-helper.js`) by **both** dashboards so they share ONE
copy of `TEAM_AREAS`, `EXTERNAL_SUBMITTER_SCOPE`, and `toAreaList()` — a drift between them
would misroute submissions. `Review_Approval_Dashboard.html` now delegates its `TEAM_AREAS` /
`EXTERNAL_SUBMITTER_SCOPE` / `toAreaList` consts to `TeamRouting.*` (its `scopeOfApproval()` /
`loadUserDir()` / `inMyReviewScope()` stay local). Also exposes:
- `loadUserDir(force)` — fetches `dashboard_users` once into `name/username -> {team, area}`.
- `resolveScope({names:[...], team, area, src})` — explicit `team`/`area` win; else the first
  `names` entry that resolves via `EXTERNAL_SUBMITTER_SCOPE` then the user directory.
- `inScope(scope, myTeam, myAreas)` — team match + area ∈ areas; **fail-open** when the reviewer
  has no scope, closed (false) when the submission's scope is unresolved (`team:null`).

## `dashboard.html` — role-based views (technician / techop2 / supervisor / admin)

Before this, `dashboard.html`'s login only checked username/password — it never read
`userData.role`, so every logged-in account (including a self-registered `technician` account,
see "Review & Approval Workflow" below) saw the exact same full dashboard: every submission from
every technician, plus the destructive delete/dedupe buttons. This was an explicit user request
to fix, discussed and confirmed before any code was written: reuse the **same 4 roles** already
established by `dashboard_users`/`Review_Approval_Dashboard.html`/`technician-auth.js`
(`technician`/`techop2`/`supervisor`/`admin`), not a new role system, and split the difference
along two independent axes — see the matrix below.

|  | technician | techop2 | supervisor | admin |
|---|---|---|---|---|
| Data scope | own submissions only | **own team + area(s)** | all | all |
| Layout | simplified (stat cards + table only) | full | full | full |
| 3 analytical charts + Transformer PM Trend panel | hidden | visible | visible | visible |
| Row-select checkboxes, Delete, Hapus Duplikat | hidden | hidden | visible | visible |
| Excel export | visible (own data only) | visible (own team + area) | visible | visible |

- **TechOp2 data scope** (later change, requested): `loadData()` loads `approvals` FIRST (moved
  up from a trailing pass — needed for routing), then for `role==='techop2'` with a team+area set
  it filters `allDataRaw` to submissions where `TeamRouting.resolveScope({names:[checkedBy,
  uploadedBy, approval.submittedBy], team: approval.team||d.team, area: approval.area||d.area,
  src})` is `TeamRouting.inScope(..., loggedInTeam, loggedInAreas)`. `loggedInTeam`/`loggedInAreas`
  come from the session (`AuthSession.get()`), backfilled from Firestore in `checkSession()` when
  missing. `applyRoleUI()` adds `body.role-techop2` (layout stays FULL — only the data is scoped)
  and fills the `#scope-note` banner. Supervisor/Admin unchanged (see everything).

- **Session is unified with the rest of the app via `auth-session.js` (`window.AuthSession`).**
  `doLogin()` calls `AuthSession.set({user,role,name})`, `checkSession()` (still `async`) reads
  `AuthSession.get()` and backfills role+name from a one-time Firestore lookup when it finds a
  session with no role cached, `doLogout()` calls `AuthSession.clear()`. The session lives in
  **`localStorage`** now (shared across every tab/page of the app, 1-hour idle timeout) — see
  "Technician login on check sheets" below for the full `AuthSession` contract. `checkSession()`
  registers `AuthSession.onExpire(() => location.reload())` so an idle timeout drops back to the
  login overlay.
- **Two independent body-class toggles drive every role-gated element**, applied once in
  `applyRoleUI()` (called from `showDashboard()`, after login/session-restore resolves):
  `body.role-technician` (the simplified-layout axis — technician only) and `body.can-delete`
  (the destructive-actions axis — admin/supervisor only, matches `loggedInRole==='admin' ||
  loggedInRole==='supervisor'`, same boolean shape as `canReview`/`canApprove` already use in
  `Review_Approval_Dashboard.html`). Elements carry a `full-only` or `del-only` class instead of
  each getting its own inline check — `.chart-grid`, `.chart-row-2`, `#trend-card` are
  `full-only`; the table's checkbox `<th>`/`<td>`, `#del-bar`, and `#btn-del-duplicates` are
  `del-only`.
- **The CSS hide rules use `!important`, and that's load-bearing, not decoration.**
  `#btn-del-duplicates` and `#del-bar` also get their `style.display` set directly by other,
  unrelated JS (`applyDedupeToggle()`, `updateDelBar()`) — an inline style always wins over a
  plain class-based stylesheet rule regardless of specificity, so without `!important` a
  technician account could still make the "Hapus Duplikat" button reappear simply by the dataset
  happening to contain real duplicates (which sets `style.display='inline-flex'` on it, unrelated
  to role). Confirmed both ways via headless Chrome with a real duplicate pair injected into a
  mocked `checksheets` query: technician's `computedDisplay` stayed `none` despite the button's
  own inline `style.display` being `inline-flex`; supervisor's showed through as intended.
- **Data scoping happens ONCE, right where `allDataRaw` is first fetched in `loadData()`**, not
  separately in the table/stats/charts/export code: for `technician`, `allDataRaw` is filtered
  down to docs whose `checkedBy` (trimmed, lower-cased) matches the logged-in account's `name`
  (falling back to `username`) before `applyDedupeToggle()` (which derives `allData`, the stat
  cards, and the charts) ever runs — so `filteredData`/Excel export/the table/the asset-filter
  dropdown are all automatically scoped for free, no second filter needed at any of those call
  sites. Verified with synthetic docs including a same-name-different-casing pair (`'Budi
  Santoso'` vs `'budi santoso'`) — both matched, confirming the comparison is genuinely
  case-insensitive and not just a lucky exact match.
- **This name-match is a known-imperfect heuristic, not a security boundary** — `checkedBy` is
  the only submitter-identity field the data contract guarantees (see "The data contract"
  above), and it's free-typed text on older submissions (pre-`technician-auth.js`), so a typo or
  a nickname means a technician's own old submission can silently not show up in their own scoped
  view. Deliberately NOT fuzzy-matched to compensate — a looser match risks pulling in a
  different person's data instead, which is the worse failure mode. The `#scope-note` banner
  (shown only under `body.role-technician`) tells the technician to contact an admin if something
  they submitted seems to be missing, rather than the dashboard silently claiming completeness it
  can't guarantee. Firestore security rules remain fully open on this collection (see "Review &
  Approval Workflow" below) — this scoping is a UI-layer convenience for a trusted internal tool,
  the same trust model every other role check in this codebase (`canReview`/`canApprove`, etc.)
  already relies on, not a new one introduced here.

## Review & Approval Workflow (`Review_Approval_Dashboard.html`)

A TechOp2-review → Supervisor-approval sign-off flow layered on top of check sheet
submissions, so a submitted PM check sheet can be reviewed with comments/recommendations,
then approved with a digital signature, producing a final signed PDF ready for Maximo
upload — all trackable from `dashboard.html` via a status badge. Rolled out to **every**
check sheet in this repo (22 as of this writing) via three shared library files, not
copy-pasted per file. If you're adding a brand-new check sheet, wire it into this system
the same way — see "Adding this to a new check sheet" below.

### Why Google Drive instead of Firebase Storage

Firebase Storage now requires the paid **Blaze** plan just to *enable* it at all (confirmed
directly in the Firebase Console — the Storage page shows "To use Storage, upgrade your
project's pricing plan" with no way around it on Spark), even though actual usage would stay
within the free tier. Rather than take on a billing account, evidence photos and generated
PDFs are persisted to **Google Drive** instead, reached through a small **Google Apps Script
Web App proxy** (`google-apps-script/drive-proxy.gs`) — genuinely free, no billing account,
generous quota (15GB+ on a personal account). See that file's own header comment for the
one-time deployment steps (create a Drive folder, paste the script into script.google.com,
deploy as a Web App). Two non-obvious things that cost real debugging time and are baked into
the current design — **do not "simplify" these away**:

- **`doGet` must always return JSON + base64, never a raw binary passthrough.** An earlier
  version tried `return file.getBlob();` directly from `doGet`, on the assumption (matching
  several online examples) that Apps Script would serve it as a real image/PDF response.
  Confirmed by hand via `curl` with `redirect:'manual'`/`redirect:'follow'` that this is
  **wrong** — the actual HTTP response Google sends back is a generic ~5KB HTML wrapper page,
  not the file's bytes, so both `<img src>` and `fetch()` silently fail (no error, just doesn't
  render/decode). The fix: `doGet` always returns `{dataBase64, mimeType, filename}` as JSON;
  the client (`storage-helper.js`) decodes that into a `blob:` URL via `URL.createObjectURL()`
  before using it as an `<img src>`, `<a href>` target, or feeding it to `pdf-lib`. Every URL
  this system stores in Firestore (`pdfUrl`, entries inside `photoUrls`, `finalPdfUrl`) is a
  Drive-proxy JSON-API URL, never a raw `drive.google.com` link.
- **`file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, ...)` is blocked for unverified Apps
  Script projects — even with the full Drive OAuth scope explicitly granted.** Confirmed by
  isolating each `DriveApp` call in a dedicated test function run directly in the Apps Script
  editor: `getFolderById()` and `createFile()` both succeed, `setSharing()` alone throws
  `Access denied: DriveApp.` — reproduced consistently across multiple redeploys and even a
  from-scratch OAuth re-authorization (revoking the app's access at
  myaccount.google.com/permissions and re-granting it from a clean state). This is Google
  treating "an app can programmatically make files public" as a more sensitive capability than
  plain read/write, gated behind app verification this project deliberately isn't pursuing (it's
  a small internal tool, not a published product). **The workaround**: `doPost` never calls
  `setSharing()` at all — instead, `ROOT_FOLDER_ID` itself is shared "Anyone with the link →
  Viewer" **once, manually, through the normal Google Drive UI** (right-click the folder →
  Share). Every file the script creates *inside* that folder tree inherits the same link-access
  permission automatically, because Drive's permission model is folder-hierarchy-inherited
  regardless of whether the file was created via the UI or the API. This is documented as step
  1b in `drive-proxy.gs`'s own header comment — don't skip it, a freshly (re)deployed proxy
  with an unshared root folder will upload files successfully but nothing will be able to
  *view* them.

### Firestore setup this system needs (Console-side, not in this repo)

- **Security rules must explicitly allow the `approvals` collection.** This project's
  Firestore rules are collection-allowlisted (`match /checksheets/{doc} { allow read, write: if
  true; }` etc., all under one fully-open trust model — no real per-request auth exists
  anywhere in this app, consistent with the public API key already committed in
  `firebase-config.js`), so a brand-new collection with no matching `match` block is
  **denied by default**, not allowed by default. Confirmed the hard way: a real submit through
  `PLTS_AshDisposal_PM.html` saved the checksheet doc and attached photo/PDF URLs to it fine
  (both hit the already-allowed `checksheets` collection), but `Approvals.create()` threw
  `Missing or insufficient permissions` because the `approvals` collection had no rule yet. Add
  `match /approvals/{doc} { allow read, write: if true; }` alongside the existing blocks.
- **A composite index is needed for `Approvals.getByChecksheetId()`** (`where('checksheetId',
  '==', ...).orderBy('createdAt', 'desc')` — a compound query needing a composite index in
  Firestore, unlike a single-field `orderBy` alone, which is auto-indexed). Firestore's own
  error message includes a direct "create this index" Console link when the query first runs
  without it; `Approvals.getAll()`'s plain `orderBy('createdAt','desc')` (no `where`, used by
  the review dashboard's inbox listing) does NOT need this — only `getByChecksheetId()`
  (used by the revision banner and `dashboard.html`'s status-column join) does.

### The three shared library files

- **`storage-helper.js`** (`window.Storage`) — the Drive-proxy client. `uploadDataUrl(path,
  dataUrl, contentType)` / `uploadBlob(path, blob, contentType)` upload and return a
  Drive-proxy URL (`path` is a virtual slash-separated path — everything before the last `/`
  becomes nested Drive folders, e.g. `checksheets/<id>/photos/inv01-0.jpg`).
  `fetchAsBytes(url)` / `toObjectUrl(url)` / `toDataUrl(url)` / `fetchMeta(url)` read one back
  (raw `ArrayBuffer`, a `blob:` URL ready for `<img src>`/`<a href>`/`window.open()`, a
  `data:` URL, or the full `{bytes,base64,mimeType,filename}`) — always via the JSON+base64
  path, per the gotcha above. Each of these takes an **optional `onProgress` callback** — when
  passed, the download runs via `XMLHttpRequest` so `{loaded, total}` progress events fire
  (`total` is `0` when the Drive proxy sends no `Content-Length`, which is the common case —
  show a bytes-only / indeterminate indicator then), plus one `{phase:'decode'}` call before
  the base64→bytes step; omit it and you get the old plain `fetch()`.
  `Review_Approval_Dashboard.html`'s `#file-progress` overlay
  (`showFileProgress`/`updateFileProgress`/`setFileProgressPhase`/`hideFileProgress`) uses this
  for "Buka PDF Asli" (opens in a tab via `openRemoteFile()`) and the approve flow's original-PDF
  fetch. **PDF *downloads* ("Unduh PDF Asli" / "Unduh PDF Final") go through `downloadRemoteFile(url,
  filename)`** — `Storage.toObjectUrl()` then a synthetic `<a download>` click — with a **uniform
  filename from `pdfDownloadName(a, cs, suffix)`:
  `"<YYYY>-<MM>-<DD> <WO> <Asset tag> <Report name>[ suffix].pdf"`**
  (date from `cs.executionDate` → `a._date` → `createdAt`; WO from `cs.woNumber`/`a._wo`; tag from
  `cs.assetTag`/`a.assetTag`; name from `assetName`, dropped when it equals the tag; empty parts
  omitted; filesystem-unsafe chars → `-`; `'FINAL'` suffix for the approved PDF).
  The detail view shows the computed name above the buttons.
  `deleteByUrl(url)` is best-effort, dev/test cleanup only. **`DRIVE_PROXY_URL`**
  at the top of this file is the one deployment-specific value — must match whatever Web App
  URL `drive-proxy.gs` is actually deployed at (ends in `/exec`); if it still contains the
  literal string `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`, every upload throws a clear error
  telling you so rather than failing silently or hitting a dead URL.
- **`approval-helper.js`** (`window.Approvals`) — the `approvals` Firestore collection, kept
  **deliberately separate** from `checksheets` (never a field bolted onto a checksheet doc) so
  the append-only `checksheets` collection that `dashboard.html`'s trend charts/dedupe/exports
  all rely on (see "The data contract" above) never has to be mutated for workflow state — one
  `approvals` doc per submission, referencing `checksheetId`, and unlike `DB.save()` this
  collection genuinely IS mutated in place as status changes (`submitted` → `reviewed` →
  `approved`, or → `returned_to_technician` from either stage — see `returnedNote.stage` for
  which). `create()`/`getAll()`/`getById()`/`getByChecksheetId()`/`submitReview()`/
  `returnToTechnician()`/`approve()`/`deleteById()` are the low-level CRUD. **The one a check
  sheet's `submitToDb()` actually calls is `submitWithFiles(checksheetId, opts)`** — a single
  best-effort entry point that uploads every evidence photo + the archival PDF, attaches the
  resulting URLs onto the checksheet doc via `DB.attachFiles()` (see below), and creates the
  `approvals` record, all in one call. Read its JSDoc comment in the file for the exact `opts`
  shape (`photos`, `pdfBuilder`, `assetTag`, `assetName`, `checksheetFile`, `submittedBy`,
  `revisionOf`) — `photos: null` and `pdfBuilder: null` are both valid for a sheet with no
  photo feature / no jsPDF export (e.g. `Hoist_Inspection_Maintenance.html`, which only has
  `window.print()`).
  **Submitter-role auto-advance (applies to every check sheet automatically — no per-file
  code):** `submitWithFiles()` reads `window.AuthSession.get()` at submit time. When the
  logged-in submitter's `role` is `techop2` (level 2), the TechOp2 review step is skipped —
  the `approvals` doc is created already at `status:'reviewed'` with a synthetic
  `review:{reviewedBy, reviewedAt, signature:<their session signature>, auto:true}` record, so
  it lands straight in the Supervisor's approval queue (`inboxItems()` for
  `loggedInRole==='supervisor'` already filters on `status==='reviewed'`). A plain
  `technician` (or no session) is unchanged → `status:'submitted'`. `submitWithFiles()` also
  backfills `team`/`area` from the session when the caller didn't pass them. Pass
  `opts.autoReview:false` to force the normal review path even for a TechOp2. Because an
  auto-reviewed doc starts at `reviewed`, `submit-guard.js`'s overwrite-safety check and
  `Review_Approval_Dashboard.html`'s `cleanupDuplicateApprovals()` both additionally treat
  `status==='reviewed' && review.auto` as "nothing a human reviewed yet" (same as
  `'submitted'`) so a TechOp2's accidental resubmit still de-dupes correctly.
- **`load-merge-modal.js`** (`window.LoadMergeModal`) — the generic "pull from database" +
  multi-submission merge picker + revision banner, reused across every check sheet instead of
  the ~150-line bespoke version originally hand-written for the `PLTS_AshDisposal_PM.html`
  pilot (still in that file as-is, not retrofitted to the shared module — it was already
  shipped and tested, not worth the regression risk of touching working code just for
  consistency). **Injects its own DOM (modal + revision banner) and `<style>` on first use** —
  a check sheet only needs `LoadMergeModal.init({assetTag: '...'})` once at init,
  `LoadMergeModal.initRevisionBanner()` once at init, and a button calling
  `LoadMergeModal.open()`. See the file's own header comment for the full usage snippet.
  Solves the same root problem PLTS's original merge feature solved: `DB.save()` always
  `.add()`s a new document, never updates one in place, so when different technicians each
  fill part of a check sheet in separate sessions, a later partial save can make an earlier
  save's data look "lost" from a naive single-latest-doc "load last" flow — this lets a
  technician pick ANY past submission(s) and union them into the current form (fill-blank-only
  by default; an explicit "Mode Timpa" checkbox force-overwrites). `buildMergedBundle()` /
  `applyMergedBundleToForm()` are exposed on the module in case a check sheet needs to compose
  them directly (e.g. a multi-asset sheet re-running `init()` with a different `assetTag` per
  selection — see below).
  - **`init({ beforeApply })` — optional host hook fired with the chosen doc(s) BEFORE any
    value is written to the form.** For a page with **dynamic rows/columns whose count is data,
    not fixed** (Motor Witness's RTD-winding count / solo-run interval columns), the generic
    `getElementById()` sweep in `applyMergedBundleToForm()` only fills elements that already
    exist — so values in a column beyond the current count are silently dropped when a
    submitted session is pulled back via "Muat / Lanjutkan" or the revision banner. Same
    reasoning as `restorePhotosFromUrls()`: the module can't know a page's dynamic-DOM shape,
    so the page supplies the reconstruction step. `_runBeforeApply(docs)` calls it in both
    `_confirm()` (after `CloudDraft.adopt`) and `loadRevisionSource()` (after `DB.getById`).
    `Motor_Witness_Test_Vendor.html`'s `mwBeforeMerge(docs)` takes the max `rtdN` / longest
    `ulIntervals` across the docs (reading `d.rtdN` for a submitted doc, `d.extra.rtdN` for a
    CloudDraft) and calls its own `applyIntervals()` — never shrinks, so a merge can't destroy
    existing columns. Its own motor-gate session list (`loadSession()`) already did this via
    `applyDraftData()`; this closes the same gap on the shared-modal path.
  - **`DB.collectCheckSheetData()`'s `inputValues` sweep now matches typeless `<input>`s.**
    An `input[type=text]` attribute selector does NOT match `<input>` with no `type` attribute,
    so the old `input[type=text], input[type=number], input[type=date]` list silently dropped
    every bare `<input class="ti">` — the RTD / IR-PI matrix / corona grid cells in
    `Motor_Witness_Test_Vendor.html` (and any similar sheet). `submitToDb()` there papered over
    it with an extra `.ct .ti, .mtx .ti` sweep, but **`CloudDraft.save()` ("💾 Simpan ke
    Database") goes only through `collectCheckSheetData()`** — so a cloud draft saved from that
    button lost all RTD/matrix values, and reopening on another device showed them blank. Fixed
    in `db-helper.js` with a broad `input:not([type=file]):not([type=checkbox]):not([type=radio])
    :not([type=button])…` selector (checkboxes/radios are still handled separately via
    `toggleStates`/`checkStates`). Purely additive — captures more ids, never fewer.
  - **`?reviseOf=<approvalId>` opens the check sheet in revision/edit mode** for ANY status,
    not just returned items. `Review_Approval_Dashboard.html`'s review action section (the
    `canReview` branch of `renderActionSection()`) has an **"✏️ Edit Check Sheet"** button
    (`.edit-cs-box`) that opens `<checksheetFile>?reviseOf=<approvalId>` (spaces `%20`-encoded)
    so a TechOp2 can fix the submitter's data mid-review instead of only bouncing it back.
    `initRevisionBanner()` adapts its wording by the approval's `status`: a `returnedNote`
    present → "merevisi submission yang dikembalikan"; `status==='submitted'` and no note →
    "dibuka oleh reviewer untuk memperbaiki isian" + a hint to pick "Timpa" on resubmit.
  - **Revision always overwrites its source approval — new `revised` status.** On resubmit,
    `SubmitGuard.resolveSubmitTarget()` checks `LoadMergeModal.getReviseOfApprovalId()` FIRST:
    if set, it fetches that approval and returns `{mode:'overwrite', targetId:<its checksheetId>,
    approvalId:<reviseOf>, revision:true}` directly — **no WO matching, no choice modal, and it
    works regardless of the source's status** (this is the fix for revising a
    `returned_to_technician` entry, which the old `canOverwrite` check refused because status
    wasn't `submitted`). The check sheet then `DB.update()`s the SAME checksheet doc
    (`createdAt` preserved) and passes `existingApprovalId`. In `Approvals.submitWithFiles()`'s
    `existingApprovalId` branch: if the prior approval was `returned_to_technician`, this is a
    REVISION — `status` → `'revised'` (or `'reviewed'` for a TechOp2 auto-review), the old
    (pre-return) `review` is discarded, `returnedNote` is moved into a `returnedHistory[]` array,
    and `revisedAt`/`revisionCount` are stamped. `checksheetId` is rewritten to the new doc.
    Any other prior status (a plain `submitted` dup) keeps the existing behavior (stays
    `submitted`). If SubmitGuard couldn't resolve `reviseOf` (blank/missing) and a **separate**
    approval with `revisionOf` was created instead, `cleanupDuplicateApprovals()` collapses it:
    folds the returned source's note into the new one's `returnedHistory`, flips it to
    `'revised'`, deletes the stale returned source.
  - **`'revised'` is behaviourally identical to `'submitted'`** for queueing / permissions —
    `Approvals.isPendingReview(status)` (`=== 'submitted' || === 'revised'`) is used everywhere
    that used to check `=== 'submitted'` (`inboxItems()`, `renderActionSection()`'s `canReview`,
    the Status Laporan tab's review section). It's a distinct label ("Direvisi") + badge only so
    reviewers can see the item went through a return→revise cycle; `renderDetail()` shows a
    "Riwayat Revisi" section with each past `returnedHistory` entry. `STATUS_ORDER`,
    `computeRecapData()` (a `revisedAt` counts as a Submitted event in its own month), the
    status-filter dropdown, and `dashboard.html`'s `APPROVAL_BADGE_*` maps all know `revised`.
  - **Merge behavior across the two different OK/NG toggle conventions this codebase uses**
    (see "Per-file conventions worth matching" below): header fields and `inputValues` (the
    generic `<input>`/`<select>`/`<textarea>` sweep — where most of a technician's actual typed
    work lives) are fill-blank-only in merge mode, never overwritten if already non-empty.
    `.r-sel`-style results additionally get their color/`resultState` resynced via
    `onResChange()` if the host page defines it. `ST`-object/`.rb`-button-style toggles are
    restored via the *same* 3-strategy DOM matcher `DB.loadLastSubmission()` already uses in
    `db-helper.js` — but deliberately **always applied**, even in merge mode, not fill-blank-only
    like text fields. Reliably detecting "is this specific toggle button already set" varies
    across at least 3 different DOM conventions found across these 22 files (plain `.rb[data-v]`
    class-swap, `[data-id]` + `.a` class, `.r-btn[data-type]` + `.active` class — none of them
    identical to either pattern CLAUDE.md's "Per-file conventions" section originally
    documented), so this was a deliberate, documented trade-off rather than an oversight:
    OK/NG toggles are coarse enough that refreshing them from a merged bundle is acceptable,
    while the measurement/remark text fields where real typed effort lives are never silently
    clobbered.

### Duplicate submission cleanup — `cleanupDuplicateApprovals()` (approvals collection only)

A technician resubmitting the same visit (unsure whether the first submit actually saved, or
just double-clicking "Submit to Database") creates a brand-new `checksheets` doc AND a brand-new
`approvals` doc every time — there was no dedup anywhere in the review/approval inbox, so every
accidental resubmit showed up as its own separate item a TechOp2/Supervisor had to review
separately. Fixed by `cleanupDuplicateApprovals()` in `Review_Approval_Dashboard.html`, called
once at the top of every `loadAll()` (i.e. on page load and every manual Refresh) — **explicit
user request, scoped deliberately to the `approvals` collection only**: `dashboard.html` reads
`checksheets` directly for its own history/Load & Merge and must keep seeing every real
submission, so this never touches or deletes a checksheet doc, only the workflow-tracking
`approvals` doc that pointed at a since-superseded duplicate.

An older `approvals` doc is deleted only when **both**:
1. It's a same-visit duplicate of a newer approval — grouped by asset tag + WO number + execution
   date (fetched from the linked checksheet via `getChecksheet()`, since `approvals` docs don't
   carry `woNumber`/`executionDate` themselves), with `createdAt` within `DB.CLUSTER_GAP_HOURS`
   (24h) of the next one in the group. This is the **exact same validated clustering**
   `dashboard.html`'s own "Hapus Duplikat" button already uses (see `DEDUP_LATEST_SUBMISSION.md`)
   — reused here rather than inventing a second dedup heuristic, just applied to `approvals`
   instead of `checksheets`. A doc missing asset tag or WO number is never grouped, same safety
   rule `DB.dedupeLatest()` uses.
2. Its `status` is still `'submitted'` — i.e. no reviewer has touched it. **An already
   reviewed/approved/returned entry is real workflow history and is never auto-deleted, no matter
   how close in time it sits to a newer submission** — a deliberate `revisionOf` resubmission
   naturally leaves its source entry at `'returned_to_technician'`, never `'submitted'`, so this
   rule alone is what keeps genuine revision history distinct from an accidental double-submit
   without needing to special-case `revisionOf` explicitly. Verified with a mocked 3-entry cluster
   (`submitted` → `reviewed` → `submitted`, all within the gap window): only the first
   (untouched, superseded) entry was deleted; the `reviewed` one survived even though a newer
   same-visit submission existed.

Runs against every approval currently in the inbox/history (not per-tab), fetching each
referenced checksheet in parallel (`Promise.all`, reusing `getChecksheet()`'s existing
`_checksheetCache` so a second `loadAll()` in the same session is cheap). Not silent — a
`#dedupe-note` banner (styled like the existing `#role-note`, just the indigo/informational
palette instead of amber/warning) reports how many were cleaned up, and points out the full
history is still in the database via Dashboard, so a reviewer isn't left wondering why an inbox
item they remember seeing is now gone. Verified via headless Chrome with a mocked `approvals` +
`checksheets` pair covering all four cases at once (genuine duplicate deleted, reviewed entry
preserved, two real distinct visits 40h apart both kept, one unrelated unique entry untouched) —
and that no `checksheets`-collection delete was ever attempted (the mock's `checksheets` collection
exposes no `delete` method at all, so any accidental attempt would have thrown).

**A third case — ORPHANED approvals — had to be added after this shipped, because duplicates kept
piling up in production anyway.** Real example that surfaced it: a "1 Monthly PM UPS"
(`7EB-UPS-A/B`) visit had 8 `approvals` entries, 7 of them still sitting there after multiple
`loadAll()`s. Root-caused via a **read-only** headless-Chrome session against real Firestore data
(bypass the login overlay, call `Approvals.getAll()`/`DB.getById()` directly — same technique
documented under "Running / testing changes" above — never call `loadAll()` itself this way,
since it would trigger the real cleanup/delete path against production): 7 of the 8 approvals'
`checksheetId` resolved to **`null`** — the checksheet document was simply gone. The cause is
`dashboard.html`'s own admin "Hapus Duplikat" button: it correctly deletes duplicate
**checksheets**, by design (see that section above) — but it has no way to know a matching
`approvals` doc exists, since it only ever touches the checksheets collection. The grouping logic
above depends on reading each approval's linked checksheet to get its WO number/execution date —
once that checksheet is gone, the approval can never be matched into a cluster, so it was
invisible to the original logic **forever**, no matter how many times the page loaded.

Fixed by treating "checksheet confirmed does not exist" as its own always-safe-to-delete
condition, independent of clustering — an approval pointing at a deleted checksheet is
unreviewable on its own merits (there's nothing left to review), so there's no need to match it
against a sibling first. Still gated on `status==='submitted'` only, same reasoning as the
clustering rule. The one thing this required real care about: `DB.getById()` resolves to `null`
for "confirmed does not exist" but *throws* for a genuine network/permission error — confirmed by
hand against real data (`DB.getById()` on a known-missing id resolved to `null`, did not throw) —
so `cleanupDuplicateApprovals()` tracks `orphaned` as true ONLY when the fetch resolved (not
threw) and returned `null`; a thrown fetch is treated as inconclusive and that entry is just
skipped for the round, never marked orphaned. Without this distinction, a transient Firestore
hiccup on any single fetch could have caused a perfectly valid, still-in-progress submission to
be misidentified as an orphan and deleted. Also fixed a related cache bug in `getChecksheet()`
while touching this: `if(_checksheetCache[id])` is falsy for a legitimately-cached `null`, so an
orphan's checksheet was being re-fetched from Firestore on every single call instead of being
cached — changed to `id in _checksheetCache`.

Verified against a mock reproducing the exact real UPS shape (7 orphans across two status values,
1 genuinely valid submission, plus regression coverage for the pre-existing clustering case and a
simulated network error): all 6 `submitted`-status orphans were deleted, the one
`returned_to_technician` orphan among them survived untouched (real history, orphaned checksheet
notwithstanding), the genuinely valid submission was untouched, the pre-existing duplicate-cluster
case still worked exactly as before, and the simulated network-error entry was never deleted.

### Submitter self-service — edit / delete YOUR OWN report (`Review_Approval_Dashboard.html`)

The person who submitted a report can fix or retract it if there's a mistake, but can **never**
touch a report belonging to another account. Admin keeps its own fuller toolset (below).

- **Ownership is a STRICT check — `_isMyOwnReport(a, cs)`** — exact case-insensitive match of the
  logged-in account's `loggedInName` OR `loggedInUser` against `a.submittedBy` / `cs.checkedBy` /
  `cs.uploadedBy` / `cs.uploadedByUsername`. Deliberately NOT `_msMatches()` (the loose
  token-overlap used for the read-only Status Laporan view) — "Budi Santoso" must not be able to
  delete "Budi Hartono"'s report. Same heuristic `dashboard.html`'s technician scoping uses;
  Firestore rules are fully open so this is a UI-layer gate like every other role check here.
- **Edit** (`openOwnRevision(id)` → opens `<checksheetFile>?reviseOf=<id>`) — allowed for any
  status except `approved` (`_canOwnerEdit()`: `status!=='approved' && checksheetFile && !_src`).
  Resubmitting through the revision flow resets the status appropriately.
- **Delete** (`doDeleteMyReport(id)`) — allowed at **ANY status** for a report the owner
  submitted (`_canOwnerDelete()` = `!a._src`; the ownership check `_isMyOwnReport()` is the real
  gate, not the workflow stage — the user asked for "hapus laporan jika ada kesalahan" without a
  status limit). Always a **full retraction** — deletes the `approvals` doc AND the `checksheets`
  doc AND best-effort Drive files (like `doPurgeAll()` but scoped to own). The `confirm()` dialog
  escalates by status: a plain confirm for `submitted`/`revised`, a stronger confirm for
  `reviewed`/`returned_to_technician` (noting the reviewer's work goes too), and a **`prompt()`
  typing `HAPUS`** for `approved` (deleting an officially-approved final report also discards the
  supervisor's signed approval). Only `_src` (external-feed) submissions can't be deleted here.
  `DB.deleteById()` failing after the approval is already gone surfaces a clear "approval gone,
  checklist not — retry from Dashboard" alert.
- Surfaced in two places: the detail overlay (`renderDetail()` — a blue-tinted `dsec` box
  "Laporan Milik Anda — Koreksi", shown when `loggedInRole!=='admin' && !a._src &&
  _isMyOwnReport()`) and the Status Laporan tab's `_msCard()` action row (Perbaiki / Hapus
  buttons under the same gates).

- **Report card / detail titles carry the asset TAG** — `_assetTitleParts(a, cs)` returns
  `{name, tag}`; the tag renders as a mono `.asset-tag-chip` next to the name in `_msCard()` and
  `renderList()`, and appended as ` · <tag>` in the detail `d-title`. The tag is suppressed when
  it's just a slug of the name (`norm(tag)` contained in `norm(name)`) or a synthetic per-visit
  placeholder (`MANUAL-UPLOAD` / `WORK-ACTIVITY-RECORD` / `MAINTENANCE-CORRECTIVE-ACTION`); a
  name-less approval falls back to showing the tag AS the name.

### Admin manual delete + monthly recap chart (`Review_Approval_Dashboard.html`)

- **Admin can manually delete a single `approvals` entry from its detail view** — a `danger-zone`
  section (`renderDetail()`, gated on `loggedInRole==='admin'`) with a `confirm()`-gated
  `doDeleteApproval()`. Same collection boundary as `cleanupDuplicateApprovals()` above: only
  `Approvals.deleteById()` is called, the underlying checksheet doc is never touched, so
  `dashboard.html`'s history and Load & Merge are unaffected — explicit user requirement, not an
  oversight. Unlike the automatic duplicate cleanup, this one is a manual, confirm-gated action
  (an admin can delete anything, including entries with real review/approval history, so it needs
  the human-in-the-loop confirmation the automatic cleanup deliberately avoids needing).
- **A SECOND admin button — "⛔ Hapus PERMANEN (termasuk data Dashboard)"** (`doPurgeAll()`) —
  is the ONE place in the whole app that deletes from the append-only `checksheets` collection.
  It removes the `approvals` doc **and** the underlying `checksheets` doc **and** best-effort
  deletes the submission's Drive files (`cs.pdfUrl` + every `cs.photoUrls[*][*].url` +
  `approval.finalPdfUrl` via `Storage.deleteByUrl()` — a failed file delete only orphans a blob,
  never blocks the purge). The checksheet data then vanishes from `dashboard.html` (history,
  stat cards, Excel export, Transformer PM trend chart) and from Load & Merge. Gated on **typing
  the literal string `HAPUS`** into a `prompt()` (a one-tap `confirm()` OK felt too weak for
  this). Drives the `#file-progress` overlay. If `Approvals.deleteById()` succeeds but
  `DB.deleteById(csId)` then fails, the user is told the approval is gone but the checklist
  data isn't — retry from Dashboard. `_afterApprovalRemoved(id)` (shared with `doDeleteApproval()`)
  updates local state + re-renders the active tab.
- **The same admin `danger-zone` also has correction tools** (all `loggedInRole==='admin'`,
  `approvals`-collection only, each `confirm()`/`alert()`-gated then `closeDetail()` +
  `loadAll()`):
  - **Edit Nama / Team / Area** (`doAdminEditRouting()` → `Approvals.adminEditRouting()`): a
    name input + Team `<select>` (E7/C7) + dependent Area `<select>` (`admFillArea()` repopulates
    from `TEAM_AREAS[team]`, prefilled from the doc in `renderDetail()`). Writes `submittedBy` /
    `team` / `area` (area normalized via `_firstArea()`) so `scopeOfApproval()`'s `a.team && a.area`
    branch re-routes the item to the right PIC. This is the fix path for a submission that landed
    with the wrong / no area.
  - **Batalkan Pengembalian ke Teknisi** (shown only when `status==='returned_to_technician'`;
    `doCancelReturn()` → `Approvals.cancelReturn()`): status goes back to the queue it came from —
    `returnedNote.stage==='approval'` + a `review` present → `'reviewed'` (Supervisor queue),
    otherwise → `'submitted'` (TechOp2 queue); `returnedNote` cleared. No re-submit by the
    technician needed.
  - **Batalkan Review** (shown only when `status==='reviewed'`; `doCancelReview()` →
    `Approvals.cancelReview()`): `review` discarded, status → `'submitted'` (back to the TechOp2
    review queue).
  Each writes an `adminNote: {action, by, at}` marker on the doc. `_firstArea()` lives in
  `approval-helper.js` (global, since team-routing.js isn't loaded on check sheets).
- **"Rekap Bulanan" is a 4th tab, not a panel bolted above the existing list** — `switchTab()`
  now also toggles `#list-toolbar`/`#list-area` vs `#recap-area` visibility (`display:none` on
  whichever isn't active) alongside the existing tab-button/active-class logic, and calls
  `renderRecapChart()` instead of `renderList()` when switching into it. `loadAll()` (called on
  page load and every Refresh) checks `_activeTab` the same way, so refreshing while already on
  the Rekap tab re-renders the chart instead of pointlessly re-rendering a hidden list.
- **The three monthly counts are each keyed off their OWN stage's timestamp, not all off
  `createdAt`** — Submitted from `createdAt`, Reviewed from `review.reviewedAt`, Approved from
  `approval.approvedAt` (`computeRecapData()`). This was an explicit choice over the simpler "all
  three grouped by submission month" alternative, confirmed with the user before building: a
  submission made in month N but reviewed in month N+1 correctly shows as a Submitted bar in N
  and a Reviewed bar in N+1, so each bar reflects real activity in that month rather than
  everything being pinned to when the item first arrived.
- **The person filter (`#recap-person-type`: none/submitter/reviewer) narrows the approval SET
  first, then the same three-stage monthly computation runs on that filtered set** —
  `filteredApprovalsForRecap()`. A submitter filter keeps entries where `submittedBy` matches; a
  reviewer filter keeps entries where `review.reviewedBy` matches (an entry never reviewed by
  anyone is correctly excluded from every reviewer's view, not just from the Reviewed series).
  This makes a reviewer's chart a coherent "of what I reviewed, when was it submitted / when did
  I review it / did it go on to be approved" recap, not three independently-filtered numbers that
  don't relate to the same underlying items. `populateRecapPersonOptions()` rebuilds the name
  dropdown from `_allApprovals` itself (deduped, sorted) whenever the type selector changes, so it
  never goes stale relative to who's actually in the data.
- **Chart.js was not previously loaded on this page** — added the same `chart.js@4.4.4` CDN
  build `dashboard.html` already uses, for one shared version across the two dashboards rather
  than a second one. Colors are pulled from the page's own CSS custom properties at render time
  (`getComputedStyle(document.documentElement)` for `--pri`/`--acc`/`--ok`) instead of hardcoded
  hex, so the chart always matches this file's own palette if it's ever retthemed.
- Verified via headless Chrome with a mocked 4-entry dataset spanning two months and two
  submitters/reviewers: org-wide monthly totals, a submitter-filtered view, and a
  reviewer-filtered view (including that an entry outside a given reviewer's own review history
  is correctly excluded) all matched hand-computed expected values exactly; confirmed the delete
  button is present only for `loggedInRole==='admin'` and that deleting only ever calls
  `.delete()` on the `approvals` mock, never on `checksheets`.

### Team / Area routing — which TechOp2 (PIC) reviews a submission

`dashboard_users` docs now carry two extra fields, `team` (`'E7'` | `'C7'`) and `area` (a
string from `TEAM_AREAS[team]` — E7: `Common` / `Powerblock`; C7: `Turbine` / `Boiler` /
`Common (CHCB)` / `Common (WWTP-Ashdisposal)`), collected in `Review_Approval_Dashboard.html`.
This was an explicit user request; the design decisions were confirmed up front:

- **Registration form** (`doRegister()`) has a Team select + a dependent Area select
  (`fillAreaOptions(teamSelId, areaSelId, selected)` repopulates Area on Team change). Both
  required, validated against `TEAM_AREAS`, written into the new `dashboard_users` doc.
- **Existing accounts are force-migrated on login.** `doLogin()` and `checkSession()`'s
  restore path both check `TEAM_AREAS[userData.team] && userData.area`; if missing they call
  `promptTeamSetup(docId, preTeam, preArea)` which shows a **no-close-button blocking overlay**
  (`#team-overlay`) — `saveTeamSetup()` writes `{team, area, teamUpdatedAt}` back onto the
  user's doc via `.update()` and only then calls `showApp()`. `setTeamSession()` mirrors both
  into `sessionStorage` (`dashboard_team` / `dashboard_area`), cleared by `doLogout()`.
  `checkSession()` is now `async` (same pattern as dashboard.html's role backfill) and does a
  one-time Firestore lookup to backfill a session created before this feature; a network error
  there fails **open** (proceeds without a scope) rather than locking the user out.
- **Routing = team match + the submitter's area ∈ the TechOp2's area(s), TechOp2 inbox only**.
  `loadAll()` fetches the whole `dashboard_users` collection once into `_userDir` (keyed
  `n:<name>` and `u:<username>`, both lowercased) and stamps every approval with `a._team` /
  `a._area` via `scopeOfApproval(a)` — a **name-match heuristic** on `a.submittedBy` (the
  free-typed "Checked By" name), the same known-imperfect, not-a-security-boundary approach
  dashboard.html's technician scoping already uses. A submission's routing area is the
  **submitter's single area**; a **TechOp2 may cover multiple areas** (`loggedInAreas`, an
  array — technician picks exactly 1, techop2 1+, enforced by `areaListError(role, areas)` /
  `roleAllowsMultiArea(role)`). `dashboard_users.area` is a **string OR array** — always read
  via `toAreaList(a)` (parses a JSON-array string too), stored in `localStorage['dashboard_area']`
  as a JSON array (both dashboards). **The `area` written onto an `approvals` doc must be the
  single plain area string, never the array or its JSON form.** An earlier `submitWithFiles()`
  session-backfill stored `dashboard_area`'s raw value (`'["Powerblock"]'`) onto the approval,
  which broke scope matching (`loggedInAreas.includes('["Powerblock"]')` is false → the PIC
  couldn't review their own area's submissions). Fixed on three fronts: `approval-helper.js`
  normalizes via a local `_firstArea()` (team-routing.js isn't loaded on check sheets) in both
  `create()` and the `submitWithFiles()` backfill; `TeamRouting.resolveScope()`/`inScope()` and
  the review dashboard's `scopeOfApproval()` normalize `a.area` on read (so already-broken docs
  route correctly); and `loadAll()` self-heals — rewrites just the `area` field on any
  `approvals` doc whose value still starts with `[` (idempotent, workflow-collection only).
  `inMyReviewScope(a)` is true when `loggedInRole !==
  'techop2'` (Supervisor/Admin **never** scoped), or the reviewer has no scope set (fail open),
  or `s.team === loggedInTeam && loggedInAreas.includes(s.area)`. `inboxItems()` filters the
  TechOp2 `'submitted'` queue through it;
  `renderActionSection()` re-checks it so a direct link to an out-of-scope submission renders a
  "di luar cakupan team/area Anda" notice instead of the review form. A submission whose
  submitter's team isn't recorded (name mismatch, pre-feature data) matches **no** TechOp2 and
  is handled via the Admin account — the `#scope-note` banner says so.
- **Explicit routing on the approval doc**: `Approvals.create()` / `submitWithFiles()` now
  accept `team` / `area` / `src` in `opts` — stored straight on the `approvals` doc, and
  `scopeOfApproval()` reads them (after `EXTERNAL_SUBMITTER_SCOPE`, before `_userDir`) so a
  submission can be routed without matching `submittedBy` to an account. Used by **Manual
  Upload** (below); normal check sheets don't pass them so nothing changes.
- **Manual PDF Upload** (`#btn-manual-upload` in the toolbar, **all logged-in roles** →
  `#manual-overlay`): pushes a report done OUTSIDE the check-sheet system into the flow.
  `submitManualUpload()` → `DB.save()` a `checksheets` doc (`manualUpload:true`, a
  `sheets.info` summary) → `Approvals.submitWithFiles()` with `pdfBuilder: () => ({ output:
  () => pdfFile })` (the picked PDF `File` handed straight through — `submitWithFiles` only
  ever calls `pdf.output('blob')`), `photos:{manual:[…]}` (images canvas-downscaled by
  `_muImageToDataUrl()` since the dashboard doesn't load photo-kit), and `team`/`area`/`src:
  'Upload manual'`. The `#file-progress` overlay is driven by `setFileProgressPct()` +
  `submitWithFiles`' `onProgress`. Edit/revise actions are hidden for `_src` submissions.
  The checksheet doc gets `manualUpload:true`, `assetTag:'MANUAL-UPLOAD'` (if none typed), and
  `uploadedBy` / `uploadedByUsername` = the logged-in uploader (may differ from the PIC in
  `checkedBy`). `dashboard.html`'s technician-scope filter matches `checkedBy` **OR**
  `uploadedBy` **OR** `uploadedByUsername` so the uploader can track approval status there;
  both detail views show a "Diinput oleh" row when `uploadedBy` is set.
- **External feeds** (`EXTERNAL_SUBMITTER_SCOPE`): other POMI mini-apps post into the same
  `checksheets`/`approvals` collections via `Approvals.submitWithFiles()` but can't hold
  `dashboard_users` accounts, so they send a **fixed synthetic `submittedBy` per plant area**
  and `scopeOfApproval()` maps it (checked **before** `_userDir`) to `{team, area, src}`.
  Currently: `mahfudjtf`'s **PM-UNIT-7** (`shared.js` → `raSendFinalPdfToFirebaseDashboard()`)
  sends `PM Unit 7 - Boiler` / `- Turbine` / `- Common CHCB` / `- Common WWTP` → all `C7` +
  the matching area (the real PIC name stays on the checksheet doc's `checkedBy`). Cards/detail
  show a `src` tag (`PM Unit 7`); the "Edit Check Sheet" / "Buka Check Sheet untuk Revisi"
  actions are hidden for these (the form lives in the other app — fixes are made there and
  re-submitted). Add a new mapping here if another app is wired in.
- The `"Semua Riwayat"` / `"Dikembalikan"` tabs are **not** scoped (full history stays visible
  to everyone); only `"Menunggu Saya"` is. Cards show a `.card-scope-tag` (`E7 · Powerblock`),
  and the detail view's Info grid has a "Team / Area (PIC)" cell.
- **`"Semua Riwayat"` has a filter/sort bar** (`#history-filters`, shown only on that tab):
  free-text search (name / tag / PIC / WO / area / src), status, team, area (repopulated per
  team by `populateHistoryAreaOptions()`), and sort (`sortApprovals()`: newest / oldest /
  name A→Z / Z→A / status order). `renderList()`'s "all" branch applies them and writes
  `#history-count` ("Menampilkan X dari Y"). `loadAll()` folds `woNumber`/`executionDate` from
  `_checksheetCache` (populated by `cleanupDuplicateApprovals`) onto `a._wo`/`a._date` for the
  search + the card meta line. `resetHistoryFilters()` clears everything.
- **`roleNeedsTeam(role)`** (`role !== 'supervisor' && role !== 'admin'`) gates all of the
  above — Supervisor/Admin never pick a team (not in registration, not the blocking overlay,
  not `checkSession`'s backfill). Only technician/techop2/unknown-role accounts are forced.
- **Area picker is checkboxes** (`renderAreaChecks(containerId, team, selected)` /
  `getCheckedAreas(containerId)`), used in registration, the mandatory `#team-overlay`, AND a
  **"Team & Area" section in the Settings modal** (`saveTeamAreaFromSettings()` — writes the
  doc, `setTeamSession()`, `refreshScopeNote()`, then `loadAll()` so the inbox re-scopes
  immediately). Shown only for `roleNeedsTeam(loggedInRole)`.
- Verified via headless Chrome: `toAreaList`/`areaListError`, techop2 register multi-checkbox,
  a C7·`[Boiler,Turbine]` TechOp2 inbox includes both-area submitters and excludes others, and
  the Settings Team & Area section prefills + is role-gated.

### Self-registration now picks its own role + registers a signature draft

Later change, explicit user request — supersedes the old "self-registration is ALWAYS
`role:'technician'`" rule (that comment is gone from `doRegister()`). Firestore is already
fully open on this project (see the trust model above), so this is a UI decision, not a new
security hole.

- **`#reg-role`** select in the registration form: `technician` (Level 1) / `techop2` (Level 2)
  / `supervisor` (Level 3). `SELF_REG_ROLES` is the allowlist; **Admin is NOT self-registerable**
  (stays Firestore-provisioned). `onRegRoleChange()` toggles `#reg-team-wrap` (shown when
  `roleNeedsTeam(role)`), `#reg-code-wrap` (shown when `roleNeedsAccessCode(role)` = techop2 |
  supervisor) and `#reg-sig-wrap` (shown when `roleUsesSignature(role)`).
- **Access code gate for elevated roles** (`roleNeedsAccessCode(role)`): registering as
  `techop2` / `supervisor` requires a code, checked in `doRegister()` **before** any Firestore
  write. `getElevatedRegCode()` reads Firestore `dashboard_config/registration.code` and falls
  back to the `ELEVATED_REG_CODE` constant (`'POMI-EIC7-2026'` — change it, or override without
  a deploy by creating that Firestore doc; the collection isn't in the security-rules allowlist
  so the read throws and silently uses the fallback until an admin adds it). `technician`
  registration needs no code.
- **`roleUsesSignature(role)`** = `techop2 || supervisor || admin` — these roles sign during the
  workflow, so their `dashboard_users` doc carries a **`signature`** field (a PNG data URL from
  the same `attachSignaturePad()` / `getSignatureDataUrl()` / `handleSignatureFile()` pad the
  review/approval forms use). Registration **requires** it for those roles.
- **Session**: `loggedInSignature` + `sessionStorage['dashboard_signature']`, set by
  `setSignatureSession()` on login/register, backfilled in `checkSession()` (combined with the
  team backfill fetch — `needTeamBackfill || needSigBackfill` triggers one lookup), cleared by
  `doLogout()`. A `sessionStorage` quota failure is swallowed (re-fetched next login).
- **Auto-fill on review/approve**: `renderDetail()` calls `prefillSignatureCanvas(canvasId)`
  right after `attachSignaturePad()` for `sig-canvas-review` / `sig-canvas-approval` — draws
  `loggedInSignature` onto the pad and sets `hasInk` so `getSignatureDataUrl()` returns it with
  no re-signing. The reviewer can still "Hapus Tanda Tangan" + redraw to override for one item.
  `closeDetail()` now `delete`s `_sigState['sig-canvas-review'/'sig-canvas-approval']` so the
  next open re-binds the fresh canvases (fixed a latent bug: `attachSignaturePad()` skips a
  canvas whose id is already in `_sigState`, so without this the 2nd detail-open's pad was dead
  and prefill never re-ran).
- **Missing-signature nudge**: `showApp()` shows the non-blocking `#sig-note` banner (amber,
  with a "Simpan Tanda Tangan" button) when `roleUsesSignature(loggedInRole) &&
  !loggedInSignature`. The button opens `#sig-overlay` (`openSignatureSetup()` — has a "Nanti
  saja" close, unlike the team overlay); `saveSignatureSetup()` looks the user's doc up by
  username, `.update()`s `{signature, signatureUpdatedAt}`, updates the session, hides the
  banner.
- Verified via headless Chrome: role→wrap visibility for all 3 roles, `roleUsesSignature`
  truth table, the sig-note banner shows/hides on `loggedInSignature`, and
  `prefillSignatureCanvas()` makes `getSignatureDataUrl()` return the saved signature.

### Account settings + light/dark theme

- **Theme** (`ra_theme` in `localStorage`: `'light'` | `'dark'` | absent = follow OS). A tiny
  script in `<head>` (before the stylesheet) sets `document.documentElement[data-theme]`
  pre-paint so there's no flash. Dark tokens live in one `:root[data-theme="dark"]{…}` block —
  the runtime JS always writes an explicit `light`/`dark` attribute (resolving "system" via
  `matchMedia`), so no `@media (prefers-color-scheme)` CSS block is needed. All colors flow
  through CSS custom properties; a handful of previously-hardcoded hex values (amber/green/rose
  "ink", chip bg, danger surfaces, the detail-overlay scrim) were pulled into new tokens
  (`--amber-ink`, `--green-ink`, `--rose-ink(-2)`, `--chip-bg/-ink`, `--warn-bdr`,
  `--danger-surf`, `--danger-btn-surf/-bdr`, `--btn-ok-hover`, `--btn-danger-hover`,
  `--overlay-scrim`). `setTheme('light'|'dark'|'system')` / `cycleTheme()` / `syncThemeUI()`;
  a topbar `#theme-btn` (☀️/🌙) cycles light↔dark, the settings modal has a 3-way segmented
  control. Signature `<canvas>` backgrounds stay white on purpose (ink capture → white PDF).
- **`#settings-overlay`** (topbar ⚙️ `#settings-btn`, shown in `showApp()`): reuses the
  `.login-overlay` scrim/box + a close button, scrollable. Sections:
  - **Tampilan** — the theme segmented control.
  - **Profil** — edit `name` + `username`. `saveProfile()` checks username uniqueness
    (`where('username','==',…)`), `.update()`s the doc, and updates `loggedInName`/`loggedInUser`
    + `sessionStorage` (`dashboard_name`/`dashboard_user`) + the topbar `#user-label` live.
  - **Ganti Password** — verifies the current password hash before `.update()`ing the new one.
  - **Tanda Tangan** — only shown for `roleUsesSignature(loggedInRole)`; same pad, prefilled
    with `loggedInSignature`, `saveSignatureFromSettings()` writes it and clears `#sig-note`.
  - `_myUserDoc()` resolves the caller's `dashboard_users` doc (cached `_myUserDocId` from
    login, else a username lookup) — every settings write goes through it.
- **Forgot password** — `#forgot-panel` (a third `toggleAuthMode()` mode, `'forgot'`, reached
  from a "Lupa password?" link on the login screen). No email system, so `doForgotPassword()`
  gates the reset behind the **same admin access code** as elevated registration
  (`getElevatedRegCode()`), then username-looks-up and `.update()`s the password hash. Tell
  the user: distributing that code = anyone with it can reset any password.
- Verified via headless Chrome: theme set/cycle/system + `localStorage` + seg/btn UI sync,
  `toggleAuthMode('forgot')` panel swap, `openSettings()` field prefill + role-gated signature
  section, and a dark-mode screenshot of the app + settings modal.

### Adding this to a new check sheet

1. Add three script includes right after `db-helper.js`, before `img-helper.js`/`photo-kit.js`:
   `<script src="storage-helper.js">`, `<script src="approval-helper.js">`,
   `<script src="load-merge-modal.js">`.
2. Add (or repurpose an existing) button calling `LoadMergeModal.open()`.
3. Near the file's own init code (often right next to an existing `loadDraft()` call), add
   `LoadMergeModal.init({ assetTag: '<this sheet's assetTag>' });` and
   `LoadMergeModal.initRevisionBanner();`.
4. In the submit function, immediately after `DB.save(base)` succeeds (and only after — the
   checksheet doc must already be safely saved before any of this best-effort work runs), add:
   ```js
   let filesOk = true;
   try {
     showNote('⏳ Mengunggah foto & PDF untuk alur review/approval...', 'info');
     filesOk = await Approvals.submitWithFiles(id, {
       photos: PHOTOS,                                   // or null — see below
       pdfBuilder: () => generatePDF(/*...*/, {silent:true}),  // or null — see below
       assetTag: '<assetTag>', assetName: '<assetName>',
       checksheetFile: '<this file's own name>.html',
       submittedBy: checkedBy,
       revisionOf: LoadMergeModal.getReviseOfApprovalId(),
     });
   } catch (e) { filesOk = false; console.error('Approvals.submitWithFiles gagal:', e); }
   showNote(filesOk ? '✅ ...' : '⚠️ Data checklist tersimpan, tapi foto/PDF gagal diunggah...', filesOk?'ok':'err');
   ```
   This must never make a successful checksheet save look like a failed submit — a Drive/network
   hiccup here is a warning, not an error, exactly like PLTS_AshDisposal_PM.html's reference
   implementation.
5. **If `generatePDF()` (or equivalent) doesn't already support a "silent" no-save/no-preview
   mode that returns the built `jsPDF` object**, add one the same minimal way PLTS does: an
   `opts.silent` branch that skips the `pdf.save()`/preview call, plus `return pdf;` at the very
   end of the function. Don't otherwise touch the PDF's layout/content.
6. **Photo shape**: `Approvals.submitWithFiles()` expects `photos` as `{groupKey: [{src,
   caption}, ...]}`. Not every check sheet's photo state already matches this — some use a flat
   array (`[{src,caption,...}]`, wrap as `{main: PHOTOS}`), some use fixed named slots
   (`photoStore[slotId]` / `PS`/`PE`/`PSD` triples, one photo per slot — write a small
   `collectPhotosForUpload()` helper that maps the slots into `{main:[{src,caption}]}` or one
   group per logical zone), some have two separate photo arrays for different purposes (e.g.
   `HV_Motor_SWGR.html`'s `PHOTOS` + `TREND_PHOTOS` — pass both as separate keys:
   `{main: PHOTOS, trend: TREND_PHOTOS}`). Pass `photos: null` for a sheet with no photo
   feature at all.
7. **Multi-asset / no-fixed-tag sheets** (a dropdown of many possible tags, one submission per
   selection — e.g. `DMH_Motor_PM_Checksheet.html`'s 8 units, `HV_Motor_SWGR.html`'s searchable
   HV motor list, `LV_Motor_MCC.html`'s MCC motor list, `4000_Hours_Mill_PM.html`'s per-Mill
   tag): `LoadMergeModal.init({assetTag})` only supports one static config at a time, so these
   files re-call `.init()` with the *currently selected* tag immediately before every
   `.open()` (wrap it, e.g. `function openLoadMergeModal(){ LoadMergeModal.init({assetTag:
   currentTag}); LoadMergeModal.open(); }`), and also re-call `.init()` inside whatever
   `onchange` handler fires when the technician picks a different asset/unit — not once at
   page load with a hardcoded tag.
8. **Header field id mismatches** (e.g. some files use `done-by` instead of `checked-by` — see
   "The data contract" above): pass a custom `headerMap` to `LoadMergeModal.init({assetTag,
   headerMap: {...}})`, overriding just the mismatched keys — the module's own default already
   covers `wo-no`/`wo-date`/`time-start`/`time-end`/`checked-by`/`nik`/`reviewed-by`/`shift`.
9. **A sheet that builds its Firestore doc manually instead of via
   `DB.collectCheckSheetData()`** (rare, but e.g. `Transformer_AT_NoDGA_Weekly.html`) won't have
   `inputValues`/`toggleStates` saved at all by default — LoadMergeModal's merge/revision-restore
   depends on both to bring back anything beyond the WO header fields. Add them to the saved doc
   the same way `db-helper.js`'s own `collectCheckSheetData()` does (a `querySelectorAll`
   sweep over every `<input>`/`<select>`/`<textarea>` with an id, plus a snapshot of the page's
   `ST` toggle-state object) — purely additive, doesn't change or remove any existing field, and
   has no effect on `dashboard.html` (which never reads either of these two fields).
10. **Implement `window.restorePhotosFromUrls(photoUrls, overwrite)`** so a Load & Merge / a
    returned-for-revision restore brings evidence photos back too, not just text fields — see
    the dedicated section right below for the full contract and why every check sheet needs its
    own implementation of this one function.

### Restoring photos on merge/revision — `restorePhotosFromUrls(photoUrls, overwrite)`

Without this, a technician whose submission was returned for revision (or who picks a past
submission via Load & Merge) gets every text/measurement/toggle field back, but an **empty
photo gallery** — they'd have to re-take/re-upload every evidence photo from scratch even
though the exact same photos already exist in Drive from the original submission. Fixed by:

- **`Approvals.submitWithFiles()`** now carries `w`/`h`/`widthCm`/`heightCm` alongside each
  photo's `url`/`caption` in the saved `photoUrls` (previously URL + caption only) — this is
  what lets a restored photo come back at its original crop/print size instead of falling back
  to PhotoKit's default box.
- **`Storage.toDataUrl(url)`** (`storage-helper.js`) converts a Drive-proxy URL back into a real
  `'data:image/jpeg;base64,...'` string — not a `blob:` URL, since check sheets' photo state
  expects a data: URL (PhotoKit's own `src`/`dataUrl` convention, and what `pdf.addImage()`/
  `PhotoKit.draw()` need).
- **`buildMergedBundle()`** (`load-merge-modal.js`) now also folds `photoUrls` from every
  selected/source document into the merge bundle — photos are **unioned per group** across
  selected docs (concatenated, oldest-first), never "newest wins overwrite" like a scalar field,
  since two different submissions' photos for the same group aren't competing values, they're
  both real evidence that should survive a multi-select merge.
- **After the text-field merge completes, `_confirm()`/`loadRevisionSource()` call
  `window.restorePhotosFromUrls(photoUrls, overwrite)` if the host page defines one.** This
  module cannot generically restore photos itself — the 22 check sheets in this repo use at
  least 6 different in-memory photo-state shapes:
  - a `{groupKey: [...]}` dict, one array per logical sub-asset (`PLTS_AshDisposal_PM.html`'s
    `PHOTOS` keyed by inverter, `4000_Hours_Mill_PM.html`'s `PHOTOS` keyed by per-tab asset —
    note the latter is keyed by the FIXED asset key, not by which Mill letter is selected, since
    `submitToDb()` already saves it that way regardless of Mill; `DRY_TRAFO_PM.html`'s `PHOTOS`
    keyed by check-item group `megger`/`etm`/`etmset`/`cleaning` — this file's photo section was
    converted from fixed single-photo slots to free-count keyed galleries, with `compressUnder1MB`
    on every add/recrop/rotate path and a separate `dry_trafo_photos` localStorage key so photos
    now survive a refresh)
  - a flat array with no grouping (`ESP_7BGPCP800A_B.html`, `UPS_7EB-UPS-AB_Monthly.html`) —
    `photoUrls`' groups get flattened into one list, and the fill-blank-only check collapses to
    "is the whole array non-empty", not per-group
  - fixed single-photo-per-slot triples keyed by a slot id (`PE`/`photoStore`/`PS`+`PSD`+`PE` —
    the six `Transformer_*` weekly/monthly sheets, `7EPLCB4_Maintenance.html`) — only the FIRST
    entry of a slot's array can be kept if a merge ever produces more than one (there's only one
    physical slot), and the newest-contributing submission's photo wins for that slot
  - `FILES`, a flat array of mixed image+file attachments with a `type` field
    (`GEN_BrushGear_PM_Checksheet.html`) — restore only touches entries whose `type` starts with
    `image/`
  - `BLOCKS[i].photos`, a free-form reorderable block list (`Work_Activity_Record.html`) — since
    blocks can be added/removed/reordered between the original submission and a later revision
    session, the saved `'block'+i` group key may no longer point at an image block by the time a
    restore runs; rather than silently drop those photos when the index doesn't line up anymore,
    a fresh image block is appended to hold them (preserves every photo, just not necessarily in
    its original position — recoverable by the technician reordering, unlike a silently dropped
    photo)
  - a fixed compartment/photo-drop-zone id keyed by a domain code, one photo each
    (`7EPLCB4_Maintenance.html`'s `COMPS`)

  A sheet with no photo feature, or one that hasn't implemented the hook, silently restores 0
  photos — every other field still merges/restores normally, it just leaves the gallery empty
  like before this feature existed. **Every check sheet in this repo already implements this
  hook** (see each file's own `restorePhotosFromUrls()` for the concrete pattern closest to a
  new sheet's own photo-state shape) — when adding a new check sheet, copy whichever existing
  implementation matches its photo widget most closely rather than writing one from scratch.

  **The contract every implementation follows:**
  1. Takes `photoUrls`: `{groupKey: [{url, caption, w, h, widthCm, heightCm}, ...]}` (w/h/
     widthCm/heightCm may be absent on older entries saved before this feature — treat as
     optional, and consider measuring via `PhotoKit.prepare([entry])` if missing, so
     `PhotoKit.fit()`/`.draw()` still has real pixel dimensions instead of silently falling back
     to a stretched/default box).
  2. For each relevant entry, calls `await Storage.toDataUrl(entry.url)`, wrapped in its own
     try/catch so **one failed fetch (expired/deleted Drive link, network hiccup) never aborts
     restoring the rest** — skip that one photo, keep going.
  3. Respects `overwrite`: `true` replaces a group/slot's current photo(s) entirely; `false`
     (default merge mode) only fills a group/slot that's **currently empty in this session** —
     never touches one the technician already has photos in, mirroring the same fill-blank-only
     spirit the rest of the merge system already applies to text fields.
  4. Calls the file's own gallery-render function afterward so restored photos actually become
     visible, not just sitting in a JS variable.
  5. Returns the number of photos actually written (not counting skipped/failed ones) —
     `load-merge-modal.js` shows this count in its toast (e.g. "3 field terisi, 2 foto
     dipulihkan").
  6. If the sheet has its own localStorage-based photo-draft persistence, it does NOT need to
     call it itself — `load-merge-modal.js` already calls the host page's `autoSaveNow()` right
     after `restorePhotosFromUrls()` resolves, if one is defined. (One exception:
     `ESP_7BGPCP800A_B.html` has no `autoSaveNow()` at all, so its implementation calls its own
     `savePhotoDraft()` directly instead — check whether a sheet actually defines `autoSaveNow`
     before assuming the generic path covers it.)

### "Status Laporan" tab (`Review_Approval_Dashboard.html`)

The **first / default tab** (`data-tab="mystatus"`, leftmost, before "Menunggu Saya"),
read-only, so whoever submitted or reviewed a report can see where it sits in the
Submit → Review → Approval flow without hunting through the review queues. It was
briefly a separate `Status_Report.html` page — that was folded into this tab and the
file deleted; there is no standalone status page.

- **Role decides the sections** (`myStatusSections()`), rendered by `renderMyStatus()`
  into `#mystatus-area`:
  - `technician`: one section, "Laporan yang saya submit" — every approval where
    `_msMatches(a.submittedBy)` or the cached checksheet's `checkedBy`/`uploadedBy`/
    `uploadedByUsername` matches. `_msMatches()` is **token-overlap**, not exact
    (user request): it tokenizes the logged-in account's name + username and the report's
    name field (`_nameTokens()` — lowercase, ≥3 letters, minus the `_MS_STOP` set of
    honorifics/particles like `muhammad`/`abdul`/`bin`/`pak`) and matches if any token is
    shared. So account "Fauzan Agung Hamidi" also picks up a report whose Checked By is just
    "Fauzan", "Fauzan Hamidi", or a multi-name "Fauzan, Adnan" (which then appears for BOTH
    Fauzan and Adnan). Deliberately loose — it's a read-only status view, not a permission
    gate; a shared middle/last name causes harmless over-inclusion. `_msMyTokens()` is
    memoised per `loggedInName|loggedInUser`. `dashboard.html`'s technician scoping still
    uses its own stricter exact-name filter (unchanged).
  - `techop2`: "Masuk untuk saya review" (`status==='submitted' && inMyReviewScope(a)` —
    the exact same scope filter the "Menunggu Saya" inbox uses), "Sudah saya review"
    (`a.review.reviewedBy` matches me, incl. auto-reviews), "Laporan yang saya submit"
    (hidden when empty).
  - `supervisor`: "Menunggu approval saya" (`status==='reviewed'`), "Sudah saya approve"
    (`a.approval.approvedBy` matches me), "Laporan yang saya submit" (hidden when empty).
  - `admin`: one section, all approvals.
- `_msStepper(a)` draws the Submit→Review→Approval→Selesai dot strip; a
  `returned_to_technician` renders a red "back" state at the stage in `returnedNote.stage`,
  and the submitter's card gets a "Perbaiki & kirim ulang" link (`<checksheetFile>?reviseOf=<id>`).
  "Detail lengkap" calls `openDetail(a.id)` directly (same page).
- Pure read — reuses the already-loaded `_allApprovals` + `_checksheetCache` (populated by
  `cleanupDuplicateApprovals()` / the `_wo`/`_date` fold in `loadAll()`); no extra fetch.
  `switchTab('mystatus')` and `loadAll()`'s tab dispatch both route to `renderMyStatus()`;
  `updateTabCounts()` fills `#count-mystatus` from `myStatusItems()` (deduped id set across
  the role's sections). `showApp()` calls `switchTab(_activeTab)` once so the default tab's
  panel visibility is synced on load.

## `cloud-draft.js` — "Simpan ke Database (Lanjut Nanti)", unified with Load & Merge

"Save a not-yet-finished report to the database and continue it later, from any device" — built
as ONE system with Load & Merge, NOT a separate feature (explicit user requirement: *"jadikan
satu system.. jangan buat terpisah agar tidak membebani drive"*). Rolled out to **all 25 portal
check sheets** (self-injecting like `submit-guard.js`). Firestore Rules must allow:
`match /checksheet_drafts/{doc} { allow read, write: if true; }` — degrades to localStorage-only
+ a clear toast on `permission-denied`. Drafts live ONLY in `checksheet_drafts` (never
`checksheets`), so dashboard / trend / dedup / review need no change.

- **`CloudDraft.save()`** ("💾 Simpan ke Database"): local `saveDraft()` first, then
  `DB.collectCheckSheetData(formId, tag, name, freq)` for `inputValues` + `toggleStates` (works
  even on sheets whose `submitToDb()` builds the doc manually), uploads photos to Drive, and
  `db.collection('checksheet_drafts').doc(<id>).set({..., status:'draft', photoUrls, extra})`.
  The id lives in `localStorage['cd_<formId>_<tag>']` so re-saving UPDATES the same doc.
  **A photo already on Drive from an earlier save is NOT re-uploaded** — each entry gets a
  `__cdSig` (`length~head~tail` of its data URL) + `__cdUrl` stamp; a re-save with an unchanged
  signature reuses the URL. When the host passes no `photos` getter, `autoPhotos()` finds the
  page's `PHOTOS` (or `FILES`) global via `new Function('return PHOTOS')` — a plain
  `window.PHOTOS` check silently missed every sheet that declares `let PHOTOS` / `const PHOTOS`
  (a lexical global, NOT a `window` property), so before this fix a "Simpan ke Database" draft
  saved ZERO photos and reopening on another device showed an empty gallery. `Motor_Witness_
  Test_Vendor.html` also passes an explicit `photos: buildApprovalPhotos` (returns the
  `{sectionKey:[{src,caption,w,h,widthCm,heightCm}]}` shape directly). On restore, both
  `loadSession()` (motor-gate list) and the shared modal's `restorePhotosIfSupported()` already
  call the host's `restorePhotosFromUrls(photoUrls, overwrite)`; `listDrafts()` returns the full
  draft doc (`photoUrls` included) so `buildMergedBundle()` has them to union.
  - **On-demand photo loading (`Motor_Witness_Test_Vendor.html`).** Each Drive photo is a ~2–3s
    round-trip through the Apps Script proxy, so downloading a session's whole gallery inline
    made "load a saved session" hang 20–30 s and look like the photos never came back.
    `restorePhotosFromUrls(photoUrls, overwrite, {defer:true})` (used by `loadSession()`) now
    only STASHES the URLs in `_pendingPhotoUrls` + `_loadedPhotoUrls` and renders a banner — it
    does NOT auto-download. Every photo section header has a persistent **"☁️ Muat Foto Drive"**
    button (`reloadDrivePhotos(key)`): pulls `_pendingPhotoUrls[key]`, else re-fetches from
    `_loadedPhotoUrls[key]` / `CloudDraft.getReusePhotoUrls()`, else a clear "nothing saved"
    note. `loadPendingPhotos()` downloads at CONC=3 with one retry each, **renders each photo
    the moment it lands** (`renderPhotos(key)` per photo, not one batch at the end), drives a
    progress pill on `#autosave-indicator` ("⏳ Mengunduh foto 5/21…" → "✅ N foto dimuat", or
    "⚠️ … M gagal" with a re-click hint), and splices consumed URLs out of `_pendingPhotoUrls`
    so a partial re-run only fetches the failures. `saveSessionDraft()` / `submitToDb()`
    `await loadPendingPhotos()` first when `_pendingTotal()>0` so a still-pending photo is never
    dropped. The LoadMergeModal path passes no `{defer}` → downloads inline behind its own
    progress overlay. `_pendingPhotoUrls` / `_loadedPhotoUrls` persist in `DRAFT_PHOTOS_KEY`
    (`._pending` / `._loaded`) so a refresh keeps the banner + button working.
  - **A "Save Draft" made while photos are still deferred used to WIPE them from the draft doc.**
    `CloudDraft.save()` does `db.collection('checksheet_drafts').doc(id).set(payload)` — a full
    replace — and `payload.photoUrls` was built purely from `cfg.photos()`. On Motor Witness a
    restored session's photos sit in `_pendingPhotoUrls` (not `PHOTOS`) until "☁️ Muat Foto Drive"
    downloads them, so `buildApprovalPhotos()` returned `null` and the `.set()` erased the
    previously-saved `photoUrls: {b, f, …}` — successfully-uploaded photos then showed "0 foto" on
    the next open, nothing to load. Fixed on three fronts (all `?v=` bumped repo-wide, this was a
    shared-lib change): (1) `buildApprovalPhotos()` now also emits every `_pendingPhotoUrls[k]`
    entry as a **URL-only reference** `{__cdUrl:<driveUrl>}` (no `src`), deduped against live
    entries by `__cdUrl`; (2) `approval-helper.js`'s `submitWithFiles()` and `cloud-draft.js`'s
    `save()` both learned to pass a `{__cdUrl, no src}` entry straight through as an
    already-on-Drive file instead of the old `!p.src` → skip; (3) `cloud-draft.js` fetches the
    existing draft doc's `photoUrls` up front (when `_activeDoc` doesn't have it) and, **only when
    `cfg.photos()` returns `null` entirely** (a throw / load-order race — never when it returns an
    object, where an absent group is a real delete), carries them forward so a `.set()` can't
    erase the group. Verified headless: save while deferred → 0 uploads, `photoUrls` kept; a real
    per-photo delete (7→4 live) → saved as 4, carry-forward does not resurrect the 3.
- **Continuing a draft uses the SAME "📥 Muat / Lanjutkan dari Database" button as Load & Merge**
  (the old "Pilih & Gabung Data" button, relabelled everywhere). `load-merge-modal.js`'s
  `open()` now also calls `CloudDraft.listDrafts()` and lists drafts above the submitted history,
  badged **DRAFT**. Picking a single draft row = full overwrite restore; `_confirm()` calls
  `CloudDraft.adopt(id, doc)` **before** `buildMergedBundle` / `restorePhotosFromUrls` (so
  `cfg.applyExtra` — e.g. MCA's `narrativeBlocks` into `_cloudNB` — is staged first) and this
  session then keeps working on that draft doc.
- **Submit is only for a finished report.** `submitToDb()` creates the real `checksheets` doc +
  approval as usual, but `Approvals.submitWithFiles()` **reuses the draft's already-uploaded
  photo URLs** (`opts.reusePhotoUrls` / `CloudDraft.getReusePhotoUrls()`, group-for-group on a
  count match) so Drive is never hit twice for the same photos; only the archival PDF uploads.
  `CloudDraft.markSubmitted()` (wired right after `SubmitGuard.markSubmitted(...)` in every sheet)
  then deletes the draft doc.
- **`CloudDraft.init({ formId, assetTag, assetName, frequency, photos?, collectExtra?, applyExtra?,
  afterRestore? })`** — one call per file, right after `TechnicianAuth.init(...)` (the single
  reliable top-level anchor). `assetTag` is a **getter reading the DOM tag field** (`#tag-search`
  / `#tag-no` / `#sel-unit`, try/catch-wrapped) for the multi-asset sheets — NOT a bare JS var
  (`()=>tag` threw `ReferenceError` at save time because `tag` was only a function parameter).
  MCA also passes `photos` (flatten NB image blocks + `PHOTOS.attachments`),
  `collectExtra`/`applyExtra` (`narrativeBlocks` structure → `_cloudNB`, checked first by
  `_fetchSourceNarrativeBlocks()`), `afterRestore`.
- `PLTS_AshDisposal_PM.html` keeps its bespoke per-inverter merge button AND gets a second
  "Muat / Lanjutkan Draft" button wired to the shared `LoadMergeModal` (+ its own
  `LoadMergeModal.init`). The 3 legacy dups (`esp_checksheet.html`, `4000 Hours Mill/*.html`)
  are not wired, same as submit-guard.

## Cache-busting shared JS includes (`?v=` suffix)

GitHub Pages serves static assets with `Cache-Control: max-age=600`, so after a shared
lib (`approval-helper.js`, `team-routing.js`, `db-helper.js`, `auth-session.js`,
`storage-helper.js`, …) changes, a browser keeps the **old** copy for up to 10 minutes
without revalidating — the symptom is a fresh page HTML calling a method the cached lib
doesn't have yet (`"Approvals.cancelReturn is not a function"`). As of the `revised`-status
rollout (2026-08-30) **every** `.html` page in the repo loads the shared libs with a single
shared `?v=YYYYMMDDx` query string (currently `?v=20260904d`) — a Python one-liner rewrites
all `<script src="[../]<lib>.js?v=…">` includes at once. **On any shared-lib change, bump the
suffix repo-wide** (same script) so no browser serves a stale copy of a lib whose API the
new page HTML depends on. The revision-overwrite flow in particular is triggered from a
check sheet's `submitToDb()`, so a stale `submit-guard.js` / `approval-helper.js` there
would silently fall back to the old behavior.

## `pdf-preview.js` — the shared "preview before it goes anywhere" modal

Self-injecting like `submit-guard.js`. Monkey-patches `window.jspdf.jsPDF.API.save` so every
check sheet's "Download PDF" button opens a full-document preview (pdf.js → stacked `<canvas>`,
all pages, mobile-safe) first; `SubmitGuard.resolveSubmitTarget(wo, pdfBuilder)` calls
`PdfPreview.confirm()` for the same preview on the submit path.

- **"Unduh PDF" does NOT go through `pdf.save()` / a captured original.** An earlier version
  captured `jsPDF.API.save` into `_realSave` at hook time and called it on the primary button —
  but on the jsPDF 2.5.1 UMD build `jsPDF.API.save` isn't reliably a plain function on `API` at
  that instant, so `_realSave` ended up `undefined` and clicking "Unduh PDF" threw
  `Cannot read properties of undefined (reading 'call')` — the preview looked fine, the download
  never happened. Fixed with `_forceDownload(pdf, name)`: `pdf.output('blob')` →
  `URL.createObjectURL` → a synthetic hidden `<a download>` click (exactly what jsPDF.save does
  internally, minus the fragile prototype dependency, and it can't recurse into the hook).
  `_realSave` is now only a best-effort fallback if `output('blob')` itself throws.
  `PdfPreview.download()` and the `_bypass` branch both route through `_forceDownload` too.
  `_installed` (not `_realSave`) is the "hook already applied" guard now.
- Verified headless (CDP `Browser.setDownloadBehavior` + `downloadWillBegin`/`downloadProgress`):
  clicking "Unduh PDF" writes a valid multi-page `MCA_*.pdf` to disk.

## Technician login on check sheets — auto-filling "Checked By" (`technician-auth.js`)

An optional, **non-blocking** login widget (`window.TechnicianAuth`) that lets a technician log
in with their `dashboard_users` account (the same collection/login `dashboard.html` and
`Review_Approval_Dashboard.html` already use, including accounts self-registered there — see
"Review & Approval Workflow" above) so their Checked-By-equivalent field auto-fills with their
real name instead of being typed by hand, and the review dashboard can trust it actually matches
who submitted. **Deliberately not a login gate**: a technician who doesn't log in can still type
that field manually and submit exactly like before this existed — no risk of a technician being
locked out in the field over a forgotten password, bad signal, or a shared device with no
account set up yet. Logging in only *upgrades* the experience (auto-fill + the field becomes
read-only so it can't drift from the logged-in account by accident); it never restricts it. This
was an explicit product decision (asked directly, chose "optional" over "mandatory") — don't
change this to a hard requirement without checking first, it's load-bearing for field usability.

**One script include + one `init()` call per check sheet, nothing else** — same self-injecting
philosophy as `load-merge-modal.js`:
```html
<script src="db-helper.js"></script>
<script src="technician-auth.js"></script>
...
<script> TechnicianAuth.init({ checkedByFieldId: 'checked-by' }); </script>
```
`checkedByFieldId` must match whatever this file's own header field is actually called — per
"The data contract" above, this varies: 14 check sheets use `checked-by`, 7 use `done-by`
(`7EPLCB4_Maintenance.html`, `7EPMCC_Maintenance.html`, `DRY_TRAFO_PM.html`,
`HV_Motor_6Monthly_PM.html`, `HV_Motor_SWGR.html`, `Hoist_Inspection_Maintenance.html`,
`LV_Motor_MCC.html`), and `Work_Activity_Record.html` uses `pic` (its "Person In Charge" field —
this file has no PM checklist at all, see its own comments). Get this wrong and the widget
silently does nothing (`init()` bails out early if the given field id doesn't exist on the page —
by design, so a copy-paste mistake fails safe/invisibly rather than throwing and breaking the
rest of the page).

**Session is shared with the dashboards via `auth-session.js` (`window.AuthSession`)** — a small
shared file (loaded before `technician-auth.js` in every check sheet, and in `<head>` of both
dashboards) that owns the login session for the whole app:
- **`localStorage`, not `sessionStorage`** — keys `dashboard_user`/`dashboard_role`/
  `dashboard_name`/`dashboard_login_time` (+ `dashboard_team`/`dashboard_area`/
  `dashboard_signature` from `Review_Approval_Dashboard.html`), plus `dashboard_last_activity`.
  So one login carries across **every tab/window/page** of this app on the same computer —
  clicking a link that opens a new tab no longer re-prompts. (Was `sessionStorage` = per-tab.)
- **1-hour idle timeout**: `AuthSession` wires `click`/`keydown`/`pointerdown`/`scroll`/
  `touchstart` (throttled) + `visibilitychange` to bump `dashboard_last_activity`, and a
  `setInterval(_check, 60s)`. `AuthSession.get()` returns `null` (and `clear()`s storage) once
  `now - last_activity >= IDLE_MS` (3600000). Pages register `AuthSession.onExpire(fn)` —
  dashboards reload (→ login overlay); `technician-auth.js` unlocks the Checked-By field but
  keeps whatever the technician already typed (never wipes an in-progress form). A `storage`
  event listener makes a logout/expiry in one tab propagate to the others.
- **API**: `AuthSession.set({user,role,name})` on login (login-time + activity stamped);
  `AuthSession.get()` → `{user,role,name,team,area,signature}` | `null`; `AuthSession.clear()`
  on logout; `AuthSession.touch()` / `isExpired()`. `technician-auth.js` falls back to the old
  per-tab `sessionStorage` read if `auth-session.js` isn't on the page (shouldn't happen).
- One-time **migration** on first load: an existing tab still on the old `sessionStorage` scheme
  gets its keys copied to `localStorage` instead of being kicked to the login screen — **and the
  `sessionStorage` copy is then deleted**. `clear()` also wipes the legacy `sessionStorage`
  keys. Both are load-bearing: without them, `clear()` (Sign Out) nuked only `localStorage`,
  the reload re-ran `migrate()`, and the leftover `sessionStorage` keys re-imported the session
  — the "can't sign out" bug.

A technician opening a check sheet cold (never logged in) still sees the "🔑 Login untuk isi
otomatis" button; the modal is self-contained (same hashPass/Firestore-lookup as the dashboards,
duplicated locally so the file has zero dependency on those pages being open).

**What logging in actually does to the field**: sets its value to the logged-in name, sets
`readOnly = true`, and fires synthetic `input`/`change` events on it (`field.dispatchEvent(...)`)
so any of this codebase's existing delegated autosave listeners — see the "autosave" notes
elsewhere in this file — pick up the change without needing their own dedicated handler. A small
"✅ Login: `<name>` · Bukan Anda?" badge replaces the login button; the "Bukan Anda?" link calls
`TechnicianAuth.logout()`, which clears the shared session, clears the field back to empty, and
restores it to editable — for a shared device where a different technician takes over the same
tablet/computer for the next visit.

Widget DOM is injected as a sibling right after whichever wrapper (`.mf`, this codebase's common
`<div class="mf"><label>...</label><input></div>` pattern) contains the Checked-By field, or
right after the field itself if there's no such wrapper — works regardless of which check
sheet's markup it runs inside, no HTML changes needed per file beyond the two lines above.

## `UNIT 8/Maintenance_Corrective_Action.html` — RCA-driven corrective action report

A 23rd check sheet, and the first one placed in a **subfolder** (`UNIT 8/`, note the trailing
space in the folder name — confirmed intentional/pre-existing, not a typo to "fix") rather than
the repo root. Every shared JS include and the `../index.html` back-link use a `../` prefix
accordingly (`<script src="../db-helper.js">`, etc.) — there was no prior subfolder-placed check
sheet to copy this convention from (`4000 Hours Mill/LV_Motor_MCC.html` is a legacy duplicate
that doesn't use `../`-prefixed includes at all, so it's not a working precedent — see the
"4000 Hours Mill" bullet under "The data contract" above). The portal's `href` for this card is
therefore `'UNIT%208/Maintenance_Corrective_Action.html'` (URL-encoded space, matching the
existing convention other multi-word `href`s in `index.html` already use, e.g.
`Weekly%20Report%20Dashboard%20EIC7.html`) — a literal space in the `href` string would still
often work in practice but breaks convention with every other portal entry.

Covers sections A–L per the client's own "Maintenance Corrective Action" template (WO/asset ID,
failure description, impact/severity, response team, chronology, findings, corrective action,
root cause analysis, recommendations, parts used, attachments, authorization), plus the full
standard feature stack (technician-auth login on `checked-by`, autosave draft, PhotoKit evidence
photos, Load & Merge, Review & Approval submission via `Approvals.submitWithFiles()`, PDF export
with the shared POMI letterhead). Two things about it don't match any other check sheet in this
repo and are worth understanding before extending it:

- **No fixed asset tag — every submission is about a different piece of equipment.** Unlike
  every other check sheet (which has one fixed `assetTag`, or a small closed set for
  multi-asset/tabbed sheets), a corrective action report can be raised against literally any
  asset in the plant. Rather than leave `assetTag` blank (which would break `LoadMergeModal`'s
  per-tag query and the dashboard's per-asset grouping), this sheet uses a synthetic constant
  tag, `MCA_ASSET_TAG = 'MAINTENANCE-CORRECTIVE-ACTION'`, the same pattern
  `Work_Activity_Record.html` already established for its own free-form reports
  (`WORK-ACTIVITY-RECORD`). The REAL equipment identity lives in Section A's free-typed `Asset
  Tag`/`Asset Description` fields, saved into `base.sheets.info` and `base.inputValues` like any
  other field — just not used as the Firestore query key. `LoadMergeModal.init({assetTag:
  MCA_ASSET_TAG})` therefore surfaces every past corrective-action report for picking/merging,
  not just ones for the same physical asset — appropriate here since each report is inherently
  about a different failure event, unlike a recurring PM visit to the same motor.
- **The RCA method (Section H) is a single dropdown — 5-Why / Fishbone (Ishikawa) / FMEA / Other
  — that swaps the visible input panel via `switchRcaMethod()`** (three `<div id="rca-5why|
  fishbone|fmea">` panels, `display:none` toggled by matching the select's value; `#rca-
  other-wrap` shows only a "name this method" text field for `other`, since there's no
  structured input to collect for an arbitrary method beyond the shared Root Cause/Contributing
  Factors fields below). Only the currently-selected method's data is meaningful — the other two
  panels' fields are left blank and read back as empty/`—`, this is expected, not a bug.
  - **5-Why** is five plain `Why 1`..`Why 5` textareas, rendered in the PDF as a simple label/
    value table in order — deliberately NOT a branching/tree diagram (no such structure was
    asked for; a flat sequential list matches how 5-Why is actually filled out on paper).
  - **Fishbone** is six textareas, one per 6M category (Man/Machine/Method/Material/
    Measurement/Environment), each meant to hold multiple causes (one per line, free text — no
    per-line sub-fields). Per the user's explicit choice during design (asked directly: drawn
    fishbone diagram vs. a table per category), the PDF renders each category as its own small
    label + wrapped-text table, **not** a hand-drawn fishbone/Ishikawa diagram — simpler to
    implement correctly and reliably legible at print size, at the cost of not looking like a
    literal fishbone.
  - **FMEA** is a dynamic table (`#fmea-body`, `addFmeaRow()`/`removeTableRow()` like Sections
    D/I/J below) with Severity/Occurrence/Detection each scored 1–10 (the user's explicit choice
    over a 1–5 scale) and RPN auto-computed as `S×O×D` live via `updateRPN()` on every S/O/D
    `oninput`. The rendered RPN cell is colour-coded (red ≥200, amber ≥100, green >0, per-cell
    via `didParseCell` on the PDF's `autoTable` call) — thresholds are a reasonable general RPN
    convention, not something the source document specified, so treat them as a starting point
    if a future user wants the plant's own formal FMEA risk bands instead.
  - Two fields are shared across every method and always shown: **Root Cause** and
    **Contributing Factors** (free text) — the method-specific panels are inputs that feed the
    analysis, these two are the actual conclusion, which is what both the dashboard's
    lighter-weight views and a quick read of the PDF should show regardless of which method was
    used.
  - Firestore always gets a `sheets.rca` summary sheet (method label + whichever method's fields
    are non-empty + the two shared fields); FMEA additionally gets its own `sheets.rca_fmea`
    sheet with proper tabular columns (`Failure Mode`/`Effect`/`S`/`Cause`/`O`/`Control`/`D`/
    `RPN`/`Recommended Action`) — same "extra keyed sheet for tabular sub-data" pattern
    documented in the HV_CHECKS `special` rows bullet above, reused here for the same reason
    (a single `Value`-column sheet can't represent a multi-row table with real columns).

**Sections E (Chronology), F (Findings), G (Corrective Action) are ordered BLOCK BUILDERS —
"+ Tambah Teks" / "+ Tambah Gambar", unlimited count, reorderable (▲▼), per-block delete** — the
same idea as `Work_Activity_Record.html`'s `BLOCKS`, but rendered into the jsPDF report (not
`window.print()` CSS). This replaced the earlier "one textarea + one photo gallery per section"
design at the user's explicit request ("bisa ditambahkan pilihan add text box, add image ...
bisa diatur posisinya sehingga flow report lebih mudah dibaca"). State: `NB = {chronology:[],
findings:[], corrective_action:[]}`, each block `{id, type:'text', heading, text}` (`text` is
**rich-text HTML**, see below) or `{id, type:'image', photos:[PhotoKit entries]}`. Key functions
(all take the section key): `nbAdd`/`nbMove`/`nbRemove`/`nbRender`/`nbCard`, image-block photo ops
`nbPickPhotos`/`nbRenderPhotos`/`nbRecropPhoto`/`nbRotatePhoto`/`nbRemovePhoto`/`nbPhotoCaption`
(reuse `compressUnder1MB` + PhotoKit, same as the section-K `pickPhotos`). The PDF renders each
block in order via `narrativeBlocksSection(label, key, hint)` — a text block is an optional navy
bold heading + `drawRichBlock()` (see below), an image block is `drawPhotoList(block.photos)`
(2-up, PhotoKit-sized). `san()` strips non-latin1 glyphs from headings/captions for jsPDF Times.
- **Text blocks are a `contenteditable` rich-text editor** (user request: "buat pilihan text
  type juga seperti warna, bold, italic, reguler, allignment"). Per-block toolbar: B / I / U
  (`document.execCommand` with `styleWithCSS`), a font-size `<select>` (`fontSize` 2/3/5/6), L/C/R
  alignment (`justify*`), 6 colour swatches (`foreColor`), and Hapus format (`removeFormat`).
  `b.text` stores the editor's `innerHTML`. `nbHtmlToPlain()` flattens it for the hidden
  `<textarea id="<key>-text">` mirror (backward compat) and for the `base.sheets` dashboard rows;
  `nbEscHtml()` wraps plain text back to HTML for the mirror-reseed / pre-block migration path.
  `base.narrativeBlocks[k]` keeps the HTML so a revision-restore rebuilds formatting
  (`rte.innerHTML = b.text`). The block text no longer flows through `inputValues` (contenteditable
  has no form value) — `narrativeBlocks` + the mirror are authoritative.
- **`drawRichBlock(html, hint)` (inside `generatePDF()`)** parses the editor HTML into styled runs
  (`parseRich()` walks the DOM tree, tracking bold/italic/underline/colour from tags + inline
  `style` + legacy `<font>`; block elements / `<br>` split paragraphs and carry `text-align`),
  then word-wraps and draws each line with real `pdf.setFont('times', 'bold'|'italic'|'bolditalic')`,
  `richColor()` (hex/rgb/named → RGB, falls back to `DARK`), per-paragraph alignment, and a light
  `[248,250,252]` quote-block background painted per line so page breaks are free. `richFontPt()`
  maps `<font size>` 1–7 and CSS px/pt/keyword to points.
- **Backward compat / restore plumbing.** Each section keeps a **hidden** `<textarea
  id="<key>-text">` mirror, kept in sync by `nbSyncMirror()` with a plain-text flattening of the
  blocks — so `DB.collectCheckSheetData()`'s sweep, old dashboard rendering, and (crucially)
  revision-restore all still have something to read. `nbReseedFromMirrorIfEmpty()` rebuilds a
  single text block from that mirror whenever `NB[key]` is empty but the mirror has content —
  this is what restores a text-only returned report on revision (the merge module fills the
  hidden mirror via `inputValues` but never calls `restorePhotosFromUrls` when there were no
  photos) and auto-migrates any pre-block-builder submission.
- **Firestore.** `base.sheets.chronology/findings/corrective` get one row per block (`nbSheetRows()`
  — text → `{desc: heading||'Teks', Value: text}`, image → `{desc:'Foto', Value:'(N foto: caps)'}`),
  readable in the dashboard detail view. `base.narrativeBlocks = {chronology:[{type,heading,text}
  | {type:'image',count,captions}], ...}` stores the block STRUCTURE so a revision-restore can
  rebuild the exact layout. Each image block's photos are flattened **in block order** into
  `PHOTOS[key]` (still keyed `chronology`/`findings`/`corrective_action`) right before
  `Approvals.submitWithFiles({photos: PHOTOS})`, so the upload path is unchanged.
- **`restorePhotosFromUrls(photoUrls, overwrite)`.** For E/F/G: if `?reviseOf=` is set,
  `_fetchSourceNarrativeBlocks()` pulls `narrativeBlocks` off the source checksheet doc
  (Approvals.getById → DB.getById, cached) and rebuilds each section's blocks — text straight
  from the structure, images sliced from the flat `photoUrls[key]` list by each image block's
  `count`. No `reviseOf` (plain multi-doc Load & Merge, rare for these unique failure-event
  reports) → all a section's restored photos land in one appended image block, text not
  restored. Section K (`attachments`) is the unchanged flat per-key restore.
- **Draft.** `localStorage['mca_draft_blocks']` = `JSON.stringify(nbSerialize())` (full blocks incl
  photo data URLs), written in the same try/catch as `mca_draft_photos` (shares the quota risk);
  `nbDeserialize()` on `loadDraft`, cleared by `resetForm`. Discrete block actions call
  `autoSaveNow()` immediately (not debounced), same as the section-K photo actions.
- **Image annotation editor** (`window.AnnotEditor`, self-injecting modal, white+blue theme
  matching the sheet). Every evidence photo — E/F/G image blocks (`nbAnnotatePhoto`) and the
  section-K gallery (`annotatePhotoAt`) — has an "✎ Anotasi" button opening a canvas editor with
  rectangle / ellipse / arrow / **text-box** tools, 7 colour swatches, 4 stroke widths, a "Pilih"
  tool to drag/delete an existing mark-up (hit-test + `Delete` key), Undo, Hapus terpilih, Hapus
  semua. Annotations are stored in **natural-image pixel coords** (canvas display is scaled to
  fit; `S.scale` converts), and on Simpan they're **baked onto the image** at natural resolution
  → `compressUnder1MB` → the entry's `src`/`dataUrl`/`w`/`h` are replaced — same destructive
  model as the existing rotate/crop tools (no separate annotation layer stored, so drafts /
  Firestore / the PDF need no new fields).
- **Text tool is a fixed-size drawn box, MS-Word style** (user: "kita membuat box dimana ...
  text tidak akan melebihi kotak tersebut seperti layaknya add text box pada ms word"). Drag to
  draw the box (a bare click gives a sensible default ~42%-width × 3-line box) → a
  `position:absolute` `#annot-te` `<textarea>` overlay opens over it at the box's exact size →
  type (word-wraps to the box width) → blur / Esc / Ctrl+Enter commits; empty text discards the
  box. The box **never grows to fit the text** — `fitFontPx()` shrinks the effective font down
  (to a ~7px floor) until the wrapped text fits the box's width AND height, and `drawAnn()`
  `ctx.clip()`s to the box, so text is always contained (the toolbar font-size is the *maximum*,
  not a fixed size). Resize any mark-up (not just text) from the blue BR-corner handle shown when
  it's selected with "Pilih" — `overHandle()` / `S.resize`; text re-fits to the new box live.
  Double-click a text mark-up to re-edit. Toolbar `#annot-fmt` group (font-size `<select>`
  `FONT_SIZES`, B, I, L/C/R align) edits the selected text mark-up live, or sets `S.txt` defaults
  for the next one; colour swatches also retint a selected text mark-up. A new shape/colour would
  extend `AnnotEditor`'s `COLORS`/`WIDTHS`/`FONT_SIZES`/`drawAnn()`, not a per-file change.
Section K (Attachments/Evidence Log) stays a single flat general-purpose PhotoKit gallery
(`PHOTOS.attachments`) for anything not tied to an E/F/G block.

**Section L (Report Authorization) is deliberately NOT built as on-page signature fields.** It
reuses the existing Review & Approval workflow end-to-end instead of duplicating it: Prepared By
is the submitting technician (auto-filled via `TechnicianAuth` on `checked-by`), Verified By
(TechOp2) and Approved By (Supervisor) — including their digital signatures — are captured by
that workflow's existing `Approvals.submitReview()`/`Approvals.approve()`/`buildFinalPdf()` steps
in `Review_Approval_Dashboard.html` after this report is submitted. The PDF's own Section L is
just a one-line pointer to that fact, not a form. Don't add manual signature boxes here — it
would create two competing sources of truth for who approved a report.

Header fields use the standard ids (`wo-no`, `wo-date`, `checked-by` — labelled "Prepared By" on
screen but same id as every other sheet) so `DB.collectCheckSheetData()`, `LoadMergeModal`'s
default `headerMap`, and `TechnicianAuth.init({checkedByFieldId:'checked-by'})` all work with
zero per-file overrides — no `done-by`/`pic`-style mismatch to work around here, unlike several
older sheets (see "The data contract" above).

**`generatePDF()`'s layout deliberately mirrors the client's own Word-exported blank template**
(`UNIT 8/MAINTENNACE CORRECTIVE ACTION.pdf` — a reference file the user dropped in that folder,
not something this repo generates or should overwrite), rather than the `kvTheme` autoTable
label/value look every other check sheet in this repo uses. This was an explicit user request
("buat tampilan download pdf sama persis seperti ini") made after the sheet was first built —
colours were sampled directly from that reference PDF's rendered pixels (`TITLE_NAVY=[31,56,100]`
for the title banner, `SECTION_NAVY=[47,84,150]` for the "A./B./C.…" section bars,
`LABEL_BG=[220,230,241]` for label cells and table headers), and every section header's exact
text/casing (`'A. WORK ORDER & ASSET IDENTIFICATION'`, letter+period+ALL-CAPS, not the em-dash
`'A — …'` style used elsewhere) was copied verbatim from `pdftotext -layout` on that file — both
the on-screen `.sec-hdr-title` labels and the PDF's `sectionHeader()` calls were updated together
so the tool and the printed report never disagree. If the reference PDF is ever regenerated with
different wording/colours, re-derive these constants from it again rather than guessing.

- **Checkboxes are hand-drawn vectors, never a text glyph.** `drawChk()`/`drawChkGroup()` render
  a bordered square that fills solid `SECTION_NAVY` when checked, exactly like the `drawChk()`
  helper already established in `Work_Activity_Record.html` (see CLAUDE.md's PDF export section
  for why: jsPDF's built-in helvetica has no reliable ☐/☑ glyph, and a font-based checkbox
  silently prints as garbage the same way `▶` did). `drawChkGroup()` lays out checkbox+label
  pairs left-to-right and wraps to a second line if the row would overflow the value column
  width — call it once with `measureOnly:true` to size the row's height before drawing the
  row's background, then again for real, matching a two-pass measure/draw split rather than
  guessing a fixed row height.
- **Detection Method's dropdown options were changed to match the reference exactly**
  (`Operator round` / `Alarm / Trip` / `PM Inspection` / `Condition Monitoring` / `Other`,
  replacing an earlier invented 6-option list) once the authoritative template surfaced — this
  was a real data-model fix, not just a rendering tweak, since the earlier options didn't
  correspond to any category in the client's own form.
- **Section A has a `wo-priority` field** (plain numeric `<input type=number>`, right after
  `wo-no` in the `.wo-grid`) — Maximo WO priority. Persisted for free by the generic
  `persistDraft()`/`DB.collectCheckSheetData()` id sweeps; explicitly carried into
  `base.sheets.info` (row `no:'1b'`) and the PDF (`formRow('Priority', …)` right under WO No.).
  **Work Order Type** dropdown is `CM / CPM / AH / EM / PDM` (EM/PDM added later at user
  request) — the PDF `chkGroupRow('Work Order Type', …)` list must be kept in sync with the
  `<select>` (it renders `EM (Emergency)` / `PdM (Predictive)` for those two).
- **Section A/B/C's one-line fields use a manually-bordered `formRow()`/`chkGroupRow()` pair**
  (shaded label cell + white value cell, drawn with `pdf.rect()`, not `autoTable`) instead of
  `kvTheme`'s grid theme — needed because a checkbox row's content is vector-drawn, which
  `autoTable` cells can't host directly without a `didDrawCell` hook per row (see
  `Work_Activity_Record.html`'s own `_chk`/`didDrawCell` pattern, which only handles one
  checkbox-group column per table, not this sheet's many independent single-row groups).
  `formRow()`'s empty-value hint text (`'From Maximo work order record'`, etc.) is copied
  verbatim from the reference template's own placeholder copy — shown in italic grey only when
  that field is actually empty, real dark text once the technician fills it in.
- **Section H's Fishbone/FMEA methods keep their own structured tables** (the 6M category
  tables / the FMEA grid with RPN) instead of collapsing into the reference's one generic shaded
  box — the reference's blank template shows the same box regardless of method since a human
  fills it by hand, but this sheet has real per-method structured data, and a table is strictly
  more useful than free text for a 10-column FMEA row. Only 5-Why (whose data really is 5 flat
  Q&A lines) and the shared Root Cause/Contributing Factors fields use the reference's exact
  shaded-box, bold-label-inline-value look.
- **Section J is CONCLUSION** — added at the user's request ("tambah kolom conclution setelah
  Recomendation"), which pushed **Main Parts → K, Attachments → L, Report Authorization → M**
  (all four section-header strings updated in the HTML *and* the PDF `sectionHeader()` calls,
  plus the `attachments` `PHOTO_LABELS` constant and the `base.sheets` titles). It's a single
  `contenteditable` rich-text field (`#conclusion-rte`, generic `rteCmd()`/`rteSize()` helpers —
  same B/I/U/size/align/colour toolbar as the E/F/G blocks) with a hidden `<textarea
  id="conclusion">` mirror holding the editor HTML for the draft/`inputValues`/merge-restore
  path (`onConclusionInput()` syncs on edit, `syncConclusionFromMirror()` pushes HTML back to
  the editor on load/restore — called from `autoSaveNow()`, `loadDraft()`, and init). PDF:
  `drawRichBlock(getConclusionHtml(), hint)` (the same rich renderer E/F/G use). `base.sheets.
  conclusion` stores the plain-text flattening; `base.conclusionHtml` stores the HTML.
- **Section L (Attachments) keeps the PhotoKit gallery** (real embedded photos) rather than reverting to the
  reference's blank `No./Description/Reference File` text table — that table shape predates the
  photo-gallery decision already made earlier in this project (see the narrative-photo bullet
  above); matching the reference's visual chrome (section bar colour/text) doesn't mean
  reverting a decision the user already made about its actual content.
- **Section M renders the reference's 3-column signature table** (`Prepared By (TECH OP 1/2)` /
  `Verified By (TECH OP 2/3)` / `Approved By (MAINT. SPV)`, each with a tall empty signature cell
  then a Name/Position/Date cell) — built with **`pdf.autoTable`** (a local `authTheme` with
  `cellPadding {top:3,left:3.5,…}` + `minCellHeight` per row), not hand-drawn `pdf.rect()`, after
  an earlier hand-drawn version came out cramped (text touching the borders, rows ~4.5mm apart).
  The Prepared By column fills `Name` from `checked-by`, `Position` from a Section-A
  **`#prepared-position`** field (added for this — swept into `inputValues` + `base.sheets.info`
  rows 11/12 for free), `Date` from `wo-date`; Verified By / Approved By stay `—` with a footnote,
  since those names/positions/signatures are captured via the Review & Approval workflow.

## `UNIT 8/LV_Motor_Bearing_Replacement.html` — motor rebuild/bearing check sheet

Ported from the client's own `LV Motor Bearing Replacement.xlsx`. Single-asset (one submission per
bearing-replacement job), asset picked from an embedded **82-motor master list** (`MOTOR_LIST`,
via a `<datalist>`-backed free-typed input, `selectMotor()` auto-fills Rated Voltage/Power/Full
Load Ampere/Speed/Service Factor from whichever row matches). **Several master-list rows have no
electrical rating data at all** (`v`/`kw`/`a`/`rpm`/`sf` all `null`) — these are breaker/feeder/tie
cubicles the source workbook listed alongside the real motors (e.g. `XXXXX` "TIE TO 8EM-SWGR-A"),
not a data-entry gap to "fix"; `selectMotor()` leaves those fields blank on selection, which is
correct. Despite the filename, the master list's own voltage column is mostly 6600/13200 V
(HV/MV, not LV) — this is the source document's own data, left as-is rather than corrected,
since it's not this repo's place to second-guess the client's master asset list.

The checklist (`CHECKS`) reuses the same **flat array + occasional `extra` fields** pattern as
this file pioneered no special-row registry needed: most rows are a plain OK/NG toggle, a handful
carry an `extra: [{id,label,unit}]` array rendered as a small inline field group right below that
row (`renderChecks()`'s `extra-row` handling) for things like Shaft Ø DE/NDE, stator resistance
T1-T2/T2-T3/T3-T1, DAR/PI, RTD Type. Three measurements didn't fit that shape and got their own
small fixed-layout widgets instead of `extra` fields: `rtdTableHtml()` (RTD1-3 + DE/NDE bearing
readings + heater resistance), `cableTableHtml()` (phase-to-phase R-S/S-T/R-T and phase-to-ground
R/S/T-Ground, each at 30s and 1min), and the Solo Run panel's `renderTempTable()` (5 locations ×
Initial/1'/15'/30' — a genuine time-series table, not worth generalizing into `extra` since
nothing else in this file needs a 2-D grid). A `sectionBreak` marker in `CHECKS` (used once, for
the source's own "ELECTRICAL TEST" sub-heading partway through the continuous checklist) renders
as a full-width navy divider row without incrementing the item counter.

## `UNIT 8/Lighting_Grounding_Etc_Checksheet.html` — 7-in-1 tabbed BOP check sheet

Ported from `LIGHTING , GROUNDING , ETC CHECK SHEET.xlsx`, which bundles 7 unrelated equipment
types as separate worksheet tabs (Lightning Arrester, Grounding, Stentofon intercom, Lighting,
Emergency Lighting, Panel/DB, Socket Outlets). **Built as ONE combined tabbed check sheet, one
submission per visit covering all 7 areas** — an explicit user choice (asked directly: 7 separate
files vs. one tabbed file, matching `4000_Hours_Mill_PM.html`'s pattern) over the repo's more
common "one file per equipment type" default, so don't split this back into 7 files without
re-confirming. Each tab still has its **own** `Equipment Tag & Description` / `Building / Area`
fields (unlike `4000_Hours_Mill_PM.html`'s single cascading asset selector) — the 7 areas
inspected in one visit are physically different pieces of equipment in different
buildings/locations, not variants of the same asset, so there's no shared tag to cascade.

- **Toggle buttons are labelled PASS/FAIL on screen** (matching the source workbook's own
  "Pass / Fail" column header verbatim) **but still use `data-v="OK"`/`"NG"` and
  `.ok-act`/`.ng-act` classes internally** — same `ST` object, same `mkTog()`/`setTog()` shape
  every other check sheet in this repo uses. This is deliberate: `DB.collectCheckSheetData()`'s
  generic `.rb.ok-act`/`.rb.ng-act` scraper, `DB.loadLastSubmission()`'s 3-strategy toggle
  restore, and `LoadMergeModal`'s matching restore logic all key off those exact class names and
  `data-v` values — relabelling the button *text* costs nothing, but changing the underlying
  `data-v`/class convention would silently break Load & Merge and the revision-restore flow for
  this one file. If a future check sheet needs different on-screen wording again, relabel the
  button text only, never the `data-v`/class pair.
- **`pdfSafe()` strips glyphs jsPDF's built-in helvetica can't render** (Ω, ≤, ≥, →, ±, · — to
  `ohm`/`<=`/`>=`/`->`/`+/-`/`-`) **applied only inside `generatePDF()`**, never to the shared
  `TAB_SECTIONS` data itself — the source criteria text is genuinely full of these (`"≤ 5 Ω"`,
  `"air terminal → earth"`, `"± tolerance"`), and they render correctly on screen (real browser
  Unicode) and in Firestore/`dashboard.html` (also a browser), so only the jsPDF text path needs
  sanitising. This is the same class of bug CLAUDE.md's PDF-export section already documents for
  `▶` — confirmed by rendering a real PDF before the fix (`Ω` prints as `©`, `≤` as `"d`, both
  silently, no exception) and after (`ohm`, `<=`). Any new criteria text added to `TAB_SECTIONS`
  with one of these symbols needs no special handling — `pdfSafe()` already covers it — but a
  *new* unsupported symbol would need adding to `pdfSafe()`'s replace chain, not worked around by
  editing the source text.
- **One PDF, one sub-report per tab, each starting on its own page** (same "no shared assetIdx
  guard needed since every tab always renders" simplification `4000_Hours_Mill_PM.html`'s
  `firstSection` flag exists for — here all 7 tabs always print, so a plain `if(!firstTab)
  pdf.addPage()` per tab suffices), followed by **one consolidated Report Authorization page at
  the very end** covering the whole visit (Inspected By/Witnessed By/Reviewed By) — the source
  workbook repeats this same 3-role signature block on every one of its 7 sheets, but since this
  file is one combined submission, one authorization block for the whole visit is correct, not
  seven copies. Follows the same pattern as `Maintenance_Corrective_Action.html`'s Section L:
  Inspected By is auto-filled from `checked-by`/`wo-date`; Witnessed By (Foreman) and Reviewed By
  (Maint. SPV) are left blank with a footnote, since those are captured via the Review & Approval
  workflow after submission, not re-collected on this form.
- **Photos are one gallery per tab** (`PHOTOS[tab]`, same keyed-object pattern as every other
  multi-gallery sheet in this repo), matching each tab's own "Document" section in the source.
- **Dynamic tables exist only where the source has them**: LUX measurement (`lux-body`, Lighting
  tab only), additional earth test points (`addl-point-body`, Grounding tab only), and
  Finding/Abnormality (`TABS_WITH_FINDINGS` = Stentofon/Lighting/Emergency Lighting/Panel-DB/
  Socket Outlets — Lightning Arrester and Grounding have no Finding table in the source, don't add
  one for "consistency").

## `Cathodic Protection/` — 8 ICCP check sheets, template + generator

Ported from the 8 `.xls` files in `google-apps-script/Checksheet mentah/` (all "Catodic_*" —
impressed-current cathodic protection: TRU setting, per-anode current at junction boxes,
pipe-to-soil ON/OFF potential, and — for one — 6-monthly ON-OFF pile potential). Placed in a
subfolder like `UNIT 8/`, so every shared-lib include and the portal back-link use a `../`
prefix; portal `href`s are `Cathodic%20Protection/<file>.html` (URL-encoded space). New portal
category **`cp` — "Cathodic Protection"** (added to `index.html`'s category array after `gnd`),
8 cards `cat:'cp'`.

**These 8 `.html` files are GENERATED — do not hand-edit them.** `Cathodic Protection/_generate.py`
substitutes `__TITLE__` + `__CONFIG__` into `Cathodic Protection/_cp_template.tpl` (the shared
engine — HTML shell + `<style>` + one big `<script>` identical in every file) and writes all 8.
To change one sheet's data: edit its `CONFIGS[...]` entry in `_generate.py`; to change behaviour
for all 8: edit `_cp_template.tpl`; then re-run `python3 "Cathodic Protection/_generate.py"` from
the repo root. `.tpl` (not `.html`) so GitHub Pages never serves the token-bearing template as a
broken page. Verify a regen the usual headless-Chrome way (`?method=PUT` on `/json/new` with
Node 26's built-in `WebSocket` — no `ws` package here).

**The engine is `CP_CONFIG`-driven.** `window.CP_CONFIG.systems[]` — each system optionally has
`truFields` (DC output / TAP / native-potential header grid, default on), `anodeGroups[]`
(`{g,anodes}` where an anode is a string or `{tag,struct}`; `anodeStruct:true` adds a "Structure
Protected" column), `potentials[]` (strings; `potentialMode:'single'` → one "Potential (-mV)"
column instead of ON/OFF), and `truUnits[]` (`{tag,struct,cap,remark}` — `remark` prefills the
row's Remark input). `MULTI = systems.length>1` prefixes section letters and forces a
`pdf.addPage()` per system. Global optional sections: `tpLocation:true` (drawing-photo slot +
add-row test-point table) and `pilePotential:{title,groups:[{label,points[]}]}` (TOP/MID/BOTTOM
ON+OFF grid — Jetty only). `ICCP_TP_Location_Boiler.html` has `systems:[]` (the source is a
drawing with no cell data) — the engine renders nothing but the TP-location section, and that's
intentional.

**Report scope (multi-system only).** When `systems.length>1` a "Cakupan Laporan & Submit" panel
appears: a checkbox per system (all on by default) plus quick buttons for each distinct
`system.unit` value (`ICCP_Yard_Piping` sets `unit:'Unit 7'`/`'Unit 8'` so you can PDF/submit
"only Unit 7"). `SYS_SEL` (a Set of indices, persisted in the draft as `_sysSel`) filters both
`generatePDF()` (excluded systems skipped, page-break tracked by a `firstShown` flag, a red
"Cakupan laporan: …" line on the cover) and `buildSheets()` (excluded systems produce no sheet
keys). A partial-scope submit appends the unit/label to `base.assetName`, sets `base.reportScope`,
and `confirm()`s first. Excluded system panels get `.sys-excluded` (dimmed + "TIDAK DISERTAKAN").

Full standard feature stack (technician-auth on `checked-by`, autosave draft with dynamic-row
keys namespaced `s<i>-`, PhotoKit `PHOTOS={evidence,tploc}`, Load & Merge + CloudDraft,
submit-guard, `Approvals.submitWithFiles`, jsPDF portrait A4 like ESP/Battery — navy cover +
`willDrawPage` mini-header + autoTable, `noEmoji()` strips non-Latin1 glyphs from the Times
font). `base.sheets` = one keyed sheet per (system, table): single-system `tru`/`anode`/
`potential`/`tru_units`, multi-system `s<a>_tru` etc, plus `pile_potential`/`tp_location`.
Dynamic-row keys are deterministic monotonic (`ax<n>`/`pt<n>`/`tl<n>`/`pl<n>`, `bumpSeqs()`
after a draft restore) so `loadDraft()` re-creates added rows with their saved ids and the
generic value sweep lines up — an earlier timestamp-key version silently dropped added rows'
values on reload.

## `CHCB SWGR/` — 6 6.9 kV Switchgear Maintenance check sheets, template + generator

Ported from `google-apps-script/Checksheet mentah/CHCB - SWGR - BKR.xlsx` — one HTML per
worksheet tab (`Sheet3` is empty, skipped): `SWGR_7EN-SWGR-A1A`, `SWGR_8EN-SWGR-A1A`,
`SWGR_CHCB_Breaker_Spare`, `SWGR_7EN-SWGR-A1A_Electrical`, `SWGR_8EN-SWGR-A1A_Electrical`,
`SWGR_STRC-2`. Subfolder → `../`-prefixed shared includes; portal `href`s
`CHCB%20SWGR/<file>.html`, category **`sg`** (existing Switchgear category), 6 cards.

**GENERATED — do not hand-edit the `.html`.** `CHCB SWGR/_generate.py` substitutes
`__TITLE__` + `__CONFIG__` into `CHCB SWGR/_swgr_template.tpl` (shared engine, one big
`<script>`). Edit a sheet's data in `_generate.py`'s `CONFIGS`, behaviour in `_swgr_template.tpl`,
then re-run `python3 "CHCB SWGR/_generate.py"`. The `.tpl` extension keeps GitHub Pages from
serving the token-bearing template.

**The engine is `SWGR_CONFIG`-driven.** `compartments:[{code,label}]` render as an editable
legend panel (code fixed, description + Breaker S/N editable) AND as the column headers of every
matrix/measurement table. `sections[]`, each with a `kind`:
- `'matrix'` (default) — `items[]` × compartments, OK/NG toggle per cell (`ST` object + `.rb`
  classes so `DB.collectCheckSheetData` scrapes them and Load & Merge restores), one Result/Remark
  text per row. Item `type`: `'subhead'` (blue divider, optional `field`/`fields[]` text inputs
  like "VCB No." / Positive-Interlock Open/Close), `'single'` (one toggle spanning all
  compartments — the "0.531 in min" roller-appearance rows), `'remark'` (remark-only row, item 15
  work history).
- `'resistance'` — fixed rows (T1-T2/T2-T3/T3-T1) × columns, numeric mΩ.
- `'megger'` — `times[]` rows (15"..10') × columns + auto **PI = R(10')/R(1')** and
  **DAR = R(1')/R(30")** read-only rows (`recalcMegger()` on every `.meg-in` input; re-run in
  `loadDraft`).
- `'rtd'` — RTD1..`rtdCount` × columns.
- `section.columns`: `'elec'` → `CFG.elecColumns` (electrical tests use a different, usually
  smaller column set than the visual checklist — motor/XFMR compartments only, with `105A HV` /
  `105A LV` split entries and `BUS A/B/C`), an explicit `[{code,label}]` array, or omitted →
  `compartments`.
The base sheets (7A1A/8A1A/Bkr-spare) = visual checklist (items 1-10) + Breaker Safety Locks
(11-15). The `_Electrical` sheets = visual (1-10) + resistance + megger + RTD. `STRC-2` adds a
second resistance+megger block for Power Cable / Slip Ring / VT&CPT / XFMR.

**Breaker interlock reference diagrams** — the 3 base sheets carry `interlockDiagrams:[{caption,
uri,w,h}]` (the generator base64-embeds `CHCB SWGR/diagram_*.png`, extracted from the source
.xlsx — Negative Interlock, Spring Discharge Interlock, Closed Latch Stop, the ones referencing
the .531/.670/.561/.995-in positions in items 12-14). Rendered as a "Breaker Interlock —
Reference Diagrams" panel and a PDF page (`pdf.addImage(uri,'PNG',…)`, aspect-preserved). The
`_Electrical` / `STRC-2` sheets have no `interlockDiagrams` (no safety-locks section). The PNGs
also sit in the folder as plain files.

PDF: **landscape A4** (matrix tables are up to 15 columns wide), navy cover + `willDrawPage`
mini-header + one `pdf.addPage()` per section. `pdfSafe()` (not just `noEmoji`) maps `≥`→`>=`,
`Ω`→`ohm`, `·`/`—`→`-`, `°`→` deg` etc before any `pdf.text()` — the criteria strings are full
of these. `single`-type rows draw one `colSpan` cell, not the value repeated across every column.
Standard stack otherwise (technician-auth on `checked-by`, autosave, PhotoKit `PHOTOS.evidence`,
Load & Merge + CloudDraft, submit-guard, `Approvals.submitWithFiles`). `base.sheets` = one `s<i>`
key per section + a `compartments` legend sheet.

## `Stacker Reclaimer/` — 10 Stacker/Reclaimer PM check sheets, template + generator

Ported from the 9 `.xls` files in `google-apps-script/Checksheet mentah/` (all "Motor_Stacker
*"). **The 9 raw files are NOT a 1:1 map to the 10 outputs here** — confirmed by actually reading
every sheet's cell content (via LibreOffice `--convert-to xlsx` + `openpyxl`, since these are old
binary `.xls`) before writing any code, the same "1 referensi dulu" caution this repo already
applies elsewhere, here spent on understanding scope instead of piloting one file:
- `"Motor_Stacker 1.xlsx"` is one giant workbook bundling 12 tabs, not 12 separate check sheets:
  an OEM Operation & Maintenance manual (`STRC 1 - OM`, 232 real rows — the full inspection
  *schedule* for the whole machine, not a fillable form), a JP work-instruction sheet (`Sheet1`,
  same kind of reference text), two electrical-schedule excerpts of that SAME OEM manual
  (`JP-STRC-E-6M`/`JP-STRC-E-3M` — identical header block to `STRC 1 - OM`, also reference-only),
  and 8 real fillable "WORK COMPLETION REPORT" tabs. Of those 8, `Long Travel 1`/`Long Travel 2`
  and `1 & 6 MONTHLY`/`1 & 6 MONTHLY (2)` are OLDER/superseded duplicates — the same content
  exists in its own up-to-date standalone `.xls` elsewhere in the folder (confirmed by diffing:
  `STRC-1`'s Long Travel tab only covers wheels A1-A10 sequentially and only the "6 Monthly"
  section, while the standalone `Motor_Stacker 1 - Long Travel.xls` covers all 20 positions
  A1-A20 split odd/even AND the full 6M+1Y+Breaker set). Only `BW-BC` and `FDR-CSRH` are unique
  to this workbook — nothing else in the folder has that content. Skipping the superseded tabs
  and the 3 reference-only tabs is what turns "12 tabs" into "2 real check sheets from this file".
- Every "motor + brake" WORK COMPLETION REPORT tab — Long Travel, Slewing, BW-BC, the STRC-2
  main sheet, FDR-CSRH, the combined BW-BC-CR monthly file — shares **verbatim identical**
  checklist wording for its "1 Monthly", "6 Monthly", "1 Yearly" and "Circuit Breaker / Motor
  Starter or Inverter" sections (confirmed cell-by-cell across multiple files — even typos like
  "may any corrosion" match exactly). Only the equipment-tag COLUMNS differ per file. So the item
  text lives ONCE in `_generate.py` (`ONE_MONTHLY`/`SIX_MONTHLY`/`ONE_YEARLY`/`BREAKER` constants,
  built via `motor_sections(cols, one_monthly=bool)`) — every config just supplies its own
  `compartments` (equipment columns) and picks which of those shared sections apply. Safety
  Device sheets use a separate, much shorter shared list (`SAFETY_ITEMS`, 4 items) repeated once
  per limit-switch group; Cable Reel & Transformer has its own `XFMR_ITEMS`/`CABLE_REEL_2Y`.
- This was **not** put to the user as an open-ended "how should I scope this" question — the
  redundancy was worked out first, then a concrete 10-vs-9-vs-"show me everything" choice was
  asked via `AskUserQuestion` (10, deduplicated, was picked), alongside build-all-at-once vs.
  one-reference-first (all-at-once was picked) and a new **`strc`** portal category vs. reusing
  `motor` (new category was picked, mirroring how Cathodic Protection got its own `cp` category
  rather than being folded into an existing one).

**GENERATED — do not hand-edit the `.html`.** `Stacker Reclaimer/_generate.py` substitutes
`__TITLE__` + `__CONFIG__` into `Stacker Reclaimer/_strc_template.tpl` (shared engine, adapted
from `CHCB SWGR/_swgr_template.tpl` — same `STRC_CONFIG`-driven shape, same
matrix/resistance/rtd/megger `kind`s, same submit/PDF/draft/photo plumbing). Edit a sheet's
data (item wording, columns) in `_generate.py`, engine behaviour in `_strc_template.tpl`, then
re-run `python3 "Stacker Reclaimer/_generate.py"`.

**One new item type over the SWGR engine: `type:'value'`.** A SWGR-style matrix item is either a
per-column OK/NG toggle (default), a single toggle spanning every column (`'single'`), a
remark-only row (`'remark'`), or a subhead divider — none of those fit a row whose per-column
answer is a MEASURED VALUE, not a pass/fail (e.g. "measure resistance of HV & LV winding": each
transformer test-point column needs a free-text ohm reading). `type:'value'` renders one
`<input class="mi wide">` per column instead of a toggle; `it.sub` (e.g. `"T1 - T2"`) turns one
logical item into several print/screen ROWS without repeating the full instruction text — the
first row shows `desc — sub`, continuation rows show just `↳ sub` — matching how the source
spreadsheet itself lays out "check resistance" as one instruction followed by 3 bare T1-T2/T1-T3/
T2-T3 rows. `value_rows()`/`value2()` in `_generate.py` build these chains. Wired into all three
places a matrix item is read: on-screen rendering, `buildSheets()` (via `iv()`, not `tv()`), and
the PDF body builder.

**A wide equipment matrix breaks jsPDF-autoTable's header wrapping — this needed an actual fix,
not just smaller fonts.** `STRC1_Long_Travel` alone has 40 equipment columns (`CCH-STRC-110A1-M`
style tags, ~17 characters each); cramming all 40 plus the No/Item/Criteria/Remark columns onto
one landscape A4 page forced autoTable to wrap each header letter-by-letter — confirmed by
actually rendering a real PDF and looking at it (`pdftoppm`), not just checking the JS didn't
throw: the header cells came out as a vertical stack of single characters, completely unreadable.
Fixed on the PDF side only (the on-screen table already scrolls horizontally, `.tbl-wrap{overflow-
x:auto}`, so it never had this problem): `chunkArr(cols, 8)` splits a matrix section's columns
into print-sized groups of 8, each rendered as its OWN `autoTable` call (repeating No/Item/
Criteria/Remark, with `secBar()` labelled "(lanjutan kolom X-Y)" on every group after the first) —
the exact same idea the SOURCE workbook already used at a coarser grain (splitting 40 wheels into
two 20-column files); this just narrows it further to a size that's actually legible. `pdfCode(c)`
also strips the shared `"CCH-"` prefix from the PRINTED header only (never touches the real code
used as the sheet/column key) so what's left fits the narrower per-chunk column width. Verified
by regenerating the PDF post-fix and rendering it again: every header reads on one line
(`STRC-110A1-M`, not 17 stacked single-character rows).

**Two Safety-Device / Cable-Reel-XFMR configs intentionally pass `"compartments": []`.** The
top-level `compartments` legend panel (and its `base.sheets.compartments` sheet) assumes every
section in the file shares ONE column set — true for every "motor + brake" sheet, false for
`STRC2_Safety_Device` (4 limit-switch groups, each with its own ~14 columns) and
`STRC2_Cable_Reel_XFMR` (transformer test-points vs. cable-reel motors are different column
sets entirely). Each section there supplies its own `"columns"` override instead; leaving the
top-level `compartments` non-empty would have rendered ONE group's columns as if they applied to
the whole page, which is simply wrong for the other groups/sections.

**A brake's resistance is measured across different terminals than a motor's — Long Travel and
Slewing needed a real per-column behaviour difference, not just different numbers.** Re-checking
the source after a user report (with a screenshot of the original spreadsheet) confirmed the
"6 Monthly" resistance item's brake column ("-B" tag) isn't a T1-T2/T1-T3/T2-T3 winding check at
all — it's ONE reading across a brake-coil terminal pair, labelled inline in the source (`"TB 3 -
5 :"` for Long Travel, `"TB 3 - 4 :"` for Slewing — confirmed these differ, not a typo, by
grepping every `"TB \d"` occurrence across every converted source file). None of the other 8
configs' source data shows this pattern at all (their brake columns are simply blank in that
region) — so this is scoped to exactly the 2 files that have it, not applied blanket. Two new
optional flags on a `type:'value'` item (`value_rows(..., brake_label=…)` / `brake_na=True` in
`_generate.py`): `brakePlaceholder` gives a brake column's first-row `<input>` that terminal-pair
as a placeholder (on-screen hint; printed as `"(TB 3 - 5)"` in the PDF when still blank, via
`isBrakeCol(c)` — `/-B$/` on the tag — so the printed sheet still says what to measure even
unfilled); `motorOnly` renders a brake column's cell as a plain non-input dash instead (used for
the resistance item's 2 continuation rows, since a brake only gets ONE reading, and for the whole
megger item, since the source shows no brake megger reading at all). `one_yearly_items(brake_label)`
builds a config-specific "1 Yearly" section; every other config still uses the shared `ONE_YEARLY`
constant unchanged (verified via headless Chrome: `STRC1_BW_BC`'s brake column still gets a plain
input on every row, identical to before this change — no regression from adding this mechanism).

**A whole section — "Basic Motor Data" — was missing end-to-end (not just from the PDF) across
all 8 "motor + brake" configs, until a user report ("PDF layout doesn't match the checksheet,
applies to every Stacker Reclaimer sheet") prompted re-checking every source sheet against
`_generate.py` line by line.** Every one of those 8 sheets opens with a 5-row nameplate block
(Rated Voltage / Rated Power / Full Load Ampere / Speed / Service Factor, one column per
equipment tag) BEFORE "1 Monthly"/"6 Monthly" starts — confirmed present in every one of their
source dumps — but `motor_sections()` never built a section for it, so it was absent from the
on-screen form AND the PDF for every one of them; this wasn't a PDF-rendering bug; the data model
itself was incomplete. Fixed by adding `BASIC_MOTOR_DATA` (5 `type:'value'` items, no criteria)
as a new `s0` section prepended by `motor_sections()` — free-text per column, no pre-filled
reference values, matching this repo's existing "Basic Motor Data" convention elsewhere (e.g.
Motor Witness's `S.motordata`). `STRC2_Cable_Reel_XFMR` and `STRC2_Safety_Device` correctly do
NOT get this section — neither has anything resembling it in its own source (confirmed, not
assumed) — so `motor_sections()` is the only thing that changed; those 2 configs build their
`sections` list by hand and are untouched. Verified via headless Chrome across all 10 files:
the 8 motor+brake configs each report a `s0` section with exactly 5 items and generate a
5-row "Basic Motor Data" PDF page (rendered and visually checked); the 2 non-motor configs are
unaffected (section count unchanged, `val-0-0-0` absent). **Lesson for extending this template
family further**: when a "layout doesn't match" report comes in, check whether a whole SECTION is
missing from `_generate.py` before assuming it's a rendering/styling issue in `_strc_template.tpl`
— the fix here was 12 lines of new config data, not a PDF change at all.

Standard stack (technician-auth on `checked-by`, autosave, PhotoKit `PHOTOS.evidence`, Load &
Merge + CloudDraft, submit-guard, `Approvals.submitWithFiles`, landscape A4 PDF with navy cover +
`willDrawPage` mini-header) is unchanged from SWGR — verified per-file via headless Chrome across
all 10 outputs (JS syntax + embedded config JSON parse for every file; on-screen render + toggle/
value data collection + a real `generatePDF()` call producing an actual multi-page PDF for the
widest matrix, the value-only XFMR sheet, and the 4-group Safety Device sheet; one full mocked
`submitToDb()` run — including clicking through the real `PdfPreview` "review before submit"
modal that the submit path shows by design, the same way a technician would — confirming
`DB.save()`+`Approvals.submitWithFiles()` both fire with zero real Firestore/Drive writes against
a fail-loud mock). Portal: new **`strc`** category ("Stacker / Reclaimer"), 10 cards, `href`s
`Stacker%20Reclaimer/<file>.html`.

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
