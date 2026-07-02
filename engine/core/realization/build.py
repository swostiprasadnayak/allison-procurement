"""
M9 — build_realization  (Feature §8.2, A.12).

Rolls landed PO (s-pr-010) + Non-PO (fbl1n) into opp.fact_spend_actual run-rates by
vendor x period. The table + logic are built to contract; baseline_run_rate /
post_award_run_rate are NULL until (a) opportunities are acted on (an award date to split
around) and (b) the live SAP actuals feed lands — exactly the designed-for path in the plan.
The cube<->PO<->SAP vendor/category crosswalk is the separate source-map deliverable, so
l3_code/business_unit here are best-effort.
"""
from __future__ import annotations
import datetime as dt
import hashlib

import pandas as pd

from engine.core.normalize.vendor import vendor_id

ACTUAL_COLUMNS = ["id", "vendor_id", "l3_code", "business_unit", "location_id", "period_month",
                  "spend_usd", "qty", "baseline_run_rate", "post_award_run_rate", "ingested_at"]
_EPOCH = dt.date(1899, 12, 30)


def excel_period(serial):
    try:
        s = float(serial)
    except (TypeError, ValueError):
        return None
    if s <= 0:
        return None
    d = _EPOCH + dt.timedelta(days=int(s))
    return f"{d.year:04d}-{d.month:02d}"


def _aid(*p):
    return "FA" + hashlib.sha1("|".join(str(x) for x in p).encode()).hexdigest()[:16]


def build_fact_spend_actual(po: pd.DataFrame, nonpo: pd.DataFrame, *, run_id) -> pd.DataFrame:
    rows = []

    # PO actuals (s-pr-010)
    p = po.copy()
    p["spend"] = pd.to_numeric(p["Amount in USD"], errors="coerce").astype("float64").fillna(0.0)
    p["qty"] = pd.to_numeric(p["Invoice qty"], errors="coerce")
    p["vid"] = p["Vendor Name"].astype(str).str.strip().map(lambda n: vendor_id(n) if n and n != "nan" else None)
    p["loc"] = p["Plnt"].astype(str).str.strip()
    p["period"] = p["Pstg Date"].map(excel_period)
    g = p.groupby(["vid", "loc", "period"], dropna=True).agg(spend=("spend", "sum"), qty=("qty", "sum")).reset_index()
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    for _, r in g.iterrows():
        rows.append({"id": _aid("po", r["vid"], r["loc"], r["period"]), "vendor_id": r["vid"],
                     "l3_code": None, "business_unit": None, "location_id": r["loc"],
                     "period_month": r["period"], "spend_usd": round(float(r["spend"]), 2),
                     "qty": float(r["qty"]) if pd.notna(r["qty"]) else None,
                     "baseline_run_rate": None, "post_award_run_rate": None, "ingested_at": now})

    # Non-PO actuals (fbl1n) — tail/maverick
    n = nonpo.copy()
    n["spend"] = pd.to_numeric(n["Amount in USD"], errors="coerce").astype("float64").fillna(0.0)
    n["vid"] = n["Vendor Name"].astype(str).str.strip().map(lambda x: vendor_id(x) if x and x != "nan" else None)
    n["period"] = n["Posting Date"].map(excel_period)
    gn = n.groupby(["vid", "period"], dropna=True).agg(spend=("spend", "sum")).reset_index()
    for _, r in gn.iterrows():
        rows.append({"id": _aid("nonpo", r["vid"], r["period"]), "vendor_id": r["vid"],
                     "l3_code": None, "business_unit": None, "location_id": None,
                     "period_month": r["period"], "spend_usd": round(float(r["spend"]), 2),
                     "qty": None, "baseline_run_rate": None, "post_award_run_rate": None, "ingested_at": now})

    return pd.DataFrame(rows, columns=ACTUAL_COLUMNS)
