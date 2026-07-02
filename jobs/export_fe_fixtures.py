"""
Export the REAL Gold opp.* scan output → JSON fixtures for the frontend.

This is the data bridge until the Node/Lakebase API exists: it writes our actual MRO scan results
(opportunities, evidence, vendors, scan ranking, cockpit aggregates) as contract-shaped JSON the
FE loads directly. NOT mock data — these are the real numbers the engine produced. Swapping the FE
loader from these files to the live API later is mechanical (same shape).

Keys are the engine's real contract column names (snake_case) — the FE maps to its camelCase types
(see Allison FE/docs/Navanta_Lens_Data_Binding_Plan.md). Records carry the run_id + OEM basis in
_manifest.json so the FE can stamp "data as of {run}".

Run:  python jobs/export_fe_fixtures.py            # default → ../Allison FE/src/data/fixtures
      python jobs/export_fe_fixtures.py --out PATH
"""
from __future__ import annotations
import argparse
import json
import math
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO

VERSION = "mro-layer0-v1"
MRO = "L1|MRO"
_ENGINE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_DEFAULT_OUT = os.path.normpath(os.path.join(_ENGINE_DIR, "..", "Allison FE", "src", "data", "fixtures"))


def _val(v):
    if isinstance(v, float) and math.isnan(v):
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, np.integer):
        return int(v)
    if isinstance(v, np.floating):
        f = float(v)
        return None if math.isnan(f) else f
    if isinstance(v, (np.bool_, bool)):
        return bool(v)
    return v


def clean(df: pd.DataFrame) -> list[dict]:
    return [{k: _val(v) for k, v in row.items()} for row in df.to_dict(orient="records")]


def write(out_dir, name, payload):
    path = os.path.join(out_dir, name)
    with open(path, "w") as f:
        json.dump(payload, f, indent=1, default=str)
    n = len(payload) if isinstance(payload, list) else "obj"
    print(f"  {name:28s} {n} records" if isinstance(payload, list) else f"  {name:28s} (object)")


def cockpit_aggregates(io, opps, recs, scan):
    """Real cockpit rollups from Gold — KPIs, fragmentation (pockets), savings-by-category, terms-gap."""
    fact = io.read("opp", "fact_spend")
    fact = fact[fact["l1_code"] == MRO]
    pockets = io.read("opp", "spend_pocket")
    pockets = pockets[pockets["l1_code"] == MRO] if "l1_code" in pockets.columns else pockets

    rec_by_opp = recs.set_index("opportunity_id")
    sav_mid = 0.0
    for _, o in opps.iterrows():
        r = rec_by_opp.loc[o["id"]] if o["id"] in rec_by_opp.index else None
        if r is not None:
            sav_mid += (float(r["savings_lo"]) + float(r["savings_hi"])) / 2.0

    kpis = {
        "mro_addressable": round(float(fact["addressable_usd"].sum()), 2),
        "mro_net_spend": round(float(fact["net_spend_usd"].sum()), 2),
        "total_movable": round(float(opps["movable_value"].sum()), 2),
        "identified_value_mid": round(sav_mid, 2),
        "open_opportunities": int(len(opps)),
        "vendor_count": int(fact["vendor_id"].nunique()),
    }

    # fragmentation per L2 (from pockets: vendor count + spend; HHI spend-weighted)
    frag = []
    if not pockets.empty:
        for l2, g in pockets.groupby("l2_code"):
            spend = float(g["pocket_spend"].sum())
            vendors = int(g["vendor_count"].sum()) if "vendor_count" in g.columns else None
            hhi = (float((g["hhi"] * g["pocket_spend"]).sum() / spend)
                   if spend and "hhi" in g.columns else None)
            frag.append({"l2_code": l2, "label": str(l2).split(">")[-1], "pocket_spend": round(spend, 2),
                         "vendor_count": vendors, "hhi_weighted": round(hhi, 1) if hhi else None,
                         "pockets": int(len(g))})
        frag.sort(key=lambda r: -r["pocket_spend"])

    # savings-by-category (scan)
    savings_by_cat = []
    for _, s in scan.sort_values("score", ascending=False).iterrows():
        savings_by_cat.append({"sub_category": s["sub_category"], "addressable": _val(s["addressable"]),
                               "score": _val(s["score"]), "rank": _val(s["rank"]),
                               "savings_lo": _val(s["savings_lo"]), "savings_hi": _val(s["savings_hi"])})

    # terms-gap (payment-terms working-capital benchmark from opp.benchmark)
    terms_gap = []
    if io.exists("opp", "benchmark"):
        b = io.read("opp", "benchmark")
        pt = b[b["provider"] == "internal-payment-terms"] if "provider" in b.columns else b.iloc[0:0]
        for _, r in pt.iterrows():
            terms_gap.append({"category": str(r["series_id"]).replace("payment_terms_wc:", ""),
                              "wc_value": _val(r["value"])})
        terms_gap.sort(key=lambda r: -(r["wc_value"] or 0))

    return {"kpis": kpis, "fragmentation": frag, "savings_by_category": savings_by_cat,
            "terms_gap": terms_gap}


