# Navanta Lens — Technical Hand-off (Allison MRO POC → Databricks)

For the engineering team standing this up in Databricks. It covers **what's built**, the **repos**,
the **data contract** (what to load and how it's shared), the **run / re-run runbook**, and how the
local POC maps to **Databricks + Unity Catalog + Lakebase**.

Read alongside: [`README.md`](README.md) (run commands), [`ASSUMPTIONS.md`](ASSUMPTIONS.md) (every
material assumption + what unlocks the real answer), and `Navanta Lens - Build Package/01 Design
Docs/` (Feature Spec Appendix A = authoritative engine logic; CDM Extension xlsx = authoritative
schema).

---

## 1. What's built vs. what you build next

**Built (this hand-off):**
- **Engine M1–M10** (`engine/core/*`, `jobs/stageN_*.py`) — normalize → pockets → scan → opportunities
  → benchmark/realization/performance. Portable Python/pandas behind an I/O adapter. Reproduces the
  discovery's acceptance anchor exactly (see §7).
- **Mercer copilot core** (`engine/copilot/*`, `services/copilot_api.py`) — scoped, cited RAG over the
  Gold evidence with a no-invented-figures guardrail. **Layer 1** curated aggregates are in
  (portfolio + supplier roll-ups); **Layer 2** (guarded text-to-SQL) is designed, not built.
- **Frontend** (`frontend/` in this repo) — Next.js console: Command Center, Opportunity Feed,
  Vendors, Value Realization, and Admin › Methodology & Parameters. Reads the CDM via `/api/*`;
  copilot panel proxies to `copilot_api`.
- **Local serving** — `jobs/load_cdm_postgres.py` lands Gold in Postgres (the local stand-in for
  Lakebase); the FE + copilot read it.

**You build next (per the module map, on top of the Gold `opp.*` contract):**
- **M11 Lakebase serving/sync** (replace local Postgres) · the production **Node API** (if not reading
  Lakebase directly) · **live SAP ingestion** (replace the file drop) · **copilot Layer 2** ·
  paid **benchmark** sources via the `BenchmarkSource` adapter.

The Gold **`opp.*` schema is the contract** — match table/column names to the CDM Extension xlsx exactly.

---

## 2. Repos

Single repo (monorepo): `Navanta-AI/allison-procurement` (private).

| Path | What |
|---|---|
| repo root | engine, copilot core, jobs, tests, params (`engine/`, `jobs/`, `config/`, `services/`) |
| `frontend/` | Next.js console (reads the CDM, proxies the copilot) — see `frontend/README.md` |

**Client data is NOT in git** (see §4). `.gitignore` keeps real Allison vendor names + spend out of
source control (engine `/data/`, `/reports/`, `*.xlsx`; frontend `node_modules`, `.env*.local`,
`src/data/fixtures/`); data is shared out-of-band.

---

## 3. The pipeline (medallion) + Databricks mapping

```
SAP extracts ─▶ BRONZE (land as-is) ─▶ SILVER (normalize) ─▶ GOLD (opp.*) ─▶ SERVE (Lakebase) ─▶ FE / copilot
   files/live        data/bronze/         M1–M3               M4–M10           M11 sync
```

| POC (local) | Databricks (production) |
|---|---|
| `data/bronze/` parquet/CSV (file drop) | Bronze Delta tables in Unity Catalog (from live SAP or landed files) |
| `engine/io/local.py` (LocalIO, parquet) | `engine/io/` DatabricksIO (Delta) — same `EngineIO` interface, swap the adapter |
| Gold parquet under `data/` | Gold Delta `opp.*` / `cim.*` / `ref.*` in Unity Catalog |
| `jobs/load_cdm_postgres.py` → local Postgres | M11 Lakebase sync (managed Postgres) — only the connection string changes |
| `services/copilot_api.py` (uvicorn) | same service, pointed at Lakebase |

The engine is written to move to Databricks by **swapping the I/O adapter** — the core logic (M1–M10)
is unchanged. All thresholds are read from `opp.engine_parameter` (no hardcoded numbers); every run is
lineage-stamped (`engine_run` / `run_id` / `config_snapshot`).

---

## 4. Input-data contract (what to load — shared separately)

**Privacy:** the source extracts contain real Allison vendor names and spend, so they are **shared
out-of-band (secure transfer), never committed to git.** The repo documents the shape; you drop the
files into `data/bronze/` (local) or land them as Bronze Delta tables (Databricks).

**The three source inputs (as used in the POC):**

| Input | What it is | Grain |
|---|---|---|
| **Spend cubes** | combined indirect + direct spend cube (the `Consol`/`C-Indirect` tabs) | one row per spend line |
| **PO ledger** (`s-pr-010`) | purchase-order lines | one row per PO line |
| **Non-PO ledger** (`fbl1n`) | non-PO / FI postings | one row per posting |

These normalize (M1–M3) into the Gold **`opp.fact_spend`** grain — the engine's single spend fact:

```
fact_spend: source_doc_key · cube_source · business_unit · vendor_id · item_id · location_id
            · l1_code · l2_code · l3_code · purchasing_country · region
            · net_spend_usd · qty · uom · unit_price_usd · pay_terms
            · id_type · is_oem · segment_class · addressable_usd · period_month · run_id
```

**Format:** prefer **Parquet** (typed); CSV is fine. The authoritative column-level schema for every
Gold table is the **CDM Extension xlsx**. The field-level **SAP → CDM mapping** is a separate
deliverable — when live SAP replaces the file drop, it populates the *same* Bronze contract, so it's a
**re-run, not a rebuild**.

**Data realities to carry over** (full detail in `ASSUMPTIONS.md`): `material_id` is not a cross-vendor
part number (~80% single-vendor) → same-item price/should-cost is staged behind
`needs-part-master`; normalize taxonomy case-dupes ("Machine parts" vs "Machine Parts") before
grouping; `controlled`/`cust_directed` are AOH-only today.

---

## 5. Run / re-run runbook

Full command sequence is in [`README.md`](README.md). Two loops matter:

**Full build** (fresh data or first run): stage1 → stage2 → stage3 → stage4 → stage5 →
build_category_footprint → init_action_store → seed_playbooks → `load_cdm_postgres` → start
`copilot_api` → start the FE.

**Parameter re-run** (after an admin edits dials on the Methodology page): the console saves edits to
`opp.engine_parameter` in Postgres. To apply them locally:

```bash
python jobs/apply_param_edits.py   # Postgres opp.engine_parameter → Gold store (bridges the local split)
python jobs/stage3_star_pockets.py
python jobs/stage4_opportunities.py
python jobs/load_cdm_postgres.py   # Gold → Postgres; FE + copilot pick up the new numbers
```

In Databricks this is a **scheduled/triggered job** (Databricks Jobs API) reading the same parameter
store the console writes — `apply_param_edits.py` exists only to reconcile the local Postgres/parquet
split. Edits are **save-only** (they apply on the next run, not live); structural params
(`oem_definition`, `engineered_segments`, `savings_rate_policy`) are read-only in the console.

**Determinism:** same data + same parameters → identical opportunities and ranking. `opp.opportunity_action`
(user decisions) is keyed on the stable `opportunity_key` and survives re-runs; the engine never
silently overwrites an acted-on opportunity (drift flag instead).

---

## 6. Copilot

FE → `/api/copilot` (proxy) → `services/copilot_api.py` (FastAPI) → `PostgresRetriever` (curated,
cited SQL over the CDM) → `grounding` (serializes rows into a cited context block) → Claude
(`claude-opus-4-8` / MockLLM offline) → guardrail (rejects figures not in the grounded set).

The FE sends a `view_context` (`page`, `opportunity_id?`, `vendor_id?`, `category_code?`) on every
call; **scope is enforced server-side — the LLM is never the scope boundary.** Layer 1 roll-ups
(portfolio + supplier totals) let it answer aggregate questions over the full dataset with citations;
Layer 2 (guarded read-only text-to-SQL) is the planned fast-follow for the long tail.

---

## 7. Acceptance anchor (must hold)

Industrial Supplies reconciles to the discovery exactly under the substring OEM baseline:
**$34,089,850 / 1,093 vendors → 19 commodity plays = $11,888,233 movable = $594k–$951k**, with the
engineered OEM carve-out and lever routing (winner_share ≥ 0.50 → Consolidate, else RFP), and vendor
tiers 16 / 19 / 53 / 163 / 842. This runs **in-process** as a config-independent fidelity test
(`tests/test_stage4_*`), so it holds regardless of the production OEM choice. Production default is
**`oem_definition = verified_web`** on **combined AT + AOH MRO** ($109.3M / 1,824 vendors → 50 opps /
$67.37M movable). All engine + copilot tests pass.
