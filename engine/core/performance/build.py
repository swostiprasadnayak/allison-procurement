"""
M10 — vendor_performance  (Feature §8.1 / §9).

Computes per-vendor x period supplier metrics from the landed PO data. What the PO extract
supports now: spend, po_count, and a lead-time proxy (invoice posting − PO created date).
on_time_pct / fill_rate_pct / ppv_pct / quality_reject_pct need the goods-receipt
(requested-vs-received qty/date, quality) and invoice-line (price-vs-PO) feeds, which are
NOT in the landed files — so they are NULL here, by design, and light up when those SAP
feeds land (the table + logic are built for it).
"""
from __future__ import annotations
import hashlib

import pandas as pd

from engine.core.normalize.vendor import vendor_id
from engine.core.realization.build import excel_period

PERF_COLUMNS = ["vendor_id", "period_month", "on_time_pct", "fill_rate_pct", "avg_lead_time_days",
                "lead_time_drift", "ppv_pct", "quality_reject_pct", "po_count", "spend_usd", "run_id"]
_EPOCH_ORD = pd.Timestamp("1899-12-30")


def _lead_days(created, posted):
    try:
        c, p = float(created), float(posted)
    except (TypeError, ValueError):
        return None
    if c <= 0 or p <= 0:
        return None
    return p - c   # invoice posting − PO created, in days (proxy lead time)


def vendor_performance(po: pd.DataFrame, *, run_id) -> pd.DataFrame:
    p = po.copy()
    p["spend"] = pd.to_numeric(p["Amount in USD"], errors="coerce").astype("float64").fillna(0.0)
    p["vid"] = p["Vendor Name"].astype(str).str.strip().map(lambda n: vendor_id(n) if n and n != "nan" else None)
    p["period"] = p["Pstg Date"].map(excel_period)
    p["lead"] = [
        _lead_days(c, q) for c, q in zip(p["Created Dt"], p["Pstg Date"])
    ]
    p = p[p["vid"].notna() & p["period"].notna()]
    g = p.groupby(["vid", "period"]).agg(
        po_count=("Purch.Doc.", "nunique"), spend=("spend", "sum"),
        lead=("lead", "mean")).reset_index()
    rows = []
    for _, r in g.iterrows():
        rows.append({
            "vendor_id": r["vid"], "period_month": r["period"],
            "on_time_pct": None,        # needs goods_receipt.on_time_flag
            "fill_rate_pct": None,      # needs qty_received / qty_ordered
            "avg_lead_time_days": round(float(r["lead"]), 1) if pd.notna(r["lead"]) else None,
            "lead_time_drift": None,
            "ppv_pct": None,            # needs invoice price vs PO price
            "quality_reject_pct": None, # needs goods_receipt.quality_rejected_qty
            "po_count": int(r["po_count"]), "spend_usd": round(float(r["spend"]), 2), "run_id": run_id,
        })
    return pd.DataFrame(rows, columns=PERF_COLUMNS)
