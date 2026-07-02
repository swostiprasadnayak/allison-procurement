# Navanta Lens — Frontend Gap Analysis & Build Plan

*Working plan to evolve the current Next.js prototype toward the Feature Spec (`Navanta_Lens_01_Feature_Spec`) and Design Doc (`Navanta_Lens_04_Design_Doc`). Scope of this doc = the **frontend** in this repo. Engine / Lakebase / Node API / SAP / Shibumi / copilot-core are backend deliverables, referenced here only as the contract the frontend is "designed-for."*

**Status:** Draft v0.1 · **Date:** 2026-06-30

**Planning decisions taken (this round):**
1. **Scope = full spec coverage** — all 5 module screens + Admin + pillar stubs + the Mercer copilot *frontend surface* (core is mocked).
2. **Domain-model remodel = plan-only** — the lever/lifecycle/movable-spend mismatch is documented here with the required mapping; the *mechanism* (remodel-to-spec vs map-layer) is **not yet chosen** and gates Phases 2–5.
3. **Design tokens = Navanta DS wins** — the installed `@navanta-ai/design-system` + `navanta-app-design` skill is the source of truth. Design Doc §1 is **superseded** where it conflicts (see §B).

---

## A. Current state → spec mapping

Prototype is **mock-data backed** (`src/data/*.ts` + React context stores in `src/context/`). No Lakebase `opp.*` binding yet.

| Current route | Spec screen | State |
|---|---|---|
| `dashboard` | Cockpit (§4.2) | Partial — KPIs, fragmentation, savings-by-category, terms-gap, legacy pipeline |
| `opportunities` + `ReviewPanel` | Feed (§4.1) **and** Qualify (§4.3), fused | Strongest — feed table, Mercer Morning Brief, evidence/waterfall/fit/your-input panel |
| `tracking` | Monitor (§4.5) | Partial — ramp chart, stage dots, commitments |
| `vendors` | Vendor landscape | Exists; spec treats Supplier 360 as a *pillar stub* and vendor-capability as *Admin* |
| — | **Act / Playbooks (§4.4)** | **Missing** |
| — | **Admin (§4.7)** | **Missing** |
| — | **Pillar stubs (§4.8)** | **Missing** |
| Morning Brief + narrative cards | **Mercer copilot (§4.6/§9)** | Present as *narrative*, not as the Q&A/draft/`view_context` surface |
| — | **Scope selector (§3)** | **Missing** (TopBar has only a sub-category dropdown) |

---

## B. Decisions & conflicts to resolve

### B1. Domain-model mismatch — DECISION PENDING (gates Phases 2–5)
Document now; choose mechanism before building data-heavy screens.

**Levers** (`src/types/opportunity.ts:10`):
| Current `Archetype` | Spec lever (§3.3) |
|---|---|
| `consolidation` | Vendor consolidation |
| `tail-rationalization` | Vendor consolidation (tail route) |
| `substitution` | Supplier transition |
| `operating-model` | (no clean spec equivalent — likely Supplier transition / services) |
| `payment-terms` | Benchmark / should-cost → payment-terms sub-method (A.7a) |
| *(none)* | **Cross-division leverage** — missing |
| *(none)* | **Spec & demand optimization** — missing (staged) |

**Lifecycle** (`OpportunityStatus`):
| Current | Spec (§3.2) |
|---|---|
| `surfaced` | Surfaced |
| `qualifying` | In Qualify |
| `qualified` | (→ Accepted) |
| `committed` / `in-execution` | In Act / In Monitor |
| `realized` | Realized |
| `dismissed` | Dismissed |
| *(none)* | **Parked** (non-terminal, revisit trigger) — missing |
| *(none)* | **Lapsed** (expired/superseded) — missing |

**Movable-spend math** (§3.4, A.5): spec mandates segment gate → `winner_share ≥ 0.50` routes Consolidate vs Competitive RFP → `movable = pocket − winner(if consolidate) − OEM`, with the **contestability upper-bound label**. Current model uses `fragmentedSide`/`consolidatedSide` + a savings waterfall — needs re-derivation to the pocket/winner/OEM model.

→ **Open choice:** (a) remodel types + mock data to spec, or (b) keep internals + add a display/translation layer. Recommend deciding before Phase 2.

### B2. Token reconciliation — RESOLVED (Navanta DS wins)
Where Design Doc §1 conflicts with the installed DS, the DS governs:
| Design Doc §1 | Use instead (Navanta DS) |
|---|---|
| Christy purple `#8c5de1` | AI/Christy `#3B0764`; brand blue `#1D4A86` |
| App bg `#fafafa` (flat) | Gradient page bg `linear-gradient(130deg,#D9E2F9,#C1CFF3)` |
| **Geist Mono** for every number | **Geist** (sans) with `tabular-nums` |
| Zinc neutral scale / radius 8–12 | DS tokens (text `#0F172A`/`#64748B`, border `#E2E8F0`, radius scale full/16/12/8/6) |
*Action: keep this table as the override note; do not retune the app to Design Doc §1.*

---

## C. Phased build plan

Dependencies: **Phase 0 gates all**; **Phase 1 (scope)** gates aggregate correctness everywhere; **B1 model decision** gates Phases 2–5.

