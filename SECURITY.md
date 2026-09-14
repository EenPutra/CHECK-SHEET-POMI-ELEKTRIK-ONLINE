# SECURITY.md — hardening the check-sheet app

## Where we are today (the baseline)

- **No per-request authentication.** The Firebase Web config in `firebase-config.js`
  is public (normal for Firebase — an API key is a project identifier, not a
  secret). The weakness is what sits behind it:
  - Firestore Security Rules were `allow read, write: if true` on every collection.
  - "Login" is a homemade check: the browser reads a `dashboard_users` doc and
    compares an **unsalted SHA-256** password hash client-side. The collection is
    world-readable, so those hashes are downloadable, and anyone could `.add()` an
    `admin` account straight into Firestore.
  - Evidence photos + report PDFs live in a Google Drive folder that was shared
    **"Anyone with the link"**, so every file was world-readable by URL.
  - The Google Apps Script proxy (`drive-proxy.gs`) is deployed "Who has access:
    Anyone" with no token, so anyone with the `/exec` URL can upload to our Drive
    or read any file id.

Trust model: internal tool for the EIC7 maintenance team, not a public app.

## The plan

| Level | What | Effort | Breaks the "no backend" design? |
|---|---|---|---|
| **1 (this doc)** | SSO gate + App Check + tightened Rules + private Drive + proxy token | ~days | No |
| 2 | Migrate homemade login → **Firebase Authentication**, role-based Rules | ~1–2 weeks (touches ~60 files) | No |
| 3 | All Firestore access behind a real backend | weeks | Yes — rearchitecture |

Level 1 raises the app from "open to anyone on the internet" to "reachable only by
staff, and casual tampering blocked". It does **not** stop a determined authenticated
insider — that needs Level 2.

---

# Level 1 — step by step

## Step 1 — Deploy the tightened Firestore Rules  ✅ *file ready in repo*

`firestore.rules` (+ `firebase.json`, `.firebaserc`) are in the repo now. They:

- keep the per-collection allow-list (unknown collection = denied),
- make `dashboard_config` read-only to clients,
- block self-registering an **admin** account,
- block changing an account's **role** via a profile/password/signature update,
- freeze `createdAt` on a checksheet overwrite (keeps dedupe/trends honest),
- require drafts to actually be `status:'draft'`.

