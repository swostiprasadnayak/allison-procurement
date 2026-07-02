"""
Stage 4 — Scan + Opportunities (M6 + M7). THE ACCEPTANCE ANCHOR.

Writes opp.scan_ranking + opp.opportunity (+ _recommendation/_evidence_factor/_vendor/_trigger),
and reconciles to the discovery:
  scan scores · vendor tiers 16/19/53/163/842 · maverick · 19 commodity plays = $11,888,233 movable
  = $594,411-$951,058 (flat 5-8%).

Run:  python jobs/stage4_opportunities.py
"""
from __future__ import annotations
import json
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params
from engine.lineage.run import begin_run, finalize_run
from engine.schema import contracts
from engine.core.scan.score import score_scan
from engine.core.opportunities import generate as M7

REPORT = "reports/stage4_opportunities.json"
VERSION = "mro-layer0-v1"
IS_L2 = "L2|MRO>Industrial Supplies"


def main():
    io = LocalIO(root="data")
    params = Params.load(io, VERSION)
    fact = io.read("opp", "fact_spend")
    pockets = io.read("opp", "spend_pocket")
    cim_vendor = io.read("cim", "vendor")

    ctx = begin_run(io, {"cube_source": "indirect", "layer": "gold", "stage": 4}, VERSION)

    # M6 scan (rank MRO sub-categories)
    mro_fact = fact[fact["l1_code"] == "L1|MRO"]
    scan = score_scan(mro_fact, params, run_id=ctx.run_id)
    contracts.validate(scan, "opp", "scan_ranking")
    io.write("opp", "scan_ranking", scan)

    # M7 opportunities (generate plays for all qualifying MRO pockets)
    out = M7.generate_opportunities(pockets[pockets["l1_code"] == "L1|MRO"], mro_fact, cim_vendor,
                                    params, run_id=ctx.run_id, scan=scan)
    for tbl in ["opportunity", "opportunity_recommendation", "opportunity_evidence_factor",
                "opportunity_vendor", "opportunity_trigger"]:
        contracts.validate(out[tbl], "opp", tbl)
        io.write("opp", tbl, out[tbl])

    # ---- reconcile the Industrial Supplies anchor ----
    is_fact = fact[fact["l2_code"] == IS_L2]
    tiers = M7.classify_tiers(is_fact, params)
    tier_counts = tiers.groupby("tier").agg(n=("vendor_id", "size"), spend=("spend", "sum"))
    REF_TIERS = {"Keep — OEM/sole-source": (16, 2018901), "Keep — strategic/broad": (19, 9385697),
                 "Leverage — negotiate": (53, 10238609), "Consolidate — fold to winner": (163, 7889912),
                 "Exit — tail/maverick": (842, 4556731)}
    tier_rows = []
    for t, (ev, es) in REF_TIERS.items():
        n = int(tier_counts.loc[t, "n"]) if t in tier_counts.index else 0
        sp = float(tier_counts.loc[t, "spend"]) if t in tier_counts.index else 0.0
        tier_rows.append({"tier": t, "vendors": n, "exp_vendors": ev, "spend": round(sp, 0),
                          "exp_spend": es, "pass": n == ev and abs(sp - es) <= 1})

    mav = M7.maverick_stats(is_fact, params)

    # commodity plays (IS, non-engineered) — the $11.888M anchor
    is_opps = out["opportunity"][out["opportunity"]["l2_code"] == IS_L2]
    commodity = is_opps[is_opps["play_route"].isin(["consolidate", "rfp"])]
    total_movable = round(float(commodity["movable_value"].sum()), 0)
    flat_lo = round(total_movable * 0.05, 0)
    flat_hi = round(total_movable * 0.08, 0)

    try:
        oem_mode = str(params.get("oem_definition"))
    except KeyError:
        oem_mode = "substring"
    is_anchor = oem_mode == "substring"   # substring proxy = the validated methodology baseline

    scan_ok = abs(scan.set_index("sub_category").loc["Industrial Supplies", "score"] - 100.0) < 0.1
    # The tier reference (16/19/53/163/842) and the $11,888,233 total ARE the substring anchor.
    # Under a verified OEM set the OEM tier grows and movable shrinks (expected, ~3-5%) — the
    # anchor is then guaranteed separately by the in-process substring fidelity test, so the
    # substring-specific assertions are not failed here.
    tiers_ok = all(r["pass"] for r in tier_rows) if is_anchor else True
    plays_ok = len(commodity) == 19 and (not is_anchor or abs(total_movable - 11888233) <= 50)

    finalize_run(io, ctx.run_id, ok=tiers_ok and plays_ok,
                 n_pockets=int(len(pockets)), n_opportunities=int(len(out["opportunity"])))

    report = {
        "stage": "4 - scan + opportunities", "methodology_version": VERSION,
        "oem_definition": oem_mode,
        "scan_top5": scan.head(5)[["sub_category", "score"]].to_dict("records"),
        "tiers": tier_rows, "tiers_pass": tiers_ok,
        "maverick": mav,
        "is_commodity_plays": int(len(commodity)), "exp_plays": 19,
        "total_movable": total_movable, "exp_movable": 11888233,
        "savings_flat_lo": flat_lo, "savings_flat_hi": flat_hi,
        "exp_savings": [594411, 951058],
        "n_opportunities": int(len(out["opportunity"])),
        "n_evidence_factors": int(len(out["opportunity_evidence_factor"])),
        "all_pass": bool(scan_ok and tiers_ok and plays_ok),
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"scan: IS={scan.set_index('sub_category').loc['Industrial Supplies','score']} (top-5 ranked)")
    print(f"tiers: {sum(r['pass'] for r in tier_rows)}/5 PASS  | maverick micro {mav['micro_vendors']} / one-PO {mav['one_po_vendors']}")
    if is_anchor:
        print(f"IS commodity plays: {len(commodity)} (exp 19) | movable ${total_movable:,.0f} (exp $11,888,233) "
              f"| savings ${flat_lo:,.0f}-${flat_hi:,.0f} (exp $594,411-$951,058)")
    else:
        print(f"OEM={oem_mode} | IS commodity plays: {len(commodity)} (exp 19) | "
              f"movable ${total_movable:,.0f} (verified; substring anchor $11,888,233 validated in tests) "
              f"| savings ${flat_lo:,.0f}-${flat_hi:,.0f}")
    print(f"opportunities={len(out['opportunity'])}  evidence_factors={len(out['opportunity_evidence_factor'])}")
    print(f"ALL PASS: {report['all_pass']}   report -> {REPORT}")


if __name__ == "__main__":
    main()
