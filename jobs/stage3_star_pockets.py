"""
Stage 3 — Star + pockets (M4-M5) on the indirect cube.

Builds opp.fact_spend + opp.spend_pocket, and validates the Industrial Supplies
L3 segment table and country table against the methodology workbook (sheet 10),
incl. AT/AOH splits, OEM-locked spend, and top-3 concentration.

Documented variance: Hand & Power Tools OEM-locked = engine $258,680 (matches the
sheet-8 India play + the 16-vendor/$2,018,901 tier total) vs sheet-10 display
$255,205 (omits the Heidenhain $3,475 line). We align to the binding sheet-8 anchor.

Run:  python jobs/stage3_star_pockets.py
"""
from __future__ import annotations
import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params, load_seed
from engine.lineage.run import begin_run, finalize_run
from engine.schema import contracts
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.spend.fact import build_fact_spend, oem_classification_map
from engine.core.spend.pockets import build_pockets

REPORT = "reports/stage3_star_pockets.json"
VERSION = "mro-layer0-v1"

# Reference — sheet 10 'Ref — Segments&Geo' (spend, vendors, AT, AOH, OEM-locked)
REF_SEG = {
    "N/A": (6122512, 221, 31583, 6090929, 158795),
    "Machine parts": (5352811, 277, 4019833, 1332979, 1525870),
    "Consumable Supplies": (3331307, 119, 473003, 2858305, 0),
    "Supplies": (2803349, 43, 2803349, 0, 0),
    "Quality": (2594767, 86, 4379, 2590389, 0),
    "Safety Equipment": (2105650, 37, 1841031, 264619, 12975),
    "Seals - Mechanical and Oil": (1639328, 24, 15129, 1624198, 0),
    "Hand and Power Tools": (1397470, 103, 1098597, 298873, 258680),  # sheet10=255205 (omits Heidenhain $3,475)
    "Abrasives": (1221809, 31, 147102, 1074707, 0),
    "Paint": (1186166, 29, 131301, 1054865, 0),
    "Lab Supplies and Testing Consumables": (1044462, 30, 854937, 189525, 0),
    "Hydraulics": (690465, 29, 203827, 486638, 0),
    "Cages": (667270, 8, 667270, 0, 0),
    "Machine Parts": (645317, 61, 645317, 0, 52406),
    "Weld Wire and Consumables": (603181, 12, 379202, 223979, 0),
    "Fittings - Hydraulic and Pneumatic": (537463, 26, 235728, 301735, 0),
    "Industrial Consumables": (511840, 37, 19616, 492224, 0),
    "Welding Supplies": (387218, 12, 243462, 143756, 0),
    "Electrical consumables, Wiring, Ballasts, Bulbs and fixtures": (311829, 29, 13349, 298480, 0),
    "Filters": (274948, 26, 60726, 214222, 0),
    "Sensor Cables and Connectors": (233034, 25, 202725, 30309, 3500),
}
SEG_NOTE = {"Hand and Power Tools": "sheet10 shows 255,205 (omits Heidenhain $3,475); engine aligns to sheet-8 play 258,680"}

REF_CTRY = {
    "United States": (13717282, 245, 12711523, 1005760, 29),
    "Italy": (8977463, 118, 0, 8977463, 17),
    "India": (5650624, 429, 1366881, 4283743, 27),
    "Belgium": (2672248, 107, 0, 2672248, 18),
    "China": (1343570, 51, 18650, 1324920, 67),
    "Hungary": (1032652, 69, 72535, 960117, 37),
    "United Kingdom": (328203, 21, 0, 328203, 58),
    "Germany": (285132, 40, 0, 285132, 32),
}


def _l3name(code):
    return str(code).split(">")[-1] if isinstance(code, str) and ">" in code else code


