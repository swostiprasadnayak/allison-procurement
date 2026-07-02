"""
Setup-time vendor verification — populate opp.vendor_classification.

Scope = MRO vendors (l1='MRO'). Incremental: only classifies vendors not already cached.
Hybrid Claude classifier (knowledge -> web-verify flagged) needs ANTHROPIC_API_KEY; the
SubstringClassifier runs offline as the baseline + anchor cross-check.

Reconciliation gate: the verified OEM set is compared to the substring baseline AND to the
Industrial Supplies anchor (16 OEM / $2,018,901). Deltas are listed as a review queue — the
verified cache supersedes the baseline in the engine only after sign-off (M1 `classification=`).

Run:
  python jobs/classify_vendors.py                      # offline baseline (substring), no key
  python jobs/classify_vendors.py --classifier hybrid  # web-grounded, needs ANTHROPIC_API_KEY
  python jobs/classify_vendors.py --limit 8 --classifier hybrid   # small live sample
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.core.params import load_seed
from engine.schema import contracts
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.normalize.vendor import vendor_id, _oem_pattern
from engine.core.normalize import vendor_classifier as VC

REPORT = "reports/vendor_classification.json"
VERSION = "mro-layer0-v1"


def mro_vendor_contexts(canon, limit=None):
    """Distinct MRO vendors with spend + a few category hints for the classifier."""
    d = canon[canon["l1"] == "MRO"].copy()
    d["net"] = pd.to_numeric(d["net_spend"], errors="coerce").astype("float64")
    d["vendor"] = d["vendor"].astype(str).str.strip()
    d = d[d["vendor"] != ""]
    rows = []
    for name, g in d.groupby("vendor"):
        cats = [c for c in g["l3"].dropna().astype(str).str.strip().unique()[:4] if c and c != "N/A"]
        rows.append(VC.VendorContext(
            vendor_name=name, vendor_id=vendor_id(name),
            total_spend=round(float(g["net"].sum()), 2), sample_categories=tuple(cats)))
    rows.sort(key=lambda c: -c.total_spend)   # classify the biggest first
    return rows[:limit] if limit else rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--classifier", choices=["substring", "hybrid"], default="substring")
    ap.add_argument("--limit", type=int, default=None, help="classify only the top-N MRO vendors by spend")
    ap.add_argument("--conf-threshold", type=float, default=0.7)
    ap.add_argument("--mode", choices=["oem_candidates", "material"], default="oem_candidates",
                    help="oem_candidates (light: web-verify only OEM candidates) | material (broad)")
    ap.add_argument("--web-min-spend", type=float, default=25000.0,
                    help="[material mode] low-confidence vendors below this spend skip web-verify")
    ap.add_argument("--web-cap", type=int, default=250, help="hard ceiling on web-verify calls (safety)")
    ap.add_argument("--reclassify", action="store_true", help="ignore cache, re-verify everything")
    args = ap.parse_args()

    io = LocalIO(root="data")
    cfg = load_seed("config/vendor_capability.yaml")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    contexts = mro_vendor_contexts(canon, limit=args.limit)

    # incremental: skip already-cached vendors
    cached = io.read("opp", "vendor_classification") if io.exists("opp", "vendor_classification") else pd.DataFrame()
    cached_ids = set() if (args.reclassify or cached.empty) else set(cached["vendor_id"])
    todo = [c for c in contexts if c.vendor_id not in cached_ids]
    print(f"MRO vendors in scope: {len(contexts):,}  already cached: {len(cached_ids):,}  to classify: {len(todo):,}")

    if args.classifier == "hybrid":
        # substring-OEM vendors are force-web-verified too (confirm the carve-outs we already assume)
        force_web = {v.vendor_id for v in VC.SubstringClassifier(cfg).classify(todo) if v.is_oem}
        clf = VC.HybridClaudeClassifier(conf_threshold=args.conf_threshold,
                                        web_verify_min_spend=args.web_min_spend,
                                        web_verify_mode=args.mode, force_web_ids=force_web,
                                        web_cap=args.web_cap)
    else:
        clf = VC.SubstringClassifier(cfg)

    verdicts = clf.classify(todo) if todo else []
    new_rows = [v.row(VERSION) for v in verdicts]
    if new_rows:
        merged = pd.concat([cached, pd.DataFrame(new_rows)], ignore_index=True) if not cached.empty else pd.DataFrame(new_rows)
        merged = merged.drop_duplicates("vendor_id", keep="last")
        contracts.validate(merged, "opp", "vendor_classification")
        io.write("opp", "vendor_classification", merged)
        cache = merged
    else:
        cache = cached

    # ---- reconciliation: verified vs substring baseline vs IS anchor ----
    rec = reconcile(canon, cfg, cache)
    report = {
        "scope": "MRO (l1='MRO')", "classifier": args.classifier,
        "mro_vendors": len(contexts), "classified_total": int(len(cache)),
        "web_verified": int((cache["source"] == "web").sum()) if not cache.empty else 0,
        "reconciliation": rec,
    }
    os.makedirs("reports", exist_ok=True)
    with open(REPORT, "w") as f:
        json.dump(report, f, indent=2, default=str)

    print(f"classified rows cached: {len(cache):,}  (web-verified: {report['web_verified']})")
    print(f"IS anchor — verified OEM vendors: {rec['is_oem_vendors_verified']} "
          f"(substring baseline: {rec['is_oem_vendors_substring']}; target 16)   "
          f"{'PASS' if rec['anchor_pass'] else 'REVIEW'}")
    if rec["deltas_vs_substring"]:
        print(f"review queue — {len(rec['deltas_vs_substring'])} vendor(s) differ from the substring baseline:")
        for d in rec["deltas_vs_substring"][:10]:
            print(f"   {d['vendor_name']}: verified is_oem={d['verified']} vs substring={d['substring']} ({d['source']})")
    print(f"report -> {REPORT}")


def reconcile(canon, cfg, cache):
    """Compare the verified OEM set to the substring baseline and the IS anchor."""
    isd = canon[(canon["l1"] == "MRO") & (canon["l2"] == "Industrial Supplies")].copy()
    isd["net"] = pd.to_numeric(isd["net_spend"], errors="coerce").astype("float64")
    isd["vendor"] = isd["vendor"].astype(str).str.strip()
    isd["vid"] = isd["vendor"].map(vendor_id)

    pat = _oem_pattern(cfg["oem_brands"])
    sub_oem_ids = set(isd[isd["vendor"].str.contains(pat)]["vid"])

    verified_oem_ids = set()
    if not cache.empty:
        verified_oem_ids = set(cache[cache["is_oem"] == True]["vendor_id"])  # noqa: E712
    is_verified_oem = isd[isd["vid"].isin(verified_oem_ids)]

    # deltas (only meaningful where we actually have a verified verdict)
    deltas = []
    if not cache.empty:
        by_id = cache.set_index("vendor_id")
        for vid in set(isd["vid"]):
            if vid not in by_id.index:
                continue
            ver = bool(by_id.loc[vid, "is_oem"])
            sub = vid in sub_oem_ids
            if ver != sub:
                deltas.append({"vendor_name": by_id.loc[vid, "vendor_name"], "verified": ver,
                               "substring": sub, "source": by_id.loc[vid, "source"]})

    return {
        "is_oem_vendors_substring": int(len(sub_oem_ids)),
        "is_oem_spend_substring": round(float(isd[isd["vid"].isin(sub_oem_ids)]["net"].sum()), 2),
        "is_oem_vendors_verified": int(is_verified_oem["vendor"].nunique()),
        "is_oem_spend_verified": round(float(is_verified_oem["net"].sum()), 2),
        "anchor_pass": len(sub_oem_ids) == 16,   # the substring baseline is the validated anchor
        "deltas_vs_substring": deltas,
    }


if __name__ == "__main__":
    main()
