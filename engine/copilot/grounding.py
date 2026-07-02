"""
Grounding — turn retrieved rows into a cited CONTEXT block the LLM must answer from.

Produces three things from a RetrievalResult:
  - `context_text`: the only facts the LLM is allowed to use, each tagged with a numbered
    citation [C1], [C2]… so answers can point back at the exact record.
  - `citations`: [C-ref → {table, id, summary}] so the UI/team can resolve a chip to a row.
  - `allowed_values`: every figure that appears in the grounded rows — the guardrail rejects any
    significant number in an answer that isn't in this set (the "no invented figures" rule).
Also a deterministic `focal_summary` (assembled in code, not by an LLM) used as the offline
MockLLM's response and as a safe fallback.
"""
from __future__ import annotations
import dataclasses
import re

# any figure shown in the grounded context is fair for the model to quote — harvest them all
# (structured cells AND numbers embedded in text like "HHI 1098", "$759K") into allowed_values.
# The (?<![A-Za-z]) guard skips digit fragments inside ids/tags (e.g. "Vcc61b2219", "[C8]") so a
# fabricated figure can't masquerade as grounded by colliding with an id fragment.
_NUMTOK = re.compile(r"(?<![A-Za-z])(\d[\d,]*(?:\.\d+)?)\s*(%|M|K|bn)?", re.I)


def _harvest(text: str, vals: set) -> None:
    for m in _NUMTOK.finditer(text or ""):
        try:
            v = float(m.group(1).replace(",", ""))
        except ValueError:
            continue
        suf = (m.group(2) or "").lower()
        if suf == "k":
            v *= 1e3
        elif suf == "m":
            v *= 1e6
        elif suf == "bn":
            v *= 1e9
        vals.add(round(v, 4))


@dataclasses.dataclass
class Grounding:
    context_text: str
    citations: list                 # [{ref, table, id, summary}]
    allowed_values: set             # floats appearing in grounded rows
    focal_summary: str              # deterministic NL summary of the focal entity (cited)
    has_focal: bool
    staged_flags: list              # human-readable staged/provability notes on the focal


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _money(x):
    v = _f(x)
    return f"${v:,.0f}" if v is not None else "—"


class _Citations:
    """Assigns C1, C2… to records, de-duped by (table, id)."""
    def __init__(self):
        self._by_key = {}
        self.list = []

    def ref(self, table, rec_id, summary):
        key = (table, str(rec_id))
        if key not in self._by_key:
            r = f"C{len(self.list) + 1}"
            self._by_key[key] = r
            self.list.append({"ref": r, "table": table, "id": str(rec_id), "summary": summary})
        return self._by_key[key]


