# Navanta Lens — FE ↔ Engine Data-Binding & Domain-Remodel Plan

*Companion to `Navanta_Lens_Frontend_Gap_Plan.md`. That plan covers screens/phases; **this** covers
the data model — how the frontend's types, mock data, and stores remodel onto the engine's real Gold
`opp.*` contract, and how real Allison numbers get into the app before the Node/Lakebase API exists.*

**Decisions taken (this round):** design stays as-is (Navanta DS) · **data becomes real** · **domain
model remaps to the engine** · future edits happen directly in this FE repo.

> **As-built 2026-06-30:** the remodels in §4.1 (levers), §4.3 (lifecycle) and §4.4 (confidence/score)
> are now implemented; see below. In the UI the contestable/movable base is labeled **"Addressable"**
> (= engine `movable_value`); the decision model is **Approve / Park / Reject** with **Parked** &
> **Rejected** tabs; and all decisions (Approve/Park/Reject/Save/Commit) now **persist to
> `opp.opportunity_action`** and survive reload.

---

## 0. The mental model — three data buckets

Every field in the FE falls into one of three buckets. Knowing which tells you whether to *bind it
to the engine*, *keep it as client state*, or *leave it editorial*.

| Bucket | Who owns it | In this repo |
|---|---|---|
| **A. Engine-owned** (the analysis: opportunities, evidence, movable, vendors, scan, aggregates) | Navanta engine → Gold `opp.*` | **Bind to REAL scanned data** (engine export now → API later) |
| **B. Runtime user state** (status transitions, operator overrides, commits, realized, drift, events) | Created when a person uses the app; Node API + Lakebase persist it later | **Context stores; starts EMPTY** (fills as users act — not fabricated) |
| **C. UI-editorial / derived** (functional-fit prose, Mercer narrative, display formatting) | Frontend | **Keep**, but base figures on bucket A |

