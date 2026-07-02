"""
Vendor verification gates — classifier + cache + M1 integration (no network; mock/substring).

Proves: the verdict carries provenance; the engine reads VERIFIED verdicts when present and
falls back to the anchor-safe substring baseline otherwise; the substring baseline still
reconciles to the 16-OEM Industrial Supplies anchor.

Run:  python -m pytest tests/test_vendor_classifier.py -q
"""
from __future__ import annotations
import os
import sys

import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import load_seed
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.normalize import vendor as M1
from engine.core.normalize import vendor_classifier as VC

CFG = load_seed("config/vendor_capability.yaml")


def _ctx(name, spend=1000.0):
    return VC.VendorContext(vendor_name=name, vendor_id=M1.vendor_id(name), total_spend=spend)


def test_substring_classifier_flags_known_oem():
    out = {v.vendor_name: v for v in SUB.classify([_ctx("Fanuc India Private Limited"), _ctx("Cline Tool And Service Company")])}
    assert out["Fanuc India Private Limited"].is_oem is True
    assert out["Fanuc India Private Limited"].oem_brand.lower() == "fanuc"
    assert out["Cline Tool And Service Company"].is_oem is False


SUB = VC.SubstringClassifier(CFG)


def test_verdict_row_carries_provenance():
    v = VC.Verdict(vendor_id="V1", vendor_name="X", is_oem=True, capability_class="oem",
                   confidence=0.9, evidence="manufacturer of CNC controls", citation_url="https://x",
                   source="web", model="claude-opus-4-8")
    row = v.row("mro-layer0-v1")
    for k in ["confidence", "evidence", "citation_url", "source", "model", "methodology_version", "verified_at"]:
        assert k in row
    assert row["is_oem"] is True and row["source"] == "web"


def test_mock_classifier_returns_canned():
    mock = VC.MockClassifier(lambda c: {"is_oem": True, "capability_class": "oem", "confidence": 0.95,
                                        "evidence": "mock", "oem_brand": "Acme"})
    v = mock.classify([_ctx("Acme Machine Co")])[0]
    assert v.is_oem and v.source == "mock" and v.capability_class == "oem"


# --- M1 integration: verified verdicts supersede the substring list ---
def _tiny_canon(name):
    return pd.DataFrame({"vendor": [name, name], "net_spend": [100.0, 200.0],
                         "business_unit": ["AT", "AT"], "parent_name": ["P", "P"]})


def test_m1_default_uses_substring_baseline():
    # a distributor name with no OEM brand -> not OEM under the baseline
    cim = M1.normalize_vendors(_tiny_canon("Acme Distributor Inc"), CFG)
    assert bool(cim.iloc[0]["is_oem"]) is False


def test_m1_reads_verified_classification():
    name = "Acme Distributor Inc"
    vid = M1.vendor_id(name)
    classification = {vid: {"is_oem": True, "capability_class": "oem"}}  # verified verdict
    cim = M1.normalize_vendors(_tiny_canon(name), CFG, classification=classification)
    row = cim.iloc[0]
    assert bool(row["is_oem"]) is True
    assert row["capability_class"] == "oem"


# --- the substring baseline still reconciles to the IS anchor (16 OEM) ---
def test_substring_baseline_reconciles_is_anchor():
    if not os.path.exists("data/bronze/indirect_cube.parquet"):
        pytest.skip("bronze not landed")
    canon = to_canonical(LocalIO("data").read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    isd = canon[(canon["l1"] == "MRO") & (canon["l2"] == "Industrial Supplies")].copy()
    isd["vendor"] = isd["vendor"].astype(str).str.strip()
    ctxs = [_ctx(n) for n in isd["vendor"].dropna().unique() if n]
    verdicts = SUB.classify(ctxs)
    assert sum(1 for v in verdicts if v.is_oem) == 16
