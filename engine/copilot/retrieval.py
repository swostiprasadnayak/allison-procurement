"""
Scoped, context-aware retrieval — the seam the team re-points at Lakebase.

`ScopedRetriever.retrieve(question, scope, view_context)` returns a `RetrievalResult`: the focal
entity in view (with its full evidence), the scope-filtered opportunities relevant to the
question, supporting scan + parameter rows, and run metadata. Every record carries a citation
tag so the answer can point back at it.

`LocalGoldRetriever` reads the local Gold parquet via LocalIO. A `LakebaseRetriever` implements
the same interface in production (the only thing that changes is where rows come from); scope is
applied here as a stand-in for the team's server-side `user_scope` filter.
"""
from __future__ import annotations
import dataclasses
from abc import ABC, abstractmethod

import pandas as pd

from engine.copilot.context import ViewContext, Scope


@dataclasses.dataclass
class RetrievalResult:
    run_id: str | None
    methodology_version: str | None
    focal_kind: str | None                      # opportunity | category | vendor | None
    focal: dict | None                          # the in-view entity
    focal_recommendation: dict | None
    focal_evidence: list                        # ordered evidence_factor rows
    focal_vendors: list                         # opportunity_vendor rows (with names)
    focal_triggers: list
    opportunities: list                         # scope-filtered, question-relevant
    scan_rows: list
    params: list                                # [{param_key, value, unit, display_label, description}]
    notes: list                                 # retrieval-side notes (e.g. "scope excluded N rows")
    vendors: list = dataclasses.field(default_factory=list)  # page-level supplier roster (Suppliers page)
    portfolio_stats: dict | None = None         # roll-up over the FULL opportunity book (Layer 1)
    supplier_stats: dict | None = None          # roll-up over the FULL supplier base (Layer 1)

    def is_empty(self) -> bool:
        return not (self.focal or self.opportunities or self.scan_rows or self.vendors
                    or self.portfolio_stats or self.supplier_stats)


class ScopedRetriever(ABC):
    @abstractmethod
    def retrieve(self, question: str, *, scope: Scope, view_context: ViewContext) -> RetrievalResult:
        ...


_STOP = {"the", "a", "an", "is", "of", "in", "for", "to", "and", "or", "why", "what", "how",
         "this", "that", "my", "our", "me", "show", "which", "are", "do", "we", "play", "biggest"}
# parameters worth surfacing for explainability (lever routing + savings); plus any keyword hits
_KEY_PARAMS = {"winner_share_consolidate", "savings_rate", "engineered_segments",
               "scan_provability_weight", "cost_of_capital"}


def _tokens(q: str) -> set:
    return {w for w in "".join(c.lower() if c.isalnum() else " " for c in q).split()
            if w and w not in _STOP and len(w) > 2}


# Layer 1 relevance — when to attach the FULL-dataset roll-ups. Aggregate questions
# ("how many suppliers", "which vendors serve both", "total movable") need totals over the
# whole book, not the focal excerpt; these keyword sets decide when to run the roll-up queries.
_VENDOR_TOKENS = {"vendor", "vendors", "supplier", "suppliers", "serve", "serves", "serving",
                  "incumbent", "incumbents", "roster", "fragmented", "fragmentation",
                  "consolidation", "sole", "source", "spend"}
_PORTFOLIO_TOKENS = {"portfolio", "total", "totals", "many", "overall", "across", "average",
                     "opportunities", "opportunity", "savings", "pipeline", "plays", "movable",
                     "addressable", "consolidate", "rfp", "count", "compare", "rest"}


def _vendor_relevant(question: str, view_context: ViewContext) -> bool:
    if view_context.page == "vendors" or view_context.focal_kind == "vendor":
        return True
    return bool(_tokens(question) & _VENDOR_TOKENS)


def _portfolio_relevant(question: str, view_context: ViewContext) -> bool:
    # On a specific opportunity, only roll up if the question is explicitly about the whole book.
    if view_context.focal_kind == "opportunity":
        return bool(_tokens(question) & _PORTFOLIO_TOKENS)
    return True


