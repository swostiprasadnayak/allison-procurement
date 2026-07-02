"""
Stage 2 — Normalize (M1-M3) on the indirect cube.

Builds the backbone (cim.vendor, cim.product, ref.taxonomy) and validates the
Industrial Supplies gate against the methodology reference:
  11,964 rows · $34,089,850 · 1,093 vendors · 16 OEM vendors / $2,018,901.

Run:  python jobs/stage2_normalize.py
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
from engine.core.normalize import vendor as M1
from engine.core.normalize import taxonomy as M2
from engine.core.normalize import price_uom as M3

REPORT = "reports/stage2_normalize.json"
VERSION = "mro-layer0-v1"


def main():
    io = LocalIO(root="data")
    params = Params.load(io, VERSION)
    engineered = params.list_("engineered_segments")
    material_threshold = params.num("tier_leverage_spend")
    cfg = load_seed("config/vendor_capability.yaml")

    # canonical lines from the indirect cube
    bronze = io.read_bronze("indirect_cube")
    canon = to_canonical(bronze, INDIRECT_MAP, cube_source="indirect")

    ctx = begin_run(io, {"cube_source": "indirect", "layer": "normalize"}, VERSION)

    # M1 vendor
    cim_vendor = M1.normalize_vendors(canon, cfg, material_threshold=material_threshold)
    contracts.validate(cim_vendor, "cim", "vendor")
    io.write("cim", "vendor", cim_vendor)

    # M2 taxonomy + product master
    ref_tax = M2.build_taxonomy(canon, engineered)
    contracts.validate(ref_tax, "ref", "taxonomy")
    io.write("ref", "taxonomy", ref_tax)

    cim_product = M2.build_product_master(canon, engineered)
    contracts.validate(cim_product, "cim", "product")
    io.write("cim", "product", cim_product)

    # M3 price coverage (directional)
    price_cov = M3.price_coverage(canon)

    # ---- Industrial Supplies gate ----
    is_mask = (canon["l1"] == "MRO") & (canon["l2"] == "Industrial Supplies")
    isd = canon[is_mask].copy()
    oem_pat = M1._oem_pattern(cfg["oem_brands"])
    isd["is_oem"] = isd["vendor"].astype(str).str.contains(oem_pat)
    isd["id_type"] = isd["material_id"].map(M2.classify_id_type)

    is_rows = int(len(isd))
    is_spend = round(float(isd["net_spend"].sum()), 2)
    is_vendors = int(isd["vendor"].nunique())
    oemd = isd[isd["is_oem"]]
    oem_vendors = int(oemd["vendor"].nunique())
    oem_spend = round(float(oemd["net_spend"].sum()), 2)

    def chk(actual, expected, tol=0):
        return {"actual": actual, "expected": expected,
                "pass": (abs(actual - expected) <= tol) if isinstance(actual, (int, float)) else actual == expected}

    gate = {
        "rows": chk(is_rows, 11964),
        "spend": chk(is_spend, 34089850.0, tol=1.0),
        "vendors": chk(is_vendors, 1093),
        "oem_vendors": chk(oem_vendors, 16),
        "oem_spend": chk(oem_spend, 2018901.0, tol=1.0),
    }
    # Machine-parts segment rows (both case variants -> engineered, kept separate)
    seg_rows = {}
    for seg, exp_spend, exp_vendors in [("Machine parts", 5352811.43, 277), ("Machine Parts", 645316.77, 61)]:
        s = isd[isd["l3"] == seg]
        seg_rows[seg] = {
            "spend": round(float(s["net_spend"].sum()), 2), "expected_spend": exp_spend,
            "vendors": int(s["vendor"].nunique()), "expected_vendors": exp_vendors,
            "segment_class": M2.segment_class(seg, engineered),
            "pass": abs(float(s["net_spend"].sum()) - exp_spend) <= 1.0
                    and int(s["vendor"].nunique()) == exp_vendors
                    and M2.segment_class(seg, engineered) == "engineered",
        }
    id_dist = isd.groupby("id_type").size().to_dict()

    all_pass = all(v["pass"] for v in gate.values()) and all(v["pass"] for v in seg_rows.values())
    finalize_run(io, ctx.run_id, ok=all_pass)

    report = {
        "stage": "2 - normalize", "methodology_version": VERSION,
        "cube_rows": int(len(canon)),
        "cim_vendor_rows": int(len(cim_vendor)),
        "cim_product_rows": int(len(cim_product)),
        "ref_taxonomy_nodes": int(len(ref_tax)),
        "taxonomy_levels": ref_tax.groupby("level").size().to_dict(),
        "price_coverage": price_cov,
        "industrial_supplies_gate": gate,
        "machine_parts_segments": seg_rows,
        "id_type_distribution": {k: int(v) for k, v in id_dist.items()},
        "all_pass": bool(all_pass),
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"cim.vendor={len(cim_vendor):,}  cim.product={len(cim_product):,}  ref.taxonomy={len(ref_tax):,} nodes")
    print("Industrial Supplies gate:")
    for k, v in gate.items():
        print(f"  {k:14} {v['actual']:>14}  exp {v['expected']:>14}   {'PASS' if v['pass'] else 'FAIL'}")
    for seg, v in seg_rows.items():
        print(f"  seg '{seg}': ${v['spend']:,.2f}/{v['vendors']}v  {v['segment_class']}  {'PASS' if v['pass'] else 'FAIL'}")
    print(f"ALL PASS: {all_pass}   report -> {REPORT}")


if __name__ == "__main__":
    main()
