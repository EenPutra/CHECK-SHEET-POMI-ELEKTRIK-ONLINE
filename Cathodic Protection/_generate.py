#!/usr/bin/env python3
"""Generate the 8 Cathodic Protection check sheets from _cp_template.tpl + per-sheet configs.
Run:  python3 "Cathodic Protection/_generate.py"   (from repo root)
"""
import json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = open(os.path.join(HERE, "_cp_template.tpl")).read()


def anodes_num(prefix, jb_spans):
    """jb_spans: list of (jb_label, count). Returns list of groups."""
    groups = []
    n = 0
    for label, cnt in jb_spans:
        anodes = []
        for _ in range(cnt):
            n += 1
            anodes.append(f"{prefix}-{n:02d}")
        groups.append({"g": f"Junction Box {label}", "anodes": anodes})
    return groups


CONFIGS = {}

# ── 1. ICCP Scrubber (Hydrogen Plant) ──────────────────────────────────────────
CONFIGS["ICCP_Scrubber_Hydrogen_Plant"] = {
    "formId": "cp_scrubber", "assetTag": "CEA-RECT-A",
    "assetName": "ICCP Scrubber (Hydrogen Plant)",
    "checksheetFile": "Cathodic Protection/ICCP_Scrubber_Hydrogen_Plant.html",
    "draftKey": "cp_scrubber", "formNo": "PI-02-31-288-F06",
    "pageTitle": "ICCP Scrubber — Hydrogen Plant",
    "heroTitle": "ICCP <em>SCRUBBER</em>",
    "eyebrow": "Impressed Current Cathodic Protection · 6 Monthly",
    "heroSub": "Hydrogen Plant · System A · CEA-RECT-A · Cathodic Protection Inspection Report",
    "frequency": "6 MONTHLY", "potentialRef": "Cu/CuSO4", "tpLocation": True,
    "pilePotential": None,
    "systems": [{
        "label": "System A · CEA-RECT-A", "sublabel": "ICCP Scrubber — Hydrogen Plant",
        "potentialRef": "Cu/CuSO4",
        "anodeGroups": [
            {"g": "P1 — Positive Junction Box", "anodes": ["P1-A1", "P1-A2", "P1-A3"]},
            {"g": "P2 — Positive Junction Box", "anodes": ["P2-A4", "P2-A5", "P2-A6"]},
            {"g": "P3 — Positive Junction Box", "anodes": ["P3-A7", "P3-A8", "P3-A9", "P3-A10"]},
        ],
        "potentials": ["CCC 110", "CCC 120", "CSW 100"],
        "truUnits": [
            {"tag": "# 3101", "struct": "AW PUMP C (CFC-P-600C)", "cap": "15 V / 10 A"},
            {"tag": "# 3102", "struct": "AW PUMP B (CFC-P-600B)", "cap": "15 V / 10 A"},
            {"tag": "# 3103", "struct": "AW PUMP A (CFC-P-600A)", "cap": "15 V / 10 A"},
        ],
    }],
}

# ── 2. 7EA-COND-000 — CP Condenser Water Box Unit 7 ────────────────────────────
def cond_box(label, console, main_anodes, tail_struct, tail_count, refs=5, tru=False):
    anodes = [{"tag": f"AN {i}", "struct": label} for i in range(1, main_anodes + 1)]
    anodes += [{"tag": f"AN {main_anodes + j}", "struct": tail_struct} for j in range(1, tail_count + 1)]
    return {
        "label": label, "sublabel": f"Console {console}",
        "truFields": tru, "potentialRef": "Ag/AgCl", "anodeStruct": True,
        "potentialMode": "single",
        "anodeGroups": [{"g": f"Anodes — Console {console}", "anodes": anodes}],
        "potentials": [f"R{i}" for i in range(1, refs + 1)],
    }

