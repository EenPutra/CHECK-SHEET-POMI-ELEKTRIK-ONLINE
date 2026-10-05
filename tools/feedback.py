#!/usr/bin/env python3
"""Read and triage the bug / feedback reports sent from the 💬 widget.

Reports live in the Firestore collection `feedback_reports` (written by
feedback-widget.js, listed in Feedback_Reports.html). This talks to the
Firestore REST API directly — no login, no packages beyond the standard
library — under the same open Level 1 rules the web app uses.

    python3 tools/feedback.py list                 # open reports (baru/ditinjau/dikerjakan)
    python3 tools/feedback.py list --all           # every report
    python3 tools/feedback.py list --id FB-5IGCYC  # one report (ticket or doc id)
    python3 tools/feedback.py set FB-5IGCYC selesai --note "Diperbaiki di 1a2b3c4"

`list` saves each report's screenshots as JPG files (default: a temp folder)
and prints their paths so they can be opened. `set` appends a history entry,
the same shape Feedback_Reports.html writes.

Every document read counts against the project's daily Firestore read quota
(50k on the free plan); a 429 means that quota is used up until 00:00 US
Pacific time.
"""
import argparse
import base64
import json
import os
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

PROJECT = "pomi-checksheet-e7"
COLL = "feedback_reports"
BASE = f"https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents/{COLL}"
STATUSES = ["baru", "ditinjau", "dikerjakan", "selesai", "ditolak"]
OPEN = {"baru", "ditinjau", "dikerjakan"}
PRIO_RANK = {"kritis": 0, "tinggi": 1, "sedang": 2, "rendah": 3}


# ── Firestore REST value <-> python ──────────────────────────────────────────
def from_fs(v):
    if v is None:
        return None
    for k in ("stringValue", "booleanValue", "doubleValue", "timestampValue"):
        if k in v:
            return v[k]
    if "integerValue" in v:
        return int(v["integerValue"])
    if "nullValue" in v:
        return None
    if "mapValue" in v:
        return {k: from_fs(x) for k, x in v["mapValue"].get("fields", {}).items()}
    if "arrayValue" in v:
        return [from_fs(x) for x in v["arrayValue"].get("values", [])]
    return None


