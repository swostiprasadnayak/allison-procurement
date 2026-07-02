# Allison — Indirect Procurement Control Tower (Navanta Lens)

> **Scope note (v1.1):** the app is **MRO-only** — the Navanta × Allison MRO
> discovery scope. All opportunities, vendors and dashboard figures come from
> the cube's MRO slice ($109.3M: AT $60.9M / AOH $48.4M; L2 breakdown and the
> 38-vendor roster extracted from `C-Indirect Spend Cube`, Consol 1 = MRO).
> Non-MRO scenarios (Material Handling/TFS, FM, IT, Packaging, Corp Svcs…)
> were removed in the rescope. UI deltas vs the spec below: the Opportunity
> column is split into Opportunity + Sub-category, promoted filter chips are
> capped at 3 per table, and the Mercer Morning Brief is a horizontal band
> above a full-width feed table (no right rail). Side navigation uses the DS
> `SideNav` (v0.4.0) with the TopBar toggle.

Agent-first indirect-procurement app for **Allison (ALSN)** post-merger (AT + AOH).
The AI actor is **Mercer** (named in the Navanta Lens V4.2 feature list). Pattern
source: the IRIS app (`../iris`) — review → commit/qualify/dismiss, AI voice, motion.
Component library: `@navanta-ai/design-system` v0.3.3 (already installed & wired).

**Reference packs for implementers** (read before coding):
- `/tmp/allison-understand/ds_inventory.txt` — full DS component API + gotchas (MUST READ)
- `/tmp/allison-understand/iris_ai-patterns.txt` — IRIS interaction model, CSS recipes
- `/tmp/allison-understand/xlsb_indirect-cube.txt` — source data facts
- `docs/persona-commodity-manager.md` — the user persona (Maria Vance)

---

## 1. Product story

Allison's merger created $761.6M of in-scope indirect spend across 10 L1 categories,
~8,000 vendors, 1.3% vendor overlap. Benchmark savings potential: **$72.7M–$102.1M**;
booked so far: **$1.3M** (41 initiatives, 0 in execution). Mercer runs the
**Scan → Qualify → Act → Monitor** loop: it sweeps every L2 × country bucket through a
two-gate screen (Gate 1: both entities ≥$250K AND fragmentation gap ≥2×; Gate 2: fit
factor 0–1), computes **confidence = fit × min(gap, 20)/20** (independent of $ size),
and surfaces a ranked opportunity feed. The commodity manager reviews evidence, then
**Commits** (→ Value Realization tracking), **Qualifies** (Mercer deep-dives), or
**Dismisses with a reason** (model feedback — "casualties" stay visible for trust).

## 2. Routes

| Route | Name | Purpose |
|---|---|---|
| `/` | redirect | `redirect("/dashboard")` (server component) |
| `/dashboard` | Command Center | KPIs, Mercer narrative, estate charts, pipeline funnel |
| `/opportunities` | Opportunity Feed | THE core page — ranked AI feed + review panel |
| `/vendors` | Vendors | Vendor roster: categorize, score, edit lead time/terms |
| `/tracking` | Value Realization | Committed plays: stages, ramp, milestones, drift alerts |

All four live in route group `src/app/(portal)/` with a shared client layout
(Sidebar + TopBar + scrollable main). No auth in v1.

## 3. Data model (`src/types/`)

