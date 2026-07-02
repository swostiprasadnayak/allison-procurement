"""
Stage 5 gates — benchmark + realization + supplier performance (M8-M10).

No numeric discovery anchor for this stage (it's structural + the computable-now payment-terms
benchmark). Tests: payment-terms parsing + WC formula, benchmark adapter (offline), realization
roll-up structure, and that perf GR/invoice metrics are correctly NULL (designed-for).

Run:  python -m pytest tests/test_stage5.py -q
"""
from __future__ import annotations
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params
from engine.schema import contracts
from engine.core.benchmark.adapter import parse_payment_terms_days, BLSProvider, payment_terms_benchmark
from engine.core.realization.build import build_fact_spend_actual, excel_period
from engine.core.performance.build import vendor_performance
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP


@pytest.mark.parametrize("text,days", [
    ("Net 60 Days", 60), ("Net 30 Days", 30), ("Net 45 Days BLOCKED", 45), ("Net 15 Days", 15),
    ("30 days", 30), ("within 30 days Due net", 30), ("75", 75),
    ("Cash-in-Advance", 0), ("Payable Immediately Due Net", 0),
    ("2nd Day of 2nd Month after Receipt/Perform.", 60), ("UNKNOWN", None), ("", None),
])
def test_payment_terms_parse(text, days):
    assert parse_payment_terms_days(text) == days


def test_bls_provider_offline():
    obs = BLSProvider().fetch("WPU061")
    assert obs and all("period" in o and "value" in o for o in obs)
    assert BLSProvider().fetch("NOPE") == []


def test_payment_terms_wc_computes():
    io = LocalIO(root="data")
    if not os.path.exists("data/bronze/indirect_cube.parquet"):
        pytest.skip("bronze not landed")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    rows = payment_terms_benchmark(canon, cost_of_capital=0.10)
    assert rows
    for r in rows:  # wc = spend * (best - current)/365 * coc ; best >= current so wc >= 0
        assert r["best_dpo"] >= r["current_dpo"] - 1e-6
        assert r["wc_value"] >= -1.0
        exp = r["annual_spend"] * (r["best_dpo"] - r["current_dpo"]) / 365.0 * 0.10
        # current_dpo is stored rounded to 0.1 day; on large spend that 0.05-day rounding
        # legitimately swings WC, so scale tolerance to spend rather than a fixed $1.
        tol = 1.0 + r["annual_spend"] * 0.05 / 365.0 * 0.10
        assert abs(r["wc_value"] - exp) <= tol


def test_excel_period():
    assert excel_period(45658) == "2025-01"   # 2025-01-01 region
    assert excel_period(0) is None and excel_period("x") is None


def test_realization_and_perf_structure():
    io = LocalIO(root="data")
    if not os.path.exists("data/bronze/po_spr010.parquet"):
        pytest.skip("PO not landed")
    po, nonpo = io.read_bronze("po_spr010"), io.read_bronze("nonpo_fbl1n")
    actual = build_fact_spend_actual(po, nonpo, run_id="t")
    contracts.validate(actual, "opp", "fact_spend_actual")
    assert len(actual) > 0 and actual["spend_usd"].sum() > 0
    # designed-for: baseline/post-award not yet populated
    assert actual["baseline_run_rate"].isna().all()

    perf = vendor_performance(po, run_id="t")
    contracts.validate(perf, "opp", "vendor_performance")
    assert len(perf) > 0
    # spend_usd is NET — a vendor-period can be negative (returns/credits exceed buys); that's real.
    assert (perf["po_count"] > 0).all() and perf["spend_usd"].notna().all()
    # GR/invoice-dependent metrics are NULL by design (no feed yet)
    for col in ["on_time_pct", "fill_rate_pct", "ppv_pct", "quality_reject_pct"]:
        assert perf[col].isna().all(), col