They intentionally still allow anonymous **reads** and **deletes** — real limits
there need Level 2 (Rules can't tell an admin from a technician without Auth).

**Deploy (option A — Firebase CLI):**
```
npm i -g firebase-tools      # once
firebase login               # once, as a project owner
cd <repo>
firebase deploy --only firestore:rules
```

**Deploy (option B — Console):** Firebase Console → Firestore Database → Rules →
paste `firestore.rules` → **Publish**.

**Test checklist (do all of these right after deploying):**

- [ ] Submit a check sheet in the field/staging → succeeds, appears in `dashboard.html`.
- [ ] Open a submitted check sheet, "Muat/Lanjutkan", change a value, re-submit
      (overwrite path) → succeeds, `createdAt` unchanged in Firestore.
- [ ] "💾 Simpan ke Database" (cloud draft) → succeeds; reopen on another device.
- [ ] Review Dashboard: register a new **technician** account → succeeds.
- [ ] Register a **techop2 / supervisor** account (with access code) → succeeds.
- [ ] Settings → change name / password / signature → succeeds.
- [ ] Team & Area setup on first login → succeeds.
- [ ] TechOp2 review + Supervisor approve a submission → succeeds, final PDF builds.
- [ ] "Hapus Duplikat" / admin delete → still works (still permitted at Level 1).
- [ ] Weekly Report Dashboard EIC7 → "Update ke Cloud" / "Ambil Update" → succeeds.

**Rollback:** re-publish the previous rules (paste `allow read, write: if true` per
collection, or `firebase deploy` an older `firestore.rules`). Rules changes are
instant and fully reversible.

## Step 2 — Put the whole site behind SSO (Cloudflare Access)  ⬜ *needs your action*

This is the single biggest win: nobody can even load a page without a company login.

1. Create a free **Cloudflare** account; add the domain the app is served on.
   (Hosting can stay on GitHub Pages — Cloudflare sits in front as DNS + proxy.)
2. Point the domain's DNS at Cloudflare (change nameservers at the registrar), keep
   the record for the site **proxied** (orange cloud).
3. Cloudflare dashboard → **Zero Trust** → Access → Applications → **Add a
   self-hosted application**:
   - Application domain = the app's hostname (e.g. `checksheet.example.com`).
   - Session duration: 24h (or your preference).
4. Add a **policy**: Action *Allow*, Include → *Emails ending in* `@paitonenergy...`
   (your Google Workspace domain), or a named list of allowed emails.
5. Identity provider: add **Google** (Workspace) as the IdP so staff log in with
   their existing account.
6. Test in an incognito window: visiting any page now redirects to Google login
   first; an outside email is refused.

Notes: free tier covers up to 50 users. If the domain can't move to Cloudflare,
alternatives: Netlify password protection, or Firebase Hosting + Identity-Aware
Proxy (needs GCP). Tell me which and I'll adjust.

## Step 3 — Enable Firebase App Check  ⬜ *needs your action + a small repo change*

App Check makes Firestore reject any request that doesn't come from our real web
app (blocks scripts / curl / scrapers hitting the open collections).

1. Firebase Console → **App Check** → register the Web app → provider
   **reCAPTCHA v3** (or reCAPTCHA Enterprise). Copy the **site key**.
2. Tell me the site key. Repo change (I'll do it when you're ready — it touches
   `firebase-config.js` + a `<script>` tag in every HTML file, so it needs one
   careful pass + a `?v=` bump):
   - add `firebase-app-check-compat.js`,
   - `firebase.appCheck().activate('<SITE_KEY>', true)` right after
     `firebase.initializeApp(...)`.
3. In the Console, keep App Check in **"Unenforced / Monitor"** for ~1 week and
   watch the metrics (make sure real traffic shows as verified).
4. Only then switch **Firestore** to **Enforced**. (If enforced too early with a
   misconfig, every check sheet stops saving — hence the monitor week.)
5. For local testing use the App Check **debug token** (printed to the console;
   register it in the Console).

## Step 4 — Lock down Google Drive  ⬜ *partly needs your action*

**4a. Make the Drive folder private (do this now — no code, no downtime):**
Downloads flow through `drive-proxy.gs` `doGet()`, which reads files as the script
owner — public sharing is not needed. Right-click the upload folder in Drive →
Share → General access → **Restricted**. Then verify in the app: open a submitted
report's "Buka PDF Asli" and an evidence photo → they still load.

**4b. Add the proxy shared token (code is staged in repo, currently inert):**
`storage-helper.js` `DRIVE_PROXY_TOKEN` and `drive-proxy.gs` `SHARED_SECRET` are
both `''` = disabled. To activate:
1. Generate a random string (e.g. `openssl rand -hex 24`).
2. Put it in **both** `SHARED_SECRET` (drive-proxy.gs) and `DRIVE_PROXY_TOKEN`
   (storage-helper.js).
3. Apps Script: Deploy → **Manage deployments** → edit → **New version**.
4. Bump `?v=` repo-wide (per CLAUDE.md's cache-busting section) so no browser
   keeps a tokenless `storage-helper.js`.
5. Deploy the repo; verify upload + view + the review/approve flow.
Order matters: deploy the script's new version *before or together with* the repo
bump, or in-flight uploads briefly 401.

**4c. (Optional) Apps Script access:** change the deployment to "Who has access:
*Anyone with a Google account*" and, if you want, check `Session.getActiveUser()
.getEmail()` against your domain in `checkAuth()`. Combined with 4b this is
belt-and-braces.

## Step 5 — Restrict the Firebase API key  ⬜ *needs your action*

Google Cloud Console → APIs & Services → **Credentials** → the "Browser key"
auto-created for the Firebase web app → **Application restrictions** → *HTTP
referrers* → add the app's domain(s) (e.g. `checksheet.example.com/*`,
`*.github.io/*` if still used). → **API restrictions** → limit to *Cloud
Firestore API*, *Identity Toolkit API*, *Token Service API*. This stops the key
being reused from other origins; combined with App Check it's meaningful.

---

## Collection inventory (keep `firestore.rules` in sync with this)

| Collection | Writer | Notes |
|---|---|---|
| `checksheets` | every check sheet submit, manual upload, external feeds | create open (external POMI feeds write here too); `createdAt` frozen on update; client deletes still allowed |
| `approvals` | review/approval workflow | mutated in place; `submitted→reviewed→approved` / `returned_to_technician→revised` |
| `checksheet_drafts` | `cloud-draft.js` | `status:'draft'`; deleted on final submit / reset |
| `dashboard_users` | register + Settings | role create-allowlist ≠ admin; role frozen on update; no client delete |
| `dashboard_config` | *(admin, Console only)* | client read-only |
| `weekly_dashboard` + `/workOrders` | Weekly Report Dashboard EIC7 | separate mini-app, own client-side password; permissive until Level 2 |

## Deferred to Level 2 (Firebase Authentication)

- Anonymous reads of all data.
- Client-side deletes (dedupe / admin purge / owner-retract).
- Password hashes readable via `dashboard_users` (Auth removes stored hashes entirely).
- Server-side enforcement of the elevated-role registration access code.
- Role checks (`canReview` / `canApprove` / technician data scoping) are UI-only.
