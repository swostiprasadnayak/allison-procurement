"""
Cube adapter — map each source cube's columns into ONE canonical line schema.

This is the single seam where indirect vs direct schema divergence lives (plan §4.2/§4.4).
Adding the direct cube later (Stage 6) = add DIRECT_MAP + a cube_source tag; no engine
logic changes. Canonical columns are what every downstream module reads.
"""
from __future__ import annotations
import pandas as pd

CANONICAL = [
    "company", "parent_name", "vendor", "l1", "l2", "l3",
    "net_spend", "qty", "country", "region",
    "material_id", "material_desc", "controlled", "cust_directed", "pay_terms",
]

# Indirect Procurement Spend Cube (C-Indirect Spend Cube)
INDIRECT_MAP = {
    "company": "Company",
    "parent_name": "Parent Name",
    "vendor": "Cleaned Vendor Name",
    "l1": "Consol 1",
    "l2": "Consol 2",
    "l3": "Consol 3",
    "net_spend": "Net Spend",
    "qty": "Invoice Quantity",
    "country": "Cleaned Purchasing Country",
    "region": "Cleaned Purchasing Region",
    "material_id": "Material ID",
    "material_desc": "Material Description",
    "controlled": "Controlled Spend",
    "cust_directed": "Customer Directed",
    "pay_terms": "Payment Terms",
}

# Direct Procurement Spend Cube — registered now, wired in Stage 6 (combine).
DIRECT_MAP = {
    "company": "Cleaned BU",
    "parent_name": "Cleaned Parent Name",
    "vendor": "Cleaned Supplier Name",
    "l1": "Consolidated L1",
    "l2": "Consolidated L2",
    "l3": "Consolidated L3",
    "net_spend": "Total Value (USD)",
    "qty": "Total Quantity",
    "country": "Cleaned Supplier Country",
    "region": "Cleaned Plant Region",
    "material_id": "Part Number",
    "material_desc": "Part Description",
    "controlled": None,                      # not present on direct cube
    "cust_directed": "Exclusive Customer Directed",
    "pay_terms": "Payment Terms",
}


def to_canonical(df: pd.DataFrame, mapping: dict, cube_source: str) -> pd.DataFrame:
    out = pd.DataFrame(index=df.index)
    for canon in CANONICAL:
        src = mapping.get(canon)
        out[canon] = df[src] if (src and src in df.columns) else pd.NA
    # types + light cleaning (Bronze stays raw; canonical is typed)
    out["net_spend"] = pd.to_numeric(out["net_spend"], errors="coerce").fillna(0.0)
    out["qty"] = pd.to_numeric(out["qty"], errors="coerce")
    for c in ["company", "parent_name", "vendor", "l1", "l2", "l3", "country", "region",
              "material_id", "material_desc", "controlled", "cust_directed", "pay_terms"]:
        out[c] = out[c].astype("string").str.strip()
    out["cube_source"] = cube_source
    # normalize business unit label (cube uses AT / OH; keep verbatim, upper)
    out["business_unit"] = out["company"].str.upper()
    return out
