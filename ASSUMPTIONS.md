# Navanta Lens — Engine Assumptions Ledger

Every material assumption baked into the engine: **what** we assume, **why**, which **direction it
errors**, and what **unlocks** the real answer. Most "unlocks" are designed-for **re-runs** (the
engine is built for them), not rebuilds. Keep this current — when an assumption changes or a data
feed lands, update the row and note the run it changed in.

_Status as of 2026-07-01 · methodology `mro-layer0-v1` · combined AT + AOH MRO ($109.3M / 1,824 vendors)._

---

## 1. OEM / sole-source carve-out  *(the big one)*

**Assumption.** Spend with a confirmed OEM is **sole-source → not competitively consolidatable →
excluded from movable.**

- **What we verified:** the *vendor* is a genuine equipment OEM that makes its own branded machinery
  and supplies proprietary spares (web-verified, citation-backed; e.g. DMG Mori "resale of parts
  prohibited", Surface Combustion "parts only an OEM can provide"). 75 OEMs web-confirmed.
- **What we did NOT verify:**
  1. **Line-item sole-source** — we confirmed the vendor is an OEM, then treat *all* their spend as
     sole-source. Generic items / services an OEM also sells are swept into the carve-out too.
  2. **Same-spec contestability** — whether another vendor makes an equivalent spec (your "if another
     OEM makes the same spec, we can still consolidate"). Not tested.
  3. **Price / "best price"** — verified **nowhere** (0 price mentions in the evidence). "Buying from
     the OEM = best price" is an untested commercial assumption; **do not claim it to the client.**
- **Direction of error:** *conservative on movable* — carving the whole OEM-vendor spend likely
  **understates** movable (some carved spend is genuinely contestable). The engine flags this:
  `contestability_note = "movable = whole non-OEM base; upper bound"`, `provability_flag = needs-part-master`.
- **Unlock:** the **part/spec master** re-run — moves genuinely multi-source OEM spend back into
  movable, and enables a should-cost/price test (separately staged).
- **OEM source of truth:** `opp.vendor_classification` (setup-time, cached). The engine reads the
  cache — **no live calls at analysis time** → per-run determinism. Verified set supersedes the
  substring anchor only on sign-off.

## 2. Movable = upper bound on contestable spend

**Assumption.** `Consolidate → movable = pocket − winner(incumbent) − OEM`; `RFP → movable = pocket − OEM`.
The non-OEM base is treated as fully contestable.

- **Direction:** *upper bound* — some non-OEM spend is sticky/at-market and won't actually move.
- **Unlock:** award outcomes + realization (M9) calibrate realized-vs-identified over time.

## 3. Savings rates are lever-tiered heuristics

**Assumption.** consolidate-to-incumbent **4–7%** · RFP **5–8%** · fragmented tail **6–10%** ·
services **5–8%** (from `opp.engine_parameter.savings_rate`).

- **Why:** directional, defensible starting bands; **parameterized** (change without code).
- **Direction:** indicative, **not contractual**. Wide bands on purpose.
- **Unlock:** category benchmarks + negotiated outcomes tighten the rates per category.

## 4. `material_id` is not a cross-vendor part number

**Assumption.** ~80% single-vendor, UOM ~100% `EA`/lot → **same-item price dispersion and
should-cost are STAGED**, not computed. We do not force like-for-like.

- **Direction:** opportunity from same-item price harmonization is **not yet counted** (absent, not wrong).
- **Unlock:** part master (`material_id → mfr_part_no` is a config flag, not a rewrite).

## 5. Engineered-segment carve-out

**Assumption.** `'Machine parts'` / `'Machine Parts'` (both case variants) → engineered → OEM
carve-out, **no consolidation play**. Case-variants normalized before grouping.

- **Why:** engineered spares are spec-locked; consolidation isn't the lever.
- **Direction:** conservative (excludes from plays). Confirmed against the IS anchor.

## 6. `controlled` / `cust_directed` disqualifiers are AOH-only today

**Assumption.** These flags exist only on the AOH side in the landed data; the disqualifier is
applied **evenly** with the gap noted.

- **Direction:** AT-side customer-directed spend may be **under-excluded** (overstating addressable there).
- **Unlock:** AT-side `controlled` / `cust_directed` flags (client data) → re-run.

## 7. Benchmark = free + internal now; paid sources pluggable

**Assumption.** POC benchmark = **BLS PPI (free)** + the **internal payment-terms working-capital**
value. Index should-cost is staged.

- **Payment-terms best-in-class** = the longest term demonstrated on **≥5%** of a sub-category's spend
  (`payment_terms_best_min_share`), target floored at current DPO so WC ≥ 0. Guards against thin
  outliers (e.g. a 150-day term on 6 invoices).
- **Direction:** WC value is a conservative, demonstrated-at-scale floor.
- **Unlock:** `BenchmarkSource` adapter → Beroe / S&P / aPriori drop in unchanged.

## 8. Realization & supplier performance — what the PO data supports

**Assumption.** `opp.fact_spend_actual` is the **full PO + Non-PO ledger** (broader than the
addressable scan scope; opportunities reconcile against it by vendor × period). `baseline_run_rate`
/ `post_award_run_rate` are **NULL** until award dates + a live actuals feed land. Supplier metrics
`on_time / fill / PPV / quality` are **NULL by design** (need goods-receipt + invoice-line feeds);
`spend / po_count / lead-time-proxy` are live.

- **Direction:** these are *designed-for* nulls, not gaps — the table + logic light up when feeds land.
- **Unlock:** SAP goods-receipt + invoice-line feeds (no rebuild, just a re-run).

## 9. Scope, dedup, determinism

- **Cube scope:** engine runs on the **indirect cube** (where the acceptance anchor lives). Combined
  indirect+direct is a designed-for expansion. **MRO definition pending confirm** ($63M AT-only vs
  $109.3M combined).
- **Vendor identity:** `vendor_id` is trim-only / **case-sensitive** (not lowercased) to avoid
  collapsing distinct names; `normalized_name == cleaned name`. Fuzzy dedup is opt-in later.
- **Determinism & lineage:** same data + same parameters → identical opportunities; every row carries
  `run_id`; `engine_run.config_snapshot` records the parameter values used; `is_current` flips on
  success. Acted-on opportunities are never silently overwritten (drift flag instead).

## 10. UI term "Addressable" = the contestable/movable base

**What.** The UI labels the contestable spend **"Addressable"** across every surface (opportunity
tiles, savings waterfall, Mercer Brief, feed column, copilot prose) = the engine **`movable_value`**
(pocket − winner *if Consolidate* − OEM/sole-source). The internal engine column keeps its name
`movable_value`; only the display label changed (from "Movable").

- **Verified, not assumed:** it is the engine `movable_value` — the same figure, relabeled.
- The fact-level **`addressable_value`** (net − OEM − cust_directed, ≈96% of spend, ≈$104.5M) is
  **intentionally NOT surfaced** — it is misleadingly high. "Addressable" in the UI always means the
  contestable figure (≈$50.3M across MRO).

## 11. Opportunity decisions persist to `opp.opportunity_action`

**What.** The FE writes user decisions (approve/park/reject/unpark/save/commit) to the mutable
`opp.opportunity_action` table via `POST /api/opportunities/action`. `getOpportunities()` LEFT JOINs it
and merges the user layer over the engine defaults, so decisions **survive engine reloads** (engine Gold
is rebuilt each run, so it can't hold user state). Only the transient auto-qualify-on-open is client-side.

- **Verified.** Persisted write-back is built. No engine change needed — the table is separate from
  engine Gold.

## 12. L3 pocket names can collide (disambiguated by country + sub-category)

**What.** Pockets are keyed by L3 × country × business unit, so the L3 name alone can repeat
(e.g. "Repairs" appears as US $24.6M, India $1.2M, Italy $1.1M). The feed shows the **Country** and
**Sub-category** columns beside the L3 name, which disambiguate the rows; **Business Unit** is a filter
facet.

- **Direction:** cosmetic-only (the pockets are distinct — no double-count). The Country/Sub-category
  columns resolve it; no name-mangling needed.

## 13. The cube spans four countries (not US-only)

**What.** `purchasing_country` spans **United States** (14 opps, $38.8M movable), **Italy** (11, $7.2M),
**India** (8, $4.2M) and **China** (1). Country is a live left-aligned column and a promoted filter
facet — it genuinely disambiguates same-name pockets across geographies.

- **Verified** against the CDM (`opp.opportunity` grouped by `purchasing_country`). *(An earlier
  "all-US" read was wrong — it only sampled the US-heavy top rows.)*

## 14. Scan timestamps are UTC, displayed Eastern

**What.** The engine stamps `created_at` in **UTC**; the UI localizes it to **Eastern** for display, so
a late-evening ET run doesn't read as the next calendar day.

- **Verified:** engine writes UTC; the timezone conversion is a display concern owned by the FE.

## 15. N/A-L3 pockets surface as a "sub-classify" review lever (not dropped)

**What.** Pockets whose L3 is unclassified in the cube (`_l3name == "N/A"`) were previously **dropped**
from opportunity generation. They are now **kept** and routed to a distinct fourth lever,
`play_route = "sub-classify"` (title uses the **L2** name), flagged
`data_quality_flag = provability_flag = "needs-subclassification"`. This surfaces the 5th MRO
sub-category (**First Fill Oils / Lubricants** — Italy $5.4M, India $0.78M, Hungary $0.75M) plus ~19
other mixed pockets as review items. Movable is directional (`pocket − OEM`, RFP band 5–8%); the FE
shows a caveat, overrides the recommendation ("split before sourcing — needs the part/spec master")
and **suppresses the RFP bidder shortlist** (a mixed pocket is not one sourcing scope).

- **Anchor-safe:** the IS acceptance anchor filters `play_route ∈ {consolidate, rfp}`, so the new
  `sub-classify` route is excluded by construction — **19 plays / $11,888,232 movable holds** (all 79
  tests pass). 56 opportunities total (was ~34): 20 rfp · 10 consolidate · 4 carve-out · 22 sub-classify.
- **Why not merge into the classified pockets:** unlike items → different sourcing events; the
  part/spec-master re-run splits them into coherent L3 scopes. This is a designed-for re-run, not a rebuild.

## 15b. Deep-dive scope is capped to the top-N scan-ranked sub-categories

**What.** Opportunity generation (M7) only spawns plays for the **top-N** MRO sub-categories by scan
score — parameter `scan_deep_dive_top_n` (default **6**; `0` disables the cap). This keeps the feed on
the discovery's focus instead of sprawling across all 15 scored categories (surfacing marginal
sub-classify pockets like Consignment / Office Supplies / Cleaning Supplies). Lower-ranked categories
are still scored on the cockpit; they just don't generate individual opportunities until promoted.

- **Why 6, not 5:** the discovery deep-dived 5 (Industrial Supplies, Chemicals, Machine/Equipment
  Repairs, First Fill Oils, Industrial Gas). The current scan edges **Electrical & Electronics** (#5,
  feasibility-driven) *above* **Industrial Gas** (#6). Rather than drop either, we surface **both**
  (top-6) pending a **client call** on the final scope. Client can dial it to 5 later (no code change).
- **Feasibility, not size, is why Electrical outranks Industrial Gas:** score = Prize × Feasibility ×
  Provability². Industrial Gas is bigger (Prize 0.078 vs 0.045) and cleaner (Prov 0.965 vs 0.866) but
  far less feasible (0.30 vs 0.68) — it's concentrated (top-3 hold ~57%) and near single-division
  (xbu 0.07). Electrical is fragmented (top-3 ~36%) and cross-BU (xbu 0.30). The multiplicative score
  rewards *actionable* leverage over raw size.
- **Anchor-safe:** Industrial Supplies is #1, always in scope — 19 plays / $11,888,232 holds (all 79
  tests pass). Feed = 50 opps across 6 categories (was 12 uncapped).

## 16. The vendor "score" is a data-confidence indicator, not a performance score

**What.** The Vendors screen composite is **not** vendor merit — it measures how complete/evidenced OUR
data on the vendor is. Reframed to three honest dimensions: **Classification evidence** (0.4, driven by
classification provenance — web 90 / model-knowledge 65 / heuristic 40), **Operational data** (0.3,
lead-time on file), **Transaction history** (0.3, PO-level actuals vs cube-only). Being an OEM is shown
as a note, **not** rewarded with points (that would conflate "is OEM" with "good vendor"). Labeled
"Data confidence" throughout the UI (column, KPI, breakdown card).

- **Why:** the old criteria (`isOem ? 90 : 55`) read as a performance/quality score we cannot yet
  substantiate. Real performance (quality, OTD, price) is a part-master / SAP-actuals re-run.

## 17. OEM set is parameterized; verified-web ADOPTED; substring anchor preserved as a fidelity test

**What.** `oem_definition` (param) selects the OEM carve-out set. **Client adopted `verified_web`**
(citation-backed web verdicts supersede the substring proxy) as the production default; **MRO scope
confirmed = AT + AOH combined ($109.3M / 1,824 vendors)** (the engine default). Impact of verified-web:
IS 19-play movable $11,888,232 → **$11,518,165** (−3.1%); total MRO movable $70.95M → **$67.37M**
(−5.0%); structure unchanged (19 IS plays, 50 opps, same top-6). The extra OEM vendors (IS 16→53) sit
mostly in already-carved engineered/tail spend, so movable barely moves.

- **Anchor preserved, not discarded.** The $11,888,233 substring reconciliation now runs IN-PROCESS
  (`classification=None`) via the `sub` fixture in `test_stage4_opportunities.py` and the `scan` fixture
  in `test_stage4_scan.py` — guaranteed regardless of the production OEM choice. The stage3/stage4 jobs
  assert the substring reference only when `oem_definition == substring`; under a verified set they
  report the verified numbers. All 79 tests pass.
- **Reversible / re-runnable:** set `oem_definition` to `substring` (reproduce the discovery exactly) or
  `verified_all` (web + model-knowledge; IS $11,502,871 / MRO $67.21M) — no code change.

## 18. Mercer copilot retrieval — Layer 1 (curated aggregates) built; Layer 2 (text-to-SQL) planned

**What.** The copilot answers over the served CDM (Postgres) via **curated, cited retrieval** — no
ontology/KG, no free-form SQL. **Layer 1 (built)** adds full-dataset roll-ups so aggregate questions
answer over the whole book instead of a top-N excerpt: **portfolio totals** (opp count by route,
movable, addressable, savings range) and **supplier totals** (distinct suppliers, serve-both count,
incumbents, total spend) via GROUP-BY, plus a top-25 roster + a top-10 serves-both roster for names.
Roll-ups are gated by page/question relevance so a focal-opportunity answer stays tight. **Layer 2
(planned)** = a guarded read-only text-to-SQL fallback (read-only view, statement timeout, forced
`LIMIT`, allow-listed tables/columns) for the long tail.

- **Why:** POC priority is correct-on-the-dataset + determinism + cited answers (the "no invented
  figures" guardrail). Aggregates were previously answered off a 15-row excerpt — the "only Fastenal
  serves both" defect (really **28** of 1,824 suppliers serve both AT + AOH).
- **Verified:** live queries return grounded, cited totals (28 serve both; 50 opps / $67.37M movable /
  $3.31–5.33M savings). All 13 copilot tests pass.

## 19. Methodology & Parameters admin page — numeric dials editable (save-only), structural read-only

**What.** Admin › Methodology renders `opp.engine_parameter` live (**30 params, 6 methodology
sections**) with the scan → opportunity formulas explained. **Numeric dials** (rate/share/usd/count/
weight/exponent/factor + rate ranges) are **editable**; an edit `PATCH`es the served store
(`opp.engine_parameter`) with an audit stamp (`change_note != 'seed'` marks it edited) — **save-only**:
the change applies on the engine's **next run**, not live. **Structural params** (`oem_definition`,
`engineered_segments`, `savings_rate_policy`) are **read-only** (they change engine structure and need
bespoke editors).

- **Local re-run bridge:** the engine reads params from its **Gold** store; the console writes
  **Postgres**. `jobs/apply_param_edits.py` syncs Postgres → Gold so a re-run (`apply_param_edits` →
  `stage3` → `stage4` → `load_cdm_postgres`) picks up edits. In production the engine reads the same
  store the console writes — the bridge only reconciles the local Postgres/parquet split.
- **Why save-only, not live recompute:** matches production (config edit → scheduled/triggered
  Databricks re-run); an FE-triggered synchronous engine run is a POC shim we deliberately did not build.

---

## Headline numbers under each OEM definition (current — post sub-classify + top-6 scope)

| OEM definition | IS 19-play movable | Total MRO movable | Notes |
|---|---|---|---|
| substring (anchor) | $11,888,232 | $70.95M | reproduces the validated discovery; fidelity baseline |
| **verified_web (ADOPTED)** | $11,518,165 | $67.37M | citation-backed; production default |
| verified_all | $11,502,871 | $67.21M | + model-knowledge verdicts |

Verified-web trims IS ~3% and MRO ~5% — the anchor is preserved (most extra OEMs were already in the
carved engineered/tail spend). See `reports/OEM_Rerun_Comparison.xlsx` for the original comparison.
