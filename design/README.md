# Navanta Lens — Design Prototypes

## `navanta_lens_prototype_v2.html` (v2.1)

**v2.1** restyles the prototype onto the *genuine* `@navanta-ai/design-system`
v0.4.13 tokens — several differ from what the app currently hardcodes and are
worth reconciling in `frontend/`:

| Token | Design system says | App hardcodes |
|---|---|---|
| Primary CTA | charcoal `#232122`, hover `#000` | indigo `#2F2B6E` |
| AI / Christy CTA | gradient `154.42deg #1d4a86 → #3d348b` | flat purple |
| Brand accent | `#6440b6` (`--kds-color-brand-accent`) | `#59349C` |
| Status pills | tonal 50/800 pairs (`--pill-*-bg/fg`) | ad-hoc tints |
| Progress fills | held-light → dark-at-tip gradients (Figma spec) | flat/simple gradients |

v2.1 also adds five UX corrections: titled attention cards with denominators
("Awaiting triage · 5 of 7 opportunities"); **Ask Mercer always left-most in
every decision footer**; an Act **evidence loop** (attach/paste → Mercer
analyzes → insights saved to the play → drafts re-issued as versions; manual
edits save as new versions, all selectable); **parked opportunities can be
approved or rejected directly**; and a decluttered feed (grouped by
sub-category with Σ-addressable headers, essential-columns default + "All"
toggle, one shared upper-bound note instead of a chip on every row).

The **to-be experience reference** for the frontend, rebuilt (Jul 2026) against the
*deployed* build rather than the discovery workbook. Open it in any browser — single
file, no dependencies, fully interactive.

**Why v2 exists.** The v1 prototype predated the real build. v2 mirrors the deployed
app's live API data exactly — the same 7 opportunities (`OPP-001…007`), the same
engine figures (Σ savings midpoints = $120,916.17 = `/api/cockpit`'s
`identifiedValueMid`), the same vendor names — so a build/design diff is 1:1 on the
same numbers. It then layers on every accepted fix from the UX audits:

| Fix | Where to see it |
|---|---|
| Confidence: 99% display ceiling + High/Medium/Directional bands, formula in explain popover | any confidence meter → ⓘ |
| Confidence score-decomposition wired into Qualify (incl. analyst-adjusted variant) | Qualify → "What drove this" |
| Declared ranking, default Impact = addressable × confidence; Brief claim tracks the active sort | Feed header |
| Bulk triage (multi-select → shared Park/Reject, reasons required) | Feed checkboxes |
| New/changed-since-last-sweep chips with the triggering signal | Feed rows (OPP-002, OPP-005) |
| Explain-this-number → methodology deep-link with row flash | any ⓘ → "View in Methodology" |
| Attention strip + value funnel + 2-sentence synthesis | Command Center |
| Commit requires timing + basis; toast carries "Track in Value Realization →" | Act modal |
| Error state ≠ loading state | Demo menu → "Simulate data-service error" |
| Vendor lead-time/terms edits actually move the data-confidence composite (one criteria model) | Vendor panel → Update operational data |
| Drift resolution flow (apply revised figures / re-affirm / escalate) with commit-baseline diff | Value Realization → OPP-004 |
| Labeled midpoints, share-of-pocket denominator, OEM carve-out rows, upper-bound caveats | throughout |
| Scope switcher (Enterprise / AT / AOH) — one persona, three altitudes, atomic re-derive | top bar |
| Scan scorecard (per-category ranking + zero-yield honesty), inbox-zero state, pillar vision stubs | Feed brief · triage everything · nav rail |

**Numbers are load-bearing.** `console.assert` self-checks at boot enforce:
roster Σ = pocket per opportunity, pocket − carve-outs = movable, Σ midpoints =
$120,916.17, vendor spend Σ = $10,519,000.55. If you edit the data, keep them green.

Validated by a 96-assertion jsdom behavior suite (triage, bulk, override, approve →
act → commit, drift resolution, SAP simulation, vendor score recompute, methodology
edit → explainer re-derive, scope switching, error/empty states).
