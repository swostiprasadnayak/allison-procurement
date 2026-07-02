"""
Stage 4 — M6 scan scoring gates.

Feasibility + Provability reconcile EXACTLY to the methodology (sheet 6); the ranking ORDER
is exact and Industrial Supplies = 100. Absolute scores are within a documented tolerance:
the residual is the Prize denominator (Machine Repairs' addressable), which uses the OEM-brand
Layer-0 proxy for `sole_source` — the methodology's broader single-source set needs item-level
data (part master). Exact scores unlock with that data; the ranking is already correct.

Run:  python -m pytest tests/test_stage4_scan.py -q
"""
from __future__ import annotations
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params
from engine.core.scan.score import score_scan
from engine.schema import contracts

REF = {  # sheet 6: (Feasibility, Provability, Score)
    "Industrial Supplies": (0.94, 0.82, 100.0),
    "Chemicals": (0.62, 1.00, 44.5),
    "Machine/Equipment Repairs (Outsourced)": (0.55, 0.29, 8.4),
    "First Fill Oils (Lubricants)": (0.16, 0.98, 5.3),
    "Industrial Gas": (0.30, 0.97, 4.0),
}
SCORE_TOL = 2.0   # documented: addressable sole_source proxy (part master pending)


@pytest.fixture(scope="module")
def scan():
    io = LocalIO(root="data")
    if not io.exists("opp", "fact_spend"):
        pytest.skip("fact_spend not built; run jobs/stage3_star_pockets.py")
    p = Params.load(io, "mro-layer0-v1")
    # Build the SUBSTRING baseline in-process — the sheet-6 reference scores are computed on the
    # substring OEM proxy. Production may run a verified OEM set (different addressable → different
    # Prize denominator → shifted absolute scores), so reading disk fact would drift off-reference.
    from engine.core.params import load_seed
    from engine.core.spend.fact import build_fact_spend
    from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
    cfg = load_seed("config/vendor_capability.yaml")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    fact = build_fact_spend(canon, oem_brands=cfg["oem_brands"],
                            engineered_segments=p.list_("engineered_segments"),
                            run_id="anchor", classification=None)
    fact = fact[fact["l1_code"] == "L1|MRO"]
    return score_scan(fact, p, run_id="t")


def test_scan_contract(scan):
    contracts.validate(scan, "opp", "scan_ranking")


def test_feasibility_and_provability_exact(scan):
    s = scan.set_index("sub_category")
    for cat, (feas, prov, _) in REF.items():
        assert abs(s.loc[cat, "feasibility"] - feas) <= 0.01, f"{cat} feasibility"
        assert abs(s.loc[cat, "provability"] - prov) <= 0.01, f"{cat} provability"


def test_industrial_supplies_is_top(scan):
    assert scan.iloc[0]["sub_category"] == "Industrial Supplies"
    assert scan.iloc[0]["score"] == 100.0


def test_ranking_order_matches_reference(scan):
    # the deep-dive set must appear in the reference order
    order = [c for c in scan["sub_category"] if c in REF]
    assert order == ["Industrial Supplies", "Chemicals", "Machine/Equipment Repairs (Outsourced)",
                     "First Fill Oils (Lubricants)", "Industrial Gas"]


def test_scores_within_tolerance(scan):
    s = scan.set_index("sub_category")
    for cat, (_, _, score) in REF.items():
        assert abs(s.loc[cat, "score"] - score) <= SCORE_TOL, f"{cat} score {s.loc[cat,'score']} vs {score}"


def test_savings_confidence_adjusted(scan):
    # savings = addressable * rate * provability; lo < hi; both >= 0
    s = scan[scan["sub_category"] == "Industrial Supplies"].iloc[0]
    assert 0 < s["savings_lo"] < s["savings_hi"]