def _vendor_payment_terms(fact):
    """Spend-weighted dominant payment-terms days per vendor (real; null where the cube has no terms)."""
    from engine.core.benchmark.adapter import parse_payment_terms_days
    f = fact.copy()
    f["days"] = f["pay_terms"].map(parse_payment_terms_days)
    f["net"] = pd.to_numeric(f["net_spend_usd"], errors="coerce").fillna(0.0)
    f = f[f["days"].notna()]
    out = {}
    if f.empty:
        return out
    for vid, g in f.groupby("vendor_id"):
        out[vid] = int(g.groupby("days")["net"].sum().idxmax())   # terms carrying the most spend
    return out


def vendor_fixture(io, opp_vendor_ids):
    """cim.vendor joined with vendor_classification (OEM verdict + citation) + vendor_performance roll-up,
    scoped to MRO vendors (category derived from fact). Real data; perf metrics that need GR/invoice feeds
    stay null with a 'staged' marker."""
    cim = io.read("cim", "vendor")
    fact = io.read("opp", "fact_spend")
    fact = fact[fact["l1_code"] == MRO]
    terms = _vendor_payment_terms(fact)
    # dominant L2/country/region/BU per vendor (by spend) + MRO membership
    dim = (fact.assign(net=pd.to_numeric(fact["net_spend_usd"], errors="coerce").fillna(0.0))
           .groupby("vendor_id")
           .apply(lambda g: pd.Series({
               "l2_code": g.groupby("l2_code")["net"].sum().idxmax() if g["l2_code"].notna().any() else None,
               "purchasing_country": g.groupby("purchasing_country")["net"].sum().idxmax() if g["purchasing_country"].notna().any() else None,
               "region": g["region"].dropna().iloc[0] if g["region"].notna().any() else None,
               "business_unit": g["business_unit"].dropna().iloc[0] if g["business_unit"].notna().any() else None,
               "mro_spend": float(g["net"].sum()),
           }), include_groups=False))
    mro_vendor_ids = set(dim.index)

    cls = io.read("opp", "vendor_classification").set_index("vendor_id") if io.exists("opp", "vendor_classification") else pd.DataFrame()
    perf = io.read("opp", "vendor_performance") if io.exists("opp", "vendor_performance") else pd.DataFrame()
    perf_roll = {}
    if not perf.empty:
        for vid, g in perf.groupby("vendor_id"):
            lead = g["avg_lead_time_days"].dropna()
            perf_roll[vid] = {"po_count": int(g["po_count"].sum()), "spend_usd": round(float(g["spend_usd"].sum()), 2),
                              "avg_lead_time_days": round(float(lead.mean()), 1) if len(lead) else None}

    keep = mro_vendor_ids | set(opp_vendor_ids)
    rows = []
    for _, v in cim.iterrows():
        vid = v["vendor_id"]
        if vid not in keep:
            continue
        d = dim.loc[vid].to_dict() if vid in dim.index else {}
        c = cls.loc[vid].to_dict() if (len(cls) and vid in cls.index) else {}
        p = perf_roll.get(vid, {})
        rows.append({
            "vendor_id": vid, "vendor_name": v["vendor_name"], "parent_name": _val(v.get("parent_name")),
            "business_unit_scope": _val(v.get("business_unit_scope")), "business_unit": _val(d.get("business_unit")),
            "l2_code": _val(d.get("l2_code")), "purchasing_country": _val(d.get("purchasing_country")),
            "region": _val(d.get("region")), "total_spend": _val(v.get("total_spend")),
            "mro_spend": round(float(d.get("mro_spend", 0.0)), 2) if d else None,
            "capability_class": _val(c.get("capability_class") or v.get("capability_class")),
            "is_oem": bool(c.get("is_oem")) if c else bool(v.get("is_oem")),
            "oem_brand": _val(c.get("oem_brand")), "oem_evidence": _val(c.get("evidence")),
            "oem_citation_url": _val(c.get("citation_url")), "oem_source": _val(c.get("source")),
            "oem_confidence": _val(c.get("confidence")), "supplier_status": _val(v.get("supplier_status")),
            # designed-for (need GR/invoice feeds) — explicit nulls
            "po_count": p.get("po_count"), "actual_spend_usd": p.get("spend_usd"),
            "avg_lead_time_days": p.get("avg_lead_time_days"),
            "on_time_pct": None, "fill_rate_pct": None, "ppv_pct": None, "quality_reject_pct": None,
        })
    rows.sort(key=lambda r: -(r["mro_spend"] or r["total_spend"] or 0))
    return rows


