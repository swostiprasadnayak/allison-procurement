"""
Stage 4 — M7 opportunity gates. THE ACCEPTANCE ANCHOR.

Reconciles: vendor tiers 16/19/53/163/842, the 19 commodity plays = $11,888,233 movable
= $594,411-$951,058, the engineered carve-out, and the evidence-factor math (Pocket − Winner
− OEM = Movable). Reads the tables jobs/stage4_opportunities.py wrote.

Run:  python -m pytest tests/test_stage4_opportunities.py -q
"""
from __future__ import annotations
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import Params
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.opportunities import generate as M7
from engine.schema import contracts

IS_L2 = "L2|MRO>Industrial Supplies"


@pytest.fixture(scope="module")
def io():
    _io = LocalIO(root="data")
    if not _io.exists("opp", "opportunity"):
        pytest.skip("opportunities not built; run jobs/stage4_opportunities.py")
    return _io


@pytest.fixture(scope="module")
def sub(io):
    """The SUBSTRING-baseline opportunity set, built in-process (classification=None) — the
    methodology-fidelity anchor ($11,888,233), INDEPENDENT of the production `oem_definition`
    (which defaults to verified_web). Guarantees the engine still reproduces the validated
    discovery no matter which OEM set the client adopts. See ASSUMPTIONS.md #17."""
    from engine.core.params import load_seed
    from engine.core.spend.fact import build_fact_spend
    from engine.core.spend.pockets import build_pockets
    from engine.core.scan.score import score_scan
    params = Params.load(io, "mro-layer0-v1")
    cfg = load_seed("config/vendor_capability.yaml")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    fact = build_fact_spend(canon, oem_brands=cfg["oem_brands"],
                            engineered_segments=params.list_("engineered_segments"),
                            run_id="anchor", classification=None)
    pockets = build_pockets(fact, run_id="anchor")
    mro_fact = fact[fact["l1_code"] == "L1|MRO"]
    scan = score_scan(mro_fact, params, run_id="anchor")
    cim_vendor = io.read("cim", "vendor")
    out = M7.generate_opportunities(pockets[pockets["l1_code"] == "L1|MRO"], mro_fact,
                                    cim_vendor, params, run_id="anchor", scan=scan)
    return {"params": params, "fact": fact, "opp": out["opportunity"]}


def test_contracts(io):
    for t in ["opportunity", "opportunity_recommendation", "opportunity_evidence_factor",
              "opportunity_vendor", "opportunity_trigger"]:
        contracts.validate(io.read("opp", t), "opp", t)


def test_vendor_tiers_exact(sub):
    """SUBSTRING anchor — the 16/19/53/163/842 tier reference (methodology fidelity)."""
    params = sub["params"]
    is_fact = sub["fact"][sub["fact"]["l2_code"] == IS_L2]
    tiers = M7.classify_tiers(is_fact, params).groupby("tier").agg(n=("vendor_id", "size"), spend=("spend", "sum"))
    ref = {"Keep — OEM/sole-source": (16, 2018901), "Keep — strategic/broad": (19, 9385697),
           "Leverage — negotiate": (53, 10238609), "Consolidate — fold to winner": (163, 7889912),
           "Exit — tail/maverick": (842, 4556731)}
    for t, (ev, es) in ref.items():
        assert int(tiers.loc[t, "n"]) == ev, t
        assert abs(float(tiers.loc[t, "spend"]) - es) <= 1, f"{t} spend"


def test_19_commodity_plays_and_movable(sub):
    """SUBSTRING anchor — 19 IS plays = $11,888,233 movable (THE acceptance number)."""
    opp = sub["opp"]
    comm = opp[(opp["l2_code"] == IS_L2) & (opp["play_route"].isin(["consolidate", "rfp"]))]
    assert len(comm) == 19
    assert abs(float(comm["movable_value"].sum()) - 11888233) <= 50
    assert abs(float(comm["movable_value"].sum()) * 0.05 - 594411) <= 50
    assert abs(float(comm["movable_value"].sum()) * 0.08 - 951058) <= 50


def test_specific_plays_reconcile(sub):
    """SUBSTRING anchor — two named IS plays reconcile exactly."""
    opp = sub["opp"].set_index("title")
    # US Safety Equipment -> Consolidate, movable 538,147 ; US Supplies -> RFP, movable 2,773,608
    se = opp.loc["Safety Equipment · United States"]
    assert se["play_route"] == "consolidate" and abs(se["movable_value"] - 538147) <= 1
    su = opp.loc["Supplies · United States"]
    assert su["play_route"] == "rfp" and abs(su["movable_value"] - 2773608) <= 1


def test_engineered_carved_out(io):
    opp = io.read("opp", "opportunity")
    eng = opp[opp["l3_code"].str.contains("Machine parts", case=False, na=False)]
    if len(eng):
        assert (eng["play_route"] == "carve-out").all()
        assert (eng["movable_value"] == 0).all()
        assert (eng["provability_flag"] == "needs-part-master").all()


def test_evidence_factor_math_ties_out(io):
    """For each play, Pocket spend (− Winner) − OEM = Movable, from the ordered evidence rows."""
    opp = io.read("opp", "opportunity")
    rec = io.read("opp", "opportunity_recommendation").set_index("opportunity_id")
    fac = io.read("opp", "opportunity_evidence_factor")
    comm = opp[(opp["l2_code"] == IS_L2) & (opp["play_route"].isin(["consolidate", "rfp"]))]
    checked = 0
    for _, o in comm.iterrows():
        rid = rec.loc[o["id"], "id"]
        rows = fac[fac["recommendation_id"] == rid].set_index("factor_name")["observed_value"]
        pocket = rows["Pocket spend"]
        oem = rows["− OEM / sole-source"]
        movable = rows["= Addressable"]  # UI/contract term for movable (renamed from "= Movable")
        winner = rows.get("− Winner (incumbent kept)", 0.0)
        assert abs((pocket + winner + oem) - movable) <= 1.0, o["title"]  # winner/oem stored negative
        checked += 1
    assert checked == 19


def test_winner_is_non_oem(io):
    ov = io.read("opp", "opportunity_vendor")
    winners = ov[ov["is_winner"] == True]  # noqa: E712
    assert not winners["is_oem"].astype(bool).any()