def ground(result) -> Grounding:
    cites = _Citations()
    vals: set = set()
    lines: list[str] = []

    def addv(*xs):
        for x in xs:
            v = _f(x)
            if v is not None:
                vals.add(round(v, 4))

    # methodology only — the run_id UUID is metadata, not useful to the model, and its
    # dash-separated hex fragments would otherwise pollute the harvested allowed-figures set.
    lines.append(f"RUN: methodology={result.methodology_version or 'n/a'}")

    staged_flags = []
    focal_summary = ""
    if result.focal and result.focal_kind == "opportunity":
        o = result.focal
        c = cites.ref("opp.opportunity", o["id"], f"{o.get('title')} — {o.get('play_route')}")
        addv(o.get("addressable_value"), o.get("movable_value"), o.get("identified_value"), o.get("score"))
        lines.append("")
        lines.append(f"FOCAL OPPORTUNITY [{c}]: {o.get('title')}")
        lines.append(f"  lever={o.get('primary_lever')} · route={o.get('play_route')} · status={o.get('status')}")
        lines.append(f"  addressable={_money(o.get('addressable_value'))} · movable={_money(o.get('movable_value'))}"
                     f" · score={o.get('score')}")
        for flag_col, label in (("provability_flag", "provability"), ("contestability_note", "contestability"),
                                ("data_quality_flag", "data quality")):
            fv = o.get(flag_col)
            if fv and str(fv).lower() not in ("nan", "none", ""):
                staged_flags.append(f"{label}: {fv}")
                lines.append(f"  {label} flag: {fv}")

        if result.focal_recommendation:
            r = result.focal_recommendation
            rc = cites.ref("opp.opportunity_recommendation", r["id"], "recommendation + savings")
            addv(r.get("prize"), r.get("feasibility"), r.get("provability"), r.get("score"),
                 r.get("savings_lo"), r.get("savings_hi"), r.get("savings_rate"), r.get("movable_value"))
            lines.append(f"  RECOMMENDATION [{rc}]: prize={r.get('prize')} feasibility={r.get('feasibility')}"
                         f" provability={r.get('provability')} → savings {_money(r.get('savings_lo'))}–{_money(r.get('savings_hi'))}"
                         f" (rate {r.get('savings_rate')})")
            if r.get("rationale"):
                lines.append(f"    rationale: {r.get('rationale')}")

        if result.focal_evidence:
            lines.append("  EVIDENCE FACTORS (ordered):")
            for e in result.focal_evidence:
                ec = cites.ref("opp.opportunity_evidence_factor", e["id"], f"{e.get('factor_name')}")
                addv(e.get("observed_value"))
                lines.append(f"    [{ec}] {e.get('factor_name')} = {e.get('observed_value')} — {e.get('impact_text')}")

        if result.focal_vendors:
            lines.append("  VENDORS:")
            for v in result.focal_vendors[:8]:
                vc = cites.ref("opp.opportunity_vendor", v["id"], f"{v.get('vendor_name')}")
                addv(v.get("spend"), v.get("share"))
                tags = []
                if v.get("is_winner"): tags.append("incumbent/winner")
                if v.get("is_oem"): tags.append("OEM")
                lines.append(f"    [{vc}] {v.get('vendor_name')} — spend={_money(v.get('spend'))}"
                             f" share={v.get('share')} {'· '.join(tags)}")

        if result.focal_triggers:
            for t in result.focal_triggers:
                tc = cites.ref("opp.opportunity_trigger", t["id"], t.get("label"))
                lines.append(f"  TRIGGER [{tc}]: {t.get('label')} — {t.get('detail')}")

        # deterministic, cited summary (offline answer + fallback)
        oc = cites.ref("opp.opportunity", o["id"], o.get("title"))
        bits = [f"{o.get('title')} is a {o.get('primary_lever')} play ({o.get('play_route')})"]
        if result.focal_recommendation:
            r = result.focal_recommendation
            rc = cites.ref("opp.opportunity_recommendation", r["id"], "recommendation")
            bits.append(f"movable spend is {_money(o.get('movable_value'))} of {_money(o.get('addressable_value'))} addressable, "
                        f"with indicative savings {_money(r.get('savings_lo'))}–{_money(r.get('savings_hi'))} [{oc}][{rc}]")
        else:
            bits.append(f"movable spend is {_money(o.get('movable_value'))} [{oc}]")
        focal_summary = ". ".join(bits) + "."
        if staged_flags:
            focal_summary += f" Note: {staged_flags[0]} (treat as staged/conservative)."

    elif result.focal and result.focal_kind == "category":
        s = result.focal
        c = cites.ref("opp.scan_ranking", s.get("id"), f"{s.get('sub_category')} scan")
        addv(s.get("addressable"), s.get("score"), s.get("rank"))
        lines.append("")
        lines.append(f"FOCAL CATEGORY [{c}]: {s.get('sub_category')} — rank #{s.get('rank')} · score {s.get('score')}"
                     f" · addressable {_money(s.get('addressable'))}")
        focal_summary = (f"{s.get('sub_category')} ranks #{s.get('rank')} with score {s.get('score')} on "
                         f"{_money(s.get('addressable'))} addressable [{c}].")

    elif result.focal and result.focal_kind == "vendor":
        v = result.focal
        vc = cites.ref("cim.vendor", v.get("vendor_id"), f"{v.get('vendor_name')}")
        lines.append("")
        lines.append(f"FOCAL SUPPLIER [{vc}]: {v.get('vendor_name')}")
        if result.focal_vendors:
            lines.append("  ROLE ACROSS OPPORTUNITIES:")
            for ov in result.focal_vendors[:10]:
                oc = cites.ref("opp.opportunity_vendor", ov["id"], f"{ov.get('opportunity_title')}")
                addv(ov.get("spend"), ov.get("share"))
                tags = []
                if ov.get("is_winner"): tags.append("incumbent/winner")
                if ov.get("is_oem"): tags.append("OEM")
                lines.append(f"    [{oc}] {ov.get('opportunity_title')} — spend={_money(ov.get('spend'))}"
                             f" share={ov.get('share')} tier={ov.get('tier')} {'· '.join(tags)}")
        n = len(result.focal_vendors)
        focal_summary = f"{v.get('vendor_name')} appears in {n} opportunit{'y' if n == 1 else 'ies'} [{vc}]."

    # portfolio totals (Layer 1) — grounds "how many plays / total movable / total savings"
    if getattr(result, "portfolio_stats", None):
        ps = result.portfolio_stats
        pc = cites.ref("opp.opportunity", "mro-portfolio", "MRO portfolio totals")
        addv(ps.get("opp_count"), ps.get("n_consolidate"), ps.get("n_rfp"), ps.get("n_carveout"),
             ps.get("n_subclassify"), ps.get("movable_total"), ps.get("addressable_total"),
             ps.get("savings_lo_total"), ps.get("savings_hi_total"))
        lines.append("")
        lines.append(f"PORTFOLIO TOTALS [{pc}] (all MRO opportunities, current run):")
        lines.append(f"  {ps.get('opp_count')} opportunities — {ps.get('n_consolidate')} consolidate · "
                     f"{ps.get('n_rfp')} competitive RFP · {ps.get('n_carveout')} OEM carve-out · "
                     f"{ps.get('n_subclassify')} sub-classify")
        lines.append(f"  movable {_money(ps.get('movable_total'))} of {_money(ps.get('addressable_total'))}"
                     f" addressable · indicative savings {_money(ps.get('savings_lo_total'))}–"
                     f"{_money(ps.get('savings_hi_total'))}")

    # supplier totals (Layer 1) — grounds "how many suppliers / how many serve both / incumbents"
    if getattr(result, "supplier_stats", None):
        ss = result.supplier_stats
        sc = cites.ref("opp.fact_spend", "mro-suppliers", "MRO supplier totals")
        addv(ss.get("total_vendors"), ss.get("serves_both"), ss.get("total_spend"), ss.get("incumbents"))
        lines.append("")
        lines.append(f"SUPPLIER TOTALS [{sc}] (all MRO suppliers, current run):")
        lines.append(f"  {ss.get('total_vendors')} distinct suppliers · {ss.get('serves_both')} serve both AT and AOH"
                     f" · {ss.get('incumbents')} consolidation incumbents · total MRO spend "
                     f"{_money(ss.get('total_spend'))}")
        if ss.get("serves_both_top"):
            lines.append("  largest suppliers serving both AT and AOH:")
            for v in ss["serves_both_top"]:
                vc = cites.ref("cim.vendor", v.get("vendor_name"), v.get("vendor_name"))
                addv(v.get("spend"))
                lines.append(f"    [{vc}] {v.get('vendor_name')} — MRO spend {_money(v.get('spend'))}")

    # relevant opportunities
    if result.opportunities:
        lines.append("")
        lines.append("RELEVANT OPPORTUNITIES (scope-filtered):")
        for o in result.opportunities:
            c = cites.ref("opp.opportunity", o["id"], o.get("title"))
            addv(o.get("movable_value"), o.get("addressable_value"), o.get("score"))
            lines.append(f"  [{c}] {o.get('title')} — {o.get('primary_lever')} · movable {_money(o.get('movable_value'))}"
                         f" · score {o.get('score')}")

    # top suppliers (Suppliers-page roster — answers aggregate vendor questions)
    if result.vendors:
        lines.append("")
        lines.append("TOP SUPPLIERS (by MRO spend, scope-filtered):")
        for v in result.vendors:
            vc = cites.ref("cim.vendor", v.get("vendor_id"), v.get("vendor_name"))
            addv(v.get("spend"))
            tags = []
            if (v.get("bu_count") or 0) > 1: tags.append("serves both AT + AOH")
            if v.get("is_winner"): tags.append("consolidation incumbent")
            lines.append(f"  [{vc}] {v.get('vendor_name')} — MRO spend {_money(v.get('spend'))}"
                         f"{' · ' + ' · '.join(tags) if tags else ''}")

    # scan ranking
    if result.scan_rows:
        lines.append("")
        lines.append("SCAN RANKING:")
        for s in result.scan_rows:
            c = cites.ref("opp.scan_ranking", s.get("id"), f"{s.get('sub_category')}")
            addv(s.get("addressable"), s.get("score"), s.get("rank"))
            lines.append(f"  [{c}] #{s.get('rank')} {s.get('sub_category')} — score {s.get('score')} · addressable {_money(s.get('addressable'))}")

    # parameters
    if result.params:
        lines.append("")
        lines.append("PARAMETERS (current values):")
        for p in result.params:
            c = cites.ref("opp.engine_parameter", p["param_key"], p.get("display_label") or p["param_key"])
            addv(p.get("value"))
            lines.append(f"  [{c}] {p['param_key']} = {p.get('value')} {p.get('unit') or ''} — {p.get('description')}")

    context_text = "\n".join(lines)
    _harvest(context_text, vals)   # any number visible in the context is quotable
    return Grounding(context_text=context_text, citations=cites.list, allowed_values=vals,
                     focal_summary=focal_summary, has_focal=bool(result.focal), staged_flags=staged_flags)
