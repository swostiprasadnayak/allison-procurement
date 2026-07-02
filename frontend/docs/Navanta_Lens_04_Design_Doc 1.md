# Navanta Lens — Category & Opportunity Management
## Design Document (for Designers)

*Doc 4 of 4. The designer-facing brief: information architecture, screen-by-screen specs, scope-adaptive behavior, states, reusable components, and — critically — **what data each element binds to** (the `opp.*` Lakebase contract from the data model). Visual style follows the **Navanta Design System** (Section 1). Build target: **Next.js** frontend on the Node.js API over Lakebase.*

**Status:** Draft v0.2 for review · **Date:** 2026-06-29
**v0.2:** §4.6 — the copilot is **context-aware**; the frontend passes a `view_context` (page + active entity + run_id) on every call (drives retrieval anchoring, "this/here" reference resolution, and per-page prompts/draft defaults). Copilot **core** is now a Navanta deliverable; the frontend owns the surfaces, `view_context`, server-side scope, and rendering. See Architecture §6.
**Read alongside:** Feature Spec (what each screen must do + acceptance criteria), Data Model (`opp.*` fields), Architecture (how data arrives).

---

## 1. Design system foundation (Navanta)

All screens use the Navanta Design System. Designers should pull tokens from the org style guide; the essentials:

**Fonts.** `Geist` for all headings, body, UI, labels, buttons. **`Geist Mono` for every number** — spend, savings, %, vendor counts, HHI, prices. (This is a spend product; numeric legibility matters.)

**Type scale.** H1 32/600, H2 24/600, H3 20/600, KPI-large 20/600, table-heading 16/600, column-heading 13/600, body 14/400, body-medium 14/500 (active/selected), body-strong 14/600, body-mono 14/400, link 14/500.

**Color.**
- **Brand "Christy" purple** — `500 #8c5de1` (primary brand / AI), `600 #6a3ebd` (hover), `50 #f7f2ff` (brand surface). **Reserve purple + `surface-brand` for AI / Mercer** features and AI-identified insights — not generic accents.
- **Neutral (Zinc)** — `900 #18181b` primary text, `600 #52525c` secondary text, `200 #e4e4e7` borders, `100 #f4f4f5` active, `50 #fafafa` app background, `0 #fff` cards.
- **Semantic** — Success `#ecfef3`/`#008234`, Warning `#fffbea`/`#9e3900`, Destructive `#fff1f2`/`#a7000f`, Info `#f0f9ff`/`#005b89`.

**Surfaces.** App background `surface-grey #fafafa`; cards `surface-white #fff`; AI panels `surface-brand #f7f2ff`; sidebars `surface-secondary #e4e4e7`.

**Buttons.** Standard primary = dark (`#18181b` bg / `#fafafa` text). **AI/Mercer primary = Christy `#8c5de1`.** Secondary = ghost (`#fafafa`/border `#d4d4d8`). Link = `#005b89`.

**Grid & spacing.** Desktop-first, 12-col, 24px gutter, 32px margin, **max content 1440px**. 8pt spacing scale (4/8/12/16/20/24/32/40/48/64). Border/divider `#e4e4e7`; input border `#d4d4d8`; radius 8–12px on cards/pills.

> Quick combos: page `#fafafa` · card `#fff` · primary text `#18181b` · secondary `#52525c` · primary button dark · AI button purple · border `#e4e4e7`.

---

## 2. Information architecture

**Left nav (persistent), grouped:**

- **Category & Opportunity Management** *(the live module)* → Feed · Cockpit · Qualify · Act · Monitor
- **Platform pillars** *(vision/stub)* → Inventory · Demand & Supply · Supplier 360 · Market Intelligence (each = one vision screen)
- **Admin** → Methodology & Parameters · Taxonomy · Vendor Capability · Validation Queue

**Top bar (persistent):** Navanta logo · **Scope selector** (persona altitude — §3) · global search · **"Ask Mercer"** launcher (Christy purple) · user menu.