CONFIGS["ICCP_Condenser_Water_Box_7EA-COND-000"] = {
    "formId": "cp_cond000", "assetTag": "7EA-COND-000",
    "assetName": "ICCP Condenser Water Box (Unit 7)",
    "checksheetFile": "Cathodic Protection/ICCP_Condenser_Water_Box_7EA-COND-000.html",
    "draftKey": "cp_cond000", "formNo": "PI-02-31-288-F07",
    "pageTitle": "ICCP Condenser Water Box — 7EA-COND-000",
    "heroTitle": "ICCP <em>CONDENSER</em>",
    "eyebrow": "Impressed Current CP · Condenser Water Box · Unit 7",
    "heroSub": "7EA-COND-000 · Impressed Current CP for Condenser Water Box Unit 7 · Power Supply: Siemens SITOP DC 24V / 30A",
    "frequency": "6 MONTHLY", "potentialRef": "Ag/AgCl", "tpLocation": False,
    "pilePotential": None,
    "systems": [
        cond_box("Return Box 1", "DB3", 6, "Long Pipe", 3, tru=True),
        cond_box("Return Box 3", "DB3", 6, "Long Pipe", 2),
        cond_box("Return Box 5", "DB4", 6, "Short Pipe", 2),
        cond_box("Return Box 7", "DB4", 6, "Long Pipe", 3),
        cond_box("Inlet Box 2", "DB1", 6, "Inlet Pipe", 1),
        cond_box("Inlet Box 4", "DB1", 6, "Inlet Pipe", 1),
        cond_box("Outlet Box 6", "DB2", 6, "Outlet Pipe", 1),
        cond_box("Outlet Box 8", "DB2", 6, "Outlet Pipe", 1),
    ],
}

# ── 3. 7EA-ID-000 — CP System, Seawater Intake of Unit 7 ───────────────────────
CONFIGS["ICCP_Seawater_Intake_7EA-ID-000"] = {
    "formId": "cp_id000", "assetTag": "7EA-RECT-100A/B",
    "assetName": "ICCP Seawater Intake (Unit 7)",
    "checksheetFile": "Cathodic Protection/ICCP_Seawater_Intake_7EA-ID-000.html",
    "draftKey": "cp_id000", "formNo": "",
    "pageTitle": "ICCP Seawater Intake — 7EA-ID-000",
    "heroTitle": "ICCP <em>SEAWATER INTAKE</em>",
    "eyebrow": "Cathodic Protection System · Seawater Intake · Unit 7",
    "heroSub": "7EA-RECT-100A / 7EA-RECT-100B · Cathodic Protection System — Seawater Intake of Unit 7",
    "frequency": "6 MONTHLY", "potentialRef": "Ag/AgCl", "tpLocation": False,
    "pilePotential": None,
    "systems": [
        {
            "label": "7EA-RECT-100A", "sublabel": "Drumscreen / Wash Pump / CW Pump / DW Pump",
            "potentialRef": "Ag/AgCl",
            "truUnits": [
                {"tag": "# 7111", "struct": "Drumscreen A (7ID-SCN-100A)", "cap": "15 V / 50 A", "remark": "( - ) Open circuit"},
                {"tag": "# 7112", "struct": "Drumscreen B (7ID-SCN-100B)", "cap": "15 V / 50 A"},
                {"tag": "# 7113", "struct": "Drumscreen C (7ID-SCN-100C)", "cap": "15 V / 50 A", "remark": "( + ) Open circuit"},
                {"tag": "# 7114", "struct": "Fish Return (7ID-P-300AM)", "cap": "15 V / 10 A"},
                {"tag": "# 7115", "struct": "Wash Pump B (7ID-P-300BM)", "cap": "15 V / 10 A"},
                {"tag": "# 7116", "struct": "Wash Pump C (7ID-P-300CM)", "cap": "15 V / 10 A"},
                {"tag": "# 7117", "struct": "CW Pump A (7-CWP-100A)", "cap": "15 V / 10 A", "remark": "( + ) Open circuit"},
                {"tag": "# 7118", "struct": "CW Pump B (7-CWP-100B)", "cap": "15 V / 10 A"},
                {"tag": "# 7119", "struct": "CW Pump C (7-CWP-100C)", "cap": "15 V / 10 A"},
                {"tag": "# 7120", "struct": "DW Pump A (7ID-P-300A)", "cap": "15 V / 10 A", "remark": "( + ) Open circuit"},
                {"tag": "# 7121", "struct": "DW Pump B (7ID-P-300B)", "cap": "15 V / 10 A"},
            ],
        },
        {
            "label": "7EA-RECT-100B", "sublabel": "Bar Screen A–J / ROH Pump",
            "potentialRef": "Ag/AgCl",
            "truUnits": [
                {"tag": "# 7101", "struct": "Bar Screen A (7ID-SCN-200A)", "cap": "15 V / 15 A"},
                {"tag": "# 7102", "struct": "Bar Screen B (7ID-SCN-200B)", "cap": "15 V / 15 A", "remark": "( - ) Open circuit"},
                {"tag": "# 7103", "struct": "Bar Screen C (7ID-SCN-200C)", "cap": "15 V / 15 A"},
                {"tag": "# 7104", "struct": "Bar Screen D (7ID-SCN-200D)", "cap": "15 V / 15 A", "remark": "( - ) Open circuit"},
                {"tag": "# 7105", "struct": "Bar Screen E (7ID-SCN-200E)", "cap": "15 V / 15 A"},
                {"tag": "# 7106", "struct": "Bar Screen F (7ID-SCN-200F)", "cap": "15 V / 15 A", "remark": "( - ) Open circuit"},
                {"tag": "# 7107", "struct": "Bar Screen G (7ID-SCN-200G)", "cap": "15 V / 15 A"},
                {"tag": "# 7108", "struct": "Bar Screen H (7ID-SCN-200H)", "cap": "15 V / 15 A", "remark": "( - ) Open circuit"},
                {"tag": "# 7109", "struct": "Bar Screen I (7ID-SCN-200I)", "cap": "15 V / 15 A"},
                {"tag": "# 7110", "struct": "Bar Screen J (7ID-SCN-200J)", "cap": "15 V / 15 A", "remark": "( + ) Open circuit"},
                {"tag": "# 7122", "struct": "ROH Pump B (CRO-P-100B)", "cap": "15 V / 10 A", "remark": "( + ) Open circuit"},
                {"tag": "# 7123", "struct": "ROH Pump C (CRO-P-100C)", "cap": "15 V / 10 A"},
            ],
        },
    ],
}

