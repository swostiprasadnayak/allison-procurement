"""
Schema contracts — the Gold/backbone column contract, from Navanta_Lens_02_CDM_Extension.xlsx.

This is the single source of truth for table/column names: every module validates
its output against it (CLAUDE.md: "match the Gold opp.* schema to the xlsx exactly").
Tables are added here as each stage builds them. Stage 1 defines the config + lineage
tables; later stages append fact_spend, spend_pocket, opportunity, etc.

Contract = ordered column list + primary key. validate() checks a frame conforms.
"""
from __future__ import annotations

# schema.table -> {"pk": [...], "columns": [...], "stage": n}
CONTRACTS: dict[str, dict] = {
    # ---- Stage 1: config & lineage (CDM 'Config & Security' + 'Model · engine') ----
    "opp.methodology_version": {
        "pk": ["version"],
        "stage": 1,
        "columns": [
            "version", "formula_set_ref", "status",   # draft | active | superseded
            "created_by", "created_at", "notes",
        ],
    },
    "opp.methodology_agreement": {
        "pk": ["id"],
        "stage": 1,
        "columns": [
            "id", "methodology_version", "client_signoff_by",
            "signed_at", "document_ref", "status",
        ],
    },
    "opp.engine_parameter": {
        "pk": ["param_key", "methodology_version"],
        "stage": 1,
        # display_label + category are a Navanta additive extension to the CDM:
        # they make the friendly name + grouping first-class data so the Admin /
        # Methodology screen can render and let the client configure each dial
        # (description already powers per-number "how is this calculated?").
        "columns": [
            "param_key", "methodology_version", "value_numeric", "value_json",
            "unit", "display_label", "category", "description",
            "last_changed_by", "last_changed_at", "change_note",
        ],
    },
    "opp.engine_run": {
        "pk": ["run_id"],
        "stage": 1,
        "columns": [
            "run_id", "scope", "config_snapshot", "methodology_version",
            "run_date", "n_pockets", "n_opportunities", "is_current", "created_at",
        ],
    },
    # ---- Stage 2: normalized backbone (CDM 'Backbone · cim' + 'ref.taxonomy') ----
    "cim.vendor": {
        "pk": ["vendor_id"],
        "stage": 2,
        "columns": [
            "vendor_id", "vendor_number", "vendor_name", "normalized_name",
            "parent_id", "parent_name", "business_unit_scope", "is_oem",
            "capability_class", "product_lanes", "geographies", "supplier_status",
            "total_spend",   # Navanta convenience (tier inputs); not a CDM rename
        ],
    },
    "cim.product": {
        "pk": ["product_number"],
        "stage": 2,
        # cube-derived subset; SAP-only fields (uom, price_group, family...) land with ingestion.
        "columns": [
            "product_number", "material_id", "description", "id_type",
            "l1_code", "l2_code", "l3_code", "segment_class",
            "mfr_part_no", "controlled", "cust_directed",
        ],
    },
    "ref.taxonomy": {
        "pk": ["code"],
        "stage": 2,
        "columns": ["code", "level", "parent_code", "name", "unspsc_code", "segment_class_default"],
    },
    # ---- Stage 3: the star + pockets (CDM 'Model · engine') ----
    "opp.fact_spend": {
        "pk": ["id"],
        "stage": 3,
        "columns": [
            "id", "source_doc_key", "cube_source", "business_unit", "vendor_id", "item_id",
            "location_id", "l1_code", "l2_code", "l3_code", "purchasing_country", "region",
            "net_spend_usd", "qty", "uom", "unit_price_usd", "pay_terms",
            "id_type", "is_oem", "segment_class", "addressable_usd", "period_month", "run_id",
        ],
    },
    "opp.spend_pocket": {
        "pk": ["id", "run_id"],
        "stage": 3,
        "columns": [
            "id", "run_id", "l1_code", "l2_code", "l3_code", "purchasing_country", "business_unit",
            "pocket_spend", "vendor_count", "top3_share", "hhi",
            "winner_vendor_id", "winner_share", "oem_spend", "crossbu_spend",
            "segment_class", "addressable", "data_quality_flag",
        ],
    },
    # ---- Setup-time vendor verification (feeds cim.vendor.is_oem/capability_class) ----
    "opp.vendor_classification": {
        "pk": ["vendor_id"],
        "stage": 2,
        # Verified OEM/capability verdict, cached at setup. The engine reads this (not a
        # live call) so per-run determinism holds. Carries provenance for "how is this
        # calculated?": confidence + evidence + citation + source(substring|knowledge|web).
        "columns": [
            "vendor_id", "vendor_name", "is_oem", "oem_brand", "capability_class",
            "confidence", "evidence", "citation_url", "source", "model",
            "methodology_version", "verified_at",
        ],
    },
    # ---- Stage 4: scan ranking (M6) ----
    "opp.scan_ranking": {
        "pk": ["id"],
        "stage": 4,
        # category-ranking scorecard (the scan's other output, shown in the cockpit).
        # prize_index = normalized addressable spend ("Prize" in A.3); addressable = the raw $.
        "columns": [
            "id", "run_id", "l1_code", "l2_code", "sub_category", "spend", "addressable",
            "prize_index", "frag", "xbu", "feasibility", "services_share", "provability",
            "score", "savings_lo", "savings_hi", "rank",
        ],
    },
    # ---- Stage 4: opportunities (M7) ----
    "opp.opportunity": {
        "pk": ["id"],
        "stage": 4,
        "columns": [
            "id", "opportunity_key", "run_id", "title", "l1_code", "l2_code", "l3_code",
            "business_unit", "purchasing_country", "region", "location_id",
            "primary_lever", "play_route", "status", "addressable_value", "movable_value",
            "identified_value", "savings_rate_basis", "recommended_lead_vendor_id", "lead_vendor_status",
            "score", "provability_flag", "contestability_note", "data_quality_flag",
            "committed_value", "realized_value", "shibumi_initiative_id", "owner",
            "parked_revisit_trigger", "dismissed_reason", "lapsed_reason", "created_at", "updated_at",
        ],
    },
    "opp.opportunity_recommendation": {
        "pk": ["id"],
        "stage": 4,
        "columns": [
            "id", "opportunity_id", "run_id", "primary_lever", "play_route", "prize", "feasibility",
            "provability", "score", "movable_value", "savings_lo", "savings_hi", "savings_rate",
            "rationale", "confidence_pct", "methodology_version", "model_version", "generated_at",
        ],
    },
    "opp.opportunity_evidence_factor": {
        "pk": ["id"],
        "stage": 4,
        "columns": ["id", "recommendation_id", "factor_name", "observed_value", "weight",
                    "impact_text", "impact_positive", "sort_order"],
    },
    "opp.opportunity_vendor": {
        "pk": ["id"],
        "stage": 4,
        "columns": ["id", "opportunity_id", "vendor_id", "spend", "share", "tier",
                    "capability_class", "is_oem", "is_winner", "supplier_status"],
    },
    "opp.opportunity_trigger": {
        "pk": ["id"],
        "stage": 4,
        "columns": ["id", "opportunity_id", "label", "detail", "sort_order"],
    },
    # ---- Stage 5: benchmark + realization + supplier performance (M8-M10) ----
    "opp.benchmark": {
        "pk": ["id"],
        "stage": 5,
        "columns": ["id", "provider", "series_id", "period", "value", "unit", "retrieved_at"],
    },
    "opp.category_benchmark_map": {
        "pk": ["category"],   # category = L2/L3 name; resolves to l3_code via the source map
        "stage": 5,
        "columns": ["category", "provider", "series_id", "note"],
    },
    "opp.fact_spend_actual": {
        "pk": ["id"],
        "stage": 5,
        "columns": ["id", "vendor_id", "l3_code", "business_unit", "location_id", "period_month",
                    "spend_usd", "qty", "baseline_run_rate", "post_award_run_rate", "ingested_at"],
    },
    "opp.vendor_performance": {
        "pk": ["vendor_id", "period_month", "run_id"],
        "stage": 5,
        "columns": ["vendor_id", "period_month", "on_time_pct", "fill_rate_pct", "avg_lead_time_days",
                    "lead_time_drift", "ppv_pct", "quality_reject_pct", "po_count", "spend_usd", "run_id"],
    },
    # ---- Copilot core: generated drafts (CDM 'opp.play_artifact'); team owns the served table ----
    "opp.play_artifact": {
        "pk": ["id"],
        "stage": 6,
        # The copilot writes drafts here (is_draft=TRUE, never auto-sent). citations is a JSON list
        # of the evidence record ids the draft is grounded on (the "how is this calculated?" trail).
        "columns": [
            "id", "opportunity_id", "artifact_type", "title", "body", "is_draft",
            "citations", "generated_by", "model", "run_id", "created_at",
        ],
    },
}


def validate(frame, schema: str, table: str, *, strict_order: bool = False) -> None:
    """Raise if `frame` is missing contract columns (or, if strict_order, differs in order)."""
    key = f"{schema}.{table}"
    if key not in CONTRACTS:
        raise KeyError(f"No contract registered for {key}")
    expected = CONTRACTS[key]["columns"]
    actual = list(frame.columns)
    missing = [c for c in expected if c not in actual]
    if missing:
        raise ValueError(f"{key}: missing contract columns {missing}")
    if strict_order and actual[: len(expected)] != expected:
        raise ValueError(f"{key}: column order differs\n expected {expected}\n got      {actual}")


def columns(schema: str, table: str) -> list[str]:
    return list(CONTRACTS[f"{schema}.{table}"]["columns"])
