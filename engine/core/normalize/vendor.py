"""
M1 — normalize_vendor  (Appendix A.1).

Builds cim.vendor from the canonical line frame: one row per consolidation key
(the cube's cleaned vendor name), with parent roll-up, is_oem, capability_class,
supplier_status. The vendor key == cleaned vendor name reproduces the discovery's
1,093 Industrial Supplies vendors; further fuzzy de-dup is a later, parameterized
enhancement (off by default for anchor parity).
"""
from __future__ import annotations
import hashlib
import re

import pandas as pd


def _sid(prefix: str, name: str) -> str:
    # 1:1 with the cube's cleaned name (the consolidation key): trim only, do NOT
    # lowercase — case-variant cleaned names (e.g. 'Snap-On' vs 'Snap-on') are distinct
    # vendors in the cube/reference. Merging them is the fuzzy de-dup opt-in, not this.
    return prefix + hashlib.sha1(str(name).strip().encode()).hexdigest()[:12]


def vendor_id(name: str) -> str:
    return _sid("V", name)


def _oem_pattern(oem_brands):
    return re.compile("|".join(re.escape(b) for b in oem_brands), re.I)


def is_oem(name: str, oem_brands) -> bool:
    return bool(_oem_pattern(oem_brands).search(str(name)))


def _capability_lookup(cfg):
    """Return a function name -> (class, lanes, geographies, status) from config matches."""
    rules = []
    for c in cfg.get("capabilities", []):
        rules.append((re.compile(re.escape(c["match"]), re.I), c))
    def lookup(name):
        for pat, c in rules:
            if pat.search(str(name)):
                return c.get("class"), c.get("lanes"), c.get("geographies"), c.get("status")
        return None, None, None, None
    return lookup


def normalize_vendors(canon: pd.DataFrame, cfg: dict, *, material_threshold: float = 100000.0,
                      classification: dict | None = None) -> pd.DataFrame:
    """canon: canonical line frame (cube_adapter). cfg: vendor_capability.yaml dict.

    classification: optional {vendor_id: {"is_oem": bool, "capability_class": str}} from the
    VERIFIED opp.vendor_classification cache. When provided, it supersedes the substring list
    per vendor (still anchor-reviewed in the classify job). When None (default), is_oem/capability
    come from the config substring list — the anchor-safe baseline that reproduces 16 OEM in IS."""
    oem_brands = cfg.get("oem_brands", [])
    oem_pat = _oem_pattern(oem_brands)
    cap = _capability_lookup(cfg)
    classification = classification or {}

    df = canon.copy()
    df["vendor"] = df["vendor"].astype("string").str.strip()
    df = df[df["vendor"].notna() & (df["vendor"] != "")]

    # aggregate to the vendor grain
    g = df.groupby("vendor", dropna=True)
    agg = pd.DataFrame({
        "total_spend": g["net_spend"].sum(),
        "parent_name": g["parent_name"].agg(lambda s: _mode(s)),
        "companies": g["business_unit"].agg(lambda s: sorted(set(x for x in s.dropna() if x))),
    }).reset_index()

    rows = []
    for _, r in agg.iterrows():
        name = r["vendor"]
        vid = vendor_id(name)
        cls, lanes, geos, status_cfg = cap(name)
        verified = classification.get(vid)
        if verified is not None:
            oem = bool(verified.get("is_oem"))
            cls = verified.get("capability_class") or cls
        else:
            oem = bool(oem_pat.search(str(name)))
            if oem:
                cls = "oem"
        bus = r["companies"]
        bu_scope = "both" if len(bus) > 1 else (bus[0] if bus else None)
        status = status_cfg or ("current-material" if r["total_spend"] >= material_threshold else "current-small")
        parent = r["parent_name"]
        rows.append({
            "vendor_id": vid,
            "vendor_number": None,                 # SAP-sourced later
            "vendor_name": name,
            "normalized_name": name,               # == cleaned name (fuzzy de-dup is a later opt-in)
            "parent_id": _sid("P", parent) if parent else None,
            "parent_name": parent,
            "business_unit_scope": bu_scope,
            "is_oem": oem,
            "capability_class": cls,
            "product_lanes": lanes,
            "geographies": geos,
            "supplier_status": status,
            "total_spend": round(float(r["total_spend"]), 2),
        })
    return pd.DataFrame(rows).sort_values("total_spend", ascending=False).reset_index(drop=True)


def _mode(s: pd.Series):
    s = s.dropna()
    if s.empty:
        return None
    m = s.mode()
    return m.iloc[0] if len(m) else s.iloc[0]