def copilot_answers(io, opps):
    """Pre-generated explain-a-play per opportunity (offline, deterministic, grounded) so the Mercer
    cards have real grounded content now; live free-text Q&A wires to the copilot endpoint later."""
    from engine.copilot.retrieval import LocalGoldRetriever
    from engine.copilot.llm import MockLLM
    from engine.copilot import Copilot
    cop = Copilot(LocalGoldRetriever(io), MockLLM())
    out = {}
    for _, o in opps.iterrows():
        a = cop.explain(o["id"])
        out[o["id"]] = {"text": a.text, "citations": a.citations, "staged_notes": a.staged_notes,
                        "guardrail_ok": a.guardrail.passed}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=_DEFAULT_OUT)
    ap.add_argument("--no-copilot", action="store_true", help="skip pre-generated copilot answers")
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    io = LocalIO(root="data")

    opps = io.read("opp", "opportunity")
    opps = opps[opps["l1_code"] == MRO] if "l1_code" in opps.columns else opps
    recs = io.read("opp", "opportunity_recommendation")
    ef = io.read("opp", "opportunity_evidence_factor")
    ov = io.read("opp", "opportunity_vendor")
    tg = io.read("opp", "opportunity_trigger")
    scan = io.read("opp", "scan_ranking")

    opp_ids = set(opps["id"])
    rec_ids = set(recs[recs["opportunity_id"].isin(opp_ids)]["id"])
    recs = recs[recs["opportunity_id"].isin(opp_ids)]
    ef = ef[ef["recommendation_id"].isin(rec_ids)].sort_values(["recommendation_id", "sort_order"])
    ov = ov[ov["opportunity_id"].isin(opp_ids)]
    tg = tg[tg["opportunity_id"].isin(opp_ids)]

    run_id = str(opps["run_id"].iloc[0]) if "run_id" in opps.columns and len(opps) else None
    n_oem_vendors = int(ov[ov["is_oem"] == True]["vendor_id"].nunique())   # noqa: E712

    print(f"exporting real MRO scan → {args.out}")
    write(args.out, "opportunities.json", clean(opps))
    write(args.out, "recommendations.json", clean(recs))
    write(args.out, "evidence_factors.json", clean(ef))
    write(args.out, "opportunity_vendors.json", clean(ov))
    write(args.out, "triggers.json", clean(tg))
    write(args.out, "scan_ranking.json", clean(scan))
    write(args.out, "cockpit.json", cockpit_aggregates(io, opps, recs, scan))
    write(args.out, "vendors.json", vendor_fixture(io, set(ov["vendor_id"])))
    if not args.no_copilot:
        write(args.out, "copilot_answers.json", copilot_answers(io, opps))

    manifest = {
        "methodology_version": VERSION, "run_id": run_id, "cube_scope": "indirect",
        "oem_basis": "substring-anchor (verified web-confirmed set pending sign-off)",
        "counts": {"opportunities": int(len(opps)), "vendors_in_plays": int(ov["vendor_id"].nunique()),
                   "scan_categories": int(len(scan)), "oem_vendors_in_plays": n_oem_vendors},
        "note": "REAL engine output, not mock. Field names = engine contract (snake_case). "
                "Swap FE loader file→API later with no shape change.",
    }
    write(args.out, "_manifest.json", manifest)
    print(f"done — {len(opps)} opportunities, run {run_id}")


if __name__ == "__main__":
    main()
