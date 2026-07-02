"""
M5 — build_pockets  (CDM opp.spend_pocket; A.5 / A.9 / A.10).

Grain = one L3 × one country. Computes the concentration + lever-routing inputs:
  pocket_spend, vendor_count, top3_share, hhi,
  winner_vendor_id (largest NON-OEM), winner_share, oem_spend,
  crossbu_spend = MIN(AT, OH) within the pocket, segment_class, addressable.

Note: pocket_spend is the NET sum (reconciles to the reference, includes credit memos).
A few tiny pockets with net-credit lines can yield winner_share > 1; that is a faithful
data artifact, harmless to routing (still consolidate), and movable is floored at 0 in M7.
"""
from __future__ import annotations
import hashlib

import numpy as np
import pandas as pd

POCKET_COLUMNS = [
    "id", "run_id", "l1_code", "l2_code", "l3_code", "purchasing_country", "business_unit",
    "pocket_spend", "vendor_count", "top3_share", "hhi",
    "winner_vendor_id", "winner_share", "oem_spend", "crossbu_spend",
    "segment_class", "addressable", "data_quality_flag",
]


def _pid(l3_code, country, run_id) -> str:
    return "P" + hashlib.sha1(f"{run_id}|{l3_code}|{country}".encode()).hexdigest()[:16]


def build_pockets(fact: pd.DataFrame, *, run_id) -> pd.DataFrame:
    f = fact[fact["l3_code"].notna() & fact["purchasing_country"].notna()].copy()
    f["net_spend_usd"] = pd.to_numeric(f["net_spend_usd"], errors="coerce").astype("float64").fillna(0.0)
    f["is_oem"] = f["is_oem"].astype(bool)

    rows = []
    for (l3c, country), g in f.groupby(["l3_code", "purchasing_country"], sort=False):
        spend = float(g["net_spend_usd"].sum())
        if spend <= 0:
            continue
        vspend = g.groupby("vendor_id").agg(s=("net_spend_usd", "sum"),
                                            oem=("is_oem", "max"))
        shares = vspend["s"] / spend
        hhi = float(((shares * 100) ** 2).sum())
        top3_share = float(vspend["s"].sort_values(ascending=False).head(3).sum() / spend)
        nonoem = vspend[~vspend["oem"].astype(bool)]
        if len(nonoem):
            winner_id = nonoem["s"].idxmax()
            winner_spend = float(nonoem["s"].max())
        else:
            winner_id, winner_spend = None, 0.0
        oem_spend = float(vspend[vspend["oem"].astype(bool)]["s"].sum())
        at = float(g.loc[g["business_unit"] == "AT", "net_spend_usd"].sum())
        oh = float(g.loc[g["business_unit"] == "OH", "net_spend_usd"].sum())
        bu = "both" if at > 0 and oh > 0 else ("AT" if at > 0 else ("OH" if oh > 0 else None))
        rows.append({
            "id": _pid(l3c, country, run_id),
            "run_id": run_id,
            "l1_code": g["l1_code"].iloc[0],
            "l2_code": g["l2_code"].iloc[0],
            "l3_code": l3c,
            "purchasing_country": country,
            "business_unit": bu,
            "pocket_spend": round(spend, 2),
            "vendor_count": int(g["vendor_id"].nunique()),
            "top3_share": round(top3_share, 4),
            "hhi": round(hhi, 1),
            "winner_vendor_id": winner_id,
            "winner_share": round(winner_spend / spend, 4) if spend else 0.0,
            "oem_spend": round(oem_spend, 2),
            "crossbu_spend": round(min(at, oh), 2),
            "segment_class": g["segment_class"].iloc[0],
            "addressable": round(float(g["addressable_usd"].sum()), 2),
            "data_quality_flag": None,        # A.11 auto-flags applied at Stage 4 (qualify)
        })
    return pd.DataFrame(rows, columns=POCKET_COLUMNS)
