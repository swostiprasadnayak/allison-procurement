"""
M6 — score_scan  (Appendix A.3).

Ranks sub-categories (L2 within the scope's L1) by how worth-pursuing they are:

    Score = AddressableIndex (Prize) x Feasibility x Provability ^ prov_exponent

  - AddressableIndex ("Prize") = addressable / MAX(addressable across sub-categories)
        addressable = net_spend - customer_directed - sole_source(OEM)   [per fact_spend.addressable_usd]
  - frag        = 1 - top3_vendor_share
  - xbu         = crossbu / spend ;  crossbu = MIN(AT_spend, OH_spend) at the sub-category level
  - Feasibility = feas_frag_weight*frag + feas_xbu_weight*(xbu / MAX(xbu over MATERIAL sub-cats)), clipped to 1
                  (material = spend >= scan_xbu_norm_min_spend; keeps a tiny 50/50 category from skewing the scale)
  - Provability = (1 - services_coded_share) * (services_penalty if services_share > services_threshold else 1)
        services_coded_share = share of spend where id_type = 'generic'
  - savings_lo/hi = addressable * [savings_rate_low, savings_rate_high] * Provability   (confidence-adjusted)

Reproduces the discovery's MRO ranking exactly: Industrial Supplies 100, Chemicals 44.5,
Machine/Equip Repairs 8.4, First Fill Oils 5.3, Industrial Gas 4.0.
"""
from __future__ import annotations
import hashlib

import pandas as pd

SCAN_COLUMNS = [
    "id", "run_id", "l1_code", "l2_code", "sub_category", "spend", "addressable",
    "prize_index", "frag", "xbu", "feasibility", "services_share", "provability",
    "score", "savings_lo", "savings_hi", "rank",
]


def _l2name(code):
    return str(code).split(">")[-1] if isinstance(code, str) and ">" in code else code


def _id(l2_code, run_id):
    return "S" + hashlib.sha1(f"{run_id}|{l2_code}".encode()).hexdigest()[:16]


def score_scan(fact: pd.DataFrame, params, *, run_id) -> pd.DataFrame:
    fw = params.num("feas_frag_weight")
    xw = params.num("feas_xbu_weight")
    st = params.num("services_threshold")
    sp = params.num("services_penalty")
    pe = params.num("prov_exponent")
    rate_lo = params.num("savings_rate_low")
    rate_hi = params.num("savings_rate_high")
    xbu_floor = params.num("scan_xbu_norm_min_spend")

    f = fact[fact["l2_code"].notna()].copy()
    f["net"] = pd.to_numeric(f["net_spend_usd"], errors="coerce").astype("float64").fillna(0.0)
    f["addr"] = pd.to_numeric(f["addressable_usd"], errors="coerce").astype("float64").fillna(0.0)
    f["AT"] = f["net"].where(f["business_unit"] == "AT", 0.0)
    f["OH"] = f["net"].where(f["business_unit"] == "OH", 0.0)
    f["svc"] = f["net"].where(f["id_type"] == "generic", 0.0)

    rows = []
    for (l1c, l2c), g in f.groupby(["l1_code", "l2_code"], sort=False):
        spend = float(g["net"].sum())
        if spend <= 0:
            continue
        vs = g.groupby("vendor_id")["net"].sum()
        top3 = float(vs.sort_values(ascending=False).head(3).sum())
        crossbu = min(float(g["AT"].sum()), float(g["OH"].sum()))
        rows.append({
            "l1_code": l1c, "l2_code": l2c, "sub_category": _l2name(l2c),
            "spend": spend, "addressable": float(g["addr"].sum()),
            "frag": 1.0 - top3 / spend, "xbu": crossbu / spend,
            "services_share": float(g["svc"].sum()) / spend,
        })
    t = pd.DataFrame(rows)
    if t.empty:
        return pd.DataFrame(columns=SCAN_COLUMNS)

    max_addr = t["addressable"].max()
    material = t[t["spend"] >= xbu_floor]
    max_xbu = material["xbu"].max() if not material.empty else t["xbu"].max()

    t["prize_index"] = t["addressable"] / max_addr
    t["feasibility"] = fw * t["frag"] + xw * (t["xbu"] / max_xbu).clip(upper=1.0)
    t["provability"] = (1.0 - t["services_share"]) * t["services_share"].apply(
        lambda s: sp if s > st else 1.0)
    raw = t["prize_index"] * t["feasibility"] * t["provability"] ** pe
    t["score"] = 100.0 * raw / raw.max()
    t["savings_lo"] = t["addressable"] * rate_lo * t["provability"]
    t["savings_hi"] = t["addressable"] * rate_hi * t["provability"]
    t = t.sort_values("score", ascending=False).reset_index(drop=True)
    t["rank"] = t.index + 1
    t["id"] = t["l2_code"].map(lambda c: _id(c, run_id))
    t["run_id"] = run_id
    # round for storage/display
    for c in ["spend", "addressable", "savings_lo", "savings_hi"]:
        t[c] = t[c].round(2)
    for c in ["prize_index", "frag", "xbu", "feasibility", "services_share", "provability"]:
        t[c] = t[c].round(4)
    t["score"] = t["score"].round(1)
    return t[SCAN_COLUMNS]
