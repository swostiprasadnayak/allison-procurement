"""
Stage 1 — Foundation entrypoint.

Seeds methodology_version + engine_parameter + methodology_agreement from the
Appendix A.2 seed, then demonstrates the run/lineage spine (begin_run ->
config_snapshot -> finalize_run -> is_current). Emits reports/stage1_foundation.json
for the review builder.

Run:  python jobs/stage1_foundation.py
"""
from __future__ import annotations
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import seed_foundation, Params, load_seed
from engine.lineage.run import begin_run, finalize_run, current_run
from engine.schema import contracts

REPORT = "reports/stage1_foundation.json"


def main():
    io = LocalIO(root="data")

    # 1) seed config + governance
    info = seed_foundation(io)
    version = info["version"]
    print(f"seeded methodology_version='{version}' with {info['n_params']} parameters")

    # 2) validate the seeded tables against the CDM contract
    for tbl in ["methodology_version", "methodology_agreement", "engine_parameter", "engine_run"]:
        if tbl == "engine_run":
            continue  # created by begin_run below
        contracts.validate(io.read("opp", tbl), "opp", tbl)
    print("contract validation: methodology_version, methodology_agreement, engine_parameter -> OK")

    # 3) resolve params and show a few
    p = Params.load(io, version)
    print(f"resolved winner_share_consolidate={p.num('winner_share_consolidate')} "
          f"engineered_segments={p.list_('engineered_segments')} "
          f"savings_rate.fragmented_tail={p.rate_range('savings_rate.fragmented_tail')}")

    # 4) lineage demo: two runs on the same scope -> is_current flips to the latest
    scope = {"business_unit": "ALL", "l1": "MRO"}
    r1 = begin_run(io, scope, version, run_id="demo-run-001")
    finalize_run(io, r1.run_id, ok=True, n_pockets=0, n_opportunities=0)
    r2 = begin_run(io, scope, version, run_id="demo-run-002")
    finalize_run(io, r2.run_id, ok=True, n_pockets=0, n_opportunities=0)
    contracts.validate(io.read("opp", "engine_run"), "opp", "engine_run")
    cur = current_run(io, scope)
    print(f"lineage demo: current run for scope = {cur['run_id']} (expect demo-run-002)")

    # 5) report for the review artifacts.
    # Values come from the resolved snapshot (what the engine will actually use);
    # label / category / definition come from the seed (the authoritative dial doc).
    snap = p.snapshot()
    seed = load_seed()
    params = [
        {
            "param_key": sp["key"],
            "label": sp.get("label", sp["key"]),
            "category": sp.get("category", "Other"),
            "value": snap.get(sp["key"]),
            "unit": sp.get("unit"),
            "definition": sp.get("desc"),
        }
        for sp in seed["params"]
    ]
    report = {
        "stage": "1 - foundation",
        "methodology_version": version,
        "n_params": info["n_params"],
        "params": params,
        "agreement_status": io.read("opp", "methodology_agreement").iloc[0]["status"],
        "contracts_validated": ["opp.methodology_version", "opp.methodology_agreement",
                                 "opp.engine_parameter", "opp.engine_run"],
        "lineage_demo": {
            "scope": scope,
            "current_run": cur["run_id"],
            "config_snapshot_keys": len(_as_obj(cur["config_snapshot"])),
            "runs": io.read("opp", "engine_run")[["run_id", "is_current"]].to_dict("records"),
        },
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)
    print(f"report -> {REPORT}")


def _num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def _as_obj(v):
    return json.loads(v) if isinstance(v, str) else v


if __name__ == "__main__":
    main()