> **Not mock data.** The analysis (bucket A) is the **real MRO scan output** — we delete the
> developer's placeholder seed records in `src/data/*.ts` and bind to the engine's actual numbers.
> The "fixtures" are just the delivery mechanism (JSON file, because the API isn't built yet); the
> data is 100% real. Bucket B isn't fabricated either — it's state that doesn't exist until a
> commodity manager clicks "accept"/"commit", so it starts empty and fills at runtime. The only
> optional exception: 1–2 clearly-labeled illustrative records to demo the Monitor screen before
> any real commit exists.

The remodel is mostly **bucket A** — replacing the placeholder seed with the real engine contract —
plus four domain-model corrections that touch all three.

---

## 1. Real-data bridge (no Lakebase needed yet)

The Node/Lakebase API is the team's later build. To get **real Allison numbers in now**, the engine
exports its Gold `opp.*` to **JSON fixtures in the contract shape**; the FE's `src/data/*.ts` become
thin **API-shaped loaders** over them. Later, swap the loader's source from `import fixture` to
`fetch('/api/…')` — mechanical, no component changes (this is your dev's Phase-0 intent).

**Engine deliverable (Navanta builds): `jobs/export_fe_fixtures.py`** → writes:
```
fixtures/opportunities.json          # opp.opportunity rows (+ joined recommendation summary)
fixtures/recommendations.json        # opp.opportunity_recommendation
fixtures/evidence_factors.json       # opp.opportunity_evidence_factor (ordered)  ← the movable waterfall
fixtures/opportunity_vendors.json    # opp.opportunity_vendor (is_oem / is_winner / share / tier)
fixtures/triggers.json               # opp.opportunity_trigger
fixtures/scan_ranking.json           # opp.scan_ranking (cockpit category scorecard)
fixtures/cockpit.json                # computed aggregates (KPIs, fragmentation from pockets, savings-by-cat, terms-gap WC)
fixtures/vendors.json                # cim.vendor + vendor_performance + vendor_classification (joined)
fixtures/copilot_answers.json        # pre-generated explain-a-play per opp (interim, until the copilot endpoint exists)
```
FE side: a single `src/data/source.ts` that reads fixtures (or `fetch`) and the existing
`src/data/*.ts` re-export typed records from it.

> **⚠ Data governance.** These fixtures carry **real Allison vendor names + spend**, and
> `docs/` already holds the spend cubes (`.xlsb`) + discovery deck. This FE folder is **not a git
> repo yet** — before it becomes one and is pushed, gitignore `fixtures/`, `docs/*.xlsb`, and the
> deck (same discipline as the engine repo). Keep the repo **private**.

---

## 2. Domain-model mapping — Opportunity

`src/types/opportunity.ts` is the file to remodel first. Map (engine field → FE field), with bucket:

| FE field (current) | Engine source | Action |
|---|---|---|
| `id`, `title` | `opp.opportunity.id` / `opportunity_key` / `title` | bind (A). **As-built:** the list's **Opportunity** column is the **`l3`** commodity name **split from the title** `"{L3} · {country}"`. |
| `category` / `l2` / `country` | `l1_code` / `l2_code` / `purchasing_country` | bind (A); **add** `region`, `business_unit`, `l3_code`. **As-built:** L2 → **Sub-category** column; **Country** is its own left-aligned column + promoted filter facet (cube spans US/Italy/India/China); **Business Unit** (AT/AOH/Both) is a filter facet. |
| **`archetype`** (5-enum) | `primary_lever` + `play_route` | **replaced (as-built)** — `play_route` renders as the **Lever** pill (Consolidate / Competitive RFP / OEM carve-out); see §4.1 |
| `addressableSpend` (**Total spend** in the list) | pocket spend | bind (A). **As-built:** the list's **Total spend** column = **pocket spend**; the fact-level `addressable_value` tile is **not surfaced** (misleadingly high). |
| **(missing)** `movableValue` → **Addressable** | `movable_value` | **as-built:** added as the headline number and labeled **"Addressable"** in the UI (replaces "Movable"). |
| `savingsLow` / `savingsHigh` | `recommendation.savings_lo` / `savings_hi` | bind (A) |
| `confidencePct` | `recommendation.confidence_pct` | bind (A) — **as-built:** = Provability × 100 (per-opportunity **Confidence** column); the category-level scan **score** is cockpit-only and not shown per opp. See §4.4. |
| `fitFactor` | `recommendation.feasibility` | bind (A) — rename concept to *Feasibility* |
| `fragmentationGap` | `scan_ranking.frag` / trigger HHI | demote to an *evidence* detail, not a headline |
| `evidenceBasis` | `savings_rate_basis` + benchmark-availability | bind (A); relabel |
| `status` | `status` (`surfaced` only from engine) | bind initial; transitions = **bucket B** (§4.3). **As-built:** Approve→`accepted`, Park→`parked` (+`parkTrigger`), Reject→`rejected` (+`rejectReason`); **persisted to `opp.opportunity_action`** via `POST /api/opportunities/action` (survives reload). |
| `mercerSummary` / `rationale[]` / `recommendedAction` | `recommendation.rationale` (+ copilot later) | bind (A) |
| **`fragmentedSide` / `consolidatedSide`** | `opportunity_vendor` + evidence factors | **replace** — see §4.2 |
| `vendorIds[]` / `vendorCount` | `opportunity_vendor.vendor_id` / real pocket vendor count | bind (A). **As-built:** `vendorCount` → the list's **Vendors** column. |
| `exclusions[]` | `evidence_factor` rows with `impact_positive=false` (`− Winner`, `− OEM`) | bind (A) — derive from the waterfall |
| `caveats[]` | `provability_flag` + `contestability_note` + `data_quality_flag` | bind (A) |
| `functionalFit` | — (no engine source) | **keep editorial (C)** |
| `userInput` (overrides) | — | **keep store state (B)** |
| `owner` / `committedAt` / `milestones` / `ramp` / `drift` | `owner`/`committed_value`/`realized_value`/`shibumi_initiative_id` on opp; `milestones`/`ramp` = `value_realization` (team) | **bucket B** — mock now |
| `events[]` | `opportunity_event` (team OLTP) | **bucket B** — mock now |
| **(missing)** `recommendedLeadVendorId` | `recommended_lead_vendor_id` | **add** — the incumbent/anchor for consolidate plays |

---

## 3. Domain-model mapping — Vendor & Dashboard

**Vendor** (`src/types/vendor.ts`, `src/data/vendors.ts`):
| FE field | Engine source | Note |
|---|---|---|
| `id` / `name` | `cim.vendor.vendor_id` / `vendor_name` | bind |
| `entity` | `business_unit_scope` (AT/AOH/both) | bind |
| `category` / `subcategory` | derive from fact L1/L2 (not on cim.vendor) | join in exporter |
| `annualSpend` | `cim.vendor.total_spend` (or `vendor_performance.spend_usd`) | bind |
| `type` | `capability_class` / `vendor_classification` (manufacturer≈oem) | bind |
| `paymentTermsDays` | parsed cube `pay_terms` (M8 parser) | export per vendor |
| `leadTimeDays` | `vendor_performance.avg_lead_time_days` (proxy) | bind; **label "proxy"** |
| `leadTimeTrend` | `vendor_performance.lead_time_drift` | **staged** (null badge) |
| **is_oem / oem_brand / citation** | `vendor_classification` | **add** — powers the "why is this an OEM?" tooltip + citation chip |
| `dataReliability` | derive: web-verified→high, knowledge→medium | bind |
| `score` / `scoreBreakdown` | — (no engine composite yet) | **designed-for** — keep mock or derive from perf later |
| `status` | `supplier_status` | bind |

**Dashboard** (`src/data/dashboard.ts` constants → `cockpit.json`):
- KPIs (total spend, # suppliers, # open opps, identified/realized value) ← opportunity rollup + fact.
- `FRAGMENTATION[]` per L2 ← `spend_pocket` (vendor_count, **HHI**, tail) grouped by L2.
- savings-by-category ← `scan_ranking.savings_lo/hi` per `sub_category`.
- `TermsGapCard` ← the **payment-terms WC benchmark** (`opp.benchmark`, M8) — *this is where the
  payment-terms lever lives*, not the opp feed (see §4.1).
- `LEGACY_PIPELINE` ← external/their data — keep as-is.
- **⚠ Scope reconciliation:** their constants say MRO = **$109.3M combined**; our engine currently
  runs the **indirect cube** only. Until the MRO-scope decision + combined-cube run, the dashboard
  totals won't match the $109.3M. Stamp "data as of {run} · indirect cube" and reconcile when the
  combined run lands.

---

## 4. The four structural remodels (the real work)

### 4.1 Levers — `archetype` → `primary_lever` + `play_route`  *(implemented 2026-06-30)*
Engine emits three levers (with route): `Vendor consolidation (to incumbent)` [consolidate] ·
`Vendor consolidation (Competitive RFP)` [rfp] · `Benchmark / should-cost (OEM carve-out)` [carve-out].
**As-built:** `play_route` renders as the **Lever** pill on the feed — *Consolidate* / *Competitive RFP* / *OEM carve-out*.
- Replace the `Archetype` enum with `{ primaryLever: string; playRoute: "consolidate"|"rfp"|"carve-out" }`.
- `labels.ts`: `ARCHETYPE_LABELS/VARIANTS/ORDER` → key off `play_route` (consolidate=info, rfp=brand, carve-out=neutral).
- **`payment-terms` is NOT an opportunity archetype** — it's a working-capital *benchmark*. Remove it
  from the opp model; surface it only in the dashboard `TermsGapCard`. (`FunctionalFitCard` and
  `ActStep` archetype maps lose the `payment-terms` key.)
- `ActStep.tsx` playbook picker: key off `play_route` (consolidate→consolidate playbook, rfp→RFP, carve-out→benchmark/negotiate).

### 4.2 Movable spend — replace `fragmentedSide`/`consolidatedSide` + waterfall
This is the biggest change and the most valuable. The engine **already emits the movable math** as
ordered `evidence_factor` rows — the FE just renders them:
```
[4] Pocket spend             $25,322,535
[5] − OEM / sole-source        −$759,406     (impact_positive=false)
[6] = Movable                $24,563,128     (contestability upper-bound label)
```
(Consolidate plays also get a `− Winner (incumbent kept)` row.)
- **`SavingsWaterfallCard.tsx`**: stop computing from `addressable × pct`; render the ordered
  `evidence_factors` (Pocket → −Winner → −OEM → = Movable), then apply the savings-rate band on
  Movable. The contestability label comes from `contestability_note`.
- **`ReviewPanel` SidesTable** (`fragmentedSide`/`consolidatedSide`): replace with a **vendor-landscape
  table** from `opportunity_vendor` — every vendor with `share`, `tier`, **`is_oem` flag**,
  **`is_winner` (incumbent)** badge; OEM rows visually separated as the carve-out. The AT-vs-AOH cut
  becomes a *secondary* grouping (`business_unit` per vendor), not the primary structure.
- `WhatDroveThisCard`, `RunPlayModal`, `VendorDetailPanel`: replace `consolidatedSide.anchorVendorId`
  reads with `recommended_lead_vendor_id`.

### 4.3 Lifecycle — Approve / Park / Reject; engine seeds `surfaced`  *(implemented 2026-06-30)*
**As-built decision model.** The CM chooses **Approve / Park / Reject**, each routing to its own tab
(**Feed · Act · Parked · Rejected**):
- **Approve** → status `accepted` → **Act** tab (run the play; commit in Act).
- **Park** → status `parked` → **Parked** tab; captures a **revisit trigger** (date or condition) in
  `parkTrigger` ↔ CDM `parked_revisit_trigger`; resurfaces when it fires, or via a manual **Return to
  feed** action (`unpark` → back to `qualified`).
- **Reject** → status `rejected` → **Rejected** tab; captures `rejectReason` (tunes Mercer's fit screen).
- `lapsed` / `lapsed_reason` remains **designed-for** (not yet its own tab).

Engine only ever sets `surfaced`; the FE seeds every opportunity `surfaced` from the CDM and manages
transitions in `OpportunityStoreContext` (bucket B) — these now **persist to `opp.opportunity_action`**
via `POST /api/opportunities/action` and survive reload (§6); only the transient auto-qualify-on-open
stays client-side. Fields `parked_revisit_trigger` / `rejected_reason` / `lapsed_reason` exist on
`opp.opportunity`. `OpportunityStoreContext` gains `park(id, trigger)` / `reject(id, reason)` and a
`lapse` path.

### 4.4 Confidence/score — adopt the engine decomposition  *(implemented 2026-06-30)*
The FE computes `confidencePct = fit × min(gap,20)/20`. The engine uses
**`score = Prize × Feasibility × Provability²`** (provability-dominant) and reports
`confidence_pct` (= provability-based). Reconcile:
- Sort/rank by `recommendation.score` (replaces the fit×gap ranking).
- `confidencePct` ← `recommendation.confidence_pct` (note: provability is intentionally *low* — it's
  outcome/evidence strength — so values like 29% are correct, not a bug; revisit `ConfidenceMeter`
  color thresholds with that in mind).
- `WhatDroveThisCard` decomposition: show **Prize / Feasibility / Provability²** (from
  `recommendation` + the first three `evidence_factor` rows), not fit/gap. `fragmentationGap` survives
  as a sub-driver of Feasibility (shown in evidence), not a headline.
- **As-built score vs. confidence.** The **scan/opportunity score** is a **category-level** 0–100
  ranking (normalized so the top MRO category = 100); it lives on the **Cockpit** and is **not** shown
  on the opportunity list or detail. **Confidence = Provability × 100** is the per-opportunity number
  shown in the list's **Confidence** column (services-heavy categories score lower — low is correct).

### 4.5 As-built feed column set + display rules  *(2026-06-30)*
The Opportunity Feed renders these columns (left → right): **# · Opportunity** (`l3`, split from title
`"{L3} · {country}"`) · **Sub-category** (`l2`) · **Country** (`purchasing_country`) · **Lever**
(`play_route` pill) · **Total spend** (pocket spend) · **Addressable** (`movable_value`) · **Vendors**
(`vendorCount`) · **Confidence** · **Savings** (low–high). Text columns left-aligned; value columns
right-aligned with the sort caret on the leading side. Dropped: a synthesized "Gap" ×-metric, the
fact-level Addressable tile, and a Status column (the tabs encode status).
- **`created_at`** is stamped **UTC** by the engine and **displayed Eastern** in the UI (so a
  late-evening ET run doesn't read as the next calendar day).

### 4.6 Act workspace + realization  *(as-built 2026-06-30)*
- **Approach picker + task checklist** are served from **`ref.playbook`** via **`/api/playbooks`** (seed:
  `jobs/seed_playbooks.py`) — curated templates keyed to the engine lever (`recommended_routes`),
  admin-adjustable per client, **not hardcoded in the FE**. Mercer pre-selects the approach whose
  `recommended_routes` contains the opportunity's `play_route`. *(Task checks + the chosen approach now
  persist via the **Save progress** action → `opp.opportunity_action`; restored on reopen/reload.)*
- **Drafts** (supplier outreach / RFP) are generated by the **Mercer copilot** (`/api/copilot` draft,
  grounded + cited) rather than FE templates.
- **Commit** captures the operator's **`committedTiming`** + **`committedBasis`** (Act workspace inputs),
  persisted on the opportunity and shown in the Tracking commitment grid + the commit event.
- **Value Realization (Tracking):** a committed play shows its **committed target**; the **realized side
  stays blank** with an honest "populates once SAP actuals are connected" note — **no fabricated realized
  values or ramp**. Realized wires in from **`fact_spend_actual`** (Feature §8.2) later. The canned
  "Evidence basis" row was removed.

**Realization-stage tracker + server-derived ramp (updated).**
- **Realization stage tracker** — the tracking panel shows a **status-driven** tracker of the *post-commit*
  stages **Committed → In execution → Realized**. The sourcing stages (RFQ / Award) are worked and tracked
  in the **Act checklist through commit**, so they are **not** re-tracked here — the old "Committed →
  Validation → RFQ → Award → Ramp" milestone timeline was removed as redundant. The stage is **movable
  forward AND back** (Advance / Back buttons) and **persists** to `opp.opportunity_action` via
  `POST /api/opportunities/action` with `{action:"stage", status}`, so it survives reload. The list view
  matches: a **3-dot stage** indicator, a **Committed** tab (was "Validating"), and a **"Next stage"**
  column (was "Next milestone").
- **Server-derived committed ramp** — the projected savings ramp for committed opportunities is now
  derived **server-side** in `getOpportunities()` (an even-split of the committed mid-point across
  2026–2029; `realized` stays `undefined` until SAP actuals). This powers the Value-Realization ramp chart
  after reload — previously the ramp was generated client-side only at commit and vanished on reload.
  **⚠ Caveat:** the even-split is a **placeholder projection**, to be replaced by real phasing later — do
  not present it as an actual forecast.
- **Terminology** — Value Realization uses **"opportunity"** throughout (not "play"): "Committed
  opportunities", the "Opportunity" column, etc.
- **Ask Mercer no-overlap** — the copilot side-panel no longer overlaps the opportunity detail modal: the
  modal shifts left (`ModalShell reservedRight`) when the docked panel is open.

---

## 5. File-by-file change list

**Types / data (bucket A — do first):**
- `src/types/opportunity.ts` — remodel per §2/§4 (lever+route, add `movableValue`/`recommendedLeadVendorId`, evidence-factor + vendor-landscape types, status +parked/+lapsed, keep userInput/events/ramp as B).
- `src/types/vendor.ts` — add `isOem`/`oemBrand`/`citationUrl`/`capabilityClass`; mark `score*`/`leadTimeTrend` designed-for.
- `src/data/source.ts` *(new)* — fixture/API loader.
- `src/data/opportunities.ts`, `vendors.ts`, `dashboard.ts`, `taxonomy.ts` — re-point to `source.ts`; delete hardcoded constants that the engine now provides (keep `LEGACY_PIPELINE`).
- `src/lib/savings.ts` — keep the override mechanism (B), but base = engine `savings_lo/hi` + apply rate band on **Movable** (not addressable).
- `src/app/(portal)/opportunities/_components/labels.ts` — lever labels key off `play_route`; drop `payment-terms`; relabel evidence-basis.

**Components (bucket A/C):**
- `SavingsWaterfallCard.tsx` — render evidence factors (§4.2). **Highest-value single change.**
- `ReviewPanel.tsx` — SidesTable → vendor landscape; exclusions ← negative evidence rows; summary tiles ← prize/feas/prov.
- `WhatDroveThisCard.tsx` — prize/feasibility/provability decomposition (§4.4).
- `opportunityColumns.tsx` — lever pill (route), movable column, confidence ← confidence_pct.
- `FunctionalFitCard.tsx` — keep editorial; drop `payment-terms` key; read `business_unit`/vendor landscape for detail.
- `ActStep.tsx` / `RunPlayModal.tsx` — playbook keyed off `play_route`; anchor ← `recommended_lead_vendor_id`.
- dashboard `_components/*` — bind to `cockpit.json`; `TermsGapCard` ← payment-terms WC.
- vendors `_components/*` — bind to joined vendor fixture; add the OEM "why?" tooltip (`vendor_classification.evidence` + `citation_url`).

**Stores (bucket B — minimal change):**
- `OpportunityStoreContext.tsx` — initial roster from fixtures; add `park`/`lapse`; otherwise transitions unchanged.
- `VendorStoreContext.tsx` — roster from fixtures; keep edit/recompute logic.

**Copilot (bucket A, later phase):**
- `src/components/mercer/*` props are text-only → easy. Interim: bind `MercerNarrativeCard`/`MercerBand`
  to `copilot_answers.json` (pre-generated explain per opp) + render `citations` as chips. Live free-text
  Q&A + `view_context` plumbing wait for the copilot endpoint (Phase 6 of the gap plan).

---

## 6. Stays mocked / designed-for (don't build in FE)
**Status write-back to the CDM is now built** — Approve/Park/Reject/Unpark/Save/Commit all persist to
**`opp.opportunity_action`** (a mutable table that survives engine reloads, since engine Gold is rebuilt
each run) via `POST /api/opportunities/action`; `getOpportunities()` merges that user layer over the
engine defaults, so decisions survive reload. (The local Postgres stands in for Lakebase.) ·
operator `userInput` overrides ·
`milestones`/`ramp`/`value_realization` · `opportunity_event` audit · vendor composite `score` ·
`on_time/fill/PPV/quality` + `leadTimeTrend` (need GR/invoice feeds) · same-item price / spec lever
(part master) · live copilot Q&A endpoint. Each gets a **"staged / needs-data"** label, not a build.

---

## 7. Suggested sequence
1. **Engine: build `export_fe_fixtures.py`** → real fixtures in the contract shape *(Navanta — unblocks everything)*.
2. **FE Phase 0:** remodel `src/types` + `source.ts` loader; re-point `src/data/*`.
3. **Movable remodel** (§4.2) — `SavingsWaterfallCard` + `ReviewPanel` vendor landscape (the highest-value screen).
4. Levers/labels (§4.1), confidence (§4.4), lifecycle (§4.3).
5. Dashboard + vendors binding; OEM "why?" tooltip.
6. Copilot interim fixtures → later live endpoint.

Engine contract is frozen and on GitHub (`Navanta-AI/allison-procurement`); see `ASSUMPTIONS.md` there
for what each number means before surfacing it in the UI.