def main():
    io = LocalIO(root="data")
    params = Params.load(io, VERSION)
    cfg = load_seed("config/vendor_capability.yaml")
    engineered = params.list_("engineered_segments")
    oem_brands = cfg["oem_brands"]

    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    ctx = begin_run(io, {"cube_source": "indirect", "layer": "gold"}, VERSION)

    # OEM carve-out set — client-configurable (see `oem_definition`). Default 'verified_web'
    # (citation-backed) supersedes the substring proxy; the anchor stays reproducible under
    # 'substring' (validated by tests/test_stage4_opportunities.py's in-process fidelity fixture).
    try:
        oem_mode = str(params.get("oem_definition"))
    except KeyError:
        oem_mode = "substring"
    is_anchor = oem_mode == "substring"   # the substring proxy is the validated methodology baseline
    vc = io.read("opp", "vendor_classification") if io.exists("opp", "vendor_classification") else None
    classification = oem_classification_map(vc, oem_mode)
    print(f"OEM definition: {oem_mode}  (verified overrides: {0 if classification is None else len(classification)})")

    # M4 fact
    fact = build_fact_spend(canon, oem_brands=oem_brands, engineered_segments=engineered,
                            run_id=ctx.run_id, classification=classification)
    contracts.validate(fact, "opp", "fact_spend")
    io.write("opp", "fact_spend", fact)

    # M5 pockets
    pockets = build_pockets(fact, run_id=ctx.run_id)
    contracts.validate(pockets, "opp", "spend_pocket")
    io.write("opp", "spend_pocket", pockets)

    # ---- Industrial Supplies validation tables (from fact) ----
    fis = fact[(fact["l1_code"] == "L1|MRO") & (fact["l2_code"] == "L2|MRO>Industrial Supplies")].copy()
    fis["net"] = pd.to_numeric(fis["net_spend_usd"], errors="coerce").astype("float64")
    fis["AT"] = fis["net"].where(fis["business_unit"] == "AT", 0.0)
    fis["AOH"] = fis["net"].where(fis["business_unit"] == "OH", 0.0)
    fis["OEM"] = fis["net"].where(fis["is_oem"].astype(bool), 0.0)
    fis["l3name"] = fis["l3_code"].map(_l3name)

    def near(a, b, tol=1.0):
        return abs(float(a) - float(b)) <= tol

    seg = fis.groupby("l3name").agg(spend=("net", "sum"), v=("vendor_id", "nunique"),
                                    AT=("AT", "sum"), AOH=("AOH", "sum"), OEM=("OEM", "sum"))
    seg_rows, seg_pass = [], True
    for name, (es, ev, eat, eaoh, eoem) in REF_SEG.items():
        r = seg.loc[name]
        # spend / vendors / AT / AOH are OEM-independent structural anchors; the OEM column is
        # substring-specific (grows under a verified set), so only enforce it under the anchor config.
        ok = (near(r.spend, es) and int(r.v) == ev and near(r.AT, eat) and near(r.AOH, eaoh)
              and (not is_anchor or near(r.OEM, eoem)))
        seg_pass &= ok
        seg_rows.append({"segment": name, "spend": round(float(r.spend), 0), "exp_spend": es,
                         "vendors": int(r.v), "exp_vendors": ev,
                         "AT": round(float(r.AT), 0), "exp_AT": eat,
                         "AOH": round(float(r.AOH), 0), "exp_AOH": eaoh,
                         "OEM": round(float(r.OEM), 0), "exp_OEM": eoem,
                         "note": SEG_NOTE.get(name, ""), "pass": bool(ok)})

    ctry_rows, ctry_pass = [], True
    for name, (es, ev, eat, eaoh, etop3) in REF_CTRY.items():
        cd = fis[fis["purchasing_country"] == name]
        spend = float(cd["net"].sum())
        top3 = float(cd.groupby("vendor_id")["net"].sum().sort_values(ascending=False).head(3).sum())
        t3 = round(100 * top3 / spend) if spend else 0
        ok = near(spend, es) and int(cd["vendor_id"].nunique()) == ev and near(cd["AT"].sum(), eat) \
            and near(cd["AOH"].sum(), eaoh) and t3 == etop3
        ctry_pass &= ok
        ctry_rows.append({"country": name, "spend": round(spend, 0), "exp_spend": es,
                          "vendors": int(cd["vendor_id"].nunique()), "exp_vendors": ev,
                          "AT": round(float(cd["AT"].sum()), 0), "exp_AT": eat,
                          "AOH": round(float(cd["AOH"].sum()), 0), "exp_AOH": eaoh,
                          "top3_pct": t3, "exp_top3_pct": etop3, "pass": bool(ok)})

    # pocket summary
    pmin, vmin = params.num("play_min_spend"), params.num("play_min_vendors")
    pk = pockets.copy()
    pk_is = pk[pk["l2_code"] == "L2|MRO>Industrial Supplies"]
    qualifying = pk_is[(pk_is["pocket_spend"] >= pmin) & (pk_is["vendor_count"] >= vmin) &
                       (pk_is["l3_code"].map(_l3name) != "N/A")]

    all_pass = seg_pass and ctry_pass
    finalize_run(io, ctx.run_id, ok=all_pass, n_pockets=int(len(pockets)))

    report = {
        "stage": "3 - star + pockets", "methodology_version": VERSION,
        "fact_rows": int(len(fact)), "fact_is_rows": int(len(fis)),
        "fact_is_spend": round(float(fis["net"].sum()), 2),
        "pocket_rows": int(len(pockets)), "pocket_is_rows": int(len(pk_is)),
        "is_qualifying_pockets": int(len(qualifying)),
        "segment_table": seg_rows, "segment_pass": bool(seg_pass),
        "country_table": ctry_rows, "country_pass": bool(ctry_pass),
        "all_pass": bool(all_pass),
        "notes": SEG_NOTE,
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"fact_spend={len(fact):,} rows (IS {len(fis):,} / ${fis['net'].sum():,.0f})  spend_pocket={len(pockets):,}")
    print(f"segment table: {sum(r['pass'] for r in seg_rows)}/{len(seg_rows)} rows PASS")
    print(f"country table: {sum(r['pass'] for r in ctry_rows)}/{len(ctry_rows)} rows PASS")
    print(f"IS qualifying pockets (>=$300k, >=4 vendors, not N/A): {len(qualifying)}")
    print(f"ALL PASS: {all_pass}   report -> {REPORT}")


if __name__ == "__main__":
    main()