# ── 4. 7EA-RECT-100G (ESP) — CP System Yard Piping ─────────────────────────────
CONFIGS["ICCP_Yard_Piping_7EA-RECT-100G"] = {
    "formId": "cp_rect100g", "assetTag": "7EA-RECT-100G",
    "assetName": "ICCP Yard Piping — Precipitator Control Building",
    "checksheetFile": "Cathodic Protection/ICCP_Yard_Piping_7EA-RECT-100G.html",
    "draftKey": "cp_rect100g", "formNo": "",
    "pageTitle": "ICCP Yard Piping — 7EA-RECT-100G",
    "heroTitle": "ICCP <em>YARD PIPING</em>",
    "eyebrow": "Cathodic Protection System · Yard Piping · PCB Unit 7/8",
    "heroSub": "System D 7EA-RECT-100G · System E 8EA-RECT-100E · System H 8EA-RECT-100F · Precipitator Control Building",
    "frequency": "6 MONTHLY", "potentialRef": "Cu/CuSO4", "tpLocation": True,
    "pilePotential": None,
    "systems": [
        {
            "label": "System D · 7EA-RECT-100G", "sublabel": "Precipitator Control Building — Unit 7",
            "potentialRef": "Cu/CuSO4",
            "anodeGroups": [{"g": "Yard Piping Anodes", "anodes": [
                "P1-D1", "P1-D2", "P2-D3/D4A", "P2-D3/D4B", "P2-D3/D4C", "P2-D3/D4D",
                "P3-D5", "P3-D6", "P3-D7", "P3-D8"]}],
            "potentials": [
                'TA-1 · 6" CFO 800', 'TA-1 · 16" CFP 100', 'TA-2 · 16" CFP 100', 'TA-2 · CSW 100',
                'BA-1 · 6" CFO 800', 'BA-1 · 8" CFO 510', 'BA-1 · 3" CFO 700', 'BA-1 · 16" CFP 100',
                'BD-1 · 1" CSA 570', 'BD-1 · 3" CSW 300', 'TD-1 · 3" 7SW 300', 'TE-1 · 10" CSW 200',
                'TE-1 · CFP', 'BG-1 · 10" CSW 100', 'BG-1 · 3" CSW 140', 'BG-1 · 3" CFW 100',
                'BG-1 · 3" CSW 140', 'BG-1 · 6" CFO 800', 'BF-4 · 2" 7CD 100', 'BF-4 · 2" 7CD 110',
                'BF-4 · 3" 8CD 100', 'BF-4 · 3" 8CD 110', 'BD1A (close to stack) · CSA 570',
                'BD1A (close to stack) · CSW 300', 'BD1A (close to stack) · CPD 210',
                'TD1A (close to stack) · CSA 570', 'TD1A (close to stack) · CSW 300',
                'TD1A (close to stack) · CPD 210'],
        },
        {
            "label": "System E · 8EA-RECT-100E", "sublabel": "Precipitator Control Building — Unit 8",
            "potentialRef": "Cu/CuSO4",
            "anodeGroups": [{"g": "Yard Piping Anodes", "anodes": [
                "P1-E1", "P1-E2", "P1-E2A", "P2-E3", "P2-E3A", "P2-E4", "P3-E5", "P3-E6", "P3-E6A"]}],
            "potentials": ['TF-1 (460) · CSW 100'],
        },
        {
            "label": "System H · 8EA-RECT-100F", "sublabel": "Precipitator Control Building — Unit 8",
            "potentialRef": "Cu/CuSO4",
            "anodeGroups": [{"g": "Yard Piping Anodes", "anodes": ["P1-H1"]}],
            "potentials": ['BF-3 (473) · CSW 400', 'BF-3 (474) · CFO 700', 'TF-2 (488) · 8" CD 100'],
        },
    ],
}

