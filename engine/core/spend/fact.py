"""
M4 — build_fact_spend  (CDM opp.fact_spend).

Assembles the analysis star from canonical lines + the normalized masters:
one row per spend line, classifiers attached (id_type, is_oem, segment_class),
addressable computed, run_id stamped. This is the fact every later module reads.

addressable = net_spend − customer_directed − sole_source (A.1). Layer-0 proxy:
sole_source = OEM spend (the carve-out); customer_directed = cust_directed flag.
(Validated against the scan addressable $31,274,709 at Stage 4.)
"""
from __future__ import annotations
import hashlib

import numpy as np
import pandas as pd

from engine.core.normalize import vendor as M1
from engine.core.normalize import taxonomy as M2

_CD_TRUE = {"yes", "y", "true", "x", "1"}


def oem_classification_map(vc, mode: str) -> dict | None:
    """Build the {vendor_id: is_oem} override for build_fact_spend from the verified
    opp.vendor_classification cache, per the `oem_definition` parameter:
      'substring'    -> None  (pure vendor-name proxy; reproduces the $11,888,233 anchor)
      'verified_web' -> citation-backed web verdicts only (else keep the substring proxy)
      'verified_all' -> web + model-knowledge verdicts
    A verdict of is_oem=False also supersedes a substring false-positive."""
    if mode == "substring" or vc is None or getattr(vc, "empty", True):
        return None
    rows = vc[vc["source"] == "web"] if mode == "verified_web" else vc
    return {r["vendor_id"]: bool(r["is_oem"]) for _, r in rows.iterrows()}

FACT_COLUMNS = [
    "id", "source_doc_key", "cube_source", "business_unit", "vendor_id", "item_id",
    "location_id", "l1_code", "l2_code", "l3_code", "purchasing_country", "region",
    "net_spend_usd", "qty", "uom", "unit_price_usd", "pay_terms",
    "id_type", "is_oem", "segment_class", "addressable_usd", "period_month", "run_id",
]


def _fid(key: str) -> str:
    return "F" + hashlib.sha1(key.encode()).hexdigest()[:16]


def build_fact_spend(canon: pd.DataFrame, *, oem_brands, engineered_segments, run_id,
                     classification: dict | None = None) -> pd.DataFrame:
    """classification: optional {vendor_id: is_oem_bool} from the VERIFIED opp.vendor_classification
    cache. When provided it supersedes the substring OEM proxy per vendor (vendors absent from the
    dict keep the substring verdict). None (default) = pure substring → reproduces the anchor."""
    df = canon.reset_index(drop=True).copy()

    net = pd.to_numeric(df["net_spend"], errors="coerce").astype("float64").fillna(0.0)
    qty = pd.to_numeric(df["qty"], errors="coerce").astype("float64")
    for c in ["vendor", "l1", "l2", "l3", "country", "region", "material_id",
              "cust_directed", "pay_terms", "business_unit"]:
        df[c] = df[c].astype(object)

    vid = df["vendor"].map(lambda n: M1.vendor_id(n) if pd.notna(n) and str(n).strip() else None)
    oem_pat = M1._oem_pattern(oem_brands)
    is_oem = df["vendor"].astype(str).str.contains(oem_pat).fillna(False).to_numpy()
    if classification:   # verified set supersedes the substring proxy, per vendor
        is_oem = np.array([bool(classification.get(v, s)) for v, s in zip(vid, is_oem)])
    cust_dir = df["cust_directed"].astype(str).str.strip().str.lower().isin(_CD_TRUE).to_numpy()

    out = pd.DataFrame(index=df.index)
    sdk = "indirect:" + df.index.astype(str)
    out["id"] = sdk.map(_fid)
    out["source_doc_key"] = sdk
    out["cube_source"] = df["cube_source"]
    out["business_unit"] = df["business_unit"]
    out["vendor_id"] = vid
    out["item_id"] = df["material_id"]
    out["location_id"] = None                       # SAP location master lands later
    # taxonomy codes (None where a level is missing)
    out["l1_code"] = _code(df, 1, ["l1"])
    out["l2_code"] = _code(df, 2, ["l1", "l2"])
    out["l3_code"] = _code(df, 3, ["l1", "l2", "l3"])
    out["purchasing_country"] = df["country"]
    out["region"] = df["region"]
    out["net_spend_usd"] = net
    out["qty"] = qty
    out["uom"] = None                                # indirect cube has no UOM column
    out["unit_price_usd"] = (net / qty).where(qty > 0)
    out["pay_terms"] = df["pay_terms"]
    out["id_type"] = df["material_id"].map(M2.classify_id_type)
    out["is_oem"] = is_oem
    out["segment_class"] = df["l3"].map(lambda x: M2.segment_class(x, engineered_segments))
    out["addressable_usd"] = np.where(is_oem | cust_dir, 0.0, net)
    out["period_month"] = None                       # derived from posting date in realization (Stage 5)
    out["run_id"] = run_id
    return out[FACT_COLUMNS]


def _code(df, level, cols):
    parts = [df[c].astype(str) for c in cols]
    code = "L%d|" % level + parts[0]
    for p in parts[1:]:
        code = code + ">" + p
    # null out where any component is missing
    missing = pd.Series(False, index=df.index)
    for c in cols:
        missing = missing | df[c].isna() | (df[c].astype(str).str.strip() == "")
    return code.where(~missing, None)