The module is organized around the method **Scan → Qualify → Act → Monitor**, but the CM lives in **Feed → Qualify** day-to-day. Scan is system-run (no "scan" button); the Feed is its output.

**Default landing by persona:** Commodity Manager → Cockpit (their scope). CPO/Exec → enterprise Cockpit rollup (read-only). Portfolio Owner → Cockpit + Admin access.

---

## 3. Scope selector (persona altitude — cross-cutting)

The single most important interaction pattern. The same role operates at **plant / region / business-unit / category** altitude, so a persistent scope control drives everything.

- **Placement:** top bar, always visible; shows the active scope as a breadcrumb-style control (e.g. `AOH ▸ Europe ▸ Italy ▸ Industrial Supplies`).
- **Behavior:** changing scope re-derives the Feed, Cockpit, and every aggregate in one interaction. Bound to `opp.user_scope`; a user can only select within their granted scope.
- **Visual:** body-medium for the active node; secondary text for the path; a dropdown per level.
- **States:** if a user has a single fixed scope, render it as a static label (not a dropdown).

---

## 4. Screens

For each screen: **purpose · layout · key components · data binding (`opp.*`) · states**.

### 4.1 Opportunity Feed (Scan output — the inbox)
- **Purpose:** the ranked, scoped queue of opportunities. The CM triages here; they do not "scan."
- **Layout:** single-column list of **Opportunity Cards** (§5.1), left filter rail, sort control (default: score desc). Optional "why new/changed" banner per item.
- **Components:** filter rail (scope dims, category, lever, confidence, status); bulk triage (mark read / park / dismiss); signal chips inline.
- **Data binding:** `opp.opportunity_brief` + `_item` (the feed); cards read `opp.opportunity` (title, lever, addressable/movable, score, flags), `opp.opportunity_trigger` (why surfaced).
- **States:** *Empty* — "No open opportunities in this scope" (text-placeholder, illustration). *Loading* — skeleton cards. *New since last visit* — info pill + reason from trigger.