# ── 5. ICCP Waste Water Treatment (CEA-RECT-D) ─────────────────────────────────
CONFIGS["ICCP_Waste_Water_Treatment_CEA-RECT-D"] = {
    "formId": "cp_wwt", "assetTag": "CEA-RECT-D",
    "assetName": "ICCP Waste Water Treatment",
    "checksheetFile": "Cathodic Protection/ICCP_Waste_Water_Treatment_CEA-RECT-D.html",
    "draftKey": "cp_wwt", "formNo": "",
    "pageTitle": "ICCP Waste Water Treatment — CEA-RECT-D",
    "heroTitle": "ICCP <em>WASTE WATER</em>",
    "eyebrow": "Impressed Current Cathodic Protection · Waste Water Treatment",
    "heroSub": "CEA-RECT-D · ICCP Waste Water Treatment · Yard Piping — Anode Current & Pipe-to-Soil Potential",
    "frequency": "6 MONTHLY", "potentialRef": "Cu/CuSO4", "tpLocation": True,
    "pilePotential": None,
    "systems": [{
        "label": "System G · CEA-RECT-D", "sublabel": "Waste Water Treatment",
        "potentialRef": "Cu/CuSO4",
        "anodeGroups": [{"g": "Yard Piping Anodes", "anodes": ["P1 + G1 (combined)", "P1", "G1"]}],
        "potentials": [
            'BT2-2 · 1.5" CSW 845', 'BT2-2 · 1" CSA 558', 'BT2-2 · CSS',
            'TT2-2 · 1.5" CSW 845', 'TT2-2 · 1" CSA 558', 'TT2-2 · CSS',
            'BT2-1 · 3" CSW 820', 'BT2-1 · 6" CPD 570', 'BT2-1 · 3" CSW 820', 'BT2-1 · 4" CPW 550',
            'BT2-1 · 1" CSA 540', 'BT2-1 · 16" CPD 509', 'BT2-1 · 3" CSW 820',
            'TT2-1 · CPD 540', 'TT2-1 · CPD 570', 'TT2-1 · CPD 508',
            'BT2-3 · 8" CPD 570', 'BT2-3 · 18" CPD 508', 'BT2-3 · 8" CPD 540',
            'BT2-4 · CSA 540', 'BT2-4 · CPW 560'],
    }],
}

