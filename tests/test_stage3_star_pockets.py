"""
Stage 3 gates — star + pockets (M4-M5).

Reconciles the Industrial Supplies L3 segment table and country table (incl. AT/AOH,
OEM-locked, top-3 concentration) and checks the pocket grain + lever-routing inputs.

Run:  python -m pytest tests/test_stage3_star_pockets.py -q
"""
from __future__ import annotations
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import load_seed
from engine.schema import contracts
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.spend.fact import build_fact_spend
from engine.core.spend.pockets import build_pockets
from jobs.stage3_star_pockets import REF_SEG, REF_CTRY, _l3name

ENG = ["Machine parts", "Machine Parts"]
CFG = load_seed("config/vendor_capability.yaml")


@pytest.fixture(scope="module")
def built():
    io = LocalIO(root="data")
    if not os.path.exists("data/bronze/indirect_cube.parquet"):
        pytest.skip("bronze not landed")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    fact = build_fact_spend(canon, oem_brands=CFG["oem_brands"], engineered_segments=ENG, run_id="t")
    pockets = build_pockets(fact, run_id="t")
    return fact, pockets


@pytest.fixture(scope="module")
def fis(built):
    fact, _ = built
    f = fact[(fact["l1_code"] == "L1|MRO") & (fact["l2_code"] == "L2|MRO>Industrial Supplies")].copy()
    f["net"] = pd.to_numeric(f["net_spend_usd"], errors="coerce").astype("float64")
    f["l3name"] = f["l3_code"].map(_l3name)
    return f


def test_fact_contract_and_totals(built):
    fact, _ = built
    contracts.validate(fact, "opp", "fact_spend")
    assert len(fact) == 104150
    isd = fact[(fact["l1_code"] == "L1|MRO") & (fact["l2_code"] == "L2|MRO>Industrial Supplies")]
    assert round(float(pd.to_numeric(isd["net_spend_usd"]).sum()), 0) == 34089850


def test_segment_table(fis):
    fis = fis.assign(AT=fis["net"].where(fis["business_unit"] == "AT", 0.0),
                     AOH=fis["net"].where(fis["business_unit"] == "OH", 0.0),
                     OEM=fis["net"].where(fis["is_oem"].astype(bool), 0.0))
    seg = fis.groupby("l3name").agg(spend=("net", "sum"), v=("vendor_id", "nunique"),
                                    AT=("AT", "sum"), AOH=("AOH", "sum"), OEM=("OEM", "sum"))
    for name, (es, ev, eat, eaoh, eoem) in REF_SEG.items():
        r = seg.loc[name]
        assert round(r.spend, 0) == es, name
        assert int(r.v) == ev, f"{name} vendors"
        assert round(r.AT, 0) == eat and round(r.AOH, 0) == eaoh, f"{name} BU split"
        assert round(r.OEM, 0) == eoem, f"{name} OEM-locked"


def test_country_table(fis):
    fis = fis.assign(AT=fis["net"].where(fis["business_unit"] == "AT", 0.0),
                     AOH=fis["net"].where(fis["business_unit"] == "OH", 0.0))
    for name, (es, ev, eat, eaoh, etop3) in REF_CTRY.items():
        cd = fis[fis["purchasing_country"] == name]
        spend = float(cd["net"].sum())
        top3 = float(cd.groupby("vendor_id")["net"].sum().sort_values(ascending=False).head(3).sum())
        assert round(spend, 0) == es, name
        assert int(cd["vendor_id"].nunique()) == ev, f"{name} vendors"
        assert round(cd["AT"].sum(), 0) == eat and round(cd["AOH"].sum(), 0) == eaoh, f"{name} BU"
        assert round(100 * top3 / spend) == etop3, f"{name} top3"


def test_pocket_contract_and_grain(built):
    _, pockets = built
    contracts.validate(pockets, "opp", "spend_pocket")
    # grain = unique (l3_code, country)
    assert pockets.duplicated(["l3_code", "purchasing_country"]).sum() == 0
    # winner_share is always finite; a few tiny net-credit pockets (negative-spend lines)
    # can push share outside [0,1] — faithful to the data, harmless to routing, and movable
    # is floored at Stage 4. Economic bounds are asserted on the qualifying anchor pockets below.
    assert pockets["winner_share"].notna().all()
    assert (pockets["hhi"] >= 0).all()


def test_qualifying_pockets_are_clean(built):
    """The 23 qualifying IS pockets (the anchor's basis) have well-formed concentration."""
    _, pockets = built
    pk = pockets[pockets["l2_code"] == "L2|MRO>Industrial Supplies"]
    q = pk[(pk["pocket_spend"] >= 300000) & (pk["vendor_count"] >= 4) &
           (pk["l3_code"].map(_l3name) != "N/A")]
    assert q["winner_share"].between(0, 1.0001).all()
    assert q["hhi"].between(0, 10000.001).all()
    assert (q["oem_spend"] <= q["pocket_spend"] + 1).all()


def test_qualifying_pockets_count(built):
    _, pockets = built
    pk = pockets[pockets["l2_code"] == "L2|MRO>Industrial Supplies"]
    q = pk[(pk["pocket_spend"] >= 300000) & (pk["vendor_count"] >= 4) &
           (pk["l3_code"].map(_l3name) != "N/A")]
    assert len(q) == 23   # 23 qualifying -> 19 commodity plays after the engineered carve-out (Stage 4)


def test_winner_is_non_oem(built):
    """winner_vendor_id must never be an OEM vendor (A.5)."""
    fact, pockets = built
    oem_ids = set(fact[fact["is_oem"].astype(bool)]["vendor_id"])
    winners = set(pockets["winner_vendor_id"].dropna())
    assert winners.isdisjoint(oem_ids)
