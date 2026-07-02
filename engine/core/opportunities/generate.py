"""
M7 — generate_opportunities  (Appendix A.4 / A.5 / A.6 / A.8 / §3.4).

From the spend pockets + fact lines, produces the named plays and their evidence:
  - vendor tiers (A.4): Keep-OEM / Keep-strategic-broad / Leverage / Consolidate / Exit-tail
  - maverick (A.8): micro + one-PO off-catalog vendors
  - per qualifying pocket (L3 x country): segment gate -> lever route -> movable -> savings
        engineered (Machine parts)        -> carve-out to OEM/should-cost track (no consolidation)
        winner_share >= winner_share_consolidate -> Consolidate to incumbent ; movable = pocket - winner - oem
        else                               -> Competitive RFP                ; movable = pocket - oem
  - emits opp.opportunity (+ _recommendation, _evidence_factor, _vendor, _trigger)

The OEM carve-out is the conservative `sole_source` proxy (spec-level contestability is the
part-master re-run). Reproduces the discovery: 19 commodity plays = $11,888,233 movable.
"""
from __future__ import annotations
import datetime as dt
import hashlib

import pandas as pd

LEVER_CONSOLIDATE = "Vendor consolidation (to incumbent)"
LEVER_RFP = "Vendor consolidation (Competitive RFP)"
LEVER_CARVEOUT = "Benchmark / should-cost (OEM carve-out)"
LEVER_SUBCLASSIFY = "Sub-classify before sourcing"


def _l3name(code):
    return str(code).split(">")[-1] if isinstance(code, str) and ">" in code else code


def _oid(prefix, *parts):
    return prefix + hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


# ----------------------------- vendor tiers (A.4) -----------------------------
def classify_tiers(scope_lines: pd.DataFrame, params) -> pd.DataFrame:
    """Per-vendor tier within a scope (e.g. one L2 category). First match wins.
    scope_lines: fact rows with vendor_id, net_spend_usd, l3_code, is_oem."""
    KS, KG = params.num("tier_keep_spend"), params.num("tier_keep_segs")
    LV, CO = params.num("tier_leverage_spend"), params.num("tier_consolidate_spend")
    g = scope_lines.groupby("vendor_id").agg(
        spend=("net_spend_usd", "sum"), segs=("l3_code", "nunique"),
        lines=("net_spend_usd", "size"), is_oem=("is_oem", "max")).reset_index()

    def tier(r):
        if bool(r["is_oem"]):
            return "Keep — OEM/sole-source"
        if r["spend"] >= KS or r["segs"] >= KG:
            return "Keep — strategic/broad"
        if r["spend"] >= LV:
            return "Leverage — negotiate"
        if r["spend"] >= CO:
            return "Consolidate — fold to winner"
        return "Exit — tail/maverick"

    g["tier"] = g.apply(tier, axis=1)
    return g


# ----------------------------- maverick (A.8) -----------------------------
def maverick_stats(scope_lines: pd.DataFrame, params) -> dict:
    """micro = spend < mav_micro_spend AND lines <= mav_micro_lines ; one_po = lines == 1.
    Note: 'lines' = cube spend-lines (coarser than PO lines; reconciles to ~99% of the
    discovery — exact when joined to cim.po_line counts)."""
    ms, ml = params.num("mav_micro_spend"), params.num("mav_micro_lines")
    g = scope_lines.groupby("vendor_id").agg(spend=("net_spend_usd", "sum"),
                                             lines=("net_spend_usd", "size"))
    micro = g[(g["spend"] < ms) & (g["lines"] <= ml)]
    onepo = g[g["lines"] == 1]
    return {
        "micro_vendors": int(len(micro)), "micro_spend": round(float(micro["spend"].sum()), 2),
        "one_po_vendors": int(len(onepo)), "one_po_spend": round(float(onepo["spend"].sum()), 2),
    }


def _savings_band(lever, movable, params):
    policy = params.get("savings_rate_policy")
    if policy == "flat":
        return movable * params.num("savings_rate_low"), movable * params.num("savings_rate_high")
    if lever == LEVER_CONSOLIDATE:
        key = "consolidate_incumbent"
    elif lever == LEVER_CARVEOUT:
        key = "services_ratecard"
    else:  # RFP, or sub-classify (directional band at the category level)
        key = "competitive_rfp"
    lo, hi = params.rate_range(f"savings_rate.{key}")
    return movable * lo, movable * hi


