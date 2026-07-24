# Feed & Vendor Roster — Research Context

Consolidated findings from CM (Commodity Manager) workflow research, the July 2026 opportunity-review meeting transcript, and the Vendor Roster / Sub-Opportunity Qualification prototype work. This is a handoff doc — read this before picking up design or engineering work on the Feed or Opportunity Detail → Vendor Roster surfaces.

Companion docs: `FEATURE_ROADMAP.md` (features #1–15, engineering-ready specs), `design/README.md` (prototype file index + dev server).

---

## 1. The CM's operational flow

Four stages, each with its own decision gate:

1. **Feed (Triage)** — scan opportunities, decide relevance/credibility before opening one.
2. **Opportunity Detail** — validate the business case (lever, spend math, vendor positioning).
3. **Vendor Qualification** — per-vendor go/no-go. **This stage does not exist in-product today** — CMs do it in Excel qualification workbooks. This is the single largest product gap identified.
4. **Act** — execute the chosen playbook (outreach, RFP, renegotiation, transition, rate-card reset).

The Vendor Roster prototype (`design/vendor_qualification_prototype.html`) is the in-product model of stage 3.

---

## 2. What the CM looks for in the Feed

Before opening an opportunity, the CM screens for:

- **Relevance** — directional signal that a real lever exists
- **Credibility** — is the confidence score evidence-derived or benchmark-derived?
- **Freshness** — timing-aware (is this data current, is a contract window open?)
- **Fragmentation gap** — ≥2× deeper than baseline is the rough bar
- **Addressable spend** — ≥$250K is the rough bar for it to be worth the effort
- **Vendor roster soundness** — can she tell who the real players are?
- **Effort-to-savings trade-off** — S/M/L size matched against Med/High effort

### Vendor count as a proxy signal
Vendor count is read as a **proxy for fragmentation depth**, not a hard gate:
- **8+ vendors** → real competitive tension exists; a consolidation or RFP play has actual leverage
- **1–2 vendors** → incumbent lock; the lever won't move the needle, screen it out early
- Exception: a single-OEM vendor in a critical category may still be worth negotiating even with low count — it's a credibility filter, not a rule

### On what terms she commits to pursuing an opportunity
All of the following need to hold, not just one:
1. Evidence holds up on inspection (survives her own sanity-check of the benchmark gap)
2. Fragmentation gap is real (vendor count / share-of-wallet supports it)
3. The lever is executable *now* (contract timing isn't blocking it)
4. Vendor roster is sound (she can name who's who)
5. Effort is proportionate to size
6. Readiness is assessed per-vendor, not for the whole opportunity as a block

---

## 3. Per-vendor decision states: Pursue / Investigate / Reject

**As of the July 2026 review, "Wait" was removed** — confirmed unnecessary and likely to be dropped. Three states remain:

- **Pursue** — evidence holds up, lever is executable, effort is proportionate. Commits the vendor into Act.
- **Reject** — incumbent lock with no counterweight, evidence collapses on inspection, contractually blocked with no near-term window, or effort/size never clears the bar. Meant to be **permanent for the cycle** — removes the vendor from active reconsideration.
- **Investigate** — evidence/context is incomplete, not that the opportunity is unattractive. Requires a **structured next step** (SKU review / contract review / counterpart check), not just a vague "look into this later." **Per the meeting transcript: Investigate vendors stay in scope through Act** — they are not held back from Act, they get resolved *during* Act.

This maps to Feature #15 in `FEATURE_ROADMAP.md`.

---

## 4. Choosing the Approach (lever) once a vendor is in Pursue

Five factors determine which of the playbooks gets selected — Re-negotiate, Competitive RFP, Consolidate RFP, Benchmark/should-cost:

1. **Fragmentation structure** — many vendors/no dominant player → Consolidate; several comparable vendors → Competitive RFP; 1–2 vendors, workable relationship → Re-negotiate
2. **Contract timing** — is the lever actually available now, or blocked until renewal
3. **Reason for action** — pure cost play stays in the four levers above; quality/risk/relationship-broken pushes toward Supplier Transition (a separate, heavier playbook, out of scope for this prototype)
4. **Category type** — services/labor spend uses Rate-Card reset, not a per-unit lever
5. **Effort budget vs. playbook cost** — RFP-style plays are reserved for L-size/high-confidence opportunities; Re-negotiate/Benchmark are cheap enough to run even on S/M

In-product, **Approach is a per-row, per-vendor field** — not fixed at a group level. Changing it re-groups the vendor into a different Approach section. This mirrors the reference design exactly (see §6).

---

## 5. Meeting transcript findings (July 2026 opportunity-review session)

Source: Sebastian Irani, Tanuj Gupta, Ashish Sharma, Mahi, Swosti — walkthrough of how the team is qualifying opportunities today, offline, in Excel.

**Confirmed structural facts:**
- CMs do **not** run the qualification flow inside the platform today — it happens entirely in spreadsheets ("savings data packets"), split by region.
- The team pulls specific vendors out of an opportunity's rolled-up list and re-groups them into **sub-opportunities** — a named, tighter clustering of vendors they've decided to actually pursue together.
- Vendor research is done manually via web search ("what does this vendor actually sell?") — flagged explicitly as something to bake into the product (→ Feature #14).
- **Anti-pattern, don't rebuild:** an earlier attempt to tag vendors into research-derived "segments" was abandoned — "most of them broke down pretty quickly." Don't reintroduce a formal vendor-segment taxonomy.
- Vendors need to move **across opportunities**, not just within one sub-grouping (example given: moving a vendor from sub-opp 13A into 30A because it's a tighter fit with a different vendor) — confirms Feature #11 needs cross-opportunity reassignment, not just within-opportunity.

**Effort / Savings / Risk mechanism (this is new, not previously modeled):**
- Size (S/M/L) maps to a base savings-% band (4/6/8%), applied to the sub-opportunity's own bundled spend.
- **Effort now drives a risk adjustment on top of the size-based estimate** — this was an explicit correction mid-meeting ("the risk is over and above this number... because that's where your savings estimate came from to begin with"). High effort → higher risk → lower expected savings; low effort → lower risk → the estimate holds closer to the base band.
- Both the **base** and the **risk-adjusted** range need to be shown in any client-facing artifact — not just one number.
- The exact risk-adjustment formula was **not finalized** in the meeting (Sebastian: "shoot... is it gross?") — the prototype uses an illustrative retention factor (Low ×0.90 / Med ×0.75 / High ×0.60), clearly flagged as provisional and configurable.
- Confidence score is **explicitly de-emphasized** for now — "thinly justified," not a focus for the upcoming demo unless a stakeholder asks. This is reflected in the prototype as a small muted chip, not a prominent progress bar.

**Two other real workflows surfaced:**
- **System-generated flow** (what the prototype models): Feed → Qualify → Act → Monitor.
- **Business-owner-driven flow** (not yet modeled in any prototype): a non-procurement stakeholder sole-sources or shortlists a vendor themselves, then hands it to procurement for due diligence/benchmarking/RFP execution. Whether these show up in the same feed as system-generated opportunities, or separately, was left open ("they agreed on flexibility, with options to filter or separate").
- **Spend thresholds** (real policy, not yet enforced in-product): purchases >$250K require an RFP or a documented sole-source justification; >$50K require benchmarking. Not currently surfaced in the roster (see §7, deferred).
- **Manual vendor addition**: vendor data is predominantly ERP-sourced, but the team needs the ability to add a placeholder vendor manually to run an RFP against a net-new/temporary supplier, before that vendor goes through full onboarding. Full onboarding only triggers if that vendor is actually awarded work.

---

## 6. Vendor Roster prototype — design decisions

File: `design/vendor_qualification_prototype.html` (standalone, no build step, opens via `file://` or the dev server).

### Structural correction (the big one)
The first build modeled the meeting transcript's "sub-opportunity" concept as a heavy card: a bordered container per sub-opp with a shaded header holding a code chip, a colored lever chip, a Size badge, an Effort badge, and a stacked savings box. Compared against the actual reference design (a real product screenshot), this read as **cluttered** — the reference uses a single continuous table with plain, minimal group-header rows (bold label + a small grey count pill), and per-row dropdowns for Approach and Scope.

**Rebuilt to match the reference exactly:**
- One `<table>`, not a card per group.
- Plain `tr.grp` header rows — reused from the same grouped-row pattern already established in the design system (`navanta_lens_prototype_v2.html`'s `.tbl tr.grp`).
- **Grouping key changed from sub-opportunity → Approach (lever)** — this matches the reference precisely, and is arguably more correct anyway: the reference groups by *what lever a vendor is currently under*, with the sub-opp code demoted to a plain informational column (`OPP-011A`, or `—` if unassigned).
- **Approach is now a per-row `<select>`** — changing it re-groups the vendor immediately. This single control replaces what was previously a separate "Move" icon → dropdown menu → checkbox-multi-select → "New sub-opportunity from selected" button flow. That flow is gone entirely; Approach reassignment does the same job with far less UI.
- Action column simplified to **Edit (stub) + Delete**, matching the reference (no Move icon).
- The size/effort/risk-adjustted-savings math didn't disappear — it lives on the **Savings Derivation tab**, which was already a plain flat table and was never part of the "too chaotic" complaint. It shows the full two-step calculation: Size → base savings-% band → base savings, then Effort → risk retention factor → risk-adjusted savings, with both a base rollup and a risk-adjusted rollup.
- The opportunity-level Mercer Summary tiles (top of the page) are **roll-ups**, not single opportunity-wide values: Sub-opportunities count + size mix, Σ risk-adjusted savings (with base kept alongside), and effort mix (Low/Med/High counts). This reflects the earlier finding that size/effort belong at the sub-opp level, not the opportunity level — a single opp-wide T-Shirt Size hides where the real savings live.

### Other confirmed feature decisions baked into the prototype
- Scope = Pursue / Investigate / Reject (no Wait).
- Investigate reveals a structured next-step selector inline (SKU review / contract review / counterpart input / price benchmark) and is explicitly labeled "resolved in Act (stays in scope)."
- Manual "Add vendor" places a placeholder vendor (tagged `Manual`) under an "Unclassified" group with no Approach assigned yet.
- Confidence is a quiet header chip, not a prominent progress bar.

### Deferred, not forgotten
- **Spend-threshold policy flags** (>$250K RFP/sole-source justification, >$50K benchmark) were built once, then intentionally stripped out of the roster during the design-correction pass because the reference screenshot doesn't show them there. The logic (`policy()` helper) was removed rather than left dead — reintroduce deliberately (likely as a column on the Savings Derivation tab, which is a natural home for it) when this becomes the active thread of work again.
- **Edit vendor** action is currently a stub toast — no detail editor is modeled yet.
- **Cross-BU/region consolidation view** (Feature #13) and **vendor research lookup** (Feature #14) are specified in `FEATURE_ROADMAP.md` but not built into this prototype.
- Whether **Approach should be directly editable at a would-be "sub-opp" grouping level**, vs. purely per-vendor as it is now, is an open question — noted at the end of the previous design pass and still unresolved.

### Inspect mode (tooling, not a product feature)
Added directly into the prototype to solve a practical problem: this environment can't forward a local dev server's port to your browser, so pointing at a specific element for feedback needed a workaround. Toggle via the bottom-right pill or the `i` key — hovering highlights any element with a friendly label, clicking captures a stable CSS-ish reference (e.g. `.approachsel[data-vid="v4"]`) into a copyable field. This is how "p.hint remove this" and `.sogroup[data-so="A"]` were communicated in this thread. Keep using it for future edits — paste the captured reference plus what you want changed.

Building this also surfaced a real (if minor) bug: `#toasts` had no `pointer-events:none`, so several stacked toast notifications could silently intercept clicks meant for whatever was underneath. Fixed at the CSS level, independent of Inspect mode.

---

## 7. Local dev server

`design/dev-server.js` — zero-dependency Node static server with live-reload (SSE-based), serving the whole `design/` folder. Run `node design/dev-server.js` (defaults to `:4173`). Note: in this remote container, the server isn't reachable from your local browser — run it on your own machine after `git pull` for real live-reload; use the published Artifact or Inspect mode for in-conversation review instead.

---

## 8. Open questions for next round

- Approach editing: per-vendor dropdown only, or should there also be a group-level bulk reassignment affordance for when many vendors need the same change at once?
- Where do spend-threshold policy flags resurface — Savings Derivation tab column, a tooltip on Addr. Spend, or elsewhere?
- Business-owner-driven flow (sole-sourced/shortlisted opportunities entered manually) — same feed as system-generated, or a separate view? Not designed yet.
- Risk-adjustment formula is illustrative (Low/Med/High × 0.90/0.75/0.60) — needs to be replaced with whatever Sebastian/Ashish finalize.
- Edit-vendor action needs a real destination (modal? drawer? inline expand?) — currently a stub.