class LocalGoldRetriever(ScopedRetriever):
    def __init__(self, io):
        self.io = io
        self._cache = {}

    def _read(self, schema, table):
        key = f"{schema}.{table}"
        if key not in self._cache:
            self._cache[key] = self.io.read(schema, table) if self.io.exists(schema, table) else pd.DataFrame()
        return self._cache[key]

    def _vendor_names(self):
        v = self._read("cim", "vendor")
        return v.set_index("vendor_id")["vendor_name"].to_dict() if not v.empty else {}

    def _pick_run(self, opp, view_context):
        if view_context.run_id:
            return view_context.run_id
        if opp.empty or "run_id" not in opp.columns:
            return None
        return opp["run_id"].value_counts().idxmax()   # the run with the most opportunities

    def retrieve(self, question, *, scope, view_context):
        opp = self._read("opp", "opportunity")
        rec = self._read("opp", "opportunity_recommendation")
        ef = self._read("opp", "opportunity_evidence_factor")
        ovd = self._read("opp", "opportunity_vendor")
        trg = self._read("opp", "opportunity_trigger")
        scan = self._read("opp", "scan_ranking")
        prm = self._read("opp", "engine_parameter")
        names = self._vendor_names()
        notes = []

        run_id = self._pick_run(opp, view_context)
        if run_id and "run_id" in opp.columns:
            opp = opp[opp["run_id"] == run_id]
        methodology_version = None
        if not rec.empty and "methodology_version" in rec.columns and len(rec):
            methodology_version = str(rec["methodology_version"].iloc[0])

        # scope filter (stand-in for the team's server-side user_scope)
        before = len(opp)
        opp = opp[opp.apply(lambda r: scope.allows(r.to_dict()), axis=1)] if not opp.empty else opp
        if before - len(opp) > 0:
            notes.append(f"scope excluded {before - len(opp)} opportunity rows")
        in_scope_ids = set(opp["id"]) if not opp.empty else set()

        focal = focal_rec = None
        focal_ef, focal_v, focal_t = [], [], []
        focal_kind = view_context.focal_kind

        def _evidence_for(opp_id):
            if rec.empty:
                return None, []
            rr = rec[rec["opportunity_id"] == opp_id]
            if rr.empty:
                return None, []
            r0 = rr.iloc[0].to_dict()
            efs = ef[ef["recommendation_id"] == r0["id"]].sort_values("sort_order") if not ef.empty else pd.DataFrame()
            return r0, [e.to_dict() for _, e in efs.iterrows()]

        def _vendors_for(opp_id):
            if ovd.empty:
                return []
            vv = ovd[ovd["opportunity_id"] == opp_id].sort_values("spend", ascending=False)
            out = []
            for _, r in vv.iterrows():
                d = r.to_dict(); d["vendor_name"] = names.get(d.get("vendor_id"), d.get("vendor_id"))
                out.append(d)
            return out

        def _triggers_for(opp_id):
            if trg.empty:
                return []
            tt = trg[trg["opportunity_id"] == opp_id].sort_values("sort_order")
            return [t.to_dict() for _, t in tt.iterrows()]

        # ---- focal resolution (only within scope) ----
        if focal_kind == "opportunity" and view_context.opportunity_id in in_scope_ids:
            focal = opp[opp["id"] == view_context.opportunity_id].iloc[0].to_dict()
            focal_rec, focal_ef = _evidence_for(focal["id"])
            focal_v, focal_t = _vendors_for(focal["id"]), _triggers_for(focal["id"])
        elif focal_kind == "opportunity":
            notes.append("requested opportunity is out of scope or not in this run — not shown")
            focal_kind = None
        elif focal_kind == "category" and not scan.empty:
            cc = view_context.category_code
            srow = scan[(scan["l2_code"] == cc) | (scan["sub_category"] == cc)]
            if not srow.empty:
                focal = srow.sort_values("score", ascending=False).iloc[0].to_dict()
        elif focal_kind == "vendor" and view_context.vendor_id:
            vid = view_context.vendor_id
            vdf = self._read("cim", "vendor")
            vm = vdf[vdf["vendor_id"] == vid] if not vdf.empty else vdf
            if not vm.empty:
                focal = vm.iloc[0].to_dict()
                # the vendor's opportunity memberships (role/spend per pocket), with opp titles
                vrows = ovd[ovd["vendor_id"] == vid] if not ovd.empty else ovd
                fv = []
                for _, r in vrows.iterrows():
                    d = r.to_dict()
                    om = opp[opp["id"] == d.get("opportunity_id")]
                    d["opportunity_title"] = om.iloc[0]["title"] if not om.empty else d.get("opportunity_id")
                    fv.append(d)
                focal_v = fv[:12]
            else:
                notes.append("requested vendor not found in scope — not shown")
                focal_kind = None

        # ---- relevant opportunities ----
        relevant = []
        if focal_kind == "opportunity" and focal:
            # the focal play + its siblings in the same L2 (for "compared to others" questions)
            sib = opp[opp["l2_code"] == focal.get("l2_code")] if "l2_code" in opp.columns else opp
            relevant = [focal] + [r.to_dict() for _, r in sib.iterrows() if r["id"] != focal["id"]][:5]
        elif focal_kind == "vendor" and focal:
            # the opportunities this vendor appears in
            ids = {d.get("opportunity_id") for d in focal_v}
            relevant = [r.to_dict() for _, r in opp.iterrows() if r["id"] in ids][:6]
        elif not opp.empty:
            toks = _tokens(question)
            def score_row(r):
                hay = " ".join(str(r.get(c, "")) for c in ("title", "l2_code", "l3_code", "purchasing_country", "primary_lever", "play_route")).lower()
                return sum(1 for t in toks if t in hay)
            ranked = sorted((r.to_dict() for _, r in opp.iterrows()),
                            key=lambda r: (score_row(r), float(r.get("movable_value") or 0)), reverse=True)
            relevant = ranked[:6]

        # ---- supporting scan rows (scope-filtered by category, like opportunities) ----
        scan_rows = []
        if not scan.empty:
            s = scan.copy()
            if not scope.enterprise and scope.l2_categories and "l2_code" in s.columns:
                s = s[s["l2_code"].isin(scope.l2_categories)]
            if focal and focal.get("l2_code") and "l2_code" in s.columns:
                s = pd.concat([s[s["l2_code"] == focal["l2_code"]], s]).drop_duplicates("id")
            scan_rows = [r.to_dict() for _, r in s.sort_values("score", ascending=False).head(6).iterrows()]

        # ---- parameters (explainability) ----
        params = []
        if not prm.empty:
            toks = _tokens(question)
            for _, r in prm.iterrows():
                k = r["param_key"]
                if k in _KEY_PARAMS or any(t in k.lower() for t in toks):
                    params.append({"param_key": k, "value": r.get("value_numeric") if pd.notna(r.get("value_numeric")) else r.get("value_json"),
                                   "unit": r.get("unit"), "display_label": r.get("display_label"),
                                   "description": r.get("description")})

        return RetrievalResult(
            run_id=run_id, methodology_version=methodology_version, focal_kind=focal_kind,
            focal=focal, focal_recommendation=focal_rec, focal_evidence=focal_ef,
            focal_vendors=focal_v, focal_triggers=focal_t, opportunities=relevant,
            scan_rows=scan_rows, params=params, notes=notes)


