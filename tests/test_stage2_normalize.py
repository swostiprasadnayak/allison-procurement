"""
Stage 2 gates — normalization (M1-M3).

Unit tests for the classifiers (id_type regex, segment_class, OEM match) + the
Industrial Supplies integration gate reconciled to the methodology reference.

Run:  python -m pytest tests/test_stage2_normalize.py -q
"""
from __future__ import annotations
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import load_seed
from engine.schema import contracts
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.normalize import vendor as M1
from engine.core.normalize import taxonomy as M2

ENGINEERED = ["Machine parts", "Machine Parts"]
CFG = load_seed("config/vendor_capability.yaml")


# --- id_type regex (A.1) ---
@pytest.mark.parametrize("mid,expected", [
    ("31000000", "unspsc"),       # 8-digit UNSPSC
    ("222292", "numcat"),         # 6+ digit category code
    ("123456789", "numcat"),      # 9 digits -> numcat (not 8)
    ("MACH REP", "generic"),      # process bucket
    ("GEN", "generic"),
    ("S009656000", "partlike"),   # vendor-specific SKU
    ("N/A", "partlike"),          # slash not allowed in generic
])
def test_classify_id_type(mid, expected):
    assert M2.classify_id_type(mid) == expected


# --- segment_class: both case variants engineered (A.11) ---
def test_segment_class_engineered_both_variants():
    assert M2.segment_class("Machine parts", ENGINEERED) == "engineered"
    assert M2.segment_class("Machine Parts", ENGINEERED) == "engineered"
    assert M2.segment_class("Abrasives", ENGINEERED) == "commodity"


# --- OEM match (A.1): true positives, no obvious false positives ---
def test_is_oem_match():
    assert M1.is_oem("Fanuc India Private Limited", CFG["oem_brands"]) is True
    assert M1.is_oem("Abb Inc", CFG["oem_brands"]) is True
    assert M1.is_oem("The Gleason Works", CFG["oem_brands"]) is True
    assert M1.is_oem("Cline Tool And Service Company", CFG["oem_brands"]) is False
    assert M1.is_oem("Instant Procurement Services Private", CFG["oem_brands"]) is False


def test_vendor_id_deterministic():
    # trim-insensitive but CASE-sensitive (1:1 with the cube's cleaned name key)
    assert M1.vendor_id("Cline Tool") == M1.vendor_id("  Cline Tool ")
    assert M1.vendor_id("Snap-On Industrial") != M1.vendor_id("Snap-on Industrial")


# --- Industrial Supplies integration gate (reconcile to the workbook) ---
@pytest.fixture(scope="module")
def isd():
    io = LocalIO(root="data")
    if not os.path.exists("data/bronze/indirect_cube.parquet"):
        pytest.skip("bronze not landed; run ingestion/step0_land.py")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    return canon[(canon["l1"] == "MRO") & (canon["l2"] == "Industrial Supplies")].copy()


def test_is_anchor_totals(isd):
    assert len(isd) == 11964
    assert round(float(isd["net_spend"].sum()), 0) == 34089850
    assert isd["vendor"].nunique() == 1093


def test_is_oem_totals(isd):
    pat = M1._oem_pattern(CFG["oem_brands"])
    oem = isd[isd["vendor"].astype(str).str.contains(pat)]
    assert oem["vendor"].nunique() == 16
    assert round(float(oem["net_spend"].sum()), 0) == 2018901


def test_is_machine_parts_segments(isd):
    for seg, exp_spend, exp_v in [("Machine parts", 5352811, 277), ("Machine Parts", 645317, 61)]:
        s = isd[isd["l3"] == seg]
        assert round(float(s["net_spend"].sum()), 0) == exp_spend
        assert s["vendor"].nunique() == exp_v
        assert M2.segment_class(seg, ENGINEERED) == "engineered"


# --- contract conformance of the built backbone ---
def test_backbone_contracts(isd):
    io = LocalIO(root="data")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    contracts.validate(M1.normalize_vendors(canon, CFG), "cim", "vendor")
    contracts.validate(M2.build_taxonomy(canon, ENGINEERED), "ref", "taxonomy")
    contracts.validate(M2.build_product_master(canon, ENGINEERED), "cim", "product")