### 4.2 Category Cockpit (home)
- **Purpose:** the CM's scoped state-of-the-category + entry into opportunities and suppliers; also hosts the **category-ranking scorecard** (Scan's other output).
- **Layout:** KPI row (4–5 tiles) → two-thirds / one-third split: left = spend composition + fragmentation + category ranking; right = top opportunities + supplier highlights + value summary.
- **Components:**
  - **KPI tiles:** total spend, # suppliers, # open opportunities, identified value, realized value. (KPI-large, Geist Mono.)
  - **Spend composition:** by category (L1→L3), AT vs AOH, geography, vendor tier (bar/treemap).
  - **Fragmentation:** vendor count, HHI, tail size (# vendors < $100k).
  - **Category ranking scorecard:** the Prize × Feasibility × Provability² ranking with "why ranked here" — the artifact's "category ranking & rationale" view.
  - **Top opportunities** (mini Opportunity Cards → Qualify); **supplier highlights** (top vendors, current vs net-new); **value summary** (identified → committed → realized by lever).
- **Data binding:** `opp.cockpit_summary` (KPIs, rollups by lever), `opp.spend_pocket` / `fact_spend` aggregates (composition, fragmentation), scan ranking, `opp.opportunity` (top), `opp.vendor_capability` (suppliers).
- **States:** every figure has a drill path; scope change recomputes all tiles; "data as of {run_date}" stamp.

### 4.3 Qualify workspace (the heart)
- **Purpose:** decide one opportunity — *is it real? do I act? which lever?* Where the CM spends most time.
- **Layout:** two-pane. **Left = evidence** (scrollable); **right = decision rail** (sticky) + Mercer panel.
- **Evidence components (left):**
  - **The play, one line** — recommended lever + movable $ + recommended lead supplier(s) with status chip (current / net-new). (H3 + body-mono for $.)
  - **Score decomposition** — Prize · Feasibility · Provability and how they combined; provability badge; "needs part-master" warning pill if flagged.
  - **Vendor landscape** — table: vendor · spend · share · tier · capability · OEM/winner flags; OEM/engineered carve-out visually separated from the contestable base.
  - **Movable-spend math** — the explicit, ordered calc: `Pocket spend → − Winner (if Consolidate) → − OEM → = Movable`, each row with its value; **contestability caveat labeled as an upper bound.**
  - **Geography & BU context** — where spend sits; cross-BU (synergy) vs single-BU tag.
  - **Recommended play & next steps**; **benchmark availability** (computable now vs staged); **data-quality flags** (mis-tag warnings).
- **Decision rail (right):** **Accept** (→ choose lever/play → Act), **Park** (reason + revisit trigger), **Dismiss** (reason). **Lever override** with captured justification. "Ask Mercer about this" (purple).
- **Data binding:** `opp.opportunity` + `opp.opportunity_recommendation` (scores, rationale, confidence) + `opp.opportunity_evidence_factor` (the decomposition + movable-math rows, ordered by `sort_order`) + `opp.opportunity_vendor` (landscape). Decisions write `opp.opportunity_event` + status.
- **States:** *Override* shows engine recommendation preserved + the CM's choice; *staged benchmark* shows "available with part master," not a number.
- **Key pattern:** every figure exposes **"how is this calculated?"** → opens the evidence-factor formula + parameters + lineage (§5.4).

### 4.4 Act / Playbooks
- **Purpose:** execute the chosen lever; generate artifacts; capture commitment.
- **Layout:** play header (opportunity context, lever, movable $) → task checklist → artifacts → commit panel.
- **Components:** **playbook picker** (consolidate / competitive RFP / negotiate / supplier transition / services rate-card); **task checklist** (assignable, status); **Mercer draft generation** (outreach / RFP scaffold / negotiation points — clearly marked **Draft**, editable, never auto-sent; purple AI affordance); **commit value** (writes a commitment).
- **Data binding:** `opp.play` (+ `play_task`, `play_artifact`), pre-filled from the opportunity's evidence; commit writes `opp.value_commitment`.
- **States:** drafts badge "AI draft — review before sending"; savings rate shown is lever-tiered and editable with justification; drift banner if underlying data changed.

### 4.5 Monitor / Value realization
- **Purpose:** track committed → realized and supply impact; the bridge to Shibumi.
- **Layout:** pipeline funnel (identified → accepted → committed → realized) → realization chart (projected vs actual) → commitments table → supplier-performance + drift.
- **Components:**
  - **Pipeline** by lever / category / scope.
  - **Realization curve** — projected (dashed) vs **actual (solid)** — visually distinct; no fabricated actuals.
  - **Commitment entry** (amount, timing, basis).
  - **Realized detail** — price effect vs volume effect, **contract coverage %**.
  - **Supplier performance** — on-time, fill rate, lead-time drift, PPV, quality (from `vendor_performance`).
  - **Drift flags**; **Shibumi link** (this opportunity's exec initiative).
- **Data binding:** `opp.value_commitment` + `opp.value_realization` (projected/actual, price/volume effect, coverage), `opp.fact_spend_actual` (run-rates), `opp.vendor_performance`; Shibumi id on `opp.opportunity`.
- **States:** *No actuals yet* — show projection + "actuals pending SAP / manual entry"; projections always dashed/labeled.

### 4.6 Mercer copilot (cross-cutting surface)
- **Purpose:** scoped, **context-aware** Q&A + explain-a-play + draft generation.
- **Surfaces:** (1) **global launcher** in top bar → slide-over panel; (2) **in-context** "Ask Mercer about this" in Qualify/Act.
- **Components:** chat thread; **answers cite the records used** (chips linking to opportunities/evidence); draft outputs route to `play_artifact`.
- **Visual:** `surface-brand #f7f2ff` panel, Christy purple accents, Geist Mono for any figures it returns.
- **Context-awareness (`view_context`) — frontend obligation.** The frontend **passes a `view_context` to the copilot on every call**, so it answers about *what's on screen* without the user restating it:
  ```
  view_context = { page: feed|cockpit|qualify|act|monitor,
                   opportunity_id? | category_code? | vendor_id?,   // the entity in view
                   run_id }                                         // the current engine run
  ```
  This drives three behaviors in the copilot core: **(1) retrieval anchoring** — the in-view entity's rows load first (on Qualify, *that* opportunity's evidence); **(2) reference resolution** — *"why is this consolidate?" / "who's the incumbent here?" / "explain this number"* resolve to the in-view entity; **(3) page defaults** — per-page suggested prompts + default draft type:
  | Page | Suggested prompts | Default draft |
  |---|---|---|
  | Cockpit | "why is _X_ ranked #1?", "where's my biggest movable?" | — |
  | Qualify | "explain the movable math", "what's the evidence?", "why this lever?" | — |
  | Act | "draft the RFP scaffold", "outreach to the incumbent" | RFP scaffold / outreach for the play in view |
  | Monitor | "realized vs committed?", "what's slipping?" | — |
  - When the user opens the panel from a card or a play, **prefill `opportunity_id`**; the global top-bar launcher opens with `page` only (no entity) and falls back to scoped search.
- **Data binding:** retrieves `opp.opportunity` / `evidence_factor` / `vendor_capability` / `cockpit_summary`, **filtered by `user_scope`** then **focused by `view_context`** (which only points *within* scope, never widens it — scope stays server-side, the LLM is never the scope boundary); cannot show out-of-scope data; says so when data is staged. Drafts write to `play_artifact` (`is_draft=TRUE`).
- **Build split:** the copilot **core** (grounded answers, drafts, guardrails, the `view_context` logic) is Navanta's deliverable; the frontend wires the **surfaces, passes `view_context`, enforces scope server-side, and renders citations/drafts**. See Architecture §6.

### 4.7 Admin — Methodology & Parameters
- **Purpose:** trust, transparency, client sign-off (admin-only).
- **Components:**
  - **Parameter management** — editable table of `engine_parameter` (seed = Appendix A.2), **versioned**; "applies on next run"; each value shows last-changed-by/at. *(No in-session live re-run.)*
  - **Methodology page** — renders the active formulas with current parameter values; the source for per-number "how is this calculated?".
  - **Client Methodology Agreement** — versioned sign-off + change log.
  - **Validation queue** — items needing review (low-confidence normalization, mis-tag, needs-part-master).
- **Data binding:** `opp.engine_parameter`, `opp.methodology_version`, `opp.methodology_agreement`; validation items flagged on pockets/opportunities.
- **Also under Admin:** Taxonomy (`ref.taxonomy`), Vendor Capability & category→lead map (`vendor_capability`, `category_lead_map`), lineage viewer.

### 4.8 Platform pillar vision screens (stub)
- **Purpose:** sell the platform; no live data. One screen each for **Inventory · Demand & Supply · Supplier 360 · Market Intelligence.**
- **Layout:** hero (pillar name + value statement) + "how it connects to the live module via the shared backbone" + a tasteful disabled/teaser visual. Navanta brand gradient imagery permitted.
- **States:** clearly "vision" — never imply live data.

---

## 5. Reusable components & patterns

### 5.1 Opportunity Card
The atom of the Feed and Cockpit. Shows: title; category path + geography (secondary text); **lever chip**; addressable $ and **movable $** (Geist Mono, movable emphasized); **score** + **confidence/provability badge**; **status pill** (§5.2); flag icons (needs-part-master, contestability, data-quality, drift). Card = `surface-white`, border `#e4e4e7`, radius 12, hover raises.

### 5.2 Status pills (lifecycle → semantic color)
| State | Pill |
|---|---|
| Surfaced | Info (`#f0f9ff`/`#005b89`) |
| In Qualify | Neutral active (`#f4f4f5`/`#52525c`) |
| Accepted / In Act / In Monitor | Brand-tint or Info |
| Parked | Warning (`#fffbea`/`#9e3900`) |
| Realized | Success (`#ecfef3`/`#008234`) |
| Dismissed | Destructive-subtle (`#fff1f2`/`#a7000f`) |
| Lapsed | Disabled (`#d4d4d8`) |

### 5.3 Lever chips
Five levers as labeled chips: Vendor Consolidation · Cross-Division Leverage · Benchmark/Should-Cost · Supplier Transition · Spec & Demand. Neutral chip with an icon; route sub-label (consolidate-to-incumbent / competitive RFP) as secondary text.

### 5.4 "How is this calculated?" affordance
A small info icon next to **every figure**. Opens a popover showing: the formula (from the Methodology page), the parameter values used, and a lineage link to source rows. Reads `opp.opportunity_evidence_factor` + `engine_parameter` + `engine_run.config_snapshot`. This is the transparency backbone — design it as a first-class, consistent control.

### 5.5 Flags & badges
- **Confidence/provability badge** — success (high) / warning (low); shows the provability basis on hover.
- **"Needs part-master"** — warning pill.
- **Contestability** — info note: "movable = upper bound."
- **Data-quality** — warning icon on mis-tagged pockets.
- **AI-identified** — Christy purple marker on engine/Mercer-generated content.

### 5.6 Money & number formatting
All numeric values in **Geist Mono**. Currency `$#,##0` with units in labels; %, multiples, counts mono. Negative/savings rendered consistently. Projected values dashed/italic; actuals solid.

---

## 6. States, accessibility, responsive

- **Every screen** designs Empty / Loading (skeletons) / Error / No-permission (out-of-scope) states.
- **Accessibility:** semantic color never the sole signal (pair with icon/label); contrast meets AA on `#fafafa`; focus rings on interactive elements.
- **Responsive:** desktop-first at 1440 max content; graceful down to ~1024 (laptop). The two-pane Qualify collapses to stacked below ~1200. Mobile is out of scope for the POC.

---

## 7. Data-binding appendix (screen → `opp.*` contract)

| Screen / component | Reads | Writes |
|---|---|---|
| Feed | `opportunity_brief`/`_item`, `opportunity`, `opportunity_trigger` | triage → `opportunity_event`, status |
| Cockpit | `cockpit_summary`, `spend_pocket`/`fact_spend` aggregates, scan ranking, `vendor_capability` | — |
| Qualify | `opportunity`, `opportunity_recommendation`, `opportunity_evidence_factor`, `opportunity_vendor` | `opportunity_event`, status, lever override |
| Act | `play`, `play_task`, `play_artifact`, opportunity evidence | `play*`, `value_commitment` |
| Monitor | `value_commitment`, `value_realization`, `fact_spend_actual`, `vendor_performance`, Shibumi id | `value_commitment`, `value_realization` (manual actuals) |
| Mercer | `opportunity`, `evidence_factor`, `vendor_capability`, `cockpit_summary` (scoped); **+ `view_context` {page, entity id, run_id} sent on every call** | `play_artifact` (drafts) |
| Admin | `engine_parameter`, `methodology_version`, `methodology_agreement`, `ref.taxonomy`, `vendor_capability`, `category_lead_map` | parameter/version/agreement edits |
| Scope selector | `user_scope` | active scope (session) |

---

## 8. Open design questions
- Cockpit vs Feed as the default landing per persona (assumed Cockpit for CM) — confirm.
- How prominent the category-ranking scorecard should be (cockpit module vs its own screen).
- Depth of the Act playbooks for the POC (full task workflow vs lightweight checklist).
- Mercer surface: slide-over only, or also a docked panel in Qualify.
- Pillar vision screens — how much teaser data/visual per pillar.
- Whether non-MRO categories appear in the POC Feed or it's filtered to MRO + fluids for the demo (ties to feature-spec §14).
