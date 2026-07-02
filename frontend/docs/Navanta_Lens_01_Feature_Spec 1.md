# Navanta Lens — Category & Opportunity Management
## Feature Specification (POC)

*Companion to `Navanta_Lens_POC_Build_Plan.md` (vision & design brief). This document defines the **features** of the one live module — Category & Opportunity Management — to acceptance-criteria level, plus the framework treatment of the other platform pillars. Data model, architecture, and the designer design doc are separate deliverables.*

**Status:** Draft v0.4 for review · **Date:** 2026-06-29
**Scope of this doc:** what the product does and the rules it must obey. *How* it's built (Databricks/Lakebase) is the architecture spec; *how it looks* is the design doc.

**v0.2 changes (from review):** added **Appendix A — build-ready engine calculation logic** (every lever's formula, data inputs, savings rate, and benchmark/should-cost data sourcing, ported from `Allison_MRO_Methodology_Spec.xlsx`); clarified the opportunity **lifecycle / terminal states** (§3.2); added **Shibumi integration** for executive value tracking (§8.1); confirmed supporting personas (supplier out of scope); aligned the **Scan** definition to the live MRO deep-dive artifact (§4).

**v0.3 changes (from review):** made **Methodology, Parameters & Governance** a first-class feature (§10) — admin-only versioned parameter management, in-product formula transparency + per-number explainability, and a versioned **client Methodology Agreement**; added **SAP actuals integration** for Monitor realized value (§8.2, `fact_spend_actual`); set the **POC benchmark approach** = free BLS PPI + internal, with a pluggable `BenchmarkSource` adapter for Beroe / S&P / aPriori in production (Appendix A.7).

**v0.4 changes (from review):** made the Mercer copilot **context-aware** (§9) — anchored to the page + opportunity in view via a frontend-supplied `view_context`, so deictic questions ("explain this", "why this lever") resolve to what's on screen; the copilot **core** moves into Navanta's build scope (Architecture §6/§10), with the team owning serving, scope enforcement, hosting, and UI.

---

## 1. Purpose & scope

### 1.1 What this module is
Category & Opportunity Management is the procurement/sourcing extension of Navanta Lens. It turns a client's spend base into a **prioritized, evidence-backed feed of cost & supply opportunities** and gives the Commodity Manager (CM) a single workspace to **qualify, act on, and monitor** them. It is proven in the POC on Allison's MRO spend (AT + AOH divisions).

### 1.2 What is LIVE vs. FRAMEWORK in the POC

| Area | POC treatment |
|---|---|
| Category & Opportunity Management (this module) | **Live & working**, powered by the real analysis engine, on the full combined spend foundation (indirect + direct cubes) with the 5 MRO deep-dive categories as the proof set. |
| Inventory optimization · Demand & supply planning · Supplier 360 & resilience · Market & commodity intelligence | **Framework only** — real navigation + a single vision screen each. No backend. |
| Mercer copilot | **Live (scoped):** Q&A, explain-a-play, and draft outreach/RFP — grounded on the module's own data. Not agentic (does not execute actions). |

### 1.3 Live data foundation
The engine ingests and normalizes the **full indirect cube (~$957M)** and **full direct cube (~$2.07B)**. The opportunity module is MRO-focused (MRO L1 ≈ $109.3M indirect), but because the foundation spans both cubes, the module also supports the **cross-cube enterprise fluids view** ($25.5M, direct + indirect) and lets non-MRO categories surface in the feed. *(Allison's "$63M MRO" ≈ AT-only; our $109.3M = combined AT+AOH — a definition difference to align at kickoff, not an error.)*

### 1.4 Out of scope for the POC
Live backend for the four core pillars; agentic/auto-executing actions; external supplier portal; write-back to client ERP; same-item unit-price benchmarking and engineered should-cost (both **blocked pending the part/spec master** — staged, not built); automated realized-savings measurement (the SAP-actuals feed is *designed-for* but, for the POC, Monitor uses CM-entered commitments + projections — §8.2).

---

## 2. Personas & the scope model

### 2.1 Primary persona — Commodity / Category Manager (multi-altitude)
The defining nuance: **the same role operates at different altitudes.** Some CMs own a category at one **plant**, some across a **region**, some **enterprise-wide / by business unit**. This is not multiple personas — it is one role whose **scope** changes what they see and own.

**Scope dimensions:** Plant → Region → Country, Business Unit (AT / AOH), and Category hierarchy (L1 → L2 → L3). A user's assigned scope is the lens on everything: feed, cockpit, opportunities, suppliers, and value all roll up or filter to it.

**Jobs to be done:** receive surfaced opportunities → decide whether to act → run the play (RFP / supplier conversation / negotiation / consolidation / transition) → track committed vs. realized value and supply impact → manage suppliers in scope.

**Pains today:** fragmented data, manual tracking, no benchmark/should-cost, no single supplier view, too many disconnected screens.

### 2.2 Supporting personas *(agreed)*
- **CPO / Procurement Exec** — enterprise savings & synergy visibility and risk posture. **Executives track the highest-level outcomes of these opportunities in Shibumi** — the client's strategic portfolio / value-realization system of record, and the natural home for AT+AOH merger-synergy tracking. **Lens is the operational engine that feeds Shibumi; it does not replace it** (see §8.1). In Lens itself, the exec view is a read-only enterprise rollup/landing.
- **Category Lead / Portfolio Owner** — cross-category prioritization; governs method (thresholds, playbooks, taxonomy).
- **Data / IT** — trusted data, taxonomy, lineage, validation queue.
- **Supplier** — **out of scope** for the POC and this design; a future external portal only.

### 2.3 Scope as a cross-cutting requirement
Scope is applied **server-side**, not just as a UI filter. The data a user can see is bounded by their assigned scope; within it they may narrow further. This is specified once here and assumed by every feature below.

**Acceptance criteria — scope**
- A user with a plant-level assignment sees only opportunities, spend, and suppliers attributable to that plant; rollups (cockpit totals, savings) reflect that slice only.
- A regional CM sees the regional rollup across that region's plants; an enterprise CM sees AT+AOH combined.
- Every numeric figure shown is reproducible from the underlying scoped data (no figure without a traceable basis).
- Changing the active scope re-derives the feed, cockpit, and all aggregates consistently within one interaction.

---

## 3. The Opportunity — the object that flows through the method

The **Opportunity** is the core object. Everything in the module is a view of, or an action on, opportunities. The method **Scan → Qualify → Act → Monitor** is the opportunity's lifecycle, not a set of screens the user walks in order.

### 3.1 What an Opportunity is
A scoped, scored, evidence-backed proposition to capture cost or supply value on a defined slice of spend — typically a **spend pocket** (Category L3 × country) or a defined cross-pocket bundle — via a **recommended lever**.

### 3.2 Lifecycle states
The opportunity is a state machine. The **happy path** is Surfaced → In Qualify → Accepted → In Act → In Monitor → **Realized**; the other branches are explicit paused or terminal states.

- **Surfaced** (Scan output) — generated/updated by the engine; ranked; unread in the feed.
- **In Qualify** — a CM has opened it and is deciding.
- **Accepted** — CM has committed to pursue; proceeds to Act.
- **Parked** *(non-terminal)* — paused, not rejected; leaves the active feed but **returns when a revisit trigger fires** (new data, part master lands, threshold change).
- **In Act** — a play has been launched from a playbook.
- **In Monitor** — commitments recorded; tracking committed → realized.

**Terminal states — how an opportunity "closes" (your question):**
- **Realized** — value captured (closed-won). The only terminal state that books savings.
- **Dismissed** — CM rejected it (not real / not worth it / can't be moved), with a reason. **This is the main "closed without value" case** — so yes, most closes that aren't wins are Dismissals.
- **Lapsed** — expired or superseded without action (e.g. a data refresh means it no longer qualifies, or the window passed).

So "closed" is not a single status: an opportunity ends as **Realized**, **Dismissed**, or **Lapsed**. "Closed" is shorthand for any of the three, not its own state.

**Acceptance criteria — lifecycle**
- Every state transition is logged with actor, timestamp, and (where applicable) a reason/justification.
- Scan may **update** a Surfaced opportunity when data refreshes, but must **not** silently overwrite an opportunity a CM has already acted on; changes to acted opportunities are surfaced as **drift flags**, not silent edits.
- An opportunity always carries its evidence and its provability/confidence basis through every state.

### 3.3 The five levers (first-class concepts)
Each opportunity is assigned exactly one **primary lever** (others may appear as secondary):
1. **Vendor consolidation** — collapse a fragmented base to fewer suppliers (tail consolidation or consolidate-to-incumbent).
2. **Cross-division leverage** — combine AT + AOH demand where both buy the same thing.
3. **Benchmark / should-cost** — price vs. market indices or best-demonstrated internal price.
4. **Supplier transition** — move volume to a better-fit/lower-cost capable supplier.
5. **Spec & demand optimization** — standardize specs / reduce consumption.

> **Each lever's exact trigger, formula, data inputs, savings rate, and staging (computable now vs. needs the part master) is specified in Appendix A.6.** The benchmark / should-cost data sourcing and calculation — the part flagged as under-specified — is **Appendix A.7**. This section (3.4) covers only how the *primary lever and movable spend* are assigned per opportunity.

### 3.4 Lever assignment & movable-spend logic (engine rules the UI must reflect)
The recommended lever and the **movable spend** are computed, not guessed. The UI must present them faithfully:
- **Segment gate first:** engineered/equipment segments (e.g. "Machine parts", OEM spares) are **carved out** of consolidation into an OEM/engineering should-cost track — they are structurally fragmented and a distributor cannot supply them.
- **Lever routed by winner share within a spend pocket:**
  - *winner_share ≥ 50%* → **Consolidate**; movable = pocket − winner − OEM (the tail).
  - *winner_share < 50%* → **Competitive RFP**; movable = pocket − OEM (the whole non-OEM base is contestable).
- **Capability is a flag, not the router** — vendor capability informs the recommended lead supplier, but winner_share decides the lever.
- **Contestability caveat:** not all non-OEM spend is contestable (sole-source, spec-locked, at-market, regulatory, switching cost net out). The displayed contestable/movable base is an **upper bound** and must be labeled as such.

### 3.5 Scoring & provability (why an opportunity ranks where it does)
Ranking = **Prize × Feasibility × Provability²** (provability weighted heavily because engagements are outcome-based). The UI must let a CM see this decomposition (see §6, Qualify). Inputs:
- **Prize** — addressable $ in scope.
- **Feasibility** — spec commonality, switching difficulty, supplier risk.
- **Provability** — strength of the evidence (data identity, UOM cleanliness, benchmark availability). Opportunities whose lever needs the part/spec master are flagged **"needs part-master validation."**

---

## 4. Feature: Opportunity Feed (Scan output)

The always-on identification engine surfaces and ranks opportunities; the CM does **not** go "scanning." The feed is an **inbox/queue**, scoped to the user — not a wall of dashboards.

**Scan produces two outputs** (mirrored in the live `MRO_Category_Deep_Dive` artifact): (1) a **category-ranking scorecard** — *which* sub-categories are worth pursuing, via Prize × Feasibility × Provability² (Appendix A.3); this is the artifact's "MRO category ranking & rationale" view and lives in the **cockpit** (§5). (2) Within pursued categories, **generated opportunities ("named plays")** at the spend-pocket level (Appendix A.5), each with its lever, movable spend, and lead supplier — these populate the **feed**. The CM consumes the feed; the engine produces both on every data refresh.

**Requirements**
- Ranked list of opportunities in the user's scope, default sort by score (Prize × Feasibility × Provability²).
- Each feed item shows: title, category path (L1/L2/L3) + geography, addressable $ and movable $, recommended lever, confidence/provability badge, and any flags (needs part-master, contestability caveat, drift, data-quality flag).
- Filter & group by scope dimensions (plant/region/BU), category, lever, confidence, and status.
- Signals (e.g. new data, price movement, fragmentation change) appear inline as the reason an item is new or changed — not as a separate signal wall.
- Bulk triage: mark read, park, dismiss (with reason).

**Acceptance criteria**
- Opening the feed at a given scope returns only in-scope opportunities, ranked deterministically; the same data produces the same order.
- Every item's headline $ figures match the engine output and are traceable to the underlying pockets.
- New/changed items since last visit are visually distinguished and explain *why* (the triggering signal).
- A dismissed/parked item leaves the active feed but is retrievable with its reason.

---

## 5. Feature: Category Cockpit (the CM's home)

The CM's scoped home base: the state of their categories at a glance, and the entry point into opportunities and suppliers.

**Requirements**
- Header KPIs for the active scope: total spend, # suppliers, # open opportunities, identified value (committed + projected), realized value.
- Spend composition: by category (L1→L2→L3), by BU (AT vs AOH), by geography, by vendor tier.
- Fragmentation view: vendor count, HHI, tail size (e.g. # vendors < $100k) for the scope's categories.
- Top open opportunities (links into Qualify) and supplier highlights (top vendors, current vs net-new, overlap).
- Value summary: identified → committed → realized, by lever.

**Acceptance criteria**
- Every cockpit figure recomputes correctly when scope changes and reconciles to the feed and to the data model totals.
- AT-vs-AOH and geography breakdowns reflect the real cube splits (e.g. for Industrial Supplies: AT≈US, AOH≈Europe + India).
- Vendor-tier definitions and per-tier average $/vendor are shown, not just counts.
- No KPI is shown without a drill path to its constituent records.

---

## 6. Feature: Qualify workspace (the heart of the product)

For a single opportunity: *Is it real? Do I act on it? Which lever?* This is where the CM lives day-to-day.

**Requirements — evidence panel**
- **The play in one line:** recommended lever + movable $ + recommended lead supplier(s) and their status (current-material / current-small / net-new).
- **Score decomposition:** Prize, Feasibility, Provability and how they combined; the provability basis and any "needs part-master" flag.
- **Vendor landscape:** vendors in the pocket, spend, share, tier; winner_share; HHI; OEM/engineered carve-out clearly separated from the contestable base.
- **Movable-spend math, shown transparently:** pocket total → minus winner (if Consolidate) → minus OEM → = movable; with the contestability caveat as an explicit upper-bound label.
- **Geography & BU context:** where the spend sits, whether it's cross-BU (synergy) or single-BU.
- **Recommended play & next steps** from the relevant lever (e.g. tail consolidation via integrator; competitive RFP aggregating AT+AOH demand; should-cost vs index — staged).
- **Benchmark availability:** what's computable now (e.g. payment-terms benchmark) vs staged for the part master (unit price / should-cost).
- **Data-quality flags:** auto-flags for mis-tagged pockets (e.g. India "Hand and Power Tools" = automation/equipment; "Seals – Mechanical and Oil" in India/China = lubricants → route to Fluids).

**Requirements — decision**
- CM chooses: **Accept** (→ pick lever/play, proceed to Act), **Park** (with reason + optional revisit trigger), or **Dismiss** (with reason).
- CM may **override** the recommended lever, with a captured justification.
- Mercer copilot available in-context to explain the play or answer questions about the evidence.

**Acceptance criteria**
- The movable-spend figure displayed equals pocket − winner(if Consolidate) − OEM per the engine rules, and the on-screen arithmetic ties out.
- Engineered/OEM carve-outs are never counted inside the contestable/movable base.
- Lever shown matches the winner_share rule (≥50% Consolidate / <50% RFP); a CM override is recorded and does not alter the engine's recommendation history.
- Recommended lead supplier and its Allison-spend status are correct per the vendor-capability/lead map.
- Every claim in the evidence panel is traceable to a data source or labeled as directional/assumption.

---

## 7. Feature: Act / Playbooks

Execute the chosen lever from a playbook. *POC scope: structured workflow + artifact generation; not auto-execution against external systems.*

**Playbooks (one per lever family)**
- **Consolidate** (tail or to-incumbent), **Competitive RFP** (no incumbent → aggregate demand, market scan, RFI→RFP scored on total cost w/ should-cost reserve, lead + backup, phased migration), **Negotiate / Benchmark**, **Supplier transition**, **Services rate-card panel** (for repair-services spend, e.g. Machine Repairs labor).

**Requirements**
- Launching a play creates a tracked **play instance** linked to the opportunity, pre-filled with its evidence (scope, vendors, movable $, recommended leads).
- Task/step checklist per playbook; assignable; status-tracked.
- **Draft generation via Mercer:** supplier outreach, RFP scaffolding, negotiation talking points — generated from the opportunity evidence, editable, never auto-sent.
- Accept/reject of follow-up actions; capture committed value when a play reaches commitment.

**Acceptance criteria**
- A play instance always carries the originating opportunity's evidence and scope; changing the opportunity's data flags the play, not silently mutates it.
- Generated drafts cite the evidence they used and are clearly marked as drafts requiring human review.
- Committing a play writes a commitment record consumed by Monitor.
- Savings rate applied is **lever-tiered**, not flat: consolidate-to-incumbent 4–7%, competitive RFP 5–8%, fragmented tail / lead+panel 6–10%, services 5–8% — and the rate used is shown and editable with justification.

---

## 8. Feature: Monitor / Value realization

Track committed → realized value and supply impact. *POC: CM enters commitments; engine projects realization over time. No fabricated realized data.*

**Requirements**
- Pipeline view: identified → accepted → committed → (projected) realized, by lever, category, scope, and BU.
- CM records commitments against opportunities/plays (amount, expected timing, basis).
- Projected realization curve from commitment + lever-tiered assumptions; manual actuals entry as they arrive.
- **Drift detection:** when refreshed data changes an opportunity already in flight, flag it (spend moved, vendor changed, fragmentation shifted).
- Supply-impact notes (e.g. dual-source established, lead-time risk) captured qualitatively for the POC.

**Acceptance criteria**
- No realized figure appears unless a CM entered it; projections are visually distinct from actuals.
- Roll-ups reconcile: sum of scoped commitments = enterprise committed total within scope boundaries.
- Drift flags appear within one data-refresh cycle of the underlying change and link back to the changed evidence.

### 8.1 Shibumi integration (not built in POC, but designed-for)
Executives track the highest-level outcomes of these opportunities in **Shibumi**, the client's strategic portfolio-management / value-realization platform. Shibumi tracks financial and non-financial benefits through every execution stage and is commonly the system of record for M&A synergy capture — directly relevant to AT+AOH. **Lens is the operational engine; Shibumi is the executive value ledger. Lens feeds Shibumi rather than duplicating it.**

**Integration shape (thin adapter; Shibumi exposes a GraphQL API and standard connectors).** Lens publishes an outbound **value-realization feed** that maps each opportunity/play to a Shibumi initiative/benefit record. The data model must expose these fields so the adapter is trivial:
`opportunity_id`, `play_id`, title, category path (L1/L2/L3), BU + scope (plant/region), `lever`, `status` (mapped to a Shibumi stage), `identified_value`, `committed_value`, `realized_value`, savings-rate basis, key dates, owner.

**POC treatment:** not wired live, but Monitor's data is **structured to map 1:1 to Shibumi initiatives**, and the integration point is drawn in the architecture spec. *(Confirm direction at kickoff: Lens push via Shibumi GraphQL vs. Shibumi pull from a published Lens dataset.)*

**Acceptance criteria**
- Every opportunity in Monitor carries the full field set above — enough to create/update a Shibumi initiative with no manual re-keying.
- Lens `status` values map cleanly to Shibumi stages; identified / committed / realized are distinct, reconciled figures.
- Realized value sent to Shibumi equals measured actuals (SAP-derived or CM-entered) only — never projections.

### 8.2 SAP actuals integration (designed-for; POC uses manual entry)
The client's ERP is **SAP** — the discovery data already comes from SAP extracts (PO `s-pr-010`, Non-PO `fbl1n`). Monitor is designed to measure **realized value from ongoing SAP actual spend**, not manual entry alone.

**Integration shape:** SAP S/4HANA → ADLS Gen2 (Bronze) via **Azure Data Factory** using the **SAP CDC / ODP connector** (or CDS-view OData, or SAP Datasphere premium-outbound replicating CDS views as CDC-capable parquet) → the same medallion → a Gold **`fact_spend_actual`** table Monitor reads.

**Realized measurement:** `realized = baseline_run_rate − post_award_run_rate` on the opportunity's vendor/category scope, separating **price effect vs. volume effect**, CM-attributed to the opportunity. This SAP-derived figure is what flows to Shibumi (§8.1).

**POC treatment:** the feed and `fact_spend_actual` are specified in the data model and architecture, but for the POC Monitor uses **CM-entered commitments + actuals**; the SAP feed goes live in production. *(Confirm SAP extraction method + access — §14.)*

**Acceptance criteria**
- `fact_spend_actual` and the realized formula are defined so that flipping from manual to SAP-sourced actuals requires **no change to Monitor's logic**.
- Price vs. volume effects are separable in the realized calculation.

---

## 9. Feature: Mercer copilot (scoped)

A natural-language layer over the module's own data. **Q&A + explain-a-play + draft outreach/RFP.** Not agentic. **Context-aware** — anchored to the page the user is on and the opportunity in view.

**Requirements**
- **Q&A** grounded on the in-scope Gold data (spend, vendors, opportunities, evidence): "What's my biggest opportunity in Industrial Supplies India?", "Which suppliers are net-new?"
- **Explain a play:** narrate why an opportunity ranked where it did and why the lever was chosen, from the score decomposition and lever rules.
- **Draft generation:** supplier outreach, RFP scaffolding, negotiation points — from opportunity evidence.
- **Context-aware to the page + opportunity in view:** the copilot knows which page (cockpit/qualify/act/monitor) and which opportunity/category/vendor the user is looking at, so *"why is this a consolidate play?"*, *"explain this number"*, *"who's the incumbent here?"* resolve to what's on screen without restating it. (Delivered via a `view_context` the frontend passes — Architecture §6.)
- Answers respect the user's scope (cannot reveal out-of-scope data) and **cite the evidence/records used.**

**Acceptance criteria**
- Every answer is grounded in retrieved in-scope records and surfaces its sources; it does not invent figures.
- **Deictic questions resolve to the in-view entity:** on an open opportunity, "explain this / why this lever / who's the incumbent" answer about *that* opportunity with no disambiguation.
- The copilot cannot return data outside the user's scope (`view_context` focuses *within* scope; it never widens it).
- Drafts are editable and marked draft; nothing is sent or executed by the copilot.
- When data is insufficient or staged (e.g. should-cost needs part master), the copilot says so rather than guessing.

---

## 10. Feature: Methodology, Parameters & Governance

A **first-class, admin-facing module** — not buried settings. It exists so the engine is **trusted, inspectable, and client-confirmable**, which matters especially under the outcome-based fee model. Four parts:

### 10.1 Parameter management (admin-only, versioned)
- Authorized admins (Portfolio Owner / Data-IT) view and edit every parameter in **Appendix A.2** (scoring weights, materiality gates, winner-share threshold, savings-rate tiers, engineered-segment map, tier cut-offs).
- Changes are **versioned** and apply on the **next engine run** (no in-session live re-run in the POC). Each opportunity records the parameter version that produced it.
- **Not** editable by individual CMs — the method stays consistent across the org.

### 10.2 Methodology transparency (in-product)
- A read-only **Methodology page** renders the active formulas (Appendix A) with the **current parameter values** filled in.
- **Per-number explainability:** any figure in the product exposes "how is this calculated?" — the formula, the parameter values used, and the source lineage. The Mercer copilot can narrate any calculation on request.

### 10.3 Client Methodology Agreement (confirmation & change control)
- A **versioned, plain-English methodology + parameter sheet** (the "dials we can turn") the client reviews and **signs off at kickoff** — the agreed basis for the engagement.
- Post-sign-off parameter/formula changes are **change-controlled**: logged with who, when, why, and which version they supersede; material changes are flagged for re-confirmation.

### 10.4 Master data & validation
- **Taxonomy management** — L1/L2/L3 + UNSPSC mapping; resolve hygiene issues (e.g. `Machine parts` vs `Machine Parts` case-dupes; A.11).
- **Vendor-capability & category→lead map** — the researched master (US metalworking→Cline Tool; US electrical→Kirby Risk; EU broad MRO→Rubix; India→Moglix/ProcMart/BulkMRO …) with supplier status tags; also drives `oem` and `capability_class` (A.1).
- **Validation queue** — items needing human review (low-confidence normalization, mis-tag flags, needs-part-master).
- **Lineage** — for any figure, trace to source rows and the transformations applied.

**Acceptance criteria**
- Parameter changes are versioned; the engine output reflects the active set, and each opportunity records which version produced it.
- The Methodology page shows every formula with live parameter values; every product figure resolves to its formula + parameters + source lineage on demand.
- The signed Methodology Agreement version is retrievable, and any later change is logged against it with a reason.
- Validation-queue items block nothing from displaying but are clearly flagged wherever they surface.

---

## 11. Core pillar framework screens (vision, not built)

For each of **Inventory optimization · Demand & supply planning · Supplier 360 & resilience · Market & commodity intelligence**: real navigation + one vision/teaser screen describing the pillar and how it connects to the live module via the shared backbone (same parts, suppliers, plants, spend). **No backend; frontend-only.** Purpose: sell the whole platform while one piece is live.

**Acceptance criteria**
- Each pillar is reachable from primary nav and renders a coherent vision screen; nothing implies live data where there is none.

---

## 12. Cross-cutting non-functional requirements

- **Evidence transparency:** no figure without a traceable basis; directional/assumption-based numbers are explicitly labeled (e.g. directional unit cost on "eaches," PO-text-mined product/service splits).
- **Data freshness:** the module reflects the latest engine run; opportunities carry a "data as of" stamp; acted opportunities surface drift rather than silent change.
- **Scope security:** scope enforced server-side on every read and on copilot retrieval.
- **Reproducibility:** identical data + parameters → identical opportunities and ranking.
- **Auditability:** all decisions, overrides, commitments, and parameter changes are logged with actor/time/reason.

---

## 13. Worked example the POC must reproduce (anchor for acceptance)

**Industrial Supplies** (MRO, $34.1M / 1,093 vendors, hyper-fragmented): feed surfaces tail-consolidation and competitive-RFP opportunities by spend pocket (L3 × country); engineered "Machine parts" carved out to an OEM/should-cost track; ~19 commodity plays ≈ $11.9M movable; geography gates the play (AT≈US, AOH≈Europe + India; meaningful cross-BU only in India + marginally US). Recommended leads researched per pocket and status-tagged (mostly current suppliers; Moglix/BulkMRO/Axalta/Akzo net-new). This end-to-end path — feed → cockpit → qualify (with the movable-spend math and carve-out) → act (RFP/consolidate playbook) → monitor (commitment + projection) — is the acceptance anchor for the live module.

---

## 14. Open items to confirm
- MRO definition alignment (AT-only $63M vs combined $109.3M) — confirm at kickoff; affects headline framing only.
- Which non-MRO categories (if any) are allowed to surface in the POC feed, or whether the feed is filtered to MRO + fluids for the demo.
- **Resolved:** POC benchmark = BLS PPI (free) + internal (payment terms, directional unit cost); paid sources (Beroe / S&P Global / aPriori) plug into the `BenchmarkSource` adapter for production. *Open:* budget/timing to procure a paid source, and the full `category → series` mapping.
- Depth of supply-impact capture in Monitor for the POC (qualitative notes assumed).
- Confirm SAP S/4HANA extraction method (Azure Data Factory SAP CDC/ODP connector vs. CDS-view OData vs. SAP Datasphere outbound) and access for the recurring `fact_spend_actual` feed.

---

# Appendix A — Engine calculation logic (build-ready)

*Authoritative calculation spec for the build. It ports the locked discovery methodology (`Allison_MRO_Methodology_Spec.xlsx`, with validated reference outputs) and generalizes it from Industrial Supplies to all five levers and all live categories. **Validate any rebuild against the reference-output numbers in that workbook** (e.g. Industrial Supplies = $34.089M / 1,093 vendors; 19 commodity plays = $11.888M movable = $0.594–0.951M). All thresholds are parameters (A.2) — never hardcode.*

## A.0 Staging — computable now vs. needs the part/spec master
| Capability | Now (Layer-0, from the cube) | Needs part/spec master |
|---|---|---|
| Vendor consolidation / RFP routing & movable spend | ✅ | sharper with part-level sole-source |
| Cross-division leverage (overlap $) | ✅ | — |
| Fragmentation (HHI, tiers, tail, maverick) | ✅ | — |
| Payment-terms benchmark | ✅ | — |
| **Same-item unit-price dispersion** | ❌ blocked | ✅ unlocks (item key = mfr part no.) |
| **Index-based should-cost** (commodity cats) | ⚠️ directional only | ✅ needs clean UOM → price/standard-unit |
| **Spec & demand optimization** | ❌ | ✅ needs spec attributes |

**Why blocked now:** `material_id` is a category/UNSPSC/vendor-specific code, **not a shared part number** (~80% single-vendor), and ~100% of lines are UOM `EA`/`AU` (each/lot), with only ~$1.1M (0.3%) in measurable physical UOM (kg/L/m). So like-for-like price work is **staged**, not built — but designed-for (the engine swaps `material_id` → mfr part no. as the item key and re-runs).

## A.1 Source & derived fields
**Source (spend cube — system of record for analysis):** `company` (AT / OH), `vendor` (cleaned = consolidation key), `parent_name`, `l1/l2/l3` (= Consol 1/2/3), `net_spend` (USD measure), `qty`, `country`, `region`, `material_id`, `material_desc`, `controlled`, `cust_directed`, `pay_terms`.

**Derived:**
- `id_type` — regex on trimmed-upper `material_id`: `unspsc` =`^[0-9]{8}$`; `numcat` =`^[0-9]{6,}$`; `generic` =`^[A-Z][A-Z .\-]{1,12}$` with no digit (process bucket, e.g. `MACH REP`); else `partlike`.
- `oem` (bool) — vendor name contains an OEM brand (Fanuc, Gleason, Okuma, Mazak, Siemens, DMG, Haas, Kuka, ABB, Fronius, Heidenhain, …). **Maintain in the vendor-capability master, not hardcoded.**
- `segment_class(l3)` — `engineered` (equipment-specific spares a broad-line distributor can't supply; currently `Machine parts` / `Machine Parts`) vs `commodity` (catalog). Maintain as a map; extend with part master.
- `capability_class(vendor)` — `broad-line/integrator` | `specialist/niche` | `oem` (from vendor-capability master).
- `addressable = net_spend − customer_directed_spend − sole_source_spend`.

## A.2 Parameters (single source of truth — tunable, versioned)
| Param | Default | Use |
|---|---|---|
| `prov_exponent` | 2 | Provability emphasis (outcome-based engagement) |
| `feas_frag_weight` | 0.5 | Fragmentation weight in Feasibility |
| `feas_xbu_weight` | 0.5 | Cross-BU weight in Feasibility |
| `services_threshold` | 0.40 | If services-coded share > this → penalize Provability |
| `services_penalty` | 0.60 | Provability multiplier when penalized |
| `play_min_spend` | $300,000 | Min pocket spend to qualify as a play |
| `play_min_vendors` | 4 | Min vendors in a pocket to qualify |
| `winner_share_consolidate` | 0.50 | ≥ → Consolidate; below → Competitive RFP |
| `engineered_segments` | Machine parts; Machine Parts | Carved out of consolidation |
| `tier_keep_spend` / `tier_keep_segs` | $500,000 / 5 | Keep–strategic/broad |
| `tier_leverage_spend` | $100,000 | Leverage–negotiate |
| `tier_consolidate_spend` | $25,000 | Consolidate; below → Exit–tail |
| `mav_micro_spend` / `mav_micro_lines` | $10,000 / 2 | Micro/maverick vendor |
| **Savings rates (lever-tiered)** | see A.6 | Replaces the legacy flat 5–8% |

## A.3 SCAN — category ranking (which sub-categories to pursue)
```
addressable   = spend − customer_directed − sole_source
Prize         = addressable / MAX(addressable across sub-categories)
frag          = 1 − top3_vendor_share
xbu           = crossbu_spend / spend         # crossbu = MIN(AT_spend, OH_spend) if both>0 else 0
Feasibility   = feas_frag_weight*frag + feas_xbu_weight*(xbu / MAX(xbu))
prov_base     = 1 − services_coded_share      # services_coded_share = share where id_type='generic'
Provability   = prov_base * (services_penalty if services_coded_share > services_threshold else 1)
score_raw     = Prize * Feasibility * Provability^prov_exponent
Score(0–100)  = 100 * score_raw / MAX(score_raw)
savings_lo/hi = addressable * savings_rate_low/high * Provability   # confidence-adjusted
```
Reference scores for the 5 deep-dive categories (validate against): Industrial Supplies 100 · Chemicals 44.5 · Machine/Equip Repairs 8.4 · First Fill Oils 5.3 · Industrial Gas 4.0. *(These are the deep-dive set, not strictly the top-5 by score — e.g. Electrical & Electronics scores 4.8 but was not selected for deep-dive.)*

## A.4 Vendor rationalization tiers (per vendor in a category; first match wins)
```
if oem:                                          "Keep — OEM/sole-source"
elif spend >= tier_keep_spend or segs >= tier_keep_segs:  "Keep — strategic/broad"
elif spend >= tier_leverage_spend:               "Leverage — negotiate"
elif spend >= tier_consolidate_spend:            "Consolidate — fold to winner"
else:                                            "Exit — tail/maverick"
```
Reference (Industrial Supplies): 1,093 → target ~100; bottom two tiers = 1,005 vendors (91%) = 37% of spend.

## A.5 Opportunity generation (spend pocket = one L3 × one country)
```
group by (country, l3)
qualify pocket if: spend >= play_min_spend AND vendor_count >= play_min_vendors AND l3 != 'N/A'

# SEGMENT GATE first
if segment_class(l3) == 'engineered':
    route → CARVE-OUT track (OEM should-cost + alternative-part qualification); NO consolidation play

winner       = vendor with MAX spend WHERE oem = FALSE     # OEM never the winner
winner_share = winner_spend / pocket_spend
oem_spend    = SUM(spend WHERE oem = TRUE)

# LEVER ROUTE (winner_share decides; capability is a flag)
if winner_share >= winner_share_consolidate:       # 0.50
    lever   = "Vendor consolidation (to incumbent)"
    movable = pocket_spend − winner_spend − oem_spend     # tail moves to incumbent
else:
    lever   = "Vendor consolidation (Competitive RFP)"
    movable = pocket_spend − oem_spend                    # whole non-OEM base contestable
savings = movable * savings_rate(lever)            # A.6 tiers
```
**Capability gate:** the largest non-OEM incumbent is only a *candidate winner*. If `capability_class` = specialist/niche (e.g. R L Guimont = metrology), do **not** consolidate onto it — run an RFP for a broad-line integrator. If capability-unverified, conclusion reads "confirm range coverage, else RFP."

## A.6 The five levers — trigger, formula, data, savings, staging
**1 · Vendor consolidation** *(now)* — fragmented pocket. Route + movable per A.5. **Savings rate:** consolidate-to-incumbent **4–7%**; competitive RFP **5–8%**; fragmented-tail / lead+panel **6–10%**. Data: cube `net_spend` by vendor×L3×country, `oem`, `capability_class`.

**2 · Cross-division leverage** *(now)* — both AT and OH buy the same L3 in the same region.
```
crossbu_addressable(region, l3) = MIN(AT_spend, OH_spend)      # genuine overlap only
savings = crossbu_addressable * rate_xbu                        # rate_xbu 5–8%
```
**Geography-gated** (A.10): material overlap is essentially India + marginal US — treat as a *regional* lever, never a global vendor merge. Data: `net_spend` by company×L3×country.

**3 · Benchmark / should-cost** — see A.7 for data sourcing & formulas (the flagged gap). Mix of *now* (payment terms; directional unit cost) and *staged* (index should-cost; same-item dispersion). **Savings is gap-based, not a flat %.**

**4 · Supplier transition** *(partly staged)* — move volume to a better-fit/lower-cost capable supplier (incl. naming an RFP winner different from the current largest).
```
savings = volume_moved * (current_unit_price − target_unit_price)     # needs price proof → staged
# Layer-0 proxy: when RFP names a new winner, use the RFP movable × rate (A.5/A.6)
```
Data: vendor-capability master + price benchmark (A.7).

**5 · Spec & demand optimization** *(staged — needs spec attributes)* — collapse spec variants of the same functional item; cut consumption.
```
savings = Σ over spec-variant groups [ (premium_spec_price − standard_spec_price) * volume ]
        + demand_reduction * unit_price
```
Data: part/spec master (not yet available) → flagged "needs part-master validation."

## A.7 Benchmark / should-cost — data sourcing & calculation
**POC decision:** benchmarks run on **free + internal** sources — (a) payment terms, (b) directional unit cost, and **BLS Producer Price Index** (free REST API) for category price trend / inflation normalization. Paid providers (Beroe, S&P Global, aPriori) plug in for production through a single **`BenchmarkSource` adapter** (one interface, pluggable providers) landing into a Gold **`benchmark`** table the engine joins to categories via a **`category → index/series` map**. Swapping providers requires **no engine change**.

Four sub-methods, by what the data supports:

**(a) Payment-terms benchmark — computable NOW.** Compare each vendor/category's `pay_terms` to the best in-class terms; value the gap as working capital.
```
wc_value = annual_spend * (best_terms_days − current_terms_days)/365 * cost_of_capital
```
Source: cube `pay_terms`. A real lever even where spend is already consolidated.

**(b) Directional unit-cost read — NOW, but flagged directional (not like-for-like).**
```
unit_price(segment, vendor) = net_spend / qty        # only where qty>0 & UOM comparable
best_demonstrated           = 25th-percentile vendor unit price in the segment
savings (directional)       = Σ over high-cost vendors [(unit_price − best_demonstrated) * qty]
```
Also surface the **AT-vs-AOH unit gap** per segment. **Caveat:** ~100% of lines are `EA`/`AU`; valid only as a directional outlier finder, **not** committed savings. Source: cube `qty`, `net_spend`.

**(c) Index-based should-cost — STAGED (commodity categories).** For categories priced off commodity inputs:
```
should_cost_unit = (index_price * input_intensity) + conversion_cost + target_margin
gap              = actual_price_unit − should_cost_unit
savings          = gap * normalized_volume      # volume in standard units (L, kg)
```
Best fit: First Fill Oils → **base-oil index**; Industrial Gas → **bulk-gas index**; Chemicals → **feedstock/metal indices**. Requires UOM normalization to price-per-standard-unit → **needs part master / clean UOM**. **Data sources:** S&P Global (Platts) and Beroe commodity/category price intelligence.

**(d) External providers — via the `BenchmarkSource` adapter.** **BLS PPI** — *free, wired for the POC* (commodity series for metals, chemicals, fuels, rubber → trend + inflation-normalize). **Beroe LiVE.Ai DataHub** — REST API, 2,300 direct/indirect categories + 12k commodity forecasts (procurement-grade category should-cost; production primary). **S&P Global (Platts)** — accredited REST API, 12,000+ raw commodity assessments / base oil, gas, metals (index should-cost for Fluids/Gas/Chemicals; production). **aPriori** — should-cost for machined/engineered parts (the OEM carve-out track; needs CAD/part data). **Distributor catalogs** (Grainger/MSC list vs. paid) — sampled.
Example `category → series` map: First Fill Oils → base-oil index (Platts) or PPI lubricating oils; Industrial Gas → industrial-gas PPI / Platts; Chemicals → feedstock PPI; abrasives/cutting → PPI metals.

## A.8 Maverick / off-catalog *(now)*
```
micro_maverick: spend < mav_micro_spend AND lines <= mav_micro_lines    # $10k & 2 lines
one_po:         lines == 1
```
Reference (Industrial Supplies): 426 micro ($0.92M) + 381 one-PO ($3.28M) → catalog/integrator migration.

## A.9 Fragmentation metrics (cockpit & qualify) *(now)*
```
share_v = vendor_spend / scope_spend
HHI     = Σ (share_v * 100)^2           # 0–10,000; higher = more concentrated
top_n_share = Σ top-N vendor shares
tail_count(t) = COUNT(vendors with spend < t)      # t = tail_t1 $100k, tail_t2 $25k
```

## A.10 Cross-BU & geography gate
`crossbu_spend(region, l3) = MIN(AT_spend, OH_spend)` (genuine overlap only). Consolidation runs **within region** (US tail → US integrator; Europe tail → Rubix; India tail → marketplace integrator). Cross-BU is a regional lever, not a global merge. Reference: Industrial Supplies splits AT≈US ($12.7M), AOH≈Italy ($9.0M) / Belgium ($2.7M) / India ($4.3M); only India is materially dual-BU.

## A.11 Data-quality auto-flags (block "act" until resolved)
Flag a pocket when its top vendors' `capability_class` contradicts its L3 label. Known cases: India "Hand and Power Tools" = automation/equipment (Kuka/Siemens/Surface Combustion → likely engineered); India/China "Seals – Mechanical and Oil" = lubricants (→ route to Fluids, fix taxonomy); Italy "Paint" includes application *systems* (Verind → engineered carve-out). Also normalize L3 **case duplicates** (`Machine parts` vs `Machine Parts`) before grouping.

## A.12 Monitor — value projection
```
identified_value = savings (engine, at qualify)
committed_value  = CM-entered at commitment
realized_proj(t) = committed_value * clamp((t − t_start)/ramp_months[lever], 0, 1)   # ramp curve
realized_actual  = SAP-measured post-award actuals (fact_spend_actual) when the SAP feed is live; CM-entered otherwise.
                   realized = baseline_run_rate − post_award_run_rate on the opp's vendor/category scope,
                   split into price effect vs. volume effect, CM-attributed. This (not the projection) is sent to Shibumi.
```
Projections are always visually distinct from actuals; no realized figure exists without CM entry.

## A.13 Blocked items & re-run hooks
| Limitation | Hook |
|---|---|
| Part/spec master missing → no same-item price; spec lever blocked | **Swap** item key `material_id` → mfr part no.; recompute `id_type` coverage; unlock A.7(c)/spec lever; re-run scan + plays |
| `controlled`/`cust_directed` AOH-only (~15%) | Request AT-side flags; apply `customer_directed` disqualifier evenly |
| Machine/Equip Repairs = services | Needs SOW + labor rate cards → rate-card panel lever (not item consolidation) |
| Savings are 5–10% hypotheses | Convert with part-master price proof + benchmark/should-cost |
| Taxonomy case-duplicates | Normalize L3 case before grouping |