```ts
// types/opportunity.ts
export type OpportunityStatus =
  | "surfaced" | "qualifying" | "qualified"          // feed
  | "committed" | "in-execution" | "realized"        // tracking
  | "dismissed";                                     // casualties

export type Archetype =
  | "consolidation"        // compete incumbent platforms
  | "operating-model"      // e.g. self-managed → managed service
  | "payment-terms"        // terms harmonization
  | "substitution"         // HHI-directed absorb (one side absorbs other)
  | "tail-rationalization";// integrated supply / tail elimination

export type EvidenceBasis = "benchmark" | "evidence" | "mixed";

export interface SideProfile {
  entity: "AT" | "AOH";
  vendorCount: number;
  topShare: number;        // top-5 share, 0–100
  spend: number;
}

export interface OppEvent {
  kind: "surfaced" | "qualified" | "committed" | "dismissed" | "stage-advanced"
      | "drift-flagged" | "drift-cleared" | "note";
  actor: "Mercer" | "Maria Vance";
  at: string;              // ISO date
  note?: string;
}

export interface Milestone {
  id: string; label: string;
  status: "completed" | "active" | "pending";
  date?: string;
  events: { type: string; date: string; severity: "info" | "warning" | "critical";
            note?: string; resolved?: boolean }[];
}

export interface Opportunity {
  id: string;                       // "OPP-001"
  title: string;
  category: string; l2: string; country: string;
  archetype: Archetype;
  addressableSpend: number;
  savingsLow: number; savingsHigh: number;
  fragmentationGap: number;         // ×
  fitFactor: number;                // 0–1
  confidencePct: number;            // fit × min(gap,20)/20 × 100
  evidenceBasis: EvidenceBasis;
  status: OpportunityStatus;
  mercerSummary: string;            // dense narrative w/ mid-dot separators
  rationale: string[];
  recommendedAction: string;        // "Consolidate 18 vendors onto Fuchs · RFQ by Jul 10"
  fragmentedSide: SideProfile;
  consolidatedSide: SideProfile & { anchorVendorId?: string };
  vendorIds: string[];              // roster refs into vendors.ts
  exclusions?: { label: string; amount: number; reason: string }[];
  caveats?: string[];               // data-quality warnings (PanelAlert)
  dismissReason?: string;
  owner?: string;                   // tracking
  committedAt?: string;
  milestones?: Milestone[];
  ramp?: { year: number; projected: number; realized?: number }[];
  drift?: { flagged: boolean; note: string; mercerAction?: string };
  events: OppEvent[];
}
```

```ts
// types/vendor.ts
export type VendorEntity = "AT" | "AOH" | "Both";
export type VendorType = "manufacturer" | "distributor" | "service-provider"
  | "managed-service" | "utility" | "government";
export type VendorStatus = "active" | "preferred" | "consolidation-target" | "exit-planned";

export interface ScoreCriterion {
  key: string; label: string;
  weight: number;        // sum = 1
  score: number;         // 0–100
  note?: string;
}

export interface VendorEvent {
  kind: "lead-time-updated" | "terms-updated" | "status-changed" | "category-changed"
      | "score-recomputed" | "note" | "mercer-flag";
  actor: "Mercer" | "Maria Vance";
  at: string;
  note?: string;
  change?: { field: string; from: string; to: string };
}

export interface Vendor {
  id: string;                  // "VEN-001"
  name: string;
  entity: VendorEntity;
  category: string;            // L1 (10 Navanta L1s)
  subcategory?: string;        // L2
  country: string;
  region: "Americas" | "EMEA" | "APAC";
  annualSpend: number;
  type: VendorType;
  paymentTermsDays: number | null;   // null = data gap (real Allison problem)
  leadTimeDays: number | null;
  leadTimeTrend: "improving" | "stable" | "slipping";
  overlap: boolean;
  dataReliability: "high" | "medium" | "low";
  score: number;                     // 0–100 weighted composite
  scoreBreakdown: ScoreCriterion[];
  status: VendorStatus;
  contractExpiry?: string | null;
  notes?: string;
  events: VendorEvent[];
}
```

**Score criteria** (lib/score.ts — deterministic recompute on edit):
cost-competitiveness 0.25 · delivery-and-lead-time 0.20 · terms-vs-benchmark 0.15 ·
range-coverage 0.15 · risk-and-financial-health 0.15 · data-reliability 0.10.
`recomputeScore(vendor)` = Σ weight×score, rounded. Editing lead time adjusts the
delivery criterion (slip beyond baseline → −points, capped), null terms → terms
criterion ≤40 with note "No terms data on file".

## 4. Seed data — REAL numbers from the spend cube (`src/data/`)

Currency: store raw dollars; format with `lib/format.ts` (`fmtM(761_600_000) → "$761.6M"`,
`fmtK(405_000) → "$405K"`).