# ── 6. ICCP Machine Shop & Warehouse (CEA-RECT-C, System F) ────────────────────
CONFIGS["ICCP_Machine_Shop_Warehouse_CEA-RECT-C"] = {
    "formId": "cp_machineshop", "assetTag": "CEA-RECT-C",
    "assetName": "ICCP Machine Shop, Warehouse & CHCB",
    "checksheetFile": "Cathodic Protection/ICCP_Machine_Shop_Warehouse_CEA-RECT-C.html",
    "draftKey": "cp_machineshop", "formNo": "",
    "pageTitle": "ICCP Machine Shop & Warehouse — CEA-RECT-C",
    "heroTitle": "ICCP <em>MACHINE SHOP</em>",
    "eyebrow": "Impressed Current CP · Machine Shop, Warehouse & CHCB",
    "heroSub": "System F · CEA-RECT-C · Machine Shop Electrical Building — Yard Piping CP",
    "frequency": "6 MONTHLY", "potentialRef": "Cu/CuSO4", "tpLocation": True,
    "pilePotential": None,
    "systems": [{
        "label": "System F · CEA-RECT-C", "sublabel": "Machine Shop Electrical Building",
        "potentialRef": "Cu/CuSO4", "anodeStruct": True,
        "anodeGroups": [{"g": "Yard Piping Anodes — 6 m vertical, 1 × 12.5 A", "anodes": [
            {"tag": "P1 - F1", "struct": "North of Machine Shop"},
            {"tag": "P1 - F2", "struct": "North of Machine Shop"},
            {"tag": "P2 - F3", "struct": "North of Machine Shop"},
            {"tag": "P2 - F4", "struct": "North of Machine Shop"},
        ]}],
        "potentials": [
            'BL3 · 3" CSW 100', 'BL3 · 2" CMA 730', 'BL3 · 8" CFP 100', 'BL3 · 4" CPW 510',
            'TL2 · 3" CSW 100', 'TL2 · 3" CSW 100', 'TL2 · 2" CMA 730', 'TL2 · 8" CFP 100',
            'BL2 · 3" CSW 100', 'BL2 · CSA', 'BL2 · 8" CFP 100',
            'TK1A (Garage) · 8" CFP 100', 'TK1A (Garage) · 3" CSW 100', 'TK1A (Garage) · 4" CPW 610',
            'TK1 (Garage) · 8" CFP 100', 'TK1 (Garage) · 3" CSW 100',
            'TV1 (CHCB) · 8" CFP 100', 'TV1 (CHCB) · 3" CSW 100', 'TV1 (CHCB) · CSA',
            'BV1 (CHCB) · 8" CFP 100', 'BV1 (CHCB) · 3" CSW 100', 'BV1 (CHCB) · CSA',
            'TK2 (CHCB) · 3" CSW 100',
            'BL1 (CHCB) · 8" CFP 100', 'BL1 (CHCB) · 3" CSW 100',
            'TL1 (CHCB) · 8" CFP 100', 'TL1 (CHCB) · 3" CSW 100'],
    }],
}

