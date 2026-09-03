#!/usr/bin/env python3
"""Generate the CHCB 6.9 kV Switchgear Maintenance check sheets from _swgr_template.tpl.
Run:  python3 "CHCB SWGR/_generate.py"   (from repo root)
Ported from google-apps-script/Checksheet mentah/CHCB - SWGR - BKR.xlsx (one HTML per worksheet tab).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = open(os.path.join(HERE, "_swgr_template.tpl")).read()


def cmp(pairs):
    return [{"code": c, "label": l} for c, l in pairs]


# ── shared checklist blocks ──────────────────────────────────────────────────
VISUAL = [
    {"no": "1", "desc": "Visually inspect all cubicles (front and rear) for any obvious damage and check for rodent activity and thoroughly clean dust from inside the panel", "crit": "No sign of damage"},
    {"no": "2", "desc": "Examine the bottom of the cubicle for parts that may have fallen from the breaker.", "crit": "No fallen parts"},
    {"desc": "The bottom of each cubicle should be maintained clean and free of any foreign objects to facilitate the detection of fallen parts.", "crit": "Cleanliness"},
    {"no": "3", "desc": "Verify that the mechanical safety interlocks and stops are intact.", "crit": "Intact"},
    {"no": "4", "desc": "Check that the cubicle heaters (where applicable) are functioning properly.", "crit": "Functioning properly"},
    {"no": "5", "desc": "Verify that the rack-in mechanism is aligned correctly.", "crit": "Aligned correctly"},
    {"no": "6", "desc": "Lubricate racking mechanism (jacking screws and bearings)", "crit": "Lubricated"},
    {"no": "7", "desc": "Perform an overall inspection looking for loose wiring or components and anomalies. Complete repairs as required.", "crit": "No loosens"},
    {"no": "8", "desc": "Verify that the shutter mechanism functions properly.", "crit": "Functioning properly"},
    {"no": "9", "desc": "The primary disconnects should be inspected for signs of over-heating, cracked insulation, cleanliness, and misalignment", "crit": "No loosens"},
    {"desc": "Primary disconnects — signs of over-heating", "crit": "No sign over heating"},
    {"desc": "Primary disconnects — cracked insulation", "crit": "No cracked insulation"},
    {"no": "10", "desc": "Visually check looseness or breakage of wire especially grounding cable", "crit": "No looseness or breakage"},
]

SAFETY_LOCKS = [
    {"no": "11", "desc": "Breaker Safety Locks — Rating Interference Interlock", "type": "subhead", "field": "VCB No."},
    {"desc": "Interference lock plate installed", "crit": "Installed"},
    {"desc": "Rating suitability", "crit": "appropriate (Amp)", "type": "single"},
    {"no": "12", "desc": "Negative Interlock and IL/MS and LCS switch", "type": "subhead"},
    {"desc": "Negative interlock roller appearance — 0.531 in minimum position to open breaker", "crit": "0.531 in min", "type": "single"},
    {"desc": "Negative interlock roller appearance — 0.670 in position to adjust interlock link", "crit": "0.670 in", "type": "single"},
    {"desc": "Negative Interlock mounting bracket bolts tightened", "crit": "Tightness"},
    {"desc": "No sign of mechanism bend, breakage", "crit": "No bend or breakage"},
    {"desc": "IL/MS and LCS switch mounting tightened", "crit": "Tightness"},
    {"desc": "IL/MS and LCS switch contacts are open on activation of negative interlock", "crit": "Contacts open"},
    {"desc": "Negative Interlock: “Electrical Trip Free” and “Mechanical Trip Free” functional test successful", "crit": "Test OK"},
    {"no": "13", "desc": "Positive Interlock", "type": "subhead", "fields": ["Open", "Close"]},
    {"desc": "No sign of mechanism bend, breakage", "crit": "No bend or breakage"},
    {"desc": "Positive Interlock functional test successful", "crit": "Test OK"},
    {"desc": "Positive interlock bar appearance", "crit": "Good"},
    {"no": "14", "desc": "Closing Spring Discharge Interlock and CL/MS switch", "type": "subhead"},
    {"desc": "No sign of mechanism bend, breakage", "crit": "No bend or breakage"},
    {"desc": "Closing Spring Discharge interlock roller appearance — 0.561 in minimum position to discharge spring", "crit": "0.561 in min", "type": "single"},
    {"desc": "Closing Spring Discharge interlock roller appearance — 0.995 in position to permit close latch reset", "crit": "0.995 in", "type": "single"},
    {"desc": "Closing Spring Discharge Interlock mounting bracket bolts tightened", "crit": "Tightness"},
    {"desc": "CL/MS switch mounting tightened", "crit": "Tightness"},
    {"desc": "CL/MS switch contacts are open on activation of spring discharge interlock", "crit": "Contacts open"},
    {"desc": "Closing Spring Discharge Interlock functional test successful", "crit": "Test OK"},
    {"no": "15", "desc": "Record all defect found and result of work carried out as work history", "type": "remark"},
]

MEG_TIMES = ["15\"", "30\"", "45\"", "1'", "2'", "3'", "4'", "5'", "6'", "7'", "8'", "9'", "10'"]


def elec_sections(res_cols="elec", meg_cols="elec", rtd_cols="elec", rtd_count=13):
    return [
        {"key": "res", "icon": "Ω", "title": "Item 11 — Three-Phase Resistance Test", "kind": "resistance",
         "crit": "measured resistance within 5% of each other", "columns": res_cols,
         "rows": ["T1 - T2", "T2 - T3", "T3 - T1"]},
        {"key": "meg", "icon": "≡", "title": "Item 12 — Insulation Resistance (1000 Vdc Megger, phase-to-ground)",
         "kind": "megger", "crit": "≥ 3 MΩ per phase-to-phase rated kV", "columns": meg_cols,
         "times": MEG_TIMES, "note": "PI = R(10') / R(1')   ·   DAR = R(1') / R(30\") — dihitung otomatis."},
        {"key": "rtd", "icon": "\U0001F321", "title": "Item 13 — RTD Resistance (Winding & Bearing Sensor)",
         "kind": "rtd", "crit": "no open circuit / short to ground", "columns": rtd_cols, "rtdCount": rtd_count},
    ]


CONFIGS = {}

# ── 7A1A ─────────────────────────────────────────────────────────────────────
C_7A1A = cmp([
    ("100A", "7A1A2"), ("100B", "E-1"), ("101A", "7A1AA"), ("101B", "CRN-100/200"),
    ("102A", "CRSH #2"), ("102B", "G-1"), ("103A", "E-5 M1"), ("103B", "E-5 M2"),
    ("104A", "C-2"), ("104B", "E-3"), ("105A", "7A1A1"), ("105B", "B-1"),
    ("106A", "7A1AM"), ("107A", "7A1AT / 8A1A"),
])
CONFIGS["SWGR_7EN-SWGR-A1A"] = {
    "formId": "swgr_7a1a", "assetTag": "7EN-SWGR-A1A", "assetName": "CHCB 6.9 kV Switchgear A1A (Unit 7)",
    "checksheetFile": "CHCB SWGR/SWGR_7EN-SWGR-A1A.html", "draftKey": "swgr_7a1a",
    "pageTitle": "SWGR 7EN-SWGR-A1A — CHCB", "heroTitle": "SWGR <em>7A1A</em>",
    "eyebrow": "6.9 kV Switchgear Maintenance · Unit 7",
    "heroSub": "7EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A — cubicle & breaker safety locks inspection",
    "swgrLabel": "7EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A", "frequency": "YEARLY",
    "compartments": C_7A1A,
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
        {"key": "locks", "icon": "\U0001F510", "title": "Breaker Safety Locks Inspection", "kind": "matrix", "items": SAFETY_LOCKS},
    ],
}

# ── 8A1A ─────────────────────────────────────────────────────────────────────
C_8A1A = cmp([
    ("109A", "8A1AM"), ("110A", "8A1A1"), ("110B", "B-2"), ("111A", "C-4"), ("111B", "E-2"),
    ("112A", "E-4 M1"), ("112B", "E-4 M2"), ("113A", "CRSH #1"), ("113B", "G-2"),
    ("114A", "8A1AA"), ("114B", "SPARE"), ("115A", "8A1A2"), ("115B", "CRN-300/400"),
])
CONFIGS["SWGR_8EN-SWGR-A1A"] = {
    "formId": "swgr_8a1a", "assetTag": "8EN-SWGR-A1A", "assetName": "CHCB 6.9 kV Switchgear A1A (Unit 8)",
    "checksheetFile": "CHCB SWGR/SWGR_8EN-SWGR-A1A.html", "draftKey": "swgr_8a1a",
    "pageTitle": "SWGR 8EN-SWGR-A1A — CHCB", "heroTitle": "SWGR <em>8A1A</em>",
    "eyebrow": "6.9 kV Switchgear Maintenance · Unit 8",
    "heroSub": "8EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A — cubicle & breaker safety locks inspection",
    "swgrLabel": "8EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A", "frequency": "YEARLY",
    "compartments": C_8A1A,
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
        {"key": "locks", "icon": "\U0001F510", "title": "Breaker Safety Locks Inspection", "kind": "matrix", "items": SAFETY_LOCKS},
    ],
}

# ── Bkr-spare ────────────────────────────────────────────────────────────────
CONFIGS["SWGR_CHCB_Breaker_Spare"] = {
    "formId": "swgr_bkrspare", "assetTag": "CHCB-SWGR-BKR-SPARE", "assetName": "CHCB 6.9 kV Switchgear — Spare Breakers",
    "checksheetFile": "CHCB SWGR/SWGR_CHCB_Breaker_Spare.html", "draftKey": "swgr_bkrspare",
    "pageTitle": "CHCB SWGR — Spare Breakers", "heroTitle": "SWGR <em>BKR SPARE</em>",
    "eyebrow": "6.9 kV Switchgear Maintenance · Spare Breakers",
    "heroSub": "CHCB 6.9 kV Switchgear — spare breaker inspection & breaker safety locks",
    "swgrLabel": "CHCB 6.9 kV Switchgear — Breaker Spare", "frequency": "YEARLY",
    "compartments": cmp([(f"BKR-{i}", "") for i in range(1, 9)]),
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
        {"key": "locks", "icon": "\U0001F510", "title": "Breaker Safety Locks Inspection", "kind": "matrix", "items": SAFETY_LOCKS},
    ],
}

# ── 7A1A (2) — visual + electrical tests ─────────────────────────────────────
C_7A1A2 = cmp([
    ("100A", "7A1A2"), ("100B", "E-1"), ("101A", "7A1AA / STRC 1"), ("101B", "CRN-100/200"),
    ("102A", "CRSH #2"), ("102B", "G-1"), ("103A", "E-5 M1"), ("103B", "E-5 M2"),
    ("104A", "C-2"), ("104B", "E-3"), ("105A", "7A1A1 / XFMR"), ("105B", "B-1"),
    ("106A", "7A1AM"), ("107A", "7A1AT / 8A1A"), ("BUS", "BUS"),
])
E_7A1A2 = cmp([
    ("100B", "E-1"), ("102A", "CRSH #2"), ("102B", "G-1"), ("103A", "E-5 M1"), ("103B", "E-5 M2"),
    ("104A", "C-2"), ("104B", "E-3"), ("105A HV", "7A1A1 HV"), ("105A LV", "7A1A1 LV"),
    ("105B", "B-1"), ("BUS A", "BUS A"), ("BUS B", "BUS B"), ("BUS C", "BUS C"),
])
RTD_7A1A2 = cmp([("100B", "E-1"), ("103A", "E-5 M1"), ("103B", "E-5 M2"), ("104A", "C-2"), ("104B", "E-3"), ("105B", "B-1")])
CONFIGS["SWGR_7EN-SWGR-A1A_Electrical"] = {
    "formId": "swgr_7a1a_el", "assetTag": "7EN-SWGR-A1A-EL", "assetName": "CHCB 6.9 kV Switchgear A1A (Unit 7) — Electrical Test",
    "checksheetFile": "CHCB SWGR/SWGR_7EN-SWGR-A1A_Electrical.html", "draftKey": "swgr_7a1a_el",
    "pageTitle": "SWGR 7EN-SWGR-A1A Electrical — CHCB", "heroTitle": "SWGR <em>7A1A · EL</em>",
    "eyebrow": "6.9 kV Switchgear Maintenance · Electrical Test · Unit 7",
    "heroSub": "7EN-SWGR-A1A · Cubicle inspection + 3-phase resistance, 1000 Vdc megger (PI/DAR) & RTD",
    "swgrLabel": "7EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A — Electrical Test", "frequency": "YEARLY",
    "compartments": C_7A1A2, "elecColumns": E_7A1A2,
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
    ] + [dict(s, columns=("elec" if s["key"] != "rtd" else RTD_7A1A2)) for s in elec_sections()],
}

# ── 8A1A (2) — visual + electrical tests ─────────────────────────────────────
C_8A1A2 = cmp([
    ("109A", "8A1AM"), ("110A", "8A1A1 / XFMR"), ("110B", "B-2"), ("111A", "C-4"), ("111B", "E-2"),
    ("112A", "E-4 M1"), ("112B", "E-4 M2"), ("113A", "CRSH #1"), ("113B", "G-2"),
    ("114A", "8A1AA"), ("114B", "SPARE"), ("115A", "8A1A2"), ("115B", "CRN-300/400"), ("BUS", "BUS"),
])
E_8A1A2 = cmp([
    ("110A HV", "8A1A1 HV"), ("110A LV", "8A1A1 LV"), ("110B", "B-2"), ("111A", "C-4"), ("111B", "E-2"),
    ("112A", "E-4 M1"), ("112B", "E-4 M2"), ("113A", "CRSH #1"), ("113B", "G-2"),
    ("BUS A", "BUS A"), ("BUS B", "BUS B"), ("BUS C", "BUS C"),
])
RTD_8A1A2 = cmp([("110B", "B-2"), ("111A", "C-4"), ("111B", "E-2"), ("112A", "E-4 M1"), ("112B", "E-4 M2")])
CONFIGS["SWGR_8EN-SWGR-A1A_Electrical"] = {
    "formId": "swgr_8a1a_el", "assetTag": "8EN-SWGR-A1A-EL", "assetName": "CHCB 6.9 kV Switchgear A1A (Unit 8) — Electrical Test",
    "checksheetFile": "CHCB SWGR/SWGR_8EN-SWGR-A1A_Electrical.html", "draftKey": "swgr_8a1a_el",
    "pageTitle": "SWGR 8EN-SWGR-A1A Electrical — CHCB", "heroTitle": "SWGR <em>8A1A · EL</em>",
    "eyebrow": "6.9 kV Switchgear Maintenance · Electrical Test · Unit 8",
    "heroSub": "8EN-SWGR-A1A · Cubicle inspection + 3-phase resistance, 1000 Vdc megger (PI/DAR) & RTD",
    "swgrLabel": "8EN-SWGR-A1A · CHCB 6.9 kV Switchgear A1A — Electrical Test", "frequency": "YEARLY",
    "compartments": C_8A1A2, "elecColumns": E_8A1A2,
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
    ] + [dict(s, columns=("elec" if s["key"] != "rtd" else RTD_8A1A2)) for s in elec_sections()],
}

# ── STRC 2 ───────────────────────────────────────────────────────────────────
C_STRC = cmp([("8A1AA1", "XFMR - STRC 2"), ("MCC-A1AA1", "Lower MCC"), ("MCC-A1AA11", "Upper MCC")])
CONFIGS["SWGR_STRC-2"] = {
    "formId": "swgr_strc2", "assetTag": "8A1AA1-STRC-2", "assetName": "Stacker Reclaimer 2 — 6.9 kV / 416 V Switchgear",
    "checksheetFile": "CHCB SWGR/SWGR_STRC-2.html", "draftKey": "swgr_strc2",
    "pageTitle": "SWGR Stacker Reclaimer 2", "heroTitle": "SWGR <em>STRC 2</em>",
    "eyebrow": "6.9 kV / 416 V Switchgear Maintenance · Stacker Reclaimer 2",
    "heroSub": "Stacker Reclaimer 2 · XFMR + Lower/Upper MCC — cubicle inspection + electrical tests",
    "swgrLabel": "Stacker Reclaimer 2 · 6.9 kV / 416 V Switchgear", "frequency": "YEARLY",
    "compartments": C_STRC,
    "sections": [
        {"key": "visual", "icon": "\U0001F50D", "title": "Cubicle / Compartment Inspection", "kind": "matrix", "items": VISUAL},
        {"key": "bkr", "icon": "\U0001F527", "title": "Item 11 — Breaker Inspection, Cleaning & Lubrication", "kind": "matrix",
         "items": [{"no": "11", "desc": "Breaker inspection, cleaning and lubrication", "crit": "No sign of damage"}]},
        {"key": "res_sw", "icon": "Ω", "title": "Item 12 — Switchgear Three-Phase Resistance Test", "kind": "resistance",
         "crit": "within 5% of each other", "columns": cmp([("HV", "HV"), ("LV", "LV")]), "rows": ["T1 - T2", "T2 - T3", "T3 - T1"]},
        {"key": "meg_sw", "icon": "≡", "title": "Item 13 — Switchgear Insulation Resistance (1000 Vdc Megger)", "kind": "megger",
         "crit": "≥ 3 MΩ per phase-to-phase kV", "columns": cmp([("HV", "HV"), ("LV", "LV")]), "times": MEG_TIMES},
        {"key": "res_cbl", "icon": "Ω", "title": "Power Cable, Slip Ring, VT & CPT, XFMR — Three-Phase Resistance", "kind": "resistance",
         "crit": "within 5% of each other",
         "columns": cmp([("XFMR HV", "XFMR HV"), ("XFMR LV", "XFMR LV"), ("Cable A", "Power Cable A"), ("Cable B", "Power Cable B"), ("Cable C", "Power Cable C")]),
         "rows": ["T1 - T2", "T2 - T3", "T3 - T1"]},
        {"key": "meg_cbl", "icon": "≡", "title": "Power Cable + Slip Ring — Insulation Resistance (1000 Vdc Megger)", "kind": "megger",
         "crit": "≥ 3 MΩ per phase-to-phase kV", "columns": cmp([("A", "Phase A"), ("B", "Phase B"), ("C", "Phase C")]), "times": MEG_TIMES},
        {"key": "rec", "icon": "\U0001F4DD", "title": "Work History", "kind": "matrix",
         "items": [{"no": "14", "desc": "Record all defect found and result of work carried out as work history", "type": "remark"}]},
    ],
}

# ── emit ─────────────────────────────────────────────────────────────────────
for stem, cfg in CONFIGS.items():
    out = TPL.replace("__TITLE__", cfg["pageTitle"]).replace(
        "__CONFIG__", json.dumps(cfg, ensure_ascii=False, indent=2))
    open(os.path.join(HERE, stem + ".html"), "w").write(out)
    print(f"  {stem}.html  ({len(cfg['compartments'])} compartments, {len(cfg['sections'])} sections)")
print("done.")