### Feed opportunities (status varies; ids OPP-001…)
1. **Material Handling & Storage US — migrate AT onto Total Fleet Solutions managed
   fleet** · operating-model · addressable $3.91M · gap 94× · fit 0.9 · **conf 90%** ·
   $196K–$313K (note: TFS's published 20–30% claim ⇒ $783K–$1,174K upside, excluded
   from model) · AT side: 188 vendors / avg $20.8K · AOH side: 2 vendors, TFS = 82%
   ($639K) · evidence: mixed · caveat: brand-independent — AT keeps Toyota/Hyster/Crown
   equipment.
2. **MRO Chemicals US — consolidate fluids & lubes onto one platform (Fuchs vs Lemak)**
   · consolidation · $8.09M addressable (of $10.02M category; 18 of 32 vendors) · gap
   16× · fit 1.0 · **conf 80%** · $405K–$648K · exclusions: process/water-treat/plating
   chem $943K (7 vendors), industrial gases $530K (4), unclassified $454K (10) ·
   anchor candidates: Fuchs (AOH incumbent **manufacturer**, $1.82M — presumptive
   winner, removes distributor margin, full ECOCUT/RENOLIN range) vs Lemak (AT
   incumbent **distributor**, $5.09M) · evidence basis: evidence (line-level Material
   Description review done).
3. **FM Facility Services US — consolidate AOH base onto AT facility platform** ·
   consolidation · $31.49M · gap 11.2× · fit 0.6 · conf 33.6% · $1.57M–$2.52M.
4. **Corporate Services Marketing US** · consolidation · $5.09M · fit 0.4 · conf 30.2% ·
   $254K–$407K.
5. **Packaging Corrugated US** · consolidation · $10.42M · fit 0.6 · conf 27% ·
   $521K–$834K.
6. **IT Computer Software US — license rationalization** · consolidation · $27.73M ·
   fit 0.4 · conf 21.4% · $1.39M–$2.22M.
7. **CAPEX Machinery US** · consolidation · $19.35M · fit 0.7 · conf 21.3% · $968K–$1.55M.
8. **MRO Machine & Equipment Repairs US** · tail-rationalization · $30.90M · fit 0.5 ·
   conf ~17% · $1.55M–$2.47M · caveat: repairs are plant-touching; site-by-site rollout.
9. **MRO Industrial Supplies US — integrated supply / catalog compression** ·
   tail-rationalization · $12.71M · fit 0.55 · conf ~16% · $636K–$1.02M · note:
   retained Fastenal/Motion catalog rate compression worth ~$3M est. across MRO.
10. **FM Cleaning US — extend AOH's GDI platform** · consolidation · $4.64M · fit 0.85 ·
    conf 15.7% · $232K–$371K.
11. **FM Security US — Allied Universal 96% AT-concentrated; absorb AOH** ·
    substitution · $2.94M · fit 0.85 · conf ~15% · $147K–$235K.
12. **Building Maintenance US — substitute Motion Automation Intelligence spend toward
    Koorsen Fire & Security + Trane** · substitution · $3.54M · HHI ratio 7.7× (AOH HHI
    3194 / 10 vendors vs AT HHI 417 / 194 vendors) · fit 0.7 · conf 70% (HHI-High) ·
    $177K–$283K.
13. **MRO payment-terms harmonization — US top vendors to Net 60** · payment-terms ·
    $274.7M AT spend lacks terms data; AOH 89-day Fastenal benchmark · conf 45% ·
    working-capital play, savings shown as DPO-uplift note $310K–$520K est. ·
    evidenceBasis: benchmark · caveat: $232.6M of AOH spend has NO terms data at all.
14. **Cline Tool parent-level negotiation — single vendor across 3 categories** ·
    consolidation · $25.3M combined ($11.1M Cutting Tools + $8.3M MRO + $5.9M CAPEX) ·
    conf 55% · $759K–$1.27M · rationale: one parent, three category relationships,
    no enterprise agreement.
15. **Cutting Tools US↔Italy — OEM consolidation + regrind program** · consolidation ·
    $14.73M · fit 0.6 · conf ~22% · $737K–$1.18M (9.8–14% benchmark band).

### Casualties (status: dismissed, with dismissReason + Mercer event)
- Logistics Hungary $2.27M — "vendor" is Nav Import Vam, the Hungarian customs
  authority; non-negotiable government levy.