# ----------------------------- opportunity generation -----------------------------
def generate_opportunities(pockets, fact, cim_vendor, params, *, run_id, scan=None):
    """Returns {opportunity, opportunity_recommendation, opportunity_evidence_factor,
    opportunity_vendor, opportunity_trigger} dataframes for the qualifying pockets."""
    pmin, vmin = params.num("play_min_spend"), params.num("play_min_vendors")
    engineered = {str(x).strip() for x in params.list_("engineered_segments")}
    wcons = params.num("winner_share_consolidate")
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    vmeta = cim_vendor.set_index("vendor_id") if not cim_vendor.empty else pd.DataFrame()
    cat_score = {}
    if scan is not None and not scan.empty:
        cat_score = scan.set_index("l2_code")[["score", "prize_index", "feasibility", "provability"]].to_dict("index")

    fact = fact.copy()
    fact["net"] = pd.to_numeric(fact["net_spend_usd"], errors="coerce").astype("float64").fillna(0.0)
    fact["is_oem"] = fact["is_oem"].astype(bool)

    # N/A-L3 pockets (no sub-commodity classification in the cube) are KEPT — they route to
    # "sub-classify" below (a review lever), NOT consolidate/RFP, so the IS anchor is untouched.
    q = pockets[(pockets["pocket_spend"] >= pmin) & (pockets["vendor_count"] >= vmin)].copy()

    # Deep-dive scope: only the top-N scan-ranked sub-categories spawn plays (the discovery
    # focused on the top 5). Lower-ranked categories are still scored on the cockpit but don't
    # generate individual opportunities until promoted. top_n <= 0 disables the cap.
    top_n = int(params.num("scan_deep_dive_top_n"))
    if top_n > 0 and scan is not None and not scan.empty:
        rank_col = "rank" if "rank" in scan.columns else "score"
        ascending = rank_col == "rank"  # rank 1 = best; score: higher = better
        in_scope = set(scan.sort_values(rank_col, ascending=ascending).head(top_n)["l2_code"])
        q = q[q["l2_code"].isin(in_scope)]

    opps, recs, facs, vends, trigs = [], [], [], [], []
    for _, pk in q.iterrows():
        l3c, country = pk["l3_code"], pk["purchasing_country"]
        l3 = _l3name(l3c)
        # Unclassified sub-commodity (no L3 in the cube): surface at the L2 level as a review
        # item — a mixed pocket isn't one sourcing scope until the part master splits it.
        heterogeneous = l3 == "N/A"
        display_l3 = _l3name(pk["l2_code"]) if heterogeneous else l3
        pocket_spend = float(pk["pocket_spend"])
        oem_spend = float(pk["oem_spend"])
        engineered_pocket = l3 in engineered

        fp = fact[(fact["l3_code"] == l3c) & (fact["purchasing_country"] == country)]
        vspend = fp.groupby("vendor_id").agg(spend=("net", "sum"), oem=("is_oem", "max"))
        nonoem = vspend[~vspend["oem"].astype(bool)]
        winner_id = nonoem["spend"].idxmax() if len(nonoem) else None
        winner_spend = float(nonoem["spend"].max()) if len(nonoem) else 0.0
        winner_share = winner_spend / pocket_spend if pocket_spend else 0.0

        if heterogeneous:
            lever, route = LEVER_SUBCLASSIFY, "sub-classify"
            movable = max(0.0, pocket_spend - oem_spend)  # directional, at the category level
            prov_flag = "needs-subclassification"
            contest = ("This pocket has no sub-commodity (L3) classification in the source data, so it "
                       "bundles unlike items — it is not a single sourcing scope. Figures are directional "
                       "at the category level; split it into coherent sub-categories (the part / spec "
                       "master re-run does this) before running any sourcing event.")
        elif engineered_pocket:
            lever, route = LEVER_CARVEOUT, "carve-out"
            movable = 0.0
            prov_flag = "needs-part-master"
            contest = ("These are engineered / OEM spare parts — sole-source, so they can't be "
                       "competitively bid. Tracked for a should-cost review, not consolidation.")
        elif winner_share >= wcons:
            lever, route = LEVER_CONSOLIDATE, "consolidate"
            movable = max(0.0, pocket_spend - winner_spend - oem_spend)
            prov_flag, contest = None, ("This is an upper estimate — the addressable figure is the spend "
                                        "beyond the incumbent, and some of it may turn out to be sole-source. "
                                        "We confirm against the part master before committing.")
        else:
            lever, route = LEVER_RFP, "rfp"
            movable = max(0.0, pocket_spend - oem_spend)
            prov_flag, contest = None, ("This is an upper estimate — the addressable figure is all the non-OEM "
                                        "spend in this category. Some may prove sole-source or already at "
                                        "market; we confirm against the part master before committing.")

        sav_lo, sav_hi = _savings_band(lever, movable, params)
        winner_name = vmeta.loc[winner_id, "vendor_name"] if (winner_id is not None and winner_id in vmeta.index) else None
        winner_status = vmeta.loc[winner_id, "supplier_status"] if (winner_id is not None and winner_id in vmeta.index) else None
        cs = cat_score.get(pk["l2_code"], {})

        oid = _oid("O", run_id, l3c, country)
        rid = _oid("R", run_id, l3c, country)
        opps.append({
            "id": oid, "opportunity_key": _oid("K", l3c, country), "run_id": run_id,
            "title": f"{display_l3} · {country}", "l1_code": pk["l1_code"], "l2_code": pk["l2_code"], "l3_code": l3c,
            "business_unit": pk["business_unit"], "purchasing_country": country, "region": None, "location_id": None,
            "primary_lever": lever, "play_route": route, "status": "surfaced",
            "addressable_value": round(float(pk["addressable"]), 2), "movable_value": round(movable, 2),
            "identified_value": round(sav_hi, 2), "savings_rate_basis": params.get("savings_rate_policy"),
            "recommended_lead_vendor_id": winner_id, "lead_vendor_status": winner_status,
            "score": round(float(cs.get("score", 0.0)), 1), "provability_flag": prov_flag,
            "contestability_note": contest,
            "data_quality_flag": ("needs-subclassification" if heterogeneous else pk.get("data_quality_flag")),
            "committed_value": None, "realized_value": None, "shibumi_initiative_id": None,
            "owner": None, "parked_revisit_trigger": None, "dismissed_reason": None, "lapsed_reason": None,
            "created_at": now, "updated_at": now,
        })
        recs.append({
            "id": rid, "opportunity_id": oid, "run_id": run_id, "primary_lever": lever, "play_route": route,
            "prize": round(float(cs.get("prize_index", 0.0)), 4), "feasibility": round(float(cs.get("feasibility", 0.0)), 4),
            "provability": round(float(cs.get("provability", 0.0)), 4), "score": round(float(cs.get("score", 0.0)), 1),
            "movable_value": round(movable, 2), "savings_lo": round(sav_lo, 2), "savings_hi": round(sav_hi, 2),
            "savings_rate": params.get("savings_rate_policy"),
            "rationale": _rationale(lever, display_l3, country, winner_name, winner_share, pocket_spend, oem_spend, movable),
            "confidence_pct": round(float(cs.get("provability", 0.0)) * 100, 1),
            "methodology_version": params.version, "model_version": None, "generated_at": now,
        })
        # evidence factors — score decomposition + movable math (ordered)
        facs.extend(_evidence_factors(rid, cs, pocket_spend, winner_name, winner_spend,
                                      oem_spend, movable, lever, route))
        # vendor landscape (with tier)
        vends.extend(_vendor_landscape(oid, fp, vspend, winner_id, vmeta, pocket_spend, params))
        trigs.append({"id": _oid("T", oid), "opportunity_id": oid,
                      "label": "Fragmented spend pocket", "sort_order": 1,
                      "detail": f"{int(pk['vendor_count'])} vendors · top 3 hold "
                                f"{float(pk['top3_share'])*100:.0f}% of spend — surfaced by the scan engine."})

    cols = {
        "opportunity": opps, "opportunity_recommendation": recs,
        "opportunity_evidence_factor": facs, "opportunity_vendor": vends, "opportunity_trigger": trigs,
    }
    return {k: pd.DataFrame(v) for k, v in cols.items()}