def to_fs(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, list):
        return {"arrayValue": {"values": [to_fs(x) for x in v]}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": {k: to_fs(x) for k, x in v.items()}}}
    raise TypeError(f"unsupported value {v!r}")


def request(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        msg = e.read().decode(errors="replace")
        if e.code == 429:
            sys.exit("Firestore: kuota baca harian habis (429). Coba lagi setelah reset (00:00 waktu Pasifik ≈ 14:00 WIB).")
        sys.exit(f"Firestore HTTP {e.code}: {msg[:400]}")


def doc_id(name):
    return name.rsplit("/", 1)[-1]


def ticket(did):
    return "FB-" + did[:6].upper()


def fetch_all():
    docs, token = [], None
    while True:
        url = BASE + "?pageSize=100" + (f"&pageToken={urllib.parse.quote(token)}" if token else "")
        res = request("GET", url)
        for d in res.get("documents", []):
            f = {k: from_fs(v) for k, v in d.get("fields", {}).items()}
            f["id"] = doc_id(d["name"])
            docs.append(f)
        token = res.get("nextPageToken")
        if not token:
            return docs


def resolve(docs, key):
    key = key.strip()
    k = key.upper().removeprefix("FB-")
    hits = [d for d in docs if d["id"] == key or d["id"].upper().startswith(k)]
    if not hits:
        sys.exit(f"Laporan {key} tidak ditemukan.")
    if len(hits) > 1:
        sys.exit(f"{key} cocok dengan {len(hits)} laporan — pakai doc id lengkap.")
    return hits[0]


# ── commands ────────────────────────────────────────────────────────────────
def cmd_list(a):
    docs = fetch_all()
    if a.id:
        docs = [resolve(docs, i) for i in a.id]
    elif not a.all:
        docs = [d for d in docs if d.get("status") in OPEN]
    docs.sort(key=lambda d: (PRIO_RANK.get(d.get("priority"), 9), d.get("createdAt") or ""))

    out_dir = a.out or os.path.join(tempfile.gettempdir(), "pomi-feedback")
    os.makedirs(out_dir, exist_ok=True)
    rows = []
    for d in docs:
        shots = []
        for i, s in enumerate(d.get("screenshots") or []):
            url = (s or {}).get("dataUrl") or ""
            if "," not in url:
                continue
            path = os.path.join(out_dir, f"{ticket(d['id'])}_{i + 1}.jpg")
            with open(path, "wb") as fh:
                fh.write(base64.b64decode(url.split(",", 1)[1]))
            shots.append(path)
        d["screenshotFiles"] = shots
        d.pop("screenshots", None)
        rows.append(d)

    if a.json:
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return
    if not rows:
        print("Tidak ada laporan terbuka." if not a.all else "Belum ada laporan.")
        return
    print(f"{len(rows)} laporan{' terbuka' if not (a.all or a.id) else ''}:\n")
    for d in rows:
        page, rep, env = d.get("page") or {}, d.get("reporter") or {}, d.get("env") or {}
        print("=" * 78)
        print(f"{ticket(d['id'])}  ({d['id']})  status={d.get('status')}  jenis={d.get('type')}  prioritas={d.get('priority')}")
        print(f"Judul    : {d.get('title')}")
        print(f"Halaman  : {page.get('title', '')} — {page.get('file') or page.get('path', '')}")
        print(f"Pelapor  : {rep.get('name')}{' (' + rep['role'] + ')' if rep.get('role') else ''}{' · ' + rep['contact'] if rep.get('contact') else ''}")
        print(f"Dibuat   : {d.get('createdAt')}   versi app: {env.get('appVersion', '—')}")
        if env:
            print(f"Browser  : {env.get('userAgent', '')[:110]}  layar {env.get('viewport', '')}  tema {env.get('theme', '') or '-'}")
        print("Penjelasan:")
        print("  " + (d.get("description") or "—").replace("\n", "\n  "))
        if d.get("steps"):
            print("Langkah:")
            print("  " + d["steps"].replace("\n", "\n  "))
        errs = d.get("consoleErrors") or []
        if errs:
            print(f"Error di halaman ({len(errs)}):")
            for e in errs:
                print(f"  [{e.get('kind')}] {e.get('msg')}" + (f" ×{e['n']}" if e.get("n", 1) > 1 else ""))
        if d.get("devNote"):
            print(f"Catatan developer: {d['devNote']}")
        for p in d["screenshotFiles"]:
            print(f"Screenshot: {p}")
    print("=" * 78)


def cmd_set(a):
    if a.status not in STATUSES:
        sys.exit(f"Status harus salah satu dari: {', '.join(STATUSES)}")
    docs = fetch_all()
    d = resolve(docs, a.id)
    now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    history = list(d.get("history") or [])
    note = a.note or ""
    history.append({"status": a.status, "by": a.by, "at": now, "note": note or f"status → {a.status}"})
    fields = {"status": a.status, "updatedAt": now, "history": history}
    if note:
        fields["devNote"] = note
    mask = "&".join("updateMask.fieldPaths=" + k for k in fields)
    request("PATCH", f"{BASE}/{d['id']}?{mask}", {"fields": {k: to_fs(v) for k, v in fields.items()}})
    print(f"{ticket(d['id'])}: {d.get('status')} → {a.status}" + (f"  ({note})" if note else ""))


def main():
    p = argparse.ArgumentParser(description="Bug / feedback reports (feedback_reports)")
    sub = p.add_subparsers(dest="cmd", required=True)
    l = sub.add_parser("list", help="tampilkan laporan")
    l.add_argument("--all", action="store_true", help="termasuk yang selesai / ditolak")
    l.add_argument("--id", action="append", help="hanya laporan ini (FB-XXXXXX atau doc id); boleh diulang")
    l.add_argument("--json", action="store_true", help="output JSON")
    l.add_argument("--out", help="folder untuk screenshot (default: folder temp)")
    l.set_defaults(fn=cmd_list)
    s = sub.add_parser("set", help="ubah status laporan")
    s.add_argument("id")
    s.add_argument("status", choices=STATUSES)
    s.add_argument("--note", help="catatan developer (mis. penyebab + commit)")
    s.add_argument("--by", default="Claude Code", help="nama yang dicatat di riwayat")
    s.set_defaults(fn=cmd_set)
    a = p.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