- Packaging Steel/Metal/Plastic India $1.25M — consolidated "vendor" is Allison
  Transmission Inc. itself (intercompany).
- CAPEX Torque Equipment India $366K — Atlas Copco 100%; OEM-locked sole source.
- CAPEX Tooling India $782K — already 94% single-vendor (Vebro); fragmented side only $382K.

### Pre-committed (tracking page seeds)
- **OPP-101 "MRO Gases US — cylinder contract consolidation"** · committed → validating ·
  $530K addressable · $42K–$68K · owner Maria Vance · milestones: Committed ✓ →
  Category & finance validation (active) → RFQ → Award → Ramp.
- **OPP-102 "Corporate Services Temporary Labor US — Ternes → Manpower panel"** ·
  in-execution · $4.18M · $209K–$334K · milestone "Award" completed; ramp 2026 $90K
  projected / $61K realized · **drift.flagged: true** — Mercer note: "Onboarding stalled
  at 2 of 4 sites · 31 days since last status change · realized tracking 32% behind
  plan"; mercerAction: "Escalate site-2 MSA signature to plant GM · revised ramp
  available".
- **OPP-103 "Packaging Lumber & Pallets US — Markleville consolidation"** · realized ·
  $2.2M · committed $128K, realized $97K YTD · all milestones completed.

### Vendors (~45 rows; real names/spend — key rows)
MRO: Cline Tool $8.3M AT (also Cutting Tools $11.1M + CAPEX $5.9M — model as 3 rows or
one row w/ note; use category MRO w/ note), Lemak LLC $5.09M AT distributor,
TotalEnergies Italia $4.9M AOH, Kirby Risk $4.3M AT, Fastenal $2.66M **Both**
(AT $6K / AOH $2.66M, AOH terms 89d), Fuchs Lubricants $1.82M AOH manufacturer,
Henkel $1.13M AT, QualiChem $1.06M AT, Motion Industries $949K Both, Chem-Trend $231K,
Kost USA $184K.
Material Handling: Toyota MH Tennessee $1.29M AT, Total Fleet Solutions $639K AOH
managed-service, Topper Industrial $440K, Wiese Planning & Eng $432K, Ace Industries
$351K, Hoosier Crane $263K, Aska Technos $3.5M AT APAC, Jungheinrich Italiana $712K AOH.
Cutting Tools: Gleason Cutting Tools $4.86M Both, Forst Technologie $3.6M, I.P.R.
Macchine $1.3M AOH.
FM: Indianapolis Power & Light $16.5M AT utility, Intra Srl $7.3M AOH, Engie Italia
$7.0M AOH, Motion Automation Intelligence $3.5M AT, Pepper Construction $2.9M AT,
Allied Universal $2.7M AT, Koorsen Fire & Security $410K AOH-side US, Trane US $385K
Both (Medium reliability), Cintas $1.25M Both, Leadec Kft $491K Both Hungary.
Packaging: Stephen Gould $3.5M Both (HIGH reliability evidence: AT $1,593/inv vs AOH
$76,458/inv), Welch Packaging $1.25M Both, Buckeye Corrugated $2.1M, Holz Legno $1.8M
AOH, Markleville Lumber $2.2M.
IT: SAP NS2 $4.8M, Microsoft Leasing $3.5M, PhaseZero $1.55M AOH, Presidio $1.6M,
Siemens Industry Software $2.0M.
Logistics: Infios US $25.6M, Ryder $25.1M, Ziegler $2.4M AOH.
Corp Svcs: KPMG $23.6M, Manpower Srl $3.3M AOH, Ternes Indiana $4.18M AT.
Spread plausible leadTimeDays (3–45), one or two with leadTimeTrend "slipping"
(e.g., a repairs vendor 14→42d w/ Mercer flag event), terms: AT vendors mostly 60/62/30,
many `null` (the real data gap), AOH mostly null except Fastenal 89.

