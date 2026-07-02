"""
Stage 1 gates — foundation, parameters, lineage.

Proves the cross-cutting non-negotiables: parameter resolution from the seed,
config_snapshot capture, is_current atomicity, and (critically) that a parameter
change reaches the NEXT run with no code edit.

Run:  python -m pytest tests/test_stage1_foundation.py -q
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys
import tempfile

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import seed_foundation, Params
from engine.lineage.run import begin_run, finalize_run, current_run
from engine.schema import contracts


@pytest.fixture
def io():
    with tempfile.TemporaryDirectory() as d:
        _io = LocalIO(root=d)
        seed_foundation(_io)
        yield _io


VERSION = "mro-layer0-v1"


# --- parameters ---------------------------------------------------------
def test_param_seed_resolves_known_values(io):
    p = Params.load(io, VERSION)
    assert p.num("prov_exponent") == 2
    assert p.num("feas_frag_weight") == 0.5
    assert p.num("winner_share_consolidate") == 0.50
    assert p.int_("play_min_spend") == 300000
    assert p.int_("play_min_vendors") == 4
    assert p.list_("engineered_segments") == ["Machine parts", "Machine Parts"]
    assert p.rate_range("savings_rate.fragmented_tail") == (0.06, 0.10)
    assert p.rate_range("savings_rate.consolidate_incumbent") == (0.04, 0.07)


def test_all_appendix_a2_params_present(io):
    p = Params.load(io, VERSION)
    required = [
        "prov_exponent", "feas_frag_weight", "feas_xbu_weight", "services_threshold",
        "services_penalty", "play_min_spend", "play_min_vendors", "winner_share_consolidate",
        "engineered_segments", "tier_keep_spend", "tier_keep_segs", "tier_leverage_spend",
        "tier_consolidate_spend", "mav_micro_spend", "mav_micro_lines",
        "savings_rate.consolidate_incumbent", "savings_rate.competitive_rfp",
        "savings_rate.fragmented_tail", "savings_rate.services_ratecard",
        "savings_rate.cross_division",
    ]
    for k in required:
        p.get(k)  # raises if missing


# --- contracts ----------------------------------------------------------
def test_seeded_tables_match_cdm_contract(io):
    for tbl in ["methodology_version", "methodology_agreement", "engine_parameter"]:
        contracts.validate(io.read("opp", tbl), "opp", tbl)


def test_param_metadata_persisted_for_admin(io):
    """display_label + category are first-class so the Admin screen can configure dials."""
    ep = io.read("opp", "engine_parameter").set_index("param_key")
    row = ep.loc["winner_share_consolidate"]
    assert row["display_label"] == "Consolidate-vs-RFP threshold"
    assert row["category"] == "Opportunity generation (A.5)"
    assert ep["display_label"].notna().all()
    assert ep["category"].notna().all()
    assert isinstance(ep.loc["prov_exponent", "description"], str) and len(ep.loc["prov_exponent", "description"]) > 20


def test_agreement_seeded_pending(io):
    agr = io.read("opp", "methodology_agreement").iloc[0]
    assert agr["status"] == "pending"
    assert agr["methodology_version"] == VERSION


# --- lineage ------------------------------------------------------------
def test_begin_run_snapshots_params(io):
    ctx = begin_run(io, {"business_unit": "ALL"}, VERSION, run_id="r1")
    run = io.read("opp", "engine_run")
    snap = json.loads(run[run.run_id == "r1"].iloc[0]["config_snapshot"])
    assert snap["winner_share_consolidate"] == 0.5
    assert snap["engineered_segments"] == ["Machine parts", "Machine Parts"]
    contracts.validate(run, "opp", "engine_run")


def test_is_current_flips_to_latest_same_scope(io):
    scope = {"business_unit": "ALL"}
    begin_run(io, scope, VERSION, run_id="r1"); finalize_run(io, "r1")
    begin_run(io, scope, VERSION, run_id="r2"); finalize_run(io, "r2")
    run = io.read("opp", "engine_run").set_index("run_id")
    assert run.loc["r2", "is_current"] == True   # noqa: E712
    assert run.loc["r1", "is_current"] == False  # noqa: E712
    assert current_run(io, scope)["run_id"] == "r2"


def test_failed_run_does_not_become_current(io):
    scope = {"business_unit": "ALL"}
    begin_run(io, scope, VERSION, run_id="good"); finalize_run(io, "good")
    begin_run(io, scope, VERSION, run_id="bad"); finalize_run(io, "bad", ok=False)
    assert current_run(io, scope)["run_id"] == "good"


def test_distinct_scopes_have_independent_current(io):
    begin_run(io, {"bu": "AT"}, VERSION, run_id="at1"); finalize_run(io, "at1")
    begin_run(io, {"bu": "OH"}, VERSION, run_id="oh1"); finalize_run(io, "oh1")
    assert current_run(io, {"bu": "AT"})["run_id"] == "at1"
    assert current_run(io, {"bu": "OH"})["run_id"] == "oh1"


# --- the key requirement: a param change reaches the NEXT run, no code edit ---
def test_parameter_change_takes_effect_next_run(io):
    # admin creates a new version with winner_share_consolidate = 0.60
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    ep = io.read("opp", "engine_parameter")
    bumped = ep.copy()
    bumped["methodology_version"] = "mro-layer0-v2"
    bumped.loc[bumped.param_key == "winner_share_consolidate", "value_numeric"] = 0.60
    bumped.loc[bumped.param_key == "winner_share_consolidate", "change_note"] = "raise threshold"
    io.write("opp", "engine_parameter", ep._append(bumped, ignore_index=True)
             if hasattr(ep, "_append") else __import__("pandas").concat([ep, bumped], ignore_index=True))

    p_old = Params.load(io, "mro-layer0-v1")
    p_new = Params.load(io, "mro-layer0-v2")
    assert p_old.num("winner_share_consolidate") == 0.50
    assert p_new.num("winner_share_consolidate") == 0.60

    # the new run snapshots the new value
    begin_run(io, {"bu": "ALL"}, "mro-layer0-v2", run_id="v2run")
    snap = json.loads(io.read("opp", "engine_run").set_index("run_id").loc["v2run", "config_snapshot"])
    assert snap["winner_share_consolidate"] == 0.60
