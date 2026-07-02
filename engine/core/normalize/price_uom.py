"""
M3 — normalize_price_uom  (Appendix A.1, A.7(b)).

Directional unit price = net_spend / qty where qty > 0. Flagged DIRECTIONAL only:
~100% of indirect lines are EA/lot, so this is an outlier finder, not committed
savings (same-item like-for-like is staged behind the part master). The indirect
cube has no UOM column, so uom is unknown here; it lands with the part/SAP master.
"""
from __future__ import annotations
import pandas as pd


def add_unit_price(canon: pd.DataFrame) -> pd.DataFrame:
    df = canon.copy()
    qty = pd.to_numeric(df["qty"], errors="coerce")
    spend = pd.to_numeric(df["net_spend"], errors="coerce")
    df["unit_price_usd"] = (spend / qty).where(qty > 0)
    df["unit_price_is_directional"] = True   # EA/lot reality; not like-for-like
    return df


def price_coverage(canon: pd.DataFrame) -> dict:
    df = add_unit_price(canon)
    n = len(df)
    have = int(df["unit_price_usd"].notna().sum())
    return {"lines": n, "with_unit_price": have,
            "pct_with_unit_price": round(100 * have / n, 1) if n else 0.0}
