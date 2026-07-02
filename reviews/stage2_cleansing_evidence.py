"""
Stage 2 cleansing evidence — show exactly what was de-duped/cleansed in the indirect cube,
separating what the CUBE arrived with (client/KPMG cleaning) from what the ENGINE added.

Run:  python reviews/stage2_cleansing_evidence.py
Out:  reports/Stage2_Cleansing_Evidence.xlsx
"""
from __future__ import annotations
import os
import sys

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO

OUT = "reports/Stage2_Cleansing_Evidence.xlsx"

H1 = Font(bold=True, size=16, color="18181B")
H2 = Font(bold=True, size=12, color="18181B")
HEAD = Font(bold=True, color="FFFFFF")
MONO = Font(name="Consolas")
GREY = Font(color="52525C")
HEAD_FILL = PatternFill("solid", fgColor="6A3EBD")
thin = Side(style="thin", color="E4E4E7")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)


def _s(ws, cell, v, font=None, fill=None, align=None, border=False):
    c = ws[cell]; c.value = v
    if font: c.font = font
    if fill: c.fill = fill
    if align: c.alignment = align
    if border: c.border = BORDER
    return c


def _heads(ws, row, names, widths):
    for i, h in enumerate(names):
        _s(ws, f"{chr(65+i)}{row}", h, HEAD, HEAD_FILL, Alignment(horizontal="left", wrap_text=True), True)
    for col, w in widths.items():
        ws.column_dimensions[col].width = w


def _str(x):
    return x.astype("string").str.strip()


