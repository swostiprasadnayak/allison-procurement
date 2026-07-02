"""
Stage 5 — Benchmark + Realization + Supplier performance (M8-M10).

M8 writes opp.benchmark (+ category_benchmark_map) incl. the computable-now payment-terms
WC benchmark; M9 rolls PO/Non-PO into opp.fact_spend_actual run-rates; M10 computes
opp.vendor_performance (what the PO data supports; GR/invoice metrics designed-for).

Run:  python jobs/stage5_benchmark_realization.py
"""
from __future__ import annotations
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params
from engine.lineage.run import begin_run, finalize_run
from engine.schema import contracts
from engine.core.benchmark.adapter import build_benchmark, payment_terms_benchmark
from engine.core.realization.build import build_fact_spend_actual
from engine.core.performance.build import vendor_performance
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP

REPORT = "reports/stage5_benchmark_realization.json"
VERSION = "mro-layer0-v1"


def main():
    io = LocalIO(root="data")
    params = Params.load(io, VERSION)
    ctx = begin_run(io, {"cube_source": "indirect+po", "layer": "gold", "stage": 5}, VERSION)

    # M8 benchmark
    bench, bmap, pt = build_benchmark(io, params, run_id=ctx.run_id)
    contracts.validate(bench, "opp", "benchmark")
    contracts.validate(bmap, "opp", "category_benchmark_map")
    io.write("opp", "benchmark", bench)
    io.write("opp", "category_benchmark_map", bmap)

    # M9 realization
    po = io.read_bronze("po_spr010")
    nonpo = io.read_bronze("nonpo_fbl1n")
    actual = build_fact_spend_actual(po, nonpo, run_id=ctx.run_id)
    contracts.validate(actual, "opp", "fact_spend_actual")
    io.write("opp", "fact_spend_actual", actual)

    # M10 vendor performance
    perf = vendor_performance(po, run_id=ctx.run_id)
    contracts.validate(perf, "opp", "vendor_performance")
    io.write("opp", "vendor_performance", perf)

    finalize_run(io, ctx.run_id, ok=True)

    # top payment-terms WC opportunities (computable now)
    pt_sorted = sorted(pt, key=lambda r: -r["wc_value"])[:6]
    report = {
        "stage": "5 - benchmark + realization + supplier performance", "methodology_version": VERSION,
        "benchmark_rows": int(len(bench)),
        "benchmark_series": int((bench["provider"] == "BLS").sum()),
        "payment_terms_categories": len(pt),
        "payment_terms_wc_total": round(sum(r["wc_value"] for r in pt), 2),
        "top_payment_terms_wc": pt_sorted,
        "fact_spend_actual_rows": int(len(actual)),
        "fact_spend_actual_total": round(float(actual["spend_usd"].sum()), 2),
        "vendor_performance_rows": int(len(perf)),
        "perf_metrics_live": ["spend_usd", "po_count", "avg_lead_time_days"],
        "perf_metrics_designed_for": ["on_time_pct", "fill_rate_pct", "ppv_pct", "quality_reject_pct"],
        "po_rows": int(len(po)), "nonpo_rows": int(len(nonpo)),
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"M8 benchmark: {len(bench)} rows ({report['benchmark_series']} BLS series obs + payment-terms WC)")
    print(f"   payment-terms WC opportunity (computable now): ${report['payment_terms_wc_total']:,.0f} across {len(pt)} sub-categories")
    print(f"M9 fact_spend_actual: {len(actual):,} run-rate rows (${report['fact_spend_actual_total']:,.0f}); baseline/post-award designed-for")
    print(f"M10 vendor_performance: {len(perf):,} vendor-periods (spend/po_count/lead-time live; on-time/fill/PPV/quality designed-for)")
    print(f"report -> {REPORT}")


if __name__ == "__main__":
    main()
