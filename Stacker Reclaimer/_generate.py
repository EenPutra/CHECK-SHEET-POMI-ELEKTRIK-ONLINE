#!/usr/bin/env python3
"""Generate the Stacker/Reclaimer PM check sheets from _strc_template.tpl.
Run:  python3 "Stacker Reclaimer/_generate.py"   (from repo root)

Ported from the 9 .xls files in google-apps-script/Checksheet mentah/ (all
"Motor_Stacker *"). Those 9 raw files are NOT a 1:1 map to 10 outputs here —
see CLAUDE.md's "Stacker Reclaimer/" section for the full reasoning, in short:
  - "Motor_Stacker 1.xlsx" is one giant workbook bundling 12 tabs: an OEM
    Operation & Maintenance manual (232 rows, reference only), a JP work-
    instruction sheet (reference only), two electrical-schedule excerpts of
    that same OEM manual (JP-STRC-E-6M/3M, also reference only), and 8 real
    fillable WORK COMPLETION REPORT tabs. Of those 8, "Long Travel 1/2" and
    "1 & 6 MONTHLY"/"1 & 6 MONTHLY (2)" are older/superseded duplicates of
    content that exists in its own up-to-date standalone .xls file elsewhere
    in the folder — only "BW-BC" and "FDR-CSRH" are unique to this workbook.
  - Every "motor + brake" WORK COMPLETION REPORT tab (Long Travel, Slewing,
    BW-BC, STRC-2 main, FDR-CSRH, the combined BW-BC-CR monthly one) shares
    the IDENTICAL checklist wording for its "1 Monthly", "6 Monthly", "1
    Yearly" and "Circuit Breaker / Motor Starter / Inverter" sections —
    confirmed by diffing several of these tabs cell-by-cell. Only the
    equipment-tag COLUMNS differ per file. So the item text lives ONCE here
    (ONE_MONTHLY/SIX_MONTHLY/ONE_YEARLY/BREAKER) and every config just picks
    which sections + which columns apply.
  - Safety Device / limit-switch sheets use a different, much shorter shared
    item list (SAFETY_ITEMS) repeated once per limit-switch group.
  - The Cable Reel & XFMR file additionally has its own transformer
    resistance/megger test (XFMR_ITEMS) and cable-reel 2-yearly PM
    (CABLE_REEL_ITEMS).
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
TPL = open(os.path.join(HERE, "_strc_template.tpl"), encoding="utf-8").read()


def cmp(pairs):
    """[(code, label), ...] -> compartments list."""
    return [{"code": c, "label": l} for c, l in pairs]


def value_rows(no, desc, crit, sublabels, brake_label=None, brake_na=False):
    """One 'parent' item (no/desc/crit, itself also a value row for the first
    sub-label) followed by a continuation 'value' row per remaining sub-label —
    used for the resistance (T1-T2/T1-T3/T2-T3) and megger (T1/T2/T3-GROUND)
    checks that the source spreadsheet lays out as several bare rows under one
    instruction.

    Brake columns (tag ends "-B") measure something DIFFERENT here than a
    motor winding does — confirmed from source: Long Travel's brake coil is
    measured across terminals "TB 3-5" (one reading), Slewing's across
    "TB 3-4" — never the motor's T1-T2/T1-T3/T2-T3, and never a megger
    reading at all. Two ways to express that, mutually exclusive:
      brake_label — the FIRST row's brake cell gets that as an input
        placeholder (own measurement, one reading); every continuation row's
        brake cell is 'motorOnly' (not applicable, shown as a dash).
      brake_na — EVERY row's brake cell is 'motorOnly' (this whole item
        doesn't apply to a brake column at all, e.g. the megger check).
    Neither flag set (the default, every config besides Long Travel/Slewing)
    leaves brake columns behaving exactly like motor columns, unchanged."""
    rows = []
    for i, sl in enumerate(sublabels):
        row = {"no": no if i == 0 else "", "desc": desc if i == 0 else "",
               "crit": crit if i == 0 else "", "type": "value", "sub": sl}
        if brake_na:
            row["motorOnly"] = True
        elif brake_label:
            if i == 0:
                row["brakePlaceholder"] = brake_label
            else:
                row["motorOnly"] = True
        rows.append(row)
    return rows


def value2(no, desc, crit, sublabels):
    """Like value_rows but for a non-resistance multi-line item (e.g. Breaker
    item 6's Bkr capacity/Rating Plug/OL type/OL range/OL setting) — same
    shape, kept as a separate name for readability at the call site."""
    return value_rows(no, desc, crit, sublabels)


# ── shared item catalogs (verbatim wording from the source WORK COMPLETION
#    REPORT tabs — identical across every "motor + brake" sheet) ──

# Every "motor + brake" WORK COMPLETION REPORT tab opens with this 5-row
# nameplate block (rows 8-12 in the source, right above "1 Monthly"/"6
# Monthly") before this was caught it was missing end-to-end — not in the
# on-screen form, not in the PDF, across all 8 motor+brake check sheets.
# Free-text per column (no criteria, no OK/NG) — matches every other check
# sheet in this repo's own "Basic Motor Data" convention (e.g. Motor Witness's
# S.motordata section), technician fills in from the equipment's own
# nameplate rather than a pre-filled reference value.
BASIC_MOTOR_DATA = [
    {"no": "1", "desc": "Rated Voltage", "crit": "", "type": "value"},
    {"no": "2", "desc": "Rated Power", "crit": "", "type": "value"},
    {"no": "3", "desc": "Full Load Ampere", "crit": "", "type": "value"},
    {"no": "4", "desc": "Speed", "crit": "", "type": "value"},
    {"no": "5", "desc": "Service Factor", "crit": "", "type": "value"},
]

ONE_MONTHLY = [
    {"no": "1", "desc": "Check mounting bolt and lock pin of motor support.", "crit": "No looseness\nNo dirty or corroded"},
    {"no": "2", "desc": "Check motor starter for contact resistances and power connection tightness.", "crit": "Tightness"},
    {"no": "3", "desc": "General clean up motor, fan and accessories.", "crit": "Clean"},
    {"no": "4", "desc": "Check seal of termination box.", "crit": "No sign of damage"},
]

SIX_MONTHLY = [
    {"no": "1.", "desc": "Ensure PTW already issue & equipment has isolate or safe for access.", "crit": ""},
    {"no": "2.", "desc": "Cleaning motor body, air screen & fin cooler.", "crit": "Clean"},
    {"no": "3.", "desc": "Check motor termination (termination seal, conduit, cable connection and dust).", "crit": "No looseness\nClean"},
    {"no": "4.", "desc": "Cleaning termination and re-tighten the cable connection.", "crit": "No looseness"},
    {"no": "5.", "desc": "Adding the lubricant to motor bearing.", "crit": "Use grease +/- 20gr each bearing"},
    {"no": "6.", "desc": "Cleaning old grease & dust at the shaft bearing.", "crit": "Clean"},
    {"no": "7.", "desc": "Put back all part to normal condition.", "crit": ""},
    {"no": "8.", "desc": "Record the PM result into maximo database.", "crit": ""},
    {"no": "9.", "desc": "Inform to supervisor & raise new WO if any defect found.", "crit": ""},
]

def one_yearly_items(brake_label=None):
    """The shared "1 Yearly" section. Pass `brake_label` (e.g. "TB 3 - 5") for
    a config whose source confirms a brake-specific resistance test point —
    only Long Travel ("TB 3 - 5") and Slewing ("TB 3 - 4") do, per the source
    workbook; every other config calls this with no argument, which leaves
    brake columns identical to motor columns (unchanged from before)."""
    return (
        [{"no": "1.", "desc": "Perform all activities PM in 6 monthly periods.", "crit": ""}]
        + value_rows("2.", "Check resistance of motor winding & temperature sensor if any.",
                     "Measured resistance within 5% of each other", ["T1 - T2", "T1 - T3", "T2 - T3"],
                     brake_label=brake_label)
        + value_rows("3.", "Check the motor winding each phase (use megger).",
                     "Min. insulation resistance not less than 1.5 megaohm", ["T1/T2/T3 - GROUND"],
                     brake_na=bool(brake_label))
        + [
            {"no": "4.", "desc": "Check motor termination, retighten cable connection & check seal bearing.", "crit": "No looseness\nClean\nNo leak"},
            {"no": "5.", "desc": "Replace old grease with new one (open the drain plug, inject grease until old grease comes out).", "crit": ""},
            {"no": "6.", "desc": "Check motor support bolt, retighten if necessary, may any corrosion, etc.", "crit": "No looseness\nNo dirty or corroded"},
            {"no": "7.", "desc": "Perform housekeeping after the job complete (make sure equipment has ready).", "crit": ""},
            {"no": "8.", "desc": "Monitor the motor during running test.", "crit": ""},
        ]
    )


ONE_YEARLY = one_yearly_items()

BREAKER = (
    [
        {"no": "1", "desc": "Visually inspect panel for any obvious signs of damage", "crit": "No sign of damage"},
        {"no": "2", "desc": "Remove accumulated dust and dirt using a soft brush or vacuum cleaner", "crit": "No dust or dirty"},
        {"no": "3", "desc": "Inspect all wiring checking for any deterioration in the insulation and tighten all connections.", "crit": "No deterioration in insulation\nTightness"},
    ]
    + value2("4", "Disconnect the coil of motor contactor and check the contact of contactors — dress the "
                  "contact faces with a fine file if beads formed (never sandpaper/emery cloth, never oil the power unit).",
             "", ["Dressing the contact", "Replace the contact"])
    + [{"no": "5", "desc": "Operate each magnetic device by hand to ensure that moving parts operate freely.", "crit": "Moving parts operate freely"}]
    + value2("6", "Check motor overload setting and compare with motor full load amps.", "",
             ["Bkr capacity", "Rating Plug", "OL type", "OL range", "OL setting"])
    + [{"no": "7", "desc": "Check all indicating lights and replace as required", "crit": ""}]
)

CABLE_REEL_2Y = (
    [
        {"no": "1.", "desc": "Make sure PTW already issue & equipment have safe to access.", "crit": ""},
        {"no": "2.", "desc": "Perform PM activities of 6 & 12 monthly periods.", "crit": ""},
        {"no": "3.", "desc": "Open cable reel cover & cleaning inside.", "crit": "No sign of damage\nNo dust or dirty"},
        {"no": "4.", "desc": "Retighten of cable termination.", "crit": "No looseness"},
    ]
    # Explicit user addition, not in the source workbook (the source's own
    # Cable Reel section never measures the reel's drive motor electrically)
    # — same wording/criteria as the standard motor 1-Yearly resistance/megger
    # check used everywhere else in this template family, applied here too
    # since the cable reel has its own small drive motor like any other.
    + value_rows("5.", "Check resistance of motor winding.",
                 "Measured resistance within 5% of each other", ["T1 - T2", "T1 - T3", "T2 - T3"])
    + value_rows("6.", "Check the motor winding each phase (use megger).",
                 "Min. insulation resistance not less than 1.5 megaohm", ["T1/T2/T3 - GROUND"])
    + [
        {"no": "7.", "desc": "Brush cleaning, slip ring inspection (replace part if already worn out).", "crit": "No sign of damage\nNo dust or dirty"},
        {"no": "8.", "desc": "Details instruction see JP attachment.", "crit": ""},
        {"no": "9.", "desc": "Inform to supervisor if any defect found & raise new WO for history record.", "crit": ""},
    ]
)

XFMR_ITEMS = (
    [
        {"no": "1.", "desc": "Open cover, cleaning and inspect inside transformer", "crit": "No sign of damage\nNo dust or dirty"},
        {"no": "2.", "desc": "Check cable termination (termination seal, conduit, cable connection and dust).", "crit": "No looseness\nClean"},
    ]
    + [{"no": "3.", "desc": "Measure resistance of HV & LV winding", "crit": "Within 5% of each other", "type": "value"}]
    + [{"no": "4.", "desc": "Measure insulation resistance of HV & LV winding by megger 500 Vdc", "crit": "Not less than 1.5 megaohm", "type": "value"}]
)

SAFETY_ITEMS = [
    {"no": "1", "desc": "Cleaning termination box or local panel", "crit": "Clean"},
    {"no": "2", "desc": "Check cable termination (termination seal, conduit, cable connection and dust).", "crit": "No looseness\nClean"},
    {"no": "3", "desc": "Retighten of cable termination.", "crit": "No looseness"},
    {"no": "4", "desc": "Function test limit switch", "crit": ""},
]


def motor_sections(cols, one_monthly=False, brake_label=None):
    """The 4 standard sections (optionally starting with '1 Monthly') applied
    to `cols` — this is the shared shape behind Long Travel / Slewing / BW-BC /
    STRC-2 main / FDR-CSRH / the combined BW-BC-CR monthly sheet.
    `brake_label` — see one_yearly_items()."""
    secs = [
        {"key": "s0", "icon": "\U0001F3F7", "title": "Basic Motor Data", "kind": "matrix", "items": BASIC_MOTOR_DATA},
    ]
    if one_monthly:
        secs.append({"key": "s1m", "icon": "\U0001F527", "title": "1 Monthly - General PM of Electric Motor", "kind": "matrix", "items": ONE_MONTHLY})
    secs += [
        {"key": "s6m", "icon": "\U0001F9F4", "title": "6 Monthly - Electric Motor PM & Lubrication", "kind": "matrix",
         "note": "Grease specification: Shell Alvania EP2 or Almagard NLGI 02 (inject with grease gun).", "items": SIX_MONTHLY},
        {"key": "s1y", "icon": "\U0001F6E2", "title": "1 Yearly - Electric Motor PM & Bearing Lubrication", "kind": "matrix",
         "items": one_yearly_items(brake_label) if brake_label else ONE_YEARLY},
        {"key": "sbk", "icon": "⚡", "title": "Circuit Breaker and Motor Starter or Inverter", "kind": "matrix", "items": BREAKER},
    ]
    return secs


CONFIGS = {}

# ── 1. STRC-1 Long Travel (40 wheel positions, Long Travel 1 + 2 combined) ──
LT1 = cmp([(f"CCH-STRC-110A{n}-{s}", f"{'Motor' if s=='M' else 'Brake'} — Wheel #{n}")
           for n in range(1, 21) for s in ("M", "B")])
CONFIGS["STRC1_Long_Travel"] = {
    "formId": "strc1_lt", "assetTag": "STRC1-LONG-TRAVEL", "assetName": "Stacker Reclaimer 1 — Long Travel Wheels",
    "checksheetFile": "Stacker Reclaimer/STRC1_Long_Travel.html", "draftKey": "strc1_lt",
    "pageTitle": "STRC 1 Long Travel", "heroTitle": "STRC <em>1 &middot; Long Travel</em>",
    "eyebrow": "Stacker Reclaimer 1 · Long Travel Wheels", "frequency": "6 MONTHLY",
    "heroSub": "STRC-1 · 20 Gantry Travel wheel positions (Motor + Brake each) — Long Travel Wheels #1-#20",
    "assetLabel": "Stacker Reclaimer 1 · Long Travel Wheels #1-#20", "compartments": LT1,
    # confirmed from source: the brake coil's own resistance is measured across
    # terminals "TB 3-5" (one reading), never the motor's T1-T2/T1-T3/T2-T3.
    "sections": motor_sections(LT1, brake_label="TB 3 - 5"),
}

# ── 2. STRC-1 Slewing (3 wheel positions) ──
SLEW1 = cmp([(f"CCH-STRC-120A{n}-{s}", f"{'Motor' if s=='M' else 'Brake'} for Boom Slewing #{n}")
             for n in range(1, 4) for s in ("M", "B")])
CONFIGS["STRC1_Slewing"] = {
    "formId": "strc1_slew", "assetTag": "STRC1-SLEWING", "assetName": "Stacker Reclaimer 1 — Slewing",
    "checksheetFile": "Stacker Reclaimer/STRC1_Slewing.html", "draftKey": "strc1_slew",
    "pageTitle": "STRC 1 Slewing", "heroTitle": "STRC <em>1 &middot; Slewing</em>",
    "eyebrow": "Stacker Reclaimer 1 · Slewing", "frequency": "6 MONTHLY",
    "heroSub": "STRC-1 · Boom Slewing motor + disc brake #1-#3",
    "assetLabel": "Stacker Reclaimer 1 · Boom Slewing #1-#3", "compartments": SLEW1,
    # confirmed from source: the brake coil's own resistance is measured across
    # terminals "TB 3-4" here (Long Travel's brake uses "TB 3-5" instead).
    "sections": motor_sections(SLEW1, brake_label="TB 3 - 4"),
}

# ── 3. STRC-1 Bucket Wheel + Boom Conveyor ──
BWBC1 = cmp([
    ("CCH-STRC-100A-M", "Motor for Boom Bucket Wheel"), ("CCH-STRC-100A-B", "Disc Brake for Boom Bucket Wheel"),
    ("CCH-STRC-310A-M", "Motor for Boom Conveyor"), ("CCH-STRC-310A-B", "Disc Brake for Boom Conveyor"),
])
CONFIGS["STRC1_BW_BC"] = {
    "formId": "strc1_bwbc", "assetTag": "STRC1-BW-BC", "assetName": "Stacker Reclaimer 1 — Bucket Wheel & Boom Conveyor",
    "checksheetFile": "Stacker Reclaimer/STRC1_BW_BC.html", "draftKey": "strc1_bwbc",
    "pageTitle": "STRC 1 Bucket Wheel & Boom Conveyor", "heroTitle": "STRC <em>1 &middot; BW / BC</em>",
    "eyebrow": "Stacker Reclaimer 1 · Bucket Wheel & Boom Conveyor", "frequency": "6 MONTHLY",
    "heroSub": "STRC-1 · Bucket Wheel motor/brake + Boom Conveyor motor/brake",
    "assetLabel": "Stacker Reclaimer 1 · Bucket Wheel & Boom Conveyor", "compartments": BWBC1,
    "sections": motor_sections(BWBC1),
}

# ── 4. STRC-1 Feeder Crusher 2 (motor + isolation XFMR + local panel) ──
FDR = cmp([
    ("CCH-FDR-300B-M", "Belt Feeder Crusher 2 Motor"), ("XFMR-320B", "Isolation Transformer Feeder Crusher 2"),
    ("CCH-CAB-320A", "Local Control Panel"),
])
CONFIGS["STRC1_FDR_CSRH"] = {
    "formId": "strc1_fdr", "assetTag": "STRC1-FDR-CSRH", "assetName": "Feeder Crusher 2 (Stacker Reclaimer 1 area)",
    "checksheetFile": "Stacker Reclaimer/STRC1_FDR_CSRH.html", "draftKey": "strc1_fdr",
    "pageTitle": "Feeder Crusher 2 (FDR-CSRH)", "heroTitle": "STRC <em>FDR-CSRH</em>",
    "eyebrow": "Feeder Crusher 2 · Belt Feeder + Isolation XFMR + Local Panel", "frequency": "6 MONTHLY",
    "heroSub": "Belt Feeder Crusher 2 motor, isolation transformer & local control panel",
    "assetLabel": "Feeder Crusher 2 — Belt Feeder / Isolation XFMR / Local Panel", "compartments": FDR,
    "sections": motor_sections(FDR, one_monthly=True),
}

# ── 4b. STRC-1 Main (Slewing/Luffing/Bucket Wheel/Boom Conveyor/Cable Reel/Rail Clamp) ──
# From the "STRC-1" tab in Motor_Stacker 1.xlsx, which — like STRC-2's own
# "STRC-2" tab — combines every major moving subsystem OTHER than Long Travel
# Wheels into one sheet. Long Travel is deliberately excluded here per
# explicit user request (already covered by STRC1_Long_Travel.html) — the
# rest of that tab (this asset group, plus a Transformer 40 kVA + Cable Reel
# 2-yearly block identical in shape to STRC2_Cable_Reel_XFMR.html, which is
# why that file's title reads "Stacker Reclaimer 1/2") is genuinely unbuilt.
STRC1_MAIN = cmp([
    ("CCH-STRC-120A1-M", "Motor for Boom Slewing #1"), ("CCH-STRC-120A2-M", "Motor for Boom Slewing #2"),
    ("CCH-STRC-120A3-M", "Motor for Boom Slewing #3"),
    ("CCH-STRC-120A1-B", "Disc Brake for Boom Slewing #1"), ("CCH-STRC-120A2-B", "Disc Brake for Boom Slewing #2"),
    ("CCH-STRC-120A3-B", "Disc Brake for Boom Slewing #3"),
    ("CCH-STRC-130A-M", "Motor for Boom Luffing"), ("CCH-STRC-130A-B", "Disc Brake for Boom Luffing"),
    ("CCH-STRC-100A-M", "Motor for Boom Bucket Wheel"), ("CCH-STRC-100A-B", "Disc Brake for Boom Bucket Wheel"),
    ("CCH-STRC-310A-M", "Motor for Boom Conveyor"), ("CCH-STRC-310A-B", "Disc Brake for Boom Conveyor"),
    ("CCH-STRC-100A1-M", "Cable Reel for Power"), ("CCH-STRC-100A2-M", "Cable Reel for Control"),
    ("CCH-STRC-100A3-M", "Rail Clamp 1"), ("CCH-STRC-100A4-M", "Rail Clamp 2"),
])
CONFIGS["STRC1_Main"] = {
    "formId": "strc1_main", "assetTag": "STRC1-MAIN", "assetName": "Stacker Reclaimer 1 — Main PM (Slewing/Luffing/BW/BC/Cable Reel/Rail Clamp)",
    "checksheetFile": "Stacker Reclaimer/STRC1_Main.html", "draftKey": "strc1_main",
    "pageTitle": "STRC 1 Main PM", "heroTitle": "STRC <em>1 &middot; Main</em>",
    "eyebrow": "Stacker Reclaimer 1 · Slewing / Luffing / Bucket Wheel / Boom Conveyor / Cable Reel / Rail Clamp",
    "frequency": "6 MONTHLY",
    "heroSub": "STRC-1 · 16 motor/brake positions across every major moving subsystem (excl. Long Travel — see its own check sheet)",
    "assetLabel": "Stacker Reclaimer 1 · Main periodic PM (16 positions)", "compartments": STRC1_MAIN,
    "sections": motor_sections(STRC1_MAIN),
}

# ── 5. STRC-2 main (Slewing/Luffing/Bucket Wheel/Boom Conveyor/Cable Reel/Rail Clamp/Power Cylinders) ──
STRC2_MAIN = cmp([
    ("CCH-STRC-1201B1-M", "Motor for Boom Slewing #1"), ("CCH-STRC-1201B2-M", "Motor for Boom Slewing #2"),
    ("CCH-STRC-1201B1-B", "Disc Brake for Boom Slewing #1"), ("CCH-STRC-1201B2-B", "Disc Brake for Boom Slewing #2"),
    ("CCH-STRC-130B-M", "Motor for Boom Luffing"), ("CCH-STRC-130B-B", "Disc Brake for Boom Luffing"),
    ("CCH-STRC-100B-M", "Motor for Boom Bucket Wheel"),
    ("CCH-STRC-510B-M", "Motor for Boom Conveyor"), ("CCH-STRC-510B-B", "Disc Brake for Boom Conveyor"),
    ("CCH-STRC-100B1-M", "Cable Reel for Power"), ("CCH-STRC-100B2-M", "Cable Reel for Control"),
    ("CCH-STRC-100B3-M", "Rail Clamp 1"), ("CCH-STRC-100B4-M", "Rail Clamp 2"),
    ("CCH-STRC-100B6-M", "Power Cylinder for Skirt"), ("CCH-GATE-545-M", "Power Cylinder for Splitter Gate"),
    ("CCH-STRC-100B5-M", "Power Cylinder for Slewing Chute"),
])
CONFIGS["STRC2_Main"] = {
    "formId": "strc2_main", "assetTag": "STRC2-MAIN", "assetName": "Stacker Reclaimer 2 — Main PM (Slewing/Luffing/BW/BC/Cable Reel/Rail Clamp/Cylinders)",
    "checksheetFile": "Stacker Reclaimer/STRC2_Main.html", "draftKey": "strc2_main",
    "pageTitle": "STRC 2 Main PM", "heroTitle": "STRC <em>2 &middot; Main</em>",
    "eyebrow": "Stacker Reclaimer 2 · Slewing / Luffing / Bucket Wheel / Boom Conveyor / Cable Reel / Rail Clamp / Power Cylinders",
    "frequency": "6 MONTHLY",
    "heroSub": "STRC-2 · 16 motor/brake/cylinder positions across every major moving subsystem",
    "assetLabel": "Stacker Reclaimer 2 · Main periodic PM (16 positions)", "compartments": STRC2_MAIN,
    "sections": motor_sections(STRC2_MAIN),
}

# ── 6. STRC-2 Cable Reel & Transformer ──
XFMR_COLS = cmp([
    ("H1-H2", "H1 - H2"), ("H2-H3", "H2 - H3"), ("H3-H1", "H3 - H1"),
    ("X1-X2", "X1 - X2"), ("X2-X3", "X2 - X3"), ("X3-X1", "X3 - X1"),
    ("H-GND", "H1/H2/H3 to GROUND"), ("X-GND", "X1/X2/X3 to GROUND"),
])
CABLE_REEL_COLS = cmp([("CCH-STRC-100B2-M", "Cable Reel Control"), ("CCH-STRC-100B1-M", "Cable Reel Power")])
CONFIGS["STRC2_Cable_Reel_XFMR"] = {
    "formId": "strc2_cr_xfmr", "assetTag": "STRC2-CR-XFMR", "assetName": "Stacker Reclaimer 1/2 — Cable Reel & Transformer 40 kVA / 6.9 kV / 416 V",
    "checksheetFile": "Stacker Reclaimer/STRC2_Cable_Reel_XFMR.html", "draftKey": "strc2_cr_xfmr",
    "pageTitle": "STRC 1/2 Cable Reel & XFMR", "heroTitle": "STRC <em>1/2 &middot; Cable Reel / XFMR</em>",
    "eyebrow": "Stacker Reclaimer 1/2 · Cable Reel & 40 kVA Transformer", "frequency": "YEARLY",
    "heroSub": "Transformer 40 kVA / 6.9 kV / 416 V resistance + megger, and Cable Reel 2-yearly PM",
    "assetLabel": "Stacker Reclaimer 1/2 · Cable Reel & Transformer 40 kVA / 6.9 kV / 416 V",
    # each section below carries its OWN columns (XFMR test points vs cable reel
    # motors) — no single top-level compartment legend fits both, so leave it empty.
    "compartments": [],
    "sections": [
        {"key": "xfmr", "icon": "Ω", "title": "Transformer 40 kVA / 6.9 kV / 416 V", "kind": "matrix",
         "columns": XFMR_COLS, "items": XFMR_ITEMS},
        {"key": "cr2y", "icon": "\U0001F50C", "title": "JP-DMH-CR-2Y — Cable Reel Cleaning, Termination & Brush Inspection (2 Yearly)",
         "kind": "matrix", "columns": CABLE_REEL_COLS, "items": CABLE_REEL_2Y},
    ],
}

# ── 7. STRC-2 Long Travel (8 wheel positions) ──
LT2 = cmp([(f"CCH-STRC-110B{n}-{s}", f"{'Motor' if s=='M' else 'Brake'} — Wheel #{n}")
           for n in range(1, 9) for s in ("M", "B")])
CONFIGS["STRC2_Long_Travel"] = {
    "formId": "strc2_lt", "assetTag": "STRC2-LONG-TRAVEL", "assetName": "Stacker Reclaimer 2 — Long Travel Wheels",
    "checksheetFile": "Stacker Reclaimer/STRC2_Long_Travel.html", "draftKey": "strc2_lt",
    "pageTitle": "STRC 2 Long Travel", "heroTitle": "STRC <em>2 &middot; Long Travel</em>",
    "eyebrow": "Stacker Reclaimer 2 · Long Travel Wheels", "frequency": "6 MONTHLY",
    "heroSub": "STRC-2 · 8 Gantry Travel wheel positions (Motor + Brake each) — Long Travel Wheels #1-#8",
    "assetLabel": "Stacker Reclaimer 2 · Long Travel Wheels #1-#8", "compartments": LT2,
    "sections": motor_sections(LT2),
}

# ── 8. STRC-2 Safety Devices & Limit Switches (4 groups, shared 4-item checklist) ──
SAFE_TRAVELLING = cmp([
    ("CCH-ZSHH-551", "Limit Switch Forward Overtravel"), ("CCH-ZSH-551", "Limit Switch Forward Deceleration"),
    ("CCH-ZSHH-552", "Limit Switch Reverse Overtravel"), ("CCH-ZSH-552", "Limit Switch Reverse Deceleration"),
    ("CCH-YS-551", "Limit Switch for Anchor Reset"), ("CCH-YS-552", "Limit Switch for Anchor Reset"),
    ("Built-in rail clamp", "Limit Switch for Rail Clamp"), ("(rail clamp 2)", "Limit Switch for Rail Clamp"),
    ("CCH-ZS-551", "Proximity Switch for Position Preset"), ("CCH-ZT-551", "Encoder for Travelling"),
    ("CCH-ZSH-571", "Limit Switch for Right Over Slewing"), ("CCH-ZSH-572", "Limit Switch for Left Over Slewing"),
    ("CCH-ZT-572", "Encoder for Slewing"),
    ("CCH-YSH-581", "Limit Switch for Boom Pile Collision"), ("CCH-YSH-582", "Limit Switch for Boom Pile Collision"),
])
SAFE_LUFFING = cmp([
    ("CCH-ZSH-561", "Limit Switch for Upper End"), ("CCH-ZSH-562", "Limit Switch for Lower End"),
    ("CCH-YS-584", "Limit Switch for Reclaiming Position"), ("CCH-ZT-561", "Encoder for Luffing Position"),
    ("CCH-ZS-593", "L.S for Control Cable Reel"), ("CCH-ZS-594", "L.S for Control Cable Reel"), ("CCH-ZS-595", "L.S for Control Cable Reel"),
    ("CCH-ZSL-596", "L.S for Power Cable Reel"), ("CCH-ZSL-597", "L.S for Power Cable Reel"), ("CCH-ZSL-598", "L.S for Power Cable Reel"),
    ("CCH-ZSC-541", "Limit Switch for Direct Position"), ("CCH-ZSO-541", "Limit Switch for Stacking Position"),
    ("CCH-ZSO-542", "Limit Switch for Position"), ("CCH-ZSC-542", "Limit Switch for Position"), ("CCH-ZT-541", "Potential Meter"),
])
SAFE_CONVEYOR = cmp([
    ("CCH-HS-541", "Pull Cord Switch"), ("CCH-HS-542", "Pull Cord Switch"),
    ("CCH-ZSH/ZSHH-541", "Belt Alignment Switch"), ("CCH-ZSH/ZSHH-542", "Belt Alignment Switch"),
    ("CCH-ZSH/ZSHH-543", "Belt Alignment Switch"), ("CCH-ZSH/ZSHH-544", "Belt Alignment Switch"),
    ("CCH-SSH-541", "Belt Slip Detector"), ("CCH-YSH-541", "Chute Plug Switch"),
    ("CCH-HS-519", "Pull Cord Switch"), ("CCH-HS-520", "Pull Cord Switch"),
    ("CCH-ZSL-507", "Belt Alignment Switch"), ("CCH-ZSH-508", "Belt Alignment Switch"),
    ("CCH-YSH-542", "Chute Plug Switch"),
    ("CCH-ZSH-581", "L.S for Reclaiming Pos. (Upper End)"), ("CCH-ZSL-581", "L.S for Stacking Pos. (Lower End)"),
])
SAFE_SKIRT = cmp([
    ("CCH-ZSH-582", "L.S for Stacking Pos. (Upper End)"), ("CCH-ZSL-582", "L.S for Reclaiming Pos. (Lower End)"),
    ("CCH-HS-591", "Emergency Push Button Box (Indoor Use)"), ("CCH-HS-592", "Emergency Push Button Box (Indoor Use)"),
    ("CCH-HS-551", "Emergency Push Button Box (Outside Use)"), ("CCH-HS-552", "Emergency Push Button Box (Outside Use)"),
    ("CABIN", "Emergency Push Button on the Counter Desk"),
])
CONFIGS["STRC2_Safety_Device"] = {
    "formId": "strc2_safety", "assetTag": "STRC2-SAFETY-DEVICE", "assetName": "Stacker Reclaimer 2 — Safety Devices & Limit Switches",
    "checksheetFile": "Stacker Reclaimer/STRC2_Safety_Device.html", "draftKey": "strc2_safety",
    "pageTitle": "STRC 2 Safety Devices", "heroTitle": "STRC <em>2 &middot; Safety Devices</em>",
    "eyebrow": "Stacker Reclaimer 2 · Safety Devices & Limit Switches (ref. drawing E06431)", "frequency": "6 MONTHLY",
    "heroSub": "Travelling / Luffing / Boom Conveyor / Skirt & Cabin limit switches, proximity switches & encoders",
    "assetLabel": "Stacker Reclaimer 2 · Safety Devices & Limit Switches",
    # 4 groups below each carry their OWN limit-switch columns — no single
    # top-level compartment legend fits all 4, so leave it empty.
    "compartments": [],
    "sections": [
        {"key": "trav", "icon": "\U0001F6A6", "title": "Travelling", "kind": "matrix", "columns": SAFE_TRAVELLING, "items": SAFETY_ITEMS},
        {"key": "luff", "icon": "\U0001F4D0", "title": "Luffing / Cable Reel / Splitter Gate", "kind": "matrix", "columns": SAFE_LUFFING, "items": SAFETY_ITEMS},
        {"key": "conv", "icon": "⛓️", "title": "Boom Conveyor / Tripper Conveyor / Slewing Chute", "kind": "matrix", "columns": SAFE_CONVEYOR, "items": SAFETY_ITEMS},
        {"key": "skirt", "icon": "\U0001F6D1", "title": "Skirt / Common / Cabin", "kind": "matrix", "columns": SAFE_SKIRT, "items": SAFETY_ITEMS},
    ],
}

# ── 9. STRC-2 Slewing / Luffing (focused variant, no Bucket Wheel/Conveyor/Cable Reel) ──
SLEWLUFF2 = cmp([
    ("CCH-STRC-120B1-M", "Motor for Boom Slewing #1"), ("CCH-STRC-120B2-M", "Motor for Boom Slewing #2"),
    ("CCH-STRC-120B1-B", "Disc Brake for Boom Slewing #1"), ("CCH-STRC-120B2-B", "Disc Brake for Boom Slewing #2"),
    ("CCH-STRC-130B-M", "Motor for Boom Luffing"), ("CCH-STRC-130B-B", "Disc Brake for Boom Luffing"),
])
CONFIGS["STRC2_Slewing_Luffing"] = {
    "formId": "strc2_slewluff", "assetTag": "STRC2-SLEWING-LUFFING", "assetName": "Stacker Reclaimer 2 — Slewing & Luffing",
    "checksheetFile": "Stacker Reclaimer/STRC2_Slewing_Luffing.html", "draftKey": "strc2_slewluff",
    "pageTitle": "STRC 2 Slewing & Luffing", "heroTitle": "STRC <em>2 &middot; Slewing / Luffing</em>",
    "eyebrow": "Stacker Reclaimer 2 · Slewing & Luffing", "frequency": "6 MONTHLY",
    "heroSub": "STRC-2 · Boom Slewing (x2) + Boom Luffing motor/brake",
    "assetLabel": "Stacker Reclaimer 2 · Slewing & Luffing", "compartments": SLEWLUFF2,
    "sections": motor_sections(SLEWLUFF2),
}

# ── 10. Combined Bucket Wheel + Boom Conveyor + Cable Reel monthly (both stackers) ──
BWBCCR = cmp([
    ("CCH-STRC-100A-M", "Motor for Boom Bucket Wheel STRC 1"), ("CCH-STRC-100B-M", "Motor for Boom Bucket Wheel STRC 2"),
    ("CCH-CNVR-310-M", "S/R 1 Boom Conveyor Motor"), ("CCH-CNVR-510-M", "S/R 2 Boom Conveyor Motor"),
    ("CCH-STRC-100A1-M", "S/R 1 Power Cable Reel Motor Drive"), ("CCH-STRC-100A2-M", "S/R 1 Control Cable Reel Motor Drive"),
])
CONFIGS["STRC_BW_BC_CR_Monthly"] = {
    "formId": "strc_bwbccr", "assetTag": "STRC-BW-BC-CR", "assetName": "Stacker Reclaimer 1 & 2 — Bucket Wheel, Boom Conveyor & Cable Reel (Combined 1&6 Monthly)",
    "checksheetFile": "Stacker Reclaimer/STRC_BW_BC_CR_Monthly.html", "draftKey": "strc_bwbccr",
    "pageTitle": "STRC 1&2 BW-BC-CR Monthly", "heroTitle": "STRC <em>1&amp;2 &middot; BW-BC-CR</em>",
    "eyebrow": "Stacker Reclaimer 1 & 2 · Combined Bucket Wheel / Boom Conveyor / Cable Reel — 1 & 6 Monthly", "frequency": "6 MONTHLY",
    "heroSub": "Bucket Wheel (STRC 1 & 2) + S/R Boom Conveyor (1 & 2) + S/R 1 Power/Control Cable Reel motors",
    "assetLabel": "Stacker Reclaimer 1 & 2 · Bucket Wheel / Boom Conveyor / Cable Reel (combined monthly round)",
    "compartments": BWBCCR,
    "sections": motor_sections(BWBCCR, one_monthly=True),
}

# ── emit ─────────────────────────────────────────────────────────────────────
for stem, cfg in CONFIGS.items():
    out = TPL.replace("__TITLE__", cfg["pageTitle"]).replace(
        "__CONFIG__", json.dumps(cfg, ensure_ascii=False, indent=2))
    open(os.path.join(HERE, stem + ".html"), "w", encoding="utf-8").write(out)
    print(f"  {stem}.html  ({len(cfg['compartments'])} compartments, {len(cfg['sections'])} sections)")
print("done.")