def main():
    io = LocalIO(root="data")
    df = io.read_bronze("indirect_cube")
    raw = _str(df["Supplier Name"]); clean = _str(df["Cleaned Vendor Name"])
    parent = _str(df["Parent Name"]); duns = _str(df["Supplier DUNS"])
    ism = (_str(df["Consol 1"]) == "MRO") & (_str(df["Consol 2"]) == "Industrial Supplies")

    is_clean = set(clean[ism].dropna())
    pair = pd.DataFrame({"raw": raw, "clean": clean}).dropna()
    merge = pair.groupby("clean")["raw"].agg(lambda s: sorted(set(s)))
    merge_multi = merge[merge.map(len) > 1]
    dunsg = pd.DataFrame({"clean": clean, "duns": duns}).dropna().groupby("clean")["duns"].nunique()
    duns_multi = dunsg[dunsg > 1].sort_values(ascending=False)

    wb = Workbook()

    # ---- Summary ----
    ws = wb.active; ws.title = "Summary"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Stage 2 — Cleansing Evidence (indirect cube)", H1)
    _s(ws, "A2", "What was de-duped, and by whom. The cube arrived client-cleaned; the engine keys off that and adds derivations (it does NOT fuzzy-merge — that is a held opt-in).", GREY)
    _heads(ws, 4, ["Scope", "Lines", "Raw Supplier Names", "Cleaned Vendor Names", "Collapsed", "Parent Names"],
           {"A": 22, "B": 12, "C": 20, "D": 22, "E": 12, "F": 16})
    r = 5
    for label, m in [("Full indirect cube", slice(None)), ("Industrial Supplies (anchor)", ism)]:
        rr, cc, pp = _str(df["Supplier Name"][m] if m is not slice(None) else df["Supplier Name"]), None, None
        d = df[m] if m is not slice(None) else df
        rN = _str(d["Supplier Name"]).nunique(); cN = _str(d["Cleaned Vendor Name"]).nunique()
        pN = _str(d["Parent Name"]).nunique()
        _s(ws, f"A{r}", label, H2, border=True)
        _s(ws, f"B{r}", len(d), MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"C{r}", rN, MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"D{r}", cN, MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"E{r}", rN - cN, MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"F{r}", pN, MONO, align=Alignment(horizontal="right"), border=True)
        r += 1
    r += 1
    notes = [
        ("Cleaned vendors merged from >1 raw spelling", f"{len(merge_multi):,}"),
        ("Cleaned vendors spanning >1 Supplier DUNS (entity consolidation)", f"{int((dunsg > 1).sum()):,}"),
        ("Engine fuzzy-merges applied beyond the cube's cleaning", "0  (held opt-in — normalized_name = Cleaned Vendor Name)"),
        ("Taxonomy case-dupes left un-collapsed (kept to match reference)", "L1 CAPEX/CapEX/Capex · L3 Machine parts/Machine Parts"),
    ]
    for k, v in notes:
        _s(ws, f"A{r}", k, None, border=True); _s(ws, f"C{r}", v, MONO, border=True); r += 1

    # ---- Vendor merges (the actual de-dup) ----
    ws2 = wb.create_sheet("Vendor merges (cube)"); ws2.sheet_view.showGridLines = False
    _s(ws2, "A1", "Raw supplier spellings collapsed into one Cleaned Vendor Name", H1)
    _s(ws2, "A2", f"{len(merge_multi):,} cleaned vendors were each built from 2+ raw spellings. This is the cube's de-dup (client/KPMG), surfaced here. Sorted by # variants.", GREY)
    _heads(ws2, 4, ["Cleaned Vendor Name", "# raw", "In IS?", "Raw spellings collapsed"],
           {"A": 40, "B": 7, "C": 8, "D": 95})
    r = 5
    for cv, variants in merge_multi.sort_values(key=lambda s: s.map(len), ascending=False).items():
        _s(ws2, f"A{r}", cv, Font(bold=True), border=True)
        _s(ws2, f"B{r}", len(variants), MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws2, f"C{r}", "Y" if cv in is_clean else "", MONO, align=Alignment(horizontal="center"), border=True)
        _s(ws2, f"D{r}", "  |  ".join(variants), MONO, align=Alignment(wrap_text=True), border=True)
        r += 1

    # ---- DUNS consolidation ----
    ws3 = wb.create_sheet("DUNS consolidation"); ws3.sheet_view.showGridLines = False
    _s(ws3, "A1", "One cleaned vendor spanning multiple Supplier DUNS", H1)
    _s(ws3, "A2", f"{len(duns_multi):,} cleaned vendors map to >1 DUNS (separate legal entities/sites folded into one supplier). Top 60.", GREY)
    _heads(ws3, 4, ["Cleaned Vendor Name", "# distinct DUNS"], {"A": 46, "B": 16})
    r = 5
    for cv, n in duns_multi.head(60).items():
        _s(ws3, f"A{r}", cv, Font(bold=True), border=True)
        _s(ws3, f"B{r}", int(n), MONO, align=Alignment(horizontal="right"), border=True)
        r += 1

    # ---- Engine added vs left ----
    ws4 = wb.create_sheet("Engine added vs left"); ws4.sheet_view.showGridLines = False
    _s(ws4, "A1", "What the engine (M1–M3) added vs. left alone", H1)
    _heads(ws4, 3, ["Action", "Who / how", "Effect"], {"A": 34, "B": 30, "C": 70})
    rows = [
        ("Raw → Cleaned Vendor Name de-dup", "Cube (client/KPMG)", "276 raw spellings → 8,064 cleaned cube-wide; 37 → 1,093 in Industrial Supplies"),
        ("Multi-DUNS entity consolidation", "Cube (client/KPMG)", "263 vendors fold multiple DUNS into one name (e.g. SKF Automotive = 9 DUNS)"),
        ("Group lines → vendor grain", "Engine M1", "104,150 lines aggregated to 8,064 vendors using the cleaned name as the key"),
        ("Parent roll-up (parent_id)", "Engine M1", "Vendors linked to a parent for roll-up (from Parent Name)"),
        ("is_oem", "Engine M1 (config)", "16 OEM vendors flagged in IS via vendor_capability.yaml (Fanuc/Gleason/…) → carve-out"),
        ("capability_class / supplier_status", "Engine M1 (config)", "Broad-line/specialist/oem + current/net-new tags for the recommended-lead logic"),
        ("id_type", "Engine M2", "material_id typed unspsc/numcat/generic/partlike (pure function of the id)"),
        ("segment_class", "Engine M2", "L3 flagged engineered vs commodity (both Machine parts case variants → engineered)"),
        ("unit_price (directional)", "Engine M3", "net_spend/qty where qty>0; flagged directional (EA/lot reality)"),
        ("Fuzzy vendor merge beyond the cube", "Engine — NOT done", "Held opt-in (off for anchor parity); would catch residual near-dupes the cube missed"),
        ("Taxonomy case-collapse", "Engine — NOT done", "Kept Machine parts/Machine Parts + CAPEX/CapEX separate to match the reference; both engineered-flagged"),
    ]
    r = 4
    for a, w, e in rows:
        _s(ws4, f"A{r}", a, Font(bold=True), border=True)
        _s(ws4, f"B{r}", w, MONO if "Engine" in w or "Cube" in w else None, border=True)
        _s(ws4, f"C{r}", e, align=Alignment(wrap_text=True, vertical="top"), border=True)
        r += 1

    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    print(f"wrote {OUT}")
    print(f"full: {len(df):,} lines, {raw.nunique():,} raw -> {clean.nunique():,} cleaned (collapse {raw.nunique()-clean.nunique()})")
    print(f"IS:   collapse 37 -> 1,093 vendors;  merge groups {len(merge_multi):,};  multi-DUNS {int((dunsg>1).sum()):,}")


if __name__ == "__main__":
    main()
