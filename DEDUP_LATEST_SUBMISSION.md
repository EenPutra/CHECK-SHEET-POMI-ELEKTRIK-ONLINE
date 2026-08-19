# Pattern: showing "latest submission per visit" instead of every resubmit

## The problem

Every check sheet's "Submit to Database" button always creates a brand-new
Firestore document (`DB.save()` always `.add()`s, never updates). In the
field, a technician sometimes hits it more than once for the same visit — a
flaky connection, or just wanting to be sure the data didn't get lost. That
piles up several near-identical documents for what is really one PM job.
Left alone, anything that reads `DB.getAll()` (a dashboard table, stat cards,
charts, Excel export, a trend chart) silently double-, triple-, or
19x-counts that one visit.

## Why the obvious fix is unsafe

The obvious dedup key is "same asset, same WO number, same execution date" —
group on `(assetTag, woNumber, executionDate)` and keep one per group.

This was tried and caught before ship by checking it against real production
data (191 documents in the `checksheets` collection): 38 groups shared a key,
and one of them — a transformer, 16 documents under one key — actually
spanned **three separate real weekly visits**, each with a different
`countOk` result, all sharing one `executionDate` value a technician had
simply never edited across drafts (some check sheets pre-fill `executionDate`
from the last submission — see `TREND_LEGACY_SOURCE` handling in
`dashboard.html`, same root cause). Naive key-only dedup would have collapsed
that to 1 row and silently thrown away 2 of the 3 real weeks of data.

So `executionDate` alone (or as part of the key) cannot be trusted to mean
"this is still the same visit." Something else has to break the tie.

## The fix: time-cluster on `createdAt`, not just the key

`createdAt` is different from `executionDate` — it's an ISO string set once,
client-side, at the exact moment `DB.save()` runs (`db-helper.js`):

```js
async save(data) {
  data.submittedAt = firebase.firestore.FieldValue.serverTimestamp();
  data.createdAt = new Date().toISOString();
  const ref = await db.collection(this.COLLECTION).add(data);
  return ref.id;
},
```

Unlike `executionDate`, a technician can't leave `createdAt` stale — it's
always "when this document was actually written." That makes it the right
signal for "is this really the same resubmission, or a different visit that
happens to share a key."

Real data shows a clean, bimodal split when you look at the `createdAt` gaps
*within* each key group:

- **Genuine resubmits** (same visit, hit submit more than once): consecutive
  `createdAt` values land within **~21 hours** of each other.
- **Genuinely different visits** that happen to share a stale key: consecutive
  `createdAt` values are **≥70 hours** apart — up to 358 hours (~15 days) in
  the worst case observed. These groups also had different `countOk` values,
  confirming they're real distinct inspections, not duplicates.

`24 hours` sits safely in that gap, so it's used as the clustering cutoff
(`CLUSTER_GAP_HOURS`). The algorithm:

1. Group documents by key: `assetTag + '||' + woNumber + '||' + executionDate`.
2. Within each group, sort by `createdAt` ascending.
3. Walk the sorted list; start a new cluster whenever the gap to the previous
   document's `createdAt` exceeds `CLUSTER_GAP_HOURS`.
4. Keep only the last (newest) document of each cluster.
5. A document missing `assetTag` or `woNumber` can't be grouped safely —
   always keep it as its own row rather than risk merging unrelated
   submissions under an empty key.

## Reference implementation

The algorithm lives once, in `db-helper.js`, as `DB.dedupeLatest()` /
`DB.CLUSTER_GAP_HOURS` — reuse it, don't re-derive it per check sheet:

```js
const DB = {
  COLLECTION: 'checksheets',
  CLUSTER_GAP_HOURS: 24,

  dedupeLatest(docs) {
    const groups = new Map();
    docs.forEach(d => {
      const tag = (d.assetTag || '').trim();
      const wo = (d.woNumber || '').trim();
      if (!tag || !wo) return;
      const key = tag + '||' + wo + '||' + (d.executionDate || '').trim();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(d);
    });

    const keep = new Set();
    const gapMs = this.CLUSTER_GAP_HOURS * 3600 * 1000;
    groups.forEach(list => {
      const sorted = [...list].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
      for (let i = 0; i < sorted.length; i++) {
        const isClusterEnd = i === sorted.length - 1 ||
          (new Date(sorted[i + 1].createdAt || 0) - new Date(sorted[i].createdAt || 0)) > gapMs;
        if (isClusterEnd) keep.add(sorted[i]);   // newest doc in this cluster (ascending sort -> last)
      }
    });

    return docs.filter(d => {
      const tag = (d.assetTag || '').trim();
      const wo = (d.woNumber || '').trim();
      return (!tag || !wo) || keep.has(d);
    });
  },
  // ...
};
```

`DB.getAll()` / `DB.getStats()` themselves stay **raw by default** (return
every document, duplicates included) — dedup is applied by the *consumer*,
not hidden inside the fetch, so a page can keep both the raw list and the
deduped view without a second Firestore round-trip:

```js
async getAll(filters = {}) {
  // ...
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return filters.dedupe === true ? this.dedupeLatest(docs) : docs;
},
```

## How to apply this to another check sheet / page

1. Make sure `db-helper.js` is loaded (`<script src="db-helper.js"></script>`)
   — `DB.dedupeLatest()` and `DB.CLUSTER_GAP_HOURS` come for free.
2. Fetch raw as usual: `const raw = await DB.getAll();` (or `DB.getAll({assetTag: ...})`
   for a filtered list — dedup still applies correctly per-group).
3. Wherever you currently render/aggregate that list, dedupe it first:
   `const deduped = DB.dedupeLatest(raw);` — use `deduped` for tables, stat
   cards, charts, exports; keep `raw` around only if you want a "show all
   history" / "include duplicates" toggle.
4. If you want a user-facing toggle (recommended for any list a technician
   or reviewer browses), follow `dashboard.html`'s pattern:
   - Keep two arrays: `allDataRaw` (untouched) and `allData` (what
     everything else reads).
   - A checkbox ("Submission terbaru saja" / "latest only") flips a
     `showAllHistory` boolean.
   - One function re-derives `allData = showAllHistory ? allDataRaw : DB.dedupeLatest(allDataRaw)`
     and re-renders — no network round-trip needed, since both arrays are
     already in memory.
   - Show a small badge with the hidden count
     (`allDataRaw.length - deduped.length`) so it's visible that something
     was collapsed, not silently missing.
5. Don't apply this inside `DB.save()` or anywhere that writes — this is a
   **display-time** filter only. The raw documents always stay in Firestore;
   nothing is ever deleted by this pattern.
6. If you introduce a different key shape for a new check sheet (e.g. no
   `woNumber` field), don't invent a new ad-hoc key — extend
   `DB.dedupeLatest()`'s key construction so the one shared implementation
   still covers it, rather than writing a second dedup function elsewhere.

## Where this is used today

`dashboard.html` — `dedupeSubmissions(docs)` is a one-line delegate to
`DB.dedupeLatest(docs)`, wired into `allData`/`allDataRaw`/`applyDedupeToggle()`/
the `#toggle-history` checkbox and `#dedupe-badge`. See the "Transformer PM
Trend Analysis" section of `CLAUDE.md` for how this interacts with
`TREND_LEGACY_SOURCE`'s date-collision handling (same root cause: a stale,
technician-editable date field, only worked around there for trend-series
merging instead of dashboard row counting).