class PostgresRetriever(ScopedRetriever):
    """Reads the served CDM (Postgres) — the same data the FE APIs query. Lean by design: for a
    focal opportunity it pulls just that play's recommendation + evidence + top vendors + trigger
    (+ a couple of params), keeping the grounding context — and the token cost — small."""

    KEY_PARAMS = ("winner_share_consolidate", "savings_rate", "cost_of_capital")

    def __init__(self, engine, *, top_vendors: int = 8):
        self.engine = engine          # sqlalchemy Engine
        self.top_vendors = top_vendors

    def _rows(self, sql, **p):
        from sqlalchemy import text
        with self.engine.connect() as c:
            return [dict(r._mapping) for r in c.execute(text(sql), p)]

    def _one(self, sql, **p):
        rows = self._rows(sql, **p)
        return rows[0] if rows else None

    def retrieve(self, question, *, scope, view_context):
        notes = []
        focal = focal_rec = None
        focal_ef, focal_v, focal_t = [], [], []
        focal_kind = view_context.focal_kind
        run_id = methodology_version = None

        if focal_kind == "opportunity" and view_context.opportunity_id:
            oid = view_context.opportunity_id
            focal = self._one(
                "SELECT id, title, primary_lever, play_route, status, addressable_value, "
                "movable_value, score, provability_flag, contestability_note, data_quality_flag, "
                "business_unit, l2_code FROM opp.opportunity WHERE id = :oid", oid=oid)
            if not focal:
                notes.append("requested opportunity not found in CDM")
                focal_kind = None
            else:
                if not scope.allows(focal):
                    notes.append("requested opportunity is out of scope — not shown")
                    return RetrievalResult(None, None, None, None, None, [], [], [], [], [], [], notes)
                focal_rec = self._one(
                    "SELECT id, prize, feasibility, provability, score, savings_lo, savings_hi, "
                    "savings_rate, rationale, methodology_version, run_id FROM "
                    "opp.opportunity_recommendation WHERE opportunity_id = :oid", oid=oid)
                if focal_rec:
                    run_id, methodology_version = focal_rec.get("run_id"), focal_rec.get("methodology_version")
                    focal_ef = self._rows(
                        "SELECT id, factor_name, observed_value, impact_text, impact_positive, "
                        "sort_order FROM opp.opportunity_evidence_factor WHERE recommendation_id = "
                        ":rid ORDER BY sort_order", rid=focal_rec["id"])
                focal_v = self._rows(
                    "SELECT ov.id, ov.vendor_id, COALESCE(v.vendor_name, ov.vendor_id) AS vendor_name, "
                    "ov.spend, ov.share, ov.is_oem, ov.is_winner FROM opp.opportunity_vendor ov "
                    "LEFT JOIN cim.vendor v ON v.vendor_id = ov.vendor_id WHERE ov.opportunity_id = "
                    ":oid ORDER BY ov.spend DESC LIMIT :n", oid=oid, n=self.top_vendors)
                focal_t = self._rows(
                    "SELECT id, label, detail FROM opp.opportunity_trigger WHERE opportunity_id = "
                    ":oid ORDER BY sort_order", oid=oid)

        elif focal_kind == "vendor" and view_context.vendor_id:
            vid = view_context.vendor_id
            focal = self._one("SELECT vendor_id, vendor_name FROM cim.vendor WHERE vendor_id = :vid", vid=vid)
            if not focal:
                notes.append("requested vendor not found in CDM")
                focal_kind = None
            else:
                # the vendor's opportunity memberships (role/spend per pocket) + opp titles
                focal_v = self._rows(
                    "SELECT ov.id, ov.vendor_id, ov.opportunity_id, o.title AS opportunity_title, "
                    "ov.spend, ov.share, ov.tier, ov.is_oem, ov.is_winner "
                    "FROM opp.opportunity_vendor ov JOIN opp.opportunity o ON o.id = ov.opportunity_id "
                    "WHERE ov.vendor_id = :vid ORDER BY ov.spend DESC LIMIT 12", vid=vid)

        # free-text question with no focal entity → small title/category search
        opportunities = []
        if focal and focal_kind == "opportunity":
            opportunities = [focal]
        elif question:
            like = "%" + "%".join(w for w in question.lower().split() if len(w) > 3)[:60] + "%"
            opportunities = self._rows(
                "SELECT id, title, primary_lever, play_route, movable_value, addressable_value, "
                "score, business_unit, l2_code FROM opp.opportunity WHERE l1_code = 'L1|MRO' AND "
                "(lower(title) LIKE :like OR lower(l2_code) LIKE :like) ORDER BY movable_value DESC "
                "LIMIT 6", like=like)
            opportunities = [o for o in opportunities if scope.allows(o)]

        params = self._rows(
            "SELECT param_key, value_numeric, value_json, unit, display_label, description "
            "FROM opp.engine_parameter WHERE param_key = ANY(:keys)",
            keys=list(self.KEY_PARAMS))
        params = [{"param_key": p["param_key"],
                   "value": p["value_numeric"] if p["value_numeric"] is not None else p["value_json"],
                   "unit": p["unit"], "display_label": p["display_label"], "description": p["description"]}
                  for p in params]

        # ---- Layer 1 roll-ups: answer aggregate questions over the FULL dataset, not a focal
        # excerpt. Cheap GROUP BY totals ground the counts/sums ("how many plays", "how many
        # suppliers serve both"); the top-N roster then supplies names for "who are the biggest". ----
        portfolio_stats = None
        if _portfolio_relevant(question, view_context):
            portfolio_stats = self._one(
                "SELECT count(*) AS opp_count, "
                "count(*) FILTER (WHERE o.play_route = 'consolidate') AS n_consolidate, "
                "count(*) FILTER (WHERE o.play_route = 'rfp') AS n_rfp, "
                "count(*) FILTER (WHERE o.play_route = 'carve-out') AS n_carveout, "
                "count(*) FILTER (WHERE o.play_route = 'sub-classify') AS n_subclassify, "
                "sum(o.movable_value) AS movable_total, sum(o.addressable_value) AS addressable_total, "
                "sum(r.savings_lo) AS savings_lo_total, sum(r.savings_hi) AS savings_hi_total "
                "FROM opp.opportunity o LEFT JOIN opp.opportunity_recommendation r "
                "ON r.opportunity_id = o.id WHERE o.l1_code = 'L1|MRO'")

        # Supplier roll-up + roster — Suppliers page, a vendor focal, or any vendor-flavored
        # question (but not when drilled into a single opportunity).
        vendors = []
        supplier_stats = None
        if focal_kind != "opportunity" and _vendor_relevant(question, view_context):
            supplier_stats = self._one(
                "WITH vs AS (SELECT vendor_id, sum(net_spend_usd) AS spend, "
                "count(DISTINCT business_unit) AS bu_count FROM opp.fact_spend "
                "WHERE l1_code = 'L1|MRO' GROUP BY vendor_id) "
                "SELECT count(*) AS total_vendors, "
                "count(*) FILTER (WHERE bu_count > 1) AS serves_both, sum(spend) AS total_spend, "
                "(SELECT count(DISTINCT vendor_id) FROM opp.opportunity_vendor WHERE is_winner) "
                "AS incumbents FROM vs")
            if supplier_stats:
                # name the largest dual-entity suppliers (the top-25 roster misses smaller ones)
                supplier_stats["serves_both_top"] = self._rows(
                    "WITH vs AS (SELECT vendor_id, sum(net_spend_usd) AS spend, "
                    "count(DISTINCT business_unit) AS bu_count FROM opp.fact_spend "
                    "WHERE l1_code = 'L1|MRO' GROUP BY vendor_id) "
                    "SELECT COALESCE(cv.vendor_name, vs.vendor_id) AS vendor_name, vs.spend "
                    "FROM vs LEFT JOIN cim.vendor cv ON cv.vendor_id = vs.vendor_id "
                    "WHERE vs.bu_count > 1 ORDER BY vs.spend DESC LIMIT 10")
            vendors = self._rows(
                "WITH vs AS (SELECT vendor_id, sum(net_spend_usd) AS spend, "
                "count(DISTINCT business_unit) AS bu_count FROM opp.fact_spend "
                "WHERE l1_code = 'L1|MRO' GROUP BY vendor_id) "
                "SELECT vs.vendor_id, COALESCE(cv.vendor_name, vs.vendor_id) AS vendor_name, "
                "vs.spend, vs.bu_count, EXISTS(SELECT 1 FROM opp.opportunity_vendor ov "
                "WHERE ov.vendor_id = vs.vendor_id AND ov.is_winner) AS is_winner "
                "FROM vs LEFT JOIN cim.vendor cv ON cv.vendor_id = vs.vendor_id "
                "ORDER BY vs.spend DESC LIMIT 25")

        return RetrievalResult(
            run_id=run_id, methodology_version=methodology_version, focal_kind=focal_kind,
            focal=focal, focal_recommendation=focal_rec, focal_evidence=focal_ef,
            focal_vendors=focal_v, focal_triggers=focal_t, opportunities=opportunities,
            scan_rows=[], params=params, notes=notes, vendors=vendors,
            portfolio_stats=portfolio_stats, supplier_stats=supplier_stats)
