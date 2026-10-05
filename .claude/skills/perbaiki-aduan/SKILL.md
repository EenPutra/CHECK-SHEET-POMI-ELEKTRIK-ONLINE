---
name: perbaiki-aduan
description: Fix every open bug / feedback report sent from the 💬 "Laporkan Bug / Masukan" widget (Firestore feedback_reports), verify each fix, commit and push, then mark the reports done. Use when the user says "/perbaiki-aduan", "perbaiki semua aduan", "kerjakan laporan bug", or asks to process the feedback reports. Optional argument: one or more ticket numbers (FB-XXXXXX) to limit the run.
---

# Perbaiki semua aduan

Reports come from `feedback-widget.js` (every page) and are stored in the Firestore collection
`feedback_reports`; `Feedback_Reports.html` shows them to people. `tools/feedback.py` is the
command-line side of the same data. Write every message to the user in Bahasa Indonesia.

## 1. Read the open reports

```bash
python3 tools/feedback.py list --out "<scratchpad>/feedback"          # all open reports
python3 tools/feedback.py list --id FB-XXXXXX --out "<scratchpad>/feedback"   # only the ones the user named
```

Open every screenshot path it prints with the Read tool — screenshots often carry the real
information (the wrong PDF, the exact button, the error). Also read the "Error di halaman"
lines and the page file. A 429 means the daily Firestore read quota is used up: stop and tell
the user it resets at 00:00 US Pacific (≈ 14:00 WIB).

If there are no open reports, say so and stop.

## 2. Triage, then tell the user the plan

For each report decide one of:

- **fix** — the problem is clear enough to fix and verify;
- **needs info** — too vague to act on without guessing (e.g. "tidak bisa", no page context,
  or a numbered list item left empty). Do not guess;
- **not a bug / out of scope** — e.g. a request that belongs to another app (an external feed
  like PM-UNIT-7), or a change that needs a product decision.

One report can contain several items (numbered lists are common) — handle each item.
Before editing, post a short list: ticket, what is wrong (in plain words), and what you will do.
Ask the user only when a report needs a real decision (behaviour, scope, deleting data);
otherwise continue.

Mark the reports you are about to fix as in progress:

```bash
python3 tools/feedback.py set FB-XXXXXX dikerjakan --note "Sedang dikerjakan"
```

## 3. Fix

Follow `CLAUDE.md` — it is the source of truth for this codebase (data contract, shared libs,
generators, PDF rules, mobile rules). In particular:

- Generated files (`CHCB SWGR/`, `Stacker Reclaimer/`, `Cathodic Protection/`): edit the
  `.tpl` / `_generate.py`, then regenerate — never hand-edit the generated `.html`.
- `index.html` is a bundle — follow the portal section in CLAUDE.md.
- A change to any shared `.js` (db-helper, approval-helper, feedback-widget, …) needs the
  `?v=` cache-buster bumped repo-wide, `.tpl` files included, and a check that exactly one
  `?v=` value remains.
- Keep the fix as small as the report needs; don't refactor around it.

## 4. Verify every fix

- `node --check` on the extracted inline `<script>` of every page you changed.
- Reproduce the reported problem and confirm it is gone with headless Chrome over CDP
  (pattern in CLAUDE.md "Running / testing changes"): `Network.setBlockedURLs` for
  `*firestore.googleapis.com*` and `*script.google.com*`, `Network.setCacheDisabled`, and
  fail-loud mocks for any `db` / `Storage` / `Approvals` call — never write to production while
  testing. For a PDF problem, render the real PDF and look at it (`pdftoppm`).
- Look at a screenshot of anything visual; check 390 px width for layout changes.

A fix that was not verified is not done — report it as unverified instead of marking it done.

## 5. Commit and push

Commit (one commit per report, or one per closely related group) with a message that says
what users will notice, and push to `main`. Add a short note to `CLAUDE.md` only for behaviour
a future session needs to know.

## 6. Close the reports

After the push succeeds, for each fixed report:

```bash
python3 tools/feedback.py set FB-XXXXXX selesai --note "<what was fixed, plain words> — commit <short hash>"
```

For reports that need info or are out of scope, use `ditinjau` (needs info — put the question
in the note so the reporter sees it in Feedback_Reports.html) or `ditolak` (with the reason).
Never mark a report `selesai` unless its fix is verified and pushed.

## 7. Report back

Tell the user, per ticket: what was wrong, what changed, how it was verified, and the new
status. List anything left open and why.