### Dashboard data (`src/data/dashboard.ts`)
- Estate: inScope $761.6M; AT $533M / AOH $228.6M; identified $72.7M–$102.1M.
- L1 table (spend / AT-vendors+top5 / AOH-vendors+top5 / benchmark band): use the
  fragmentation heatmap numbers from the cube (Corporate Services 946/46.7% vs 543/26.9%;
  MRO 686/35.6% vs 1,166/22.4%; Logistics 96/94.8% vs 206/39.1%; etc. — full list in
  xlsb_indirect-cube.txt VENDORDATA).
- Legacy pipeline: 41 indirect initiatives · $1.3M · stages 28 Idea / 13 Charter / 0 / 0.
- Benchmark savings by L1 (the $72.7–102.1M table) for a bar chart.

## 5. Mercer AI voice (IRIS rules, Allison skin)

1. **Named actor**: "Mercer" everywhere — "Mercer Summary", "Mercer's sweep",
   timeline events `actor: "Mercer"`. NEVER "the AI".
2. **Icon**: copy `/public/ai-star-small.svg` + `/public/AI-star-heading.svg` from
   `../iris/public/`. Never Phosphor `Sparkle`.
3. **Gradient ownership**: AI CTAs use DS `Button variant="christy"`
   (`--gradient-christy` #1D4A86→#3D348B). Lavender recommendation bands:
   `linear-gradient(to right,#EBDFFF 72%,#F3ECFE 100%)`; AI panel wash:
   `linear-gradient(147.68deg,#F5F0FF 4.74%,#FFFFFF 39.12%)`. Purple = Mercer only.
4. **Confidence on every rec** — "Confidence 80%" caption in band headers; confidence
   is independent of $ size (small clean > huge messy).
5. **Narrative style**: dense, specific, mid-dot separators, concrete numbers/dates:
   "AT self-manages $3.9M across 188 vendors · AOH runs 2 · migrating onto TFS's
   managed-fleet contract clears the 94× gap and books $196K–$313K."
6. **Caveat discipline**: evidence-basis pill (benchmark/evidence/mixed) on every
   opportunity; PanelAlert for data gaps; "benchmark-basis — validate vendor-by-vendor
   against AT contract rates before committing" copy.
7. **Commit micro-sequence** (copy IRIS keyframes into globals.css):
   click Commit → button "Committing…" + `.mercer-btn-committing` 220ms pulse →
   band swaps to green success (`linear-gradient(to right,#D6F5E2 0%,#F3FAF6 100%)`)
   wrapped in `.mercer-commit-success` (320ms) with duotone CheckCircle in
   `.mercer-check-burst` + **Undo** button → close panel → row green-flash 2s → fade
   200ms → moves out of feed; success toast. Reduced-motion clamp on everything.
8. **Dismiss = calibration feedback**: reason dropdown (canned: "Non-negotiable
   counterparty (gov/utility)", "Intercompany spend", "OEM-locked sole source",
   "Already consolidated", "Plant constraint", "Data quality insufficient",
   "Other (specify)") + copy "Logged for sweep calibration."

## 6. UI composition per page (DS components — see ds_inventory.txt for exact APIs)

**Shell**: `(portal)/layout.tsx` (client): provider stack OpportunityStore > VendorStore;
flex h-screen [Sidebar | flex-col [TopBar | main]]. Sidebar: 232px fixed, white,
logo block ("Allison · Navanta Lens" + AI star), nav items (House Dashboard /
Briefcase Opportunities w/ live surfaced-count badge / Truck or Factory Vendors /
ChartLineUp Value Realization w/ drift badge), Phosphor duotone inactive / fill active,
bottom: avatar "Maria Vance · Commodity Manager — MRO". TopBar: 48px white border-b,
route title left, right: "Mercer · last sweep 04:00 today" status chip + AiStar.
Main: bg `var(--surface-raised)` (#f8fafc), scrollable, content max-w-[1648px] mx-auto
px-6 py-6 flex flex-col gap-6.

**Dashboard**: PageHeading + Mercer narrative card (wash gradient, AiStar 24px,
2–3 sentence estate synthesis with strong numbers, focus chips linking to pages) →
KpiGrid [In-scope spend $761.6M · Identified $72.7–102.1M · Pipeline coverage (live:
Σ feed savings mid ÷ (2× $17.1M MRO base target), show ratio) · Committed (live Σ) ·
Realized (live Σ)] → grid: BarChart "Benchmark savings potential by category" (Base $
per L1) + fragmentation DataTable (L1, spend, AT vendors/top-5, AOH vendors/top-5,
verdict pill "Severely over-supplied") → bottom row: legacy-pipeline funnel card
(28 Idea/13 Charter/0/0 + "Mercer surfaced 15 in 4 minutes" contrast line + Button
→ /opportunities) + AT-vs-AOH StackedBarChart by region.

**Opportunities**: PageHeading + right-rail Mercer brief panel (325px; wash gradient;
rows: "15 surfaced · 2 high-confidence", "$278.4M addressable scanned · 612 buckets ·
2 gates", "4 screened out — view casualties", live committed count) | main: TableShell
(title "Opportunity Feed", icon Briefcase, search, facets: category select (promoted),
archetype toggle-group (promoted), country select, "High confidence ≥60%" ToggleFacet
w/ count, tabs: Feed (default) / Dismissed / All w/ badges) + DataTable: columns
Opportunity (title + `${category} · ${l2} · ${country}` sub, cellLayout col wrapLines 2),
Archetype (Pill: consolidation info / operating-model warning / substitution neutral /
payment-terms info / tail neutral), Addressable (right, fmtM), Gap ("94×", right),
Confidence (custom mini-bar + %, sortable, DEFAULT SORT desc), Savings (range, right),
Evidence (pill: evidence=info, benchmark=warning, mixed=neutral), Status. Row click →
DetailPanelShell (width 480): title id, subtitle `${title}`, statusRow = confidence bar;
children: Mercer recommendation band (lavender, AiStar, "Mercer recommends · Confidence
80%", recommendedAction headline, rationale bullets) — THIS band swaps to commit-success
green on commit (IRIS pattern) → caveats PanelAlert(s) → PanelInfoGrid "Opportunity
profile" (addressable, gap, fit, archetype, sides w/ vendor counts + top-5 shares,
anchor vendor link) → vendor roster mini-table (name, entity, spend, type — from
vendorIds) → exclusions list (if any) → PanelTimeline (events; idPrefix=opp.id).
Footer: [Dismiss ghost] [Qualify outline] [Commit christy fullWidth-ish].
Qualify → status qualifying + toast "Mercer is assembling the evidence pack…" then
1.6s later status qualified + confidence recalc (+5pts if evidence, else −) + toast +
event. Dismiss → Dialog w/ reason Select + optional note → status dismissed → row
animates out → toast "Logged for sweep calibration". Commit → micro-sequence above →
status committed, committedAt now, default milestones generated, appears in /tracking;
toast "OPP-002 committed · tracking in Value Realization".

**Vendors**: PageHeading + KpiGrid [Vendors under management (count) · Spend covered ·
Overlap vendors (count + %) · Avg score · Missing terms data ($ + count)] → TableShell
(title "Vendor Management", search, facets: category select promoted, entity
toggle-group promoted (AT/AOH/Both), "Serves both entities" toggle, "Missing terms
data" toggle, "Lead time slipping" toggle; tabs All / Consolidation targets /
Preferred / Exit planned) + DataTable: Vendor (name + type sub), Category (+L2 sub),
Entity (Pill AT=info AOH=warning Both=neutral), Country, Spend (right, sortable,
default sort), Terms ("Net 60" or "— no data" amber), Lead time ("14d" + trend arrow:
slipping=red ArrowUp w/ tooltip, improving=green ArrowDown), Score (colored number:
≥75 success, 50–74 warning, <50 destructive; sortable), Status (Pill). Row click →
DetailPanelShell: title name, subtitle `${category} · ${fmtM(spend)}`; children:
Mercer band IF vendor is anchor of an active opp ("Anchor candidate for OPP-002 ·
consolidation winner — manufacturer, removes distributor margin") → PanelAlert if
leadTimeTrend slipping or terms null → score breakdown card (6 criteria rows: label,
weight, mini progress bar, score, note) → PanelInfoGrid (entity, type, country/region,
terms, lead time, reliability, contract expiry, overlap) → **Edit form** (DS Input
number for lead time, Select for terms presets [Net 30/45/60/90/—], Select status,
Select category): Save → updates store, appends VendorEvent(s) w/ change {from,to},
recomputeScore, toast "Lead time updated 14d → 28d · score 82 → 74" → PanelTimeline
events. Footer: Button "Save changes" (disabled until dirty).

**Tracking**: PageHeading + KpiGrid [Committed value (Σ mid savings) · In execution ·
Realized YTD · Drift alerts (count, destructive when >0)] → ramp chart card: BarChart
or custom grouped bars projected-vs-realized 2026–2029 (Σ ramps of committed opps) →
TableShell (title "Committed plays", tabs by stage: All / Validating / In execution /
Realized, facets category select) + DataTable: Play (title + id sub), Category,
Committed savings (range, right), Stage (4-step progress dots — extend TABLE_STATUSES
pattern: committed=1, validating=2, in-execution=3, realized=4; map tones success,
drift→warning), Owner (party cell or plain), Next milestone (label + date), Drift
(warning Pill "Stalled 31d" when flagged). Row click → DetailPanelShell: Mercer drift
PanelAlert when flagged (note + mercerAction + [Apply revised ramp] [Escalate] buttons
that clear flag w/ event + toast) → PanelInfoGrid (committed, basis, owner, committedAt,
addressable) → realized-vs-target Progress bar → PanelTimeline milestones
(idPrefix=opp.id) → events timeline. Footer: Button outline "Advance stage" (advances
status + milestone, appends event, toast; hidden at realized).

## 7. State (`src/context/`)

`OpportunityStoreContext`: `useState<Opportunity[]>` seeded; derived via useMemo:
feed (surfaced/qualifying/qualified sorted conf desc), dismissed, tracked
(committed/in-execution/realized), counts, sums (committedMid, realizedYtd,
driftCount, surfacedCount). Actions (useCallback, immutable map + appendEvent):
`commit(id)`, `qualify(id)` (two-phase w/ setTimeout 1600ms — keep timer in ref,
clear on unmount), `dismiss(id, reason, note?)`, `undoCommit(id)`, `advanceStage(id)`,
`clearDrift(id, action)`. Every mutation pairs with an OppEvent — audit never drifts.

`VendorStoreContext`: `useState<Vendor[]>`; actions `updateVendor(id, patch)` →
appends events per changed field + recomputeScore + score-recomputed event.

Toasts: DS `ToastProvider` + `<Toaster position="top-right"/>` in root layout;
`useToast().addToast(msg, "success" | …)`.

## 8. Files & conventions

```
src/
  app/layout.tsx            # DS styles.css BEFORE globals.css; ToastProvider+Toaster; Geist
  app/globals.css           # tailwind + mercer keyframes + reduced-motion clamp
  app/page.tsx              # redirect("/dashboard")
  app/(portal)/layout.tsx   # client shell: stores > Sidebar+TopBar+main
  app/(portal)/{dashboard,opportunities,vendors,tracking}/page.tsx + _components/
  components/layout/{Sidebar,TopBar}.tsx
  components/mercer/{MercerBand,MercerNarrativeCard,ConfidenceMeter,CommittedBand}.tsx
  context/{OpportunityStoreContext,VendorStoreContext}.tsx
  data/{opportunities,vendors,dashboard,taxonomy}.ts
  types/{opportunity,vendor}.ts
  lib/{format,score}.ts
public/ai-star-small.svg, public/AI-star-heading.svg   # copied from ../iris/public
```

- TypeScript strict; named Phosphor imports only; duotone for status icons, bold for
  active/primary, regular default.
- Numbers in tables: `style={{fontVariantNumeric:"tabular-nums"}}` or class.
- Pill has NO success variant — use custom span w/ `--success` tokens for green pills.
- TableShell pagination is controlled: slice rows yourself; totalItems = filtered count.
- DataTable `sortMode="client"` for flat data; columns need `cell` always.
- DetailPanelShell: render once per page, toggle `open`; pass `idPrefix` to each
  PanelTimeline; z-index 90/95 — keep shell chrome below.
- Switch uses `onCheckedChange`; Dialog uses `onClose`; Popover spreads triggerProps.
- All client pages: `"use client"` at top. App builds with `npm run build` cleanly.
```