def _rationale(lever, l3, country, winner, share, pocket, oem, movable):
    if lever == LEVER_SUBCLASSIFY:
        return (f"{l3} in {country} has no sub-commodity classification in the source data — it bundles "
                f"unlike items, so it isn't one sourcing scope. Split it (part-master re-run) before sourcing.")
    if lever == LEVER_CARVEOUT:
        return f"{l3} in {country} is an engineered/OEM segment — proprietary spares are sole-source; route to OEM should-cost, not consolidation."
    # Note: the movable math (pocket − winner − OEM) is shown in the savings derivation, so the
    # rationale states only the *why this lever*, not the figures (avoids repeating the breakdown).
    if lever == LEVER_CONSOLIDATE:
        return (f"{winner} already holds {share*100:.0f}% of {l3} in {country} — consolidate the "
                f"tail onto the incumbent rather than competing it.")
    return (f"No dominant incumbent in {l3} / {country} (largest non-OEM {share*100:.0f}%) — compete "
            f"the non-OEM base with an RFP rather than folding it to one vendor.")


def _evidence_factors(rid, cs, pocket, winner_name, winner_spend, oem_spend, movable, lever, route):
    """Ordered rows powering 'how is this calculated?': score decomposition + the movable math."""
    rows, so = [], 0

    def add(name, value, text, positive=True, weight=None):
        nonlocal so
        so += 1
        rows.append({"id": _oid("F", rid, so), "recommendation_id": rid, "factor_name": name,
                     "observed_value": value, "weight": weight, "impact_text": text,
                     "impact_positive": positive, "sort_order": so})

    # score decomposition (category scan)
    add("Prize (relative size)", round(float(cs.get("prize_index", 0.0)), 2), "category size vs the largest MRO category (A.3)")
    add("Feasibility", round(float(cs.get("feasibility", 0.0)), 2), "fragmentation + cross-BU headroom")
    add("Provability", round(float(cs.get("provability", 0.0)), 2), "evidence strength (weighted ^2 in the score)")
    # movable-spend math (the contract-critical ordered rows)
    add("Pocket spend", round(pocket, 2), "total spend in this L3 x country pocket", True)
    if lever == LEVER_CONSOLIDATE:
        add("− Winner (incumbent kept)", round(-winner_spend, 2), f"{winner_name} retained; only the tail moves", False)
    add("− OEM / sole-source", round(-oem_spend, 2), "OEM / sole-source spend removed — can't be competitively bid", False)
    # UI term = "Addressable" (the contestable spend). The DB column stays `movable_value`; only the
    # user-facing label is "Addressable" — the engine's fact-level addressable_value is not shown.
    add("= Addressable", round(movable, 2), "contestable spend (upper estimate — confirmed against the part master)", True)
    return rows