### Phase 0 — Foundations
- **Data-contract layer**: shape `src/types` + `src/data` to mirror the `opp.*` contract (Design Doc §7) — `opportunity`, `opportunity_recommendation`, `opportunity_evidence_factor` (ordered rows), `opportunity_vendor`, `opportunity_trigger`, `cockpit_summary`, `play*`, `value_commitment`, `value_realization`, `engine_parameter`, `user_scope`, `view_context`. Mock-backed, but API-shaped so a later swap to the Node/Lakebase API is mechanical.
- **Apply B2 token note**; remove any Design-Doc-§1-driven values already in the tree.
- **Land B1 decision** (see §B1).

### Phase 1 — Scope selector (§3, cross-cutting)
- Persistent top-bar control: `BU (AT/AOH) ▸ Region ▸ Country ▸ Category (L1→L3)`, breadcrumb style, dropdown per level; static label when scope is fixed.
- New `ScopeContext`; every feed/cockpit/monitor aggregate re-derives from active scope in one interaction. Bind to `user_scope`. (Server-side enforcement is backend; frontend treats scope as a hard filter.)

### Phase 2 — Feed + Qualify (§4.1, §4.3) — *blocked on B1*
- **Feed**: rank by `Prize × Feasibility × Provability²`; show category path + geo, addressable **and movable $**, lever chip, confidence/provability badge, flags (needs-part-master, contestability, drift, data-quality); filter/group by scope dims/category/lever/confidence/status; bulk triage (read/park/dismiss+reason); inline "why new/changed" from `opportunity_trigger`.
- **Qualify**: split current fused screen into a proper two-pane — evidence (play-one-line, score decomposition, vendor landscape with **OEM carve-out separated**, **movable-spend math** `pocket → −winner(if consolidate) → −OEM → = movable` with upper-bound label, geo/BU, recommended play, benchmark availability now-vs-staged, data-quality flags) + decision rail (**Accept / Park / Dismiss**, **lever override** with justification, "Ask Mercer about this").

### Phase 3 — Cockpit (§4.2)
- KPI row (total spend, #suppliers, #open opps, identified value, realized value); spend composition (L1→L3, AT vs AOH, geo, vendor tier); fragmentation (vendor count, HHI, tail < $100k); **category-ranking scorecard** (Prize×Feas×Prov² + "why ranked here"); top opps → Qualify; supplier highlights; value summary by lever; "data as of {run}" stamp; drill paths on every figure.

### Phase 4 — Act / Playbooks (§4.4) — NEW
- Playbook picker (Consolidate / Competitive RFP / Negotiate-Benchmark / Supplier transition / Services rate-card); play instance pre-filled from opp evidence; assignable task checklist with status; **Mercer draft generation** (outreach / RFP scaffold / negotiation points — marked "AI draft", editable, never auto-sent); commit panel → `value_commitment`; lever-tiered editable savings rate w/ justification; drift banner.

### Phase 5 — Monitor (§4.5) — align existing `tracking`
- Pipeline funnel (identified → accepted → committed → realized); realization curve **projected (dashed) vs actual (solid)**; commitment entry; realized detail (price vs volume effect, coverage %); supplier performance; drift flags; **Shibumi link/field** on the opportunity. No fabricated actuals.

### Phase 6 — Mercer copilot surface (§4.6/§9) — frontend only, core mocked
- Global launcher (slide-over) + in-context "Ask Mercer about this"; plumb **`view_context {page, entity_id, run_id}`** on every call; per-page suggested prompts + default draft type (table §4.6); citation chips; drafts → `play_artifact (is_draft=true)`; `surface-brand` panel. Wire against a mock core; scope stays a server-side concept (UI never widens it).

### Phase 7 — Admin (§4.7) — NEW
- Methodology page (renders formulas from Appendix A with **live parameter values**); versioned parameter table ("applies next run", last-changed-by/at); Client Methodology Agreement (versioned sign-off + change log); Validation Queue (low-confidence normalization, mis-tag, needs-part-master).

### Phase 8 — IA / nav + pillar stubs (§2, §4.8)
- Restructure `SideNav` (`src/components/layout/Sidebar.tsx`) into the 3 spec groups: **Category & Opportunity Mgmt** (Feed · Cockpit · Qualify · Act · Monitor) · **Platform pillars** (Inventory · Demand & Supply · Supplier 360 · Market Intelligence) · **Admin**.
- Build the 4 pillar vision screens (hero + "how it connects via the shared backbone" + tasteful teaser; never imply live data).

### Cross-cutting (woven through Phases 2–8)
- **"How is this calculated?"** popover (§5.4) as a first-class control on every figure (formula + params + lineage).
- Full-lifecycle **status pills** (§5.2), **lever chips** (§5.3), **flags/badges** (§5.5).
- **Empty / Loading / Error / No-permission** states on every screen (§6); desktop-first, graceful to ~1024; Qualify two-pane → stacked below ~1200.

---

## D. Explicitly out of this repo (backend / "designed-for")
Engine calc (Appendix A), Lakebase, Node API, SAP `fact_spend_actual` feed, Shibumi push/pull, copilot core, part/spec-master unlocks (same-item price, spec lever). Frontend accommodates these via the Phase-0 data contract + "staged / needs part-master" labels rather than building them.

---

## E. Immediate next step
Resolve **B1** (model remodel mechanism), then start **Phase 0** (data-contract layer) + **Phase 1** (scope selector) in parallel, since both are prerequisites for the screen work and neither is blocked by the others.
