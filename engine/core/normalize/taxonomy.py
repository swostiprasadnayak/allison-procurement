"""
M2 — normalize_taxonomy  (Appendix A.1, A.11).

  - classify_id_type : regex typing of material_id (unspsc/numcat/generic/partlike)
  - segment_class    : engineered (carve-out) vs commodity, from the engineered_segments param
  - build_taxonomy   : ref.taxonomy hierarchy (L1>L2>L3) from the cube Consol columns
  - build_product_master : cim.product keyed by material_id with id_type + representative taxonomy

Note on case-dupes (A.11): 'Machine parts' and 'Machine Parts' appear as SEPARATE L3
values in the discovery's reference segment table, so we GROUP on the raw L3 (to reconcile
that table) but flag BOTH variants as engineered (both are in the engineered_segments param),
so the carve-out is unaffected by the case difference.
"""
from __future__ import annotations
import re

import pandas as pd

_RE_UNSPSC = re.compile(r"[0-9]{8}$")
_RE_NUMCAT = re.compile(r"[0-9]{6,}$")
_RE_GENERIC = re.compile(r"[A-Z][A-Z .\-]{1,12}$")


def classify_id_type(material_id) -> str:
    s = "" if material_id is None else str(material_id).strip().upper()
    if _RE_UNSPSC.fullmatch(s):
        return "unspsc"
    if _RE_NUMCAT.fullmatch(s):
        return "numcat"
    if _RE_GENERIC.fullmatch(s) and not re.search(r"[0-9]", s):
        return "generic"
    return "partlike"


def segment_class(l3, engineered_segments) -> str:
    eng = {str(x).strip() for x in engineered_segments}
    return "engineered" if str(l3).strip() in eng else "commodity"


def taxonomy_code(level: int, parts) -> str:
    """Stable code for a taxonomy node, e.g. ('L3|MRO>Industrial Supplies>Abrasives').
    Path-based so the same leaf name under different parents never collides."""
    return f"L{level}|" + ">".join(str(p).strip() for p in parts)


def build_taxonomy(canon: pd.DataFrame, engineered_segments) -> pd.DataFrame:
    """ref.taxonomy: one row per L1/L2/L3 node. code = level-prefixed path (unique)."""
    rows = []
    seen = set()

    def add(level, path_parts, parent_code):
        code = taxonomy_code(level, path_parts)
        if code in seen:
            return code
        seen.add(code)
        name = path_parts[-1]
        rows.append({
            "code": code,
            "level": level,
            "parent_code": parent_code,
            "name": name,
            "unspsc_code": None,                       # cube uses names, not UNSPSC
            "segment_class_default": segment_class(name, engineered_segments) if level == 3 else None,
        })
        return code

    sub = canon[["l1", "l2", "l3"]].dropna(how="all").drop_duplicates()
    for _, r in sub.iterrows():
        l1, l2, l3 = (str(r["l1"]).strip() if pd.notna(r["l1"]) else None,
                      str(r["l2"]).strip() if pd.notna(r["l2"]) else None,
                      str(r["l3"]).strip() if pd.notna(r["l3"]) else None)
        if not l1:
            continue
        c1 = add(1, [l1], None)
        if l2:
            c2 = add(2, [l1, l2], c1)
            if l3:
                add(3, [l1, l2, l3], c2)
    return pd.DataFrame(rows)


def build_product_master(canon: pd.DataFrame, engineered_segments) -> pd.DataFrame:
    """cim.product keyed by material_id (interim item key). id_type is a pure function of the
    id; l1/l2/l3 + segment_class use the modal taxonomy seen for that id. mfr_part_no NULL
    until the part master lands (the swap hook)."""
    df = canon.copy()
    df["material_id"] = df["material_id"].astype("string").str.strip()
    df = df[df["material_id"].notna() & (df["material_id"] != "")]
    g = df.groupby("material_id")
    out = pd.DataFrame({
        "description": g["material_desc"].agg(_mode),
        "l1_code": g["l1"].agg(_mode),
        "l2_code": g["l2"].agg(_mode),
        "l3_code": g["l3"].agg(_mode),
        "controlled": g["controlled"].agg(_mode),
        "cust_directed": g["cust_directed"].agg(_mode),
    }).reset_index().rename(columns={"material_id": "product_number"})
    out["material_id"] = out["product_number"]
    out["id_type"] = out["product_number"].map(classify_id_type)
    out["segment_class"] = out["l3_code"].map(lambda x: segment_class(x, engineered_segments))
    out["mfr_part_no"] = None
    return out[["product_number", "material_id", "description", "id_type",
                "l1_code", "l2_code", "l3_code", "segment_class",
                "mfr_part_no", "controlled", "cust_directed"]]


def _mode(s: pd.Series):
    s = s.dropna()
    if s.empty:
        return None
    m = s.mode()
    return m.iloc[0] if len(m) else s.iloc[0]
