# Navanta Lens — Engine & Copilot Core

The analysis **engine (M1–M10)** + the **Mercer copilot core** for the Navanta Lens "Category &
Opportunity Management" module, proven on Allison Transmission's MRO spend. Reads landed spend data
and writes the Gold `opp.*` tables that are the contract the app team builds against.

> **Scope.** This repo is the engine + copilot core. It does **not** include the Lakebase
> serving/sync, the Node API, the Next.js frontend, or live SAP ingestion — those are the app
> team's, built on the Gold `opp.*` tables and the copilot core defined here.

## Architecture

Portable Python core (pandas) behind a thin I/O adapter, validated locally against the methodology
reference outputs, then run on Databricks. Medallion: Bronze (landed) → Silver (normalize) → Gold
(`opp.*`). All thresholds live in `opp.engine_parameter` (no hardcoded numbers); every run is
lineage-stamped (`engine_run` / `run_id` / `config_snapshot`).

```
engine/
  core/normalize/   M1 vendor · M2 taxonomy · M3 price/uom · vendor_classifier (OEM verification)
  core/spend/       M4 fact_spend · M5 spend_pocket
  core/scan/        M6 scan score/rank
  core/opportunities/  M7 opportunities + recommendation + evidence factors + vendor + trigger
  core/benchmark/   M8 BLS adapter + payment-terms WC benchmark
  core/realization/ M9 fact_spend_actual
  core/performance/ M10 vendor_performance
  copilot/          context (view_context/scope) · retrieval · grounding · llm · guardrails · drafts · copilot
  io/               EngineIO interface · LocalIO (parquet) · DatabricksIO (skeleton)
  lineage/ schema/  run lineage · the opp.* / cim.* column contracts
jobs/               stageN_*.py runners · classify_vendors.py · copilot_demo.py
reviews/            per-stage review builders (Excel + scorecard HTML)
tests/              79 gates (engine anchor + copilot)
config/             parameter seed + taxonomy/benchmark config
```

## Run

```bash
pip install -r requirements.txt          # pandas, pyarrow, openpyxl, pyyaml, anthropic, pytest
# land the source data under data/bronze/ (cubes + PO/Non-PO — shared separately, see HANDOFF.md), then:
python jobs/stage1_foundation.py         # seed parameters + lineage
python jobs/stage2_normalize.py          # M1–M3 backbone
python jobs/stage3_star_pockets.py       # M4–M5
python jobs/stage4_opportunities.py      # M6–M7  (reproduces the acceptance anchor)
python jobs/stage5_benchmark_realization.py  # M8–M10
python jobs/build_category_footprint.py  # indirect L1 footprint (homepage estate scan)
python jobs/init_action_store.py         # opp.opportunity_action (write-back, keyed on opportunity_key)
python jobs/seed_playbooks.py            # ref.playbook (execution templates)
python -m pytest -q                      # 79 + copilot gates

# OEM verification (setup-time, needs ANTHROPIC_API_KEY):
python jobs/classify_vendors.py --classifier hybrid --mode oem_candidates

# --- Serving (local stand-in for Lakebase — powers the FE + copilot) ---
docker compose up -d                     # local Postgres CDM
python jobs/load_cdm_postgres.py         # Gold → Postgres (opp.*/cim.*/ref.*)
python -m uvicorn services.copilot_api:app --port 8000   # copilot API (MockLLM offline; ANTHROPIC_API_KEY → live)

# --- Apply admin parameter edits, then re-run (the Methodology page save loop) ---
python jobs/apply_param_edits.py         # Postgres opp.engine_parameter → Gold
python jobs/stage3_star_pockets.py && python jobs/stage4_opportunities.py && python jobs/load_cdm_postgres.py

# Copilot smoke test (offline by default; --live uses Claude opus-4-8):
python jobs/copilot_demo.py --explain top
```

The **frontend** (Next.js) lives in [`frontend/`](frontend/) and reads this Postgres CDM through
`/api/*` route handlers; the copilot panel proxies to the `services/copilot_api` service above. See
[`HANDOFF.md`](HANDOFF.md) for the full pipeline, the input-data contract, and the Databricks mapping.

## Acceptance anchor

Industrial Supplies reconciles to the discovery exactly: **$34,089,850 / 1,093 vendors → 19
commodity plays = $11,888,233 movable = $594k–$951k**, with the engineered OEM carve-out and lever
routing (winner_share ≥ 0.50 → Consolidate, else Competitive RFP).

> **Assumptions.** Every material assumption (OEM = sole-source proxy, movable = upper bound, savings
> heuristics, staged should-cost, etc.) — with its rationale, error direction, and what unlocks the
> real answer — is in [`ASSUMPTIONS.md`](ASSUMPTIONS.md). Read it before quoting a number to the client.

## Data realities

- `material_id` is not a cross-vendor part number (~80% single-vendor) → same-item price / should-cost
  is staged behind `provability_flag = needs-part-master` (a re-run, not a rebuild).
- OEM = sole-source proxy. The hybrid classifier (knowledge → web-verify) refines it; verified set
  supersedes the substring anchor only after sign-off.
- `controlled` / `cust_directed` are AOH-only today.

## Copilot core

Scoped, context-aware RAG + generation over the Gold evidence: grounded answers that cite the
records used, a guardrail that blocks invented figures, and draft generation to `opp.play_artifact`.
The frontend passes a `view_context` (page + opportunity in view); scope is enforced server-side by
the team — the LLM is never the scope boundary. See `engine/copilot/`.