# ── 7. Jetty Area (Six Monthly) ───────────────────────────────────────────────
CONFIGS["ICCP_Jetty_Area_Six_Monthly"] = {
    "formId": "cp_jetty", "assetTag": "JETTY-AREA-CP",
    "assetName": "Cathodic Protection — Jetty Area",
    "checksheetFile": "Cathodic Protection/ICCP_Jetty_Area_Six_Monthly.html",
    "draftKey": "cp_jetty", "formNo": "",
    "pageTitle": "Cathodic Protection Inspection — Jetty Area",
    "heroTitle": "CP <em>JETTY AREA</em>",
    "eyebrow": "Impressed Current CP · Coal Unloading Dock & Jetty · Six Monthly",
    "heroSub": "Coal Unloading Dock & Jetty · TR No.1/2/3 · Individual anode current + 6-monthly ON-OFF pile potential",
    "frequency": "6 MONTHLY", "potentialRef": "Ag/AgCl", "tpLocation": False,
    "systems": [
        {
            "label": "Transformer Rectifier No. 1 (CKT. 1)", "sublabel": "Coal Unloading Dock & Jetty",
            "potentialRef": "Ag/AgCl",
            "anodeGroups": anodes_num("CKT1", [
                ("MD 01", 5), ("DA 02", 4), ("DA 04", 4), ("DA 06", 4), ("DA 08", 4),
                ("DA 10", 4), ("DA 12", 4), ("DA 14", 4), ("DA 16", 5), ("DA 19", 5)]),
        },
        {
            "label": "Transformer Rectifier No. 2 (CKT. 2)", "sublabel": "Coal Unloading Dock & Jetty",
            "potentialRef": "Ag/AgCl",
            "anodeGroups": anodes_num("CKT2", [
                ("DA 21", 4), ("DA 23", 4), ("DA 25", 4), ("DA 27", 4), ("DA 29", 4),
                ("DA 31", 4), ("JC 10", 4), ("JC 08", 4), ("JC 06", 4), ("JC 04", 4), ("JC 02", 4)]),
        },
        {
            "label": "Transformer Rectifier No. 3 (CKT. 3)", "sublabel": "Coal Unloading Dock & Jetty",
            "potentialRef": "Ag/AgCl",
            "anodeGroups": anodes_num("CKT3", [
                ("DA 33", 5), ("DA 36", 6), ("DA 38", 4), ("DA 40", 4), ("DA 42", 4),
                ("DA 44", 4), ("DA 46", 4), ("DA 48", 4), ("DA 50", 4), ("MD 02", 4)]),
        },
    ],
    "pilePotential": {
        "title": "6-Monthly “ON-OFF” Pile Potential",
        "groups": [
            {"label": "Coal Unloading Docks & Jetty — Location on Deck", "points": [
                "MD1-MB2 W. Dolphin", "Dock 1 - DC 1", "Dock 1 - DC 10", "Dock 2 - DC 19",
                "Dock 2 - DC 20", "Dock 2 - DC 26", "Dock 2 - DC 32", "Dock 2 - DC 33",
                "Dock 3 - DC 42", "Dock 3 - DC 51", "MD2-MB1 E Dolphin", "Jetty - JA 10",
                "Jetty - JA 5", "Jetty - JA 1"]},
            {"label": "Location on Wall — East Side", "points": [
                "East 1", "East 2", "East 3", "East 4", "East 5"]},
            {"label": "Location on Wall — West Side", "points": [
                "West 1", "West 2", "West 3", "West 4", "West 5", "West 6", "West 7", "West 8"]},
        ],
    },
}

# ── 8. TP Location — Boiler Area (drawing + fill-in test points) ───────────────
CONFIGS["ICCP_TP_Location_Boiler"] = {
    "formId": "cp_tpboiler", "assetTag": "CP-TP-BOILER",
    "assetName": "Cathodic Protection — Test Point Location (Boiler)",
    "checksheetFile": "Cathodic Protection/ICCP_TP_Location_Boiler.html",
    "draftKey": "cp_tpboiler", "formNo": "",
    "pageTitle": "CP Test Point Location — Boiler Area",
    "heroTitle": "CP <em>TEST POINTS</em>",
    "eyebrow": "Cathodic Protection · Test Point Location · Boiler Area",
    "heroSub": "Boiler Area · Test point location reference drawing + pipe-to-soil potential readings",
    "frequency": "6 MONTHLY", "potentialRef": "Cu/CuSO4", "tpLocation": True,
    "pilePotential": None,
    "systems": [],
}

# ── emit ──────────────────────────────────────────────────────────────────────
for stem, cfg in CONFIGS.items():
    out = TPL.replace("__TITLE__", cfg["pageTitle"]).replace(
        "__CONFIG__", json.dumps(cfg, ensure_ascii=False, indent=2))
    path = os.path.join(HERE, stem + ".html")
    open(path, "w").write(out)
    ns = len(cfg["systems"])
    print(f"  {stem}.html  ({ns} system{'s' if ns != 1 else ''})")
print("done.")