def _vendor_landscape(oid, fp, vspend, winner_id, vmeta, pocket_spend, params):
    KS, KG = params.num("tier_keep_spend"), params.num("tier_keep_segs")
    LV, CO = params.num("tier_leverage_spend"), params.num("tier_consolidate_spend")
    segs = fp.groupby("vendor_id")["l3_code"].nunique()
    rows = []
    for vid, r in vspend.sort_values("spend", ascending=False).iterrows():
        spend = float(r["spend"]); is_oem = bool(r["oem"]); nseg = int(segs.get(vid, 1))
        if is_oem:
            tier = "Keep — OEM/sole-source"
        elif spend >= KS or nseg >= KG:
            tier = "Keep — strategic/broad"
        elif spend >= LV:
            tier = "Leverage — negotiate"
        elif spend >= CO:
            tier = "Consolidate — fold to winner"
        else:
            tier = "Exit — tail/maverick"
        cap = vmeta.loc[vid, "capability_class"] if vid in vmeta.index else None
        status = vmeta.loc[vid, "supplier_status"] if vid in vmeta.index else None
        rows.append({"id": _oid("OV", oid, vid), "opportunity_id": oid, "vendor_id": vid,
                     "spend": round(spend, 2), "share": round(spend / pocket_spend, 4) if pocket_spend else 0.0,
                     "tier": tier, "capability_class": cap, "is_oem": is_oem,
                     "is_winner": vid == winner_id, "supplier_status": status})
    return rows
