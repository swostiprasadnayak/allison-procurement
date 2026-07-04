// Server-only: these functions use the `pg` Pool (via @/lib/db) and are only
// imported by the Node-runtime route handlers under src/app/api/*.
import { q } from "@/lib/db";
import { buildRamp } from "@/lib/ramp";
import { buildPerformance } from "@/lib/vendorPerformance";
import type { Opportunity, OppExclusion, FunctionalFitCheck, DraftVersion } from "@/types/opportunity";
import type {
  ScoreCriterion,
  Vendor,
  VendorEntity,
  VendorOppRef,
  VendorRole,
  VendorType,
} from "@/types/vendor";

/**
 * Server-only CDM access layer. These functions query the local Postgres
 * "CDM" and map rows onto the EXISTING FE types (src/types/*). They are the
 * single bridge between the engine's snake_case Gold `opp.*` schema and the
 * frontend's view models — only the route handlers call them.
 */

const MRO_L1 = "L1|MRO";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** Map the CDM business-unit code onto the FE VendorEntity union. */
function entityOf(bu: string | null | undefined): VendorEntity {
  switch (bu) {
    case "AT":
      return "AT";
    case "OH":
      return "AOH";
    case "both":
      return "Both";
    default:
      return "AT";
  }
}

/**
 * The opportunity `SideProfile.entity` type is narrower than VendorEntity —
 * it only admits "AT" | "AOH". An opportunity's business_unit is single-sided
 * in practice; "both"/unknown collapse to "AT" to match the FE fallback.
 */
function sideEntityOf(bu: string | null | undefined): "AT" | "AOH" {
  return bu === "OH" ? "AOH" : "AT";
}

/** "L2|MRO>Industrial Supplies" -> "Industrial Supplies". */
function l2name(code: string | null | undefined): string {
  if (!code) return "";
  const parts = code.split(">");
  return parts[parts.length - 1] ?? "";
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Functional fit — DERIVED FROM REAL ENGINE SIGNALS (no canned text). Each row's verdict +
 * detail come straight from CDM fields:
 *   - asset/scope overlap ← business_unit (cross-BU = both)
 *   - vendor/brand independence ← OEM/sole-source share of the pocket
 *   - geography ← purchasing_country
 *   - play type ← play_route (the lever the engine chose)
 */
function deriveFunctionalFit(a: {
  businessUnit: string | null | undefined;
  oemShare: number; // 0..1
  country: string;
  playRoute: string | null | undefined;
  l2: string;
  vendorCount: number;
}): FunctionalFitCheck {
  const oemPct = `${Math.round(a.oemShare * 100)}%`;
  const buLabel = a.businessUnit === "OH" ? "AOH" : "AT";

  const assetScopeOverlap =
    a.businessUnit === "both"
      ? {
          label: "Asset & scope overlap",
          verdict: "pass" as const,
          detail: `Both AT and AOH buy in ${a.l2} — genuinely shared scope, so consolidation pools real cross-BU volume.`,
        }
      : {
          label: "Asset & scope overlap",
          verdict: "info" as const,
          detail: `Single business unit (${buLabel}) — a within-BU consolidation, not cross-BU synergy.`,
        };

  let vendorIndependence;
  if (a.oemShare <= 0.001)
    vendorIndependence = {
      label: "Vendor & brand independence",
      verdict: "pass" as const,
      detail: "No OEM/sole-source spend in this pocket — the full base can be competitively bid.",
    };
  else if (a.oemShare < 0.15)
    vendorIndependence = {
      label: "Vendor & brand independence",
      verdict: "pass" as const,
      detail: `Only ${oemPct} is OEM/sole-source — the rest can be competitively bid.`,
    };
  else
    vendorIndependence = {
      label: "Vendor & brand independence",
      verdict: "watch" as const,
      detail: `${oemPct} is OEM/sole-source (brand-locked); the remainder is contestable.`,
    };

  const geographyProof = a.country
    ? {
        label: "Geography",
        verdict: "pass" as const,
        detail: `Single geography (${a.country}) — no cross-border or multi-region complexity.`,
      }
    : { label: "Geography", verdict: "info" as const, detail: "Geography not specified for this pocket." };

  let operatingModel;
  if (a.playRoute === "consolidate")
    operatingModel = {
      label: "Play type",
      verdict: "info" as const,
      detail: `Consolidate — a dominant non-OEM incumbent holds ≥50%, so fold the ${a.vendorCount}-vendor tail onto them.`,
    };
  else if (a.playRoute === "rfp")
    operatingModel = {
      label: "Play type",
      verdict: "info" as const,
      detail: `Competitive RFP — no dominant incumbent, so compete the ${a.vendorCount}-vendor non-OEM base.`,
    };
  else if (a.playRoute === "sub-classify")
    operatingModel = {
      label: "Play type",
      verdict: "watch" as const,
      detail: `Sub-classify first — this pocket has no sub-commodity classification, so it bundles unlike items across ${a.vendorCount} vendors. Split it into coherent scopes (part / spec master) before any single sourcing event.`,
    };
  else
    operatingModel = {
      label: "Play type",
      verdict: "watch" as const,
      detail: "Benchmark / should-cost — engineered or OEM spend, not competitively consolidatable.",
    };

  return { assetScopeOverlap, vendorIndependence, geographyProof, operatingModel };
}

// Raw machine flag codes are suppressed from the caveat pills — the human
// `contestability_note` (always set alongside them) carries the readable sentence.
const EMPTY_CAVEATS = new Set(["nan", "none", "", "needs-part-master", "needs-subclassification"]);

// ---------------------------------------------------------------------------
// row shapes (snake_case, as they come back from pg)
// ---------------------------------------------------------------------------

interface OpportunityRow {
  id: string;
  /** Stable natural key (hash of l3 × country) — survives engine re-runs, unlike
   *  the run-scoped `id`. The write-back (opp.opportunity_action) keys on this. */
  opportunity_key: string;
  title: string;
  l2_code: string | null;
  l3_code: string | null;
  business_unit: string | null;
  purchasing_country: string | null;
  primary_lever: string | null;
  play_route: string | null;
  status: string | null;
  addressable_value: number | null;
  movable_value: number | null;
  recommended_lead_vendor_id: string | null;
  score: number | null;
  provability_flag: string | null;
  contestability_note: string | null;
  data_quality_flag: string | null;
  created_at: string | null;
}

interface RecommendationRow {
  id: string;
  opportunity_id: string;
  prize: number | null;
  feasibility: number | null;
  provability: number | null;
  score: number | null;
  savings_lo: number | null;
  savings_hi: number | null;
  rationale: string | null;
  confidence_pct: number | null;
}

interface EvidenceFactorRow {
  recommendation_id: string;
  factor_name: string;
  observed_value: number | null;
  impact_text: string | null;
  impact_positive: boolean | null;
  sort_order: number | string | null;
}

interface OppVendorRow {
  opportunity_id: string;
  vendor_id: string;
  vendor_name: string | null;
  spend: number | null;
  share: number | null;
  tier: string | null;
  capability_class: string | null;
  is_oem: boolean | null;
  is_winner: boolean | null;
  supplier_status: string | null;
}

interface TriggerRow {
  opportunity_id: string;
  label: string | null;
  detail: string | null;
  sort_order: number | string | null;
}

/** The mutable user / play-state layer (opp.opportunity_action) — merged over
 *  the engine defaults so user decisions survive engine reloads. */
interface ActionRow {
  opportunity_id: string;
  status: string | null;
  approach: string | null;
  done_tasks: string[] | null;
  custom_tasks: string[] | null;
  draft_versions: DraftVersion[] | null;
  notes: string | null;
  park_trigger: string | null;
  reject_reason: string | null;
  committed_at: string | null;
  committed_timing: string | null;
  committed_basis: string | null;
  committed_low: number | null;
  committed_high: number | null;
}

// ---------------------------------------------------------------------------
// getOpportunities
// ---------------------------------------------------------------------------

export async function getOpportunities(): Promise<Opportunity[]> {
  const [opps, buSplit, recs, evidence, oppVendors, triggers, actions] = await Promise.all([
    q<OpportunityRow>(
      `SELECT id, opportunity_key, title, l2_code, l3_code, business_unit, purchasing_country, primary_lever,
              play_route, status, addressable_value, movable_value,
              recommended_lead_vendor_id, score, provability_flag, contestability_note,
              data_quality_flag, created_at
         FROM opp.opportunity
        WHERE l1_code = $1`,
      [MRO_L1],
    ),
    // Per-vendor spend split by business unit within each pocket (l3 × country),
    // for the roster's AT/AOH breakdown — the cross-BU consolidation view.
    q<{
      l3_code: string | null;
      purchasing_country: string | null;
      vendor_id: string;
      business_unit: string | null;
      spend: number | null;
    }>(
      `SELECT l3_code, purchasing_country, vendor_id, business_unit,
              sum(net_spend_usd) AS spend
         FROM opp.fact_spend
        WHERE l1_code = $1
        GROUP BY 1, 2, 3, 4`,
      [MRO_L1],
    ),
    q<RecommendationRow>(
      `SELECT id, opportunity_id, prize, feasibility, provability, score,
              savings_lo, savings_hi, rationale, confidence_pct
         FROM opp.opportunity_recommendation`,
    ),
    q<EvidenceFactorRow>(
      `SELECT recommendation_id, factor_name, observed_value, impact_text,
              impact_positive, sort_order
         FROM opp.opportunity_evidence_factor`,
    ),
    q<OppVendorRow>(
      `SELECT ov.opportunity_id, ov.vendor_id, ov.spend, ov.share, ov.tier,
              ov.capability_class, ov.is_oem, ov.is_winner, ov.supplier_status,
              v.normalized_name AS vendor_name
         FROM opp.opportunity_vendor ov
         LEFT JOIN cim.vendor v ON v.vendor_id = ov.vendor_id`,
    ),
    q<TriggerRow>(
      `SELECT opportunity_id, label, detail, sort_order
         FROM opp.opportunity_trigger`,
    ),
    q<ActionRow>(
      `SELECT opportunity_id, status, approach, done_tasks, custom_tasks, draft_versions,
              notes, park_trigger, reject_reason, committed_at, committed_timing,
              committed_basis, committed_low, committed_high
         FROM opp.opportunity_action`,
    ),
  ]);

  // Index the child rows by their foreign key for in-JS assembly.
  const recByOpp = new Map<string, RecommendationRow>();
  for (const r of recs) recByOpp.set(r.opportunity_id, r);

  const evidenceByRec = new Map<string, EvidenceFactorRow[]>();
  for (const e of evidence) {
    const list = evidenceByRec.get(e.recommendation_id) ?? [];
    list.push(e);
    evidenceByRec.set(e.recommendation_id, list);
  }

  const vendorsByOpp = new Map<string, OppVendorRow[]>();
  for (const v of oppVendors) {
    const list = vendorsByOpp.get(v.opportunity_id) ?? [];
    list.push(v);
    vendorsByOpp.set(v.opportunity_id, list);
  }

  const triggerByOpp = new Map<string, TriggerRow>();
  for (const t of triggers) {
    // Keep the lowest sort_order trigger as the representative one.
    const existing = triggerByOpp.get(t.opportunity_id);
    if (!existing || Number(t.sort_order) < Number(existing.sort_order)) {
      triggerByOpp.set(t.opportunity_id, t);
    }
  }

  // User / play-state layer (persisted decisions), merged over engine defaults.
  // Keyed by the STABLE opportunity_key (stored in the action row's opportunity_id
  // column) so decisions survive engine re-runs, which change the run-scoped id.
  const actionByOpp = new Map<string, ActionRow>();
  for (const a of actions) actionByOpp.set(a.opportunity_id, a);

  // Per-vendor AT/AOH spend within a pocket (l3 × country), keyed for the roster.
  const buByPocketVendor = new Map<string, { at: number; aoh: number }>();
  for (const r of buSplit) {
    const key = `${r.l3_code ?? ""}|${r.purchasing_country ?? ""}|${r.vendor_id}`;
    const e = buByPocketVendor.get(key) ?? { at: 0, aoh: 0 };
    const s = Number(r.spend) || 0;
    if (r.business_unit === "AT") e.at += s;
    else if (r.business_unit === "OH") e.aoh += s;
    buByPocketVendor.set(key, e);
  }

  // Category-level services share (the real driver of provability → confidence), joined by l2_code.
  const scanRows = await q<{ l2_code: string; services_share: number | null }>(
    `SELECT l2_code, services_share FROM opp.scan_ranking`,
  );
  const svcByL2 = new Map<string, number>();
  for (const s of scanRows) if (s.services_share != null) svcByL2.set(s.l2_code, Number(s.services_share));

  // The FE `Opportunity` type has no `movableValue` field, but the engine
  // surfaces it and the API consumers want it, so we carry it as an extra
  // property on the returned JSON. `engineId` carries the stable engine
  // surrogate key (the hash) so write-back / Shibumi can resolve the real row,
  // while `id` becomes a human-friendly "OPP-001" assigned by movable rank.
  type OpportunityWithMovable = Opportunity & {
    movableValue: number;
    pocketSpend: number;
    engineId: string;
    /** Stable natural key — the write-back persists against this (survives re-runs). */
    opportunityKey: string;
  };

  const mapped: OpportunityWithMovable[] = opps.map((opp) => {
    const rec = recByOpp.get(opp.id);
    const factors = rec ? evidenceByRec.get(rec.id) ?? [] : [];
    const vendors = vendorsByOpp.get(opp.id) ?? [];
    const trigger = triggerByOpp.get(opp.id);
    const action = actionByOpp.get(opp.opportunity_key);

    const addressableSpend = Number(opp.addressable_value) || 0;
    // Committed figures (persisted at commit) override the engine baseline so a
    // committed play tracks the number the operator committed to.
    const savingsLow =
      action?.committed_low != null ? Number(action.committed_low) : Number(rec?.savings_lo) || 0;
    const savingsHigh =
      action?.committed_high != null ? Number(action.committed_high) : Number(rec?.savings_hi) || 0;

    // Committed opps carry a projected ramp so Value Realization's chart renders
    // after a reload (the store generates the same on commit). Realized stays
    // undefined — SAP actuals populate it later. Mirrors the store's commit().
    const isCommittedStage = ["committed", "in-execution", "realized"].includes(
      action?.status ?? "",
    );
    const rampMid = Math.round((savingsLow + savingsHigh) / 2);
    // Quarterly ramp from the committed timing (falls back to the commit date) —
    // never before the play starts. Mirrors the store's commit().
    const ramp = isCommittedStage
      ? buildRamp(rampMid, action?.committed_timing, action?.committed_at ?? opp.created_at)
      : undefined;
    const fitFactor = Number(rec?.feasibility) || 0;
    const confidencePct = Math.round(Number(rec?.confidence_pct) || 0);

    // Fragmentation gap: vendors per $M of addressable, scaled down to the ×
    // metric the FE shows, clamped to a sane band.
    const vendorsPerM =
      addressableSpend > 0 ? vendors.length / (addressableSpend / 1e6) : 0;
    const fragmentationGap = clamp(Math.round(vendorsPerM / 3), 2, 20);

    const winner = vendors.find((v) => v.is_winner) ?? vendors[0];

    // Keep the vendor COUNT out of the action headline — it's the fragmentation
    // context (shown in the trigger + Vendors column + roster), not an RFP invite
    // list. The RFP shortlists credible bidders and consolidates to a lead + backup.
    const recommendedAction =
      opp.play_route === "consolidate"
        ? `Consolidate the fragmented supplier base onto the incumbent`
        : opp.play_route === "rfp"
          ? `Competitive RFP to consolidate the fragmented supplier base`
          : opp.play_route === "sub-classify"
            ? `Sub-classify into coherent sub-categories before sourcing — needs the part / spec master`
            : "Benchmark / should-cost review";

    const entity = sideEntityOf(opp.business_unit);

    // OEM / winner carve-outs — the negative-impact evidence factors. These are
    // the rows subtracted from the pocket to reach movable.
    const exclusions: OppExclusion[] = factors
      .filter((f) => f.impact_positive === false)
      .map((f) => ({
        label: f.factor_name.replace("−", "").trim(),
        amount: Math.abs(Number(f.observed_value) || 0),
        reason: f.impact_text ?? "",
      }));

    const movableValue = Number(opp.movable_value) || 0;

    // Pocket spend = the engine's "Pocket spend" evidence factor; fall back to
    // movable + the carve-outs (pocket − winner − OEM = movable, by construction).
    const pocketFactor = factors.find((f) => f.factor_name === "Pocket spend");
    const pocketSpend =
      Number(pocketFactor?.observed_value) ||
      movableValue + exclusions.reduce((sum, ex) => sum + ex.amount, 0);

    // OEM/sole-source share of the pocket — the real signal behind "brand independence".
    const oemAmount = exclusions
      .filter((ex) => ex.label.toLowerCase().includes("oem"))
      .reduce((sum, ex) => sum + ex.amount, 0);
    const oemShare = pocketSpend > 0 ? oemAmount / pocketSpend : 0;
    const functionalFit = deriveFunctionalFit({
      businessUnit: opp.business_unit,
      oemShare,
      country: opp.purchasing_country ?? "",
      playRoute: opp.play_route,
      l2: l2name(opp.l2_code),
      vendorCount: vendors.length,
    });

    const caveats = [
      opp.contestability_note,
      opp.provability_flag,
      opp.data_quality_flag,
    ].filter(
      (x): x is string =>
        !!x && !EMPTY_CAVEATS.has(String(x).toLowerCase()),
    );

    // Confidence explanation — its REAL driver is the product-vs-services mix (provability).
    // Prize and Feasibility are ranking inputs (they belong on the cockpit), so they're not shown
    // here — showing them under "confidence" was the misleading part.
    const svcShare = svcByL2.get(opp.l2_code ?? "");
    const svcPct = svcShare != null ? Math.round(svcShare * 100) : null;
    const confidenceLine =
      svcPct != null
        ? `Confidence reflects how provable the savings are — it tracks the product-vs-services mix. ` +
          `${svcPct}% of this category is services (harder to should-cost); the rest is product spend ` +
          `with clear line items. Services-heavy categories score lower.`
        : `Confidence reflects evidence strength — product spend with clear line items is more ` +
          `provable than services-heavy spend.`;

    const rationale = [rec?.rationale, trigger?.detail, confidenceLine].filter(
      (x): x is string => !!x,
    );

    // created_at is stored UTC; show the Eastern calendar date so a late-evening
    // ET run doesn't read as "tomorrow" (UTC). en-CA yields "YYYY-MM-DD" for fmtDate.
    const createdAt =
      (opp.created_at
        ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(
            new Date(opp.created_at),
          )
        : "") || "2026-06-29";

    return {
      id: opp.id, // reassigned to a friendly "OPP-NNN" after the movable sort below
      engineId: opp.id,
      opportunityKey: opp.opportunity_key,
      title: opp.title,
      // L3 commodity alone — the engine title is "{L3} · {country}"; the list
      // shows L3 as the opportunity name and L2 as its own Sub-category column.
      l3: (opp.title ?? "").split(" · ")[0].trim(),
      category: "MRO",
      l2: l2name(opp.l2_code),
      country: opp.purchasing_country ?? "",
      archetype:
        opp.play_route === "carve-out"
          ? "substitution"
          : opp.play_route === "sub-classify"
            ? "tail-rationalization"
            : "consolidation",
      // Real engine route — the Lever column renders this, matching the detail panel.
      playRoute: opp.play_route ?? "",
      vendorCount: vendors.length,
      // Friendly BU label for the filter facet: OH → AOH, both → Both.
      businessUnit:
        opp.business_unit === "OH"
          ? "AOH"
          : opp.business_unit === "both"
            ? "Both"
            : (opp.business_unit ?? ""),
      addressableSpend,
      // movable_value is contestable spend after the OEM / winner carve-outs;
      // pocketSpend is the L3×country pocket before them — both come straight
      // from the engine so the savings waterfall renders the real derivation.
      pocketSpend,
      savingsLow,
      savingsHigh,
      fragmentationGap,
      fitFactor,
      confidencePct,
      evidenceBasis: "evidence",
      // Status + decision facts come from the persisted user layer (opp.opportunity_action);
      // engine default is "surfaced".
      status: (action?.status ?? "surfaced") as Opportunity["status"],
      approach: action?.approach ?? undefined,
      doneTasks: Array.isArray(action?.done_tasks) ? action.done_tasks : undefined,
      customTasks: Array.isArray(action?.custom_tasks) ? action.custom_tasks : undefined,
      draftVersions: Array.isArray(action?.draft_versions) ? action.draft_versions : undefined,
      parkTrigger: action?.park_trigger ?? undefined,
      rejectReason: action?.reject_reason ?? undefined,
      committedAt: action?.committed_at ?? undefined,
      committedTiming: action?.committed_timing ?? undefined,
      committedBasis: action?.committed_basis ?? undefined,
      ramp,
      mercerSummary: rec?.rationale ?? "",
      rationale,
      recommendedAction,
      fragmentedSide: {
        entity,
        vendorCount: vendors.length,
        topShare: Math.round((Number(winner?.share) || 0) * 100),
        spend: pocketSpend,
      },
      consolidatedSide: {
        entity,
        vendorCount: 1,
        topShare: 100,
        spend: Number(winner?.spend) || 0,
        anchorVendorId: winner?.vendor_id,
      },
      vendorIds: vendors.map((v) => v.vendor_id),
      // Real per-vendor roster (name + share + spend) for the Act draft's supplier
      // table — sorted by share, names joined from cim.vendor.
      vendorRoster: [...vendors]
        .sort((a, b) => (Number(b.share) || 0) - (Number(a.share) || 0))
        .map((v) => {
          const bu = buByPocketVendor.get(
            `${opp.l3_code ?? ""}|${opp.purchasing_country ?? ""}|${v.vendor_id}`,
          );
          return {
            name: v.vendor_name ?? v.vendor_id,
            share: Number(v.share) || 0,
            spend: Number(v.spend) || 0,
            isWinner: Boolean(v.is_winner),
            isOem: Boolean(v.is_oem),
            capabilityClass: v.capability_class ?? null,
            at: bu?.at ?? 0,
            aoh: bu?.aoh ?? 0,
          };
        }),
      exclusions,
      caveats,
      functionalFit,
      events: [
        {
          kind: "surfaced",
          actor: "Mercer",
          at: createdAt,
          note: trigger?.detail || "Surfaced by the scan engine",
        },
      ],
      movableValue,
    };
  });

  // Sort by movable_value desc, then assign human-friendly OPP-NNN ids
  // (OPP-001 = largest movable). The stable engine key lives on `engineId`.
  mapped.sort((a, b) => b.movableValue - a.movableValue);
  mapped.forEach((o, i) => {
    o.id = `OPP-${String(i + 1).padStart(3, "0")}`;
  });

  return mapped;
}

// ---------------------------------------------------------------------------
// getVendors
// ---------------------------------------------------------------------------

interface VendorRow {
  vendor_id: string;
  l2_code: string | null;
  mro_spend: number | null;
  vendor_name: string | null;
  business_unit_scope: string | null;
  total_spend: number | null;
  capability_class: string | null;
  supplier_status: string | null;
  is_oem: boolean | null;
  oem_brand: string | null;
  oem_evidence: string | null;
  citation_url: string | null;
  oem_source: string | null;
  oem_conf: number | null;
  po_count: number | string | null;
  actual_spend: number | null;
  lead: number | null;
}

export async function getVendors(): Promise<Vendor[]> {
  const rows = await q<VendorRow>(
    `WITH agg AS (
        SELECT vendor_id, l2_code, sum(net_spend_usd) AS s
          FROM opp.fact_spend
         WHERE l1_code = 'L1|MRO'
         GROUP BY vendor_id, l2_code
      ),
      dom AS (
        SELECT DISTINCT ON (vendor_id)
               vendor_id,
               l2_code,
               sum(s) OVER (PARTITION BY vendor_id) AS mro_spend
          FROM agg
         ORDER BY vendor_id, s DESC
      ),
      perf AS (
        SELECT vendor_id,
               sum(po_count) AS po_count,
               sum(spend_usd) AS spend_usd,
               avg(avg_lead_time_days) AS lead
          FROM opp.vendor_performance
         GROUP BY vendor_id
      )
      SELECT d.vendor_id, d.l2_code, d.mro_spend,
             v.vendor_name, v.business_unit_scope, v.total_spend,
             v.capability_class, v.supplier_status,
             c.is_oem, c.oem_brand, c.evidence AS oem_evidence,
             c.citation_url, c.source AS oem_source, c.confidence AS oem_conf,
             p.po_count, p.spend_usd AS actual_spend, p.lead
        FROM dom d
        JOIN cim.vendor v ON v.vendor_id = d.vendor_id
        LEFT JOIN opp.vendor_classification c ON c.vendor_id = d.vendor_id
        LEFT JOIN perf p ON p.vendor_id = d.vendor_id
       ORDER BY d.mro_spend DESC`,
  );

  // Real role across the plays + the opportunities each vendor appears in
  // (opp.opportunity_vendor → opportunity). Replaces the fabricated status.
  const roleRows = await q<{
    vendor_id: string;
    is_winner: boolean | null;
    is_oem: boolean | null;
    tier: string | null;
    opp_id: string;
    title: string | null;
    movable: number | null;
  }>(
    `SELECT ov.vendor_id, ov.is_winner, ov.is_oem, ov.tier, o.id AS opp_id, o.title, o.movable_value AS movable
       FROM opp.opportunity_vendor ov
       JOIN opp.opportunity o ON o.id = ov.opportunity_id`,
  );
  type RoleAgg = { winner: boolean; oem: boolean; tiers: Set<string>; opps: VendorOppRef[] };
  const roleByVendor = new Map<string, RoleAgg>();
  for (const r of roleRows) {
    const agg = roleByVendor.get(r.vendor_id) ?? { winner: false, oem: false, tiers: new Set(), opps: [] };
    agg.winner = agg.winner || r.is_winner === true;
    agg.oem = agg.oem || r.is_oem === true;
    if (r.tier) agg.tiers.add(r.tier);
    if (!agg.opps.some((o) => o.id === r.opp_id))
      agg.opps.push({
        id: r.opp_id,
        title: r.title ?? "",
        isWinner: r.is_winner === true,
        isOem: r.is_oem === true,
        addressable: Number(r.movable) || 0,
      });
    roleByVendor.set(r.vendor_id, agg);
  }
  const deriveRole = (agg: RoleAgg | undefined): VendorRole => {
    if (!agg) return "none";
    if (agg.winner) return "winner";
    if (agg.oem) return "oem";
    if (agg.tiers.has("Keep — strategic/broad")) return "strategic";
    if (agg.tiers.has("Leverage — negotiate")) return "leverage";
    if (agg.tiers.has("Consolidate — fold to winner")) return "consolidate";
    if (agg.tiers.has("Exit — tail/maverick")) return "tail";
    return "none";
  };

  return rows.map((row) => {
    const isOem = row.is_oem === true;
    const source = row.oem_source;
    const lead = row.lead;

    // Vendor "Type" is derived from the engine's real `capability_class`, NOT
    // guessed from is_oem. "specialist" maps to manufacturer (a niche-line
    // maker, not a distributor); null / unknown leaves the type undefined so
    // the roster renders "—" rather than a fabricated label.
    const cap = (row.capability_class ?? "").toLowerCase();
    const vendorType: VendorType | undefined =
      cap === "oem"
        ? "manufacturer"
        : cap === "broad-line"
          ? "distributor"
          : cap === "specialist"
            ? "manufacturer"
            : undefined;

    // Data-confidence composite — NOT a vendor merit/performance score. It measures
    // how complete and well-evidenced OUR data on the vendor is (classification
    // provenance, operational data, transaction history). Being an OEM is shown as a
    // note, not rewarded with points — that would conflate "is OEM" with "good vendor".
    const poCount = Number(row.po_count) || 0;
    // The classification score is driven by PROVENANCE (how we sourced it), so the
    // note pairs the finding with that provenance — they always agree.
    const finding = isOem
      ? `OEM${row.oem_brand ? ` · ${row.oem_brand}` : ""}`
      : row.capability_class
        ? String(row.capability_class)
        : "Unclassified";
    const provenance =
      source === "web" ? "web evidence" : source === "knowledge" ? "model knowledge" : "heuristic only";
    const scoreBreakdown: ScoreCriterion[] = [
      {
        key: "classification",
        label: "Classification evidence",
        weight: 0.4,
        score: source === "web" ? 90 : source === "knowledge" ? 65 : 40,
        note: `${finding} · ${provenance}`,
      },
      {
        key: "operational",
        label: "Operational data",
        weight: 0.3,
        score: lead != null ? 80 : 45,
        note: lead != null ? "Lead-time on file" : "No lead-time data yet",
      },
      {
        key: "transaction",
        label: "Transaction history",
        weight: 0.3,
        score: poCount > 0 ? 85 : 55,
        note: poCount > 0 ? "PO-level actuals captured" : "Cube spend only",
      },
    ];

    const score = Math.round(
      scoreBreakdown.reduce((sum, c) => sum + c.weight * c.score, 0),
    );

    const dataReliability =
      source === "web" ? "high" : source === "knowledge" ? "medium" : "low";

    return {
      id: row.vendor_id,
      name: row.vendor_name ?? row.vendor_id,
      entity: entityOf(row.business_unit_scope),
      category: "MRO",
      subcategory: l2name(row.l2_code),
      country: "US",
      region: "Americas",
      annualSpend: Math.round(Number(row.mro_spend) || 0),
      type: vendorType,
      paymentTermsDays: null,
      leadTimeDays: lead != null ? Math.round(Number(lead)) : null,
      leadTimeTrend: "stable",
      overlap: row.business_unit_scope === "both",
      dataReliability,
      score,
      scoreBreakdown,
      status: "active",
      role: deriveRole(roleByVendor.get(row.vendor_id)),
      opportunities: roleByVendor.get(row.vendor_id)?.opps ?? [],
      performance: buildPerformance(row.vendor_id, lead != null ? Math.round(Number(lead)) : null, poCount),
      contractExpiry: null,
      notes: row.oem_evidence || undefined,
      events: [],
    } satisfies Vendor;
  });
}

// ---------------------------------------------------------------------------
// getCockpit
// ---------------------------------------------------------------------------

export interface CockpitKpis {
  mroNetSpend: number;
  totalMovable: number;
  openOpportunities: number;
  identifiedValueMid: number;
  vendorCount: number;
}

export interface CockpitSavingsRow {
  subCategory: string;
  score: number;
  rank: number;
  addressable: number;
  savingsLow: number;
  savingsHigh: number;
}

export interface CockpitTermsRow {
  category: string;
  wcValue: number;
}

export interface Cockpit {
  kpis: CockpitKpis;
  savingsByCategory: CockpitSavingsRow[];
  termsGap: CockpitTermsRow[];
}

export async function getCockpit(): Promise<Cockpit> {
  const [kpiRows, scanRows, termsRows] = await Promise.all([
    q<{
      mro_net_spend: number | null;
      total_movable: number | null;
      open_opportunities: number | string | null;
      identified_value_mid: number | null;
      vendor_count: number | string | null;
    }>(
      `SELECT
         (SELECT sum(net_spend_usd) FROM opp.fact_spend WHERE l1_code = 'L1|MRO') AS mro_net_spend,
         (SELECT sum(movable_value) FROM opp.opportunity WHERE l1_code = 'L1|MRO') AS total_movable,
         (SELECT count(*) FROM opp.opportunity WHERE l1_code = 'L1|MRO') AS open_opportunities,
         (SELECT sum((r.savings_lo + r.savings_hi) / 2)
            FROM opp.opportunity_recommendation r
            JOIN opp.opportunity o ON o.id = r.opportunity_id
           WHERE o.l1_code = 'L1|MRO') AS identified_value_mid,
         (SELECT count(DISTINCT vendor_id) FROM opp.fact_spend WHERE l1_code = 'L1|MRO') AS vendor_count`,
    ),
    q<{
      sub_category: string;
      score: number | null;
      rank: number | string | null;
      addressable: number | null;
      savings_lo: number | null;
      savings_hi: number | null;
    }>(
      `SELECT sub_category, score, rank, addressable, savings_lo, savings_hi
         FROM opp.scan_ranking
        ORDER BY rank ASC`,
    ),
    q<{ series_id: string; value: number | null }>(
      `SELECT series_id, value
         FROM opp.benchmark
        WHERE provider = 'internal-payment-terms'
        ORDER BY value DESC`,
    ),
  ]);

  const k = kpiRows[0] ?? {};

  return {
    kpis: {
      mroNetSpend: Number(k.mro_net_spend) || 0,
      totalMovable: Number(k.total_movable) || 0,
      openOpportunities: Number(k.open_opportunities) || 0,
      identifiedValueMid: Number(k.identified_value_mid) || 0,
      vendorCount: Number(k.vendor_count) || 0,
    },
    savingsByCategory: scanRows.map((s) => ({
      subCategory: s.sub_category,
      score: Number(s.score) || 0,
      rank: Number(s.rank) || 0,
      addressable: Number(s.addressable) || 0,
      savingsLow: Number(s.savings_lo) || 0,
      savingsHigh: Number(s.savings_hi) || 0,
    })),
    termsGap: termsRows.map((t) => ({
      category: t.series_id.replace("payment_terms_wc:", ""),
      wcValue: Number(t.value) || 0,
    })),
  };
}

// ---------------------------------------------------------------------------
// applyOpportunityAction — write the user / play-state layer (opp.opportunity_action)
// ---------------------------------------------------------------------------

/** Columns the FE is allowed to write (whitelist — safe to interpolate). */
const ACTION_COLUMNS = [
  "status",
  "approach",
  "done_tasks",
  "custom_tasks",
  "draft_versions",
  "notes",
  "park_trigger",
  "reject_reason",
  "committed_at",
  "committed_timing",
  "committed_basis",
  "committed_low",
  "committed_high",
] as const;

const JSONB_COLUMNS = new Set(["done_tasks", "custom_tasks", "draft_versions"]);

type ActionPatch = Partial<Record<(typeof ACTION_COLUMNS)[number], unknown>>;

/** Upsert a user action onto an opportunity. Only whitelisted columns are set;
 *  `done_tasks`/`custom_tasks`/`draft_versions` are written as jsonb. Survives
 *  engine reloads. */
export async function applyOpportunityAction(id: string, patch: ActionPatch): Promise<void> {
  const cols = ACTION_COLUMNS.filter((c) => c in patch);
  const values: unknown[] = [id];
  const valSql: string[] = [];
  cols.forEach((c, i) => {
    const ph = `$${i + 2}`;
    if (JSONB_COLUMNS.has(c)) {
      valSql.push(`${ph}::jsonb`);
      values.push(JSON.stringify(patch[c] ?? []));
    } else {
      valSql.push(ph);
      values.push(patch[c] ?? null);
    }
  });
  const insertCols = ["opportunity_id", ...cols, "updated_at"];
  const placeholders = ["$1", ...valSql, "now()"];
  const updates = [...cols.map((c) => `${c} = EXCLUDED.${c}`), "updated_at = now()"].join(", ");
  const sql = `INSERT INTO opp.opportunity_action (${insertCols.join(", ")})
               VALUES (${placeholders.join(", ")})
               ON CONFLICT (opportunity_id) DO UPDATE SET ${updates}`;
  await q(sql, values);
}

// ---------------------------------------------------------------------------
// getCategoryFootprint — the indirect L1 expansion map (ref.category_footprint)
// ---------------------------------------------------------------------------

export interface FootprintCategory {
  name: string;
  spend: number;
  vendors: number;
  lineCount: number;
  scanned: boolean;
  rank: number;
}

export interface CategoryFootprint {
  categories: FootprintCategory[];
  totalSpend: number;
  scannedSpend: number;
  scannedCount: number;
  totalCount: number;
}

/** Real indirect L1 categories from the cube (`Consol 1`), with the one scanned
 *  L1 (MRO) flagged. Powers the L1 selector's expansion list + the brief's
 *  footprint line — real figures, not hardcoded. */
export async function getCategoryFootprint(): Promise<CategoryFootprint> {
  const rows = await q<{
    l1_name: string;
    net_spend: number | null;
    vendors: number | string | null;
    line_count: number | string | null;
    is_scanned: boolean | null;
    rank: number | string | null;
  }>(
    `SELECT l1_name, net_spend, vendors, line_count, is_scanned, rank
       FROM ref.category_footprint
      ORDER BY rank ASC`,
  );
  const categories: FootprintCategory[] = rows.map((r) => ({
    name: r.l1_name,
    spend: Number(r.net_spend) || 0,
    vendors: Number(r.vendors) || 0,
    lineCount: Number(r.line_count) || 0,
    scanned: Boolean(r.is_scanned),
    rank: Number(r.rank) || 0,
  }));
  return {
    categories,
    totalSpend: categories.reduce((s, c) => s + c.spend, 0),
    scannedSpend: categories.filter((c) => c.scanned).reduce((s, c) => s + c.spend, 0),
    scannedCount: categories.filter((c) => c.scanned).length,
    totalCount: categories.length,
  };
}

// ---------------------------------------------------------------------------
// getGeography — region/country footprint (opp.fact_spend)
// ---------------------------------------------------------------------------

export interface GeographyCountry {
  name: string;
  spend: number;
}

export interface GeographyRegion {
  name: string;
  spend: number;
  countries: GeographyCountry[];
}

/** Real region -> country spend hierarchy from the line-item fact table
 *  (`Cleaned Purchasing Region` / `Cleaned Purchasing Country` on the cube).
 *  Opportunities only carry `purchasing_country` (region isn't part of the
 *  pocket grain — see engine/core/opportunities/generate.py), so "region" as
 *  a scope level is a UI grouping over its member countries, not a native
 *  opportunity field: filtering by region means "country in this list."
 *  Plant/location is intentionally absent — `location_id` is NULL engine-wide
 *  until the SAP location-master feed lands (same designed-for gap as
 *  vendor_performance's on_time_pct/fill_rate_pct). */
export async function getGeography(): Promise<GeographyRegion[]> {
  const rows = await q<{ region: string | null; country: string | null; spend: number | null }>(
    `SELECT region, purchasing_country AS country, sum(net_spend_usd) AS spend
       FROM opp.fact_spend
      WHERE l1_code = 'L1|MRO'
      GROUP BY region, purchasing_country`,
  );
  const byRegion = new Map<string, GeographyRegion>();
  for (const r of rows) {
    const regionName = r.region?.trim() || "Unspecified";
    const countryName = r.country?.trim() || "Unspecified";
    const spend = Number(r.spend) || 0;
    if (!byRegion.has(regionName)) byRegion.set(regionName, { name: regionName, spend: 0, countries: [] });
    const region = byRegion.get(regionName)!;
    region.spend += spend;
    const existing = region.countries.find((c) => c.name === countryName);
    if (existing) existing.spend += spend;
    else region.countries.push({ name: countryName, spend });
  }
  return [...byRegion.values()]
    .sort((a, b) => b.spend - a.spend)
    .map((r) => ({ ...r, countries: r.countries.sort((a, b) => b.spend - a.spend) }));
}

// ---------------------------------------------------------------------------
// getEngineParameters — the engine's decision knobs (opp.engine_parameter)
// ---------------------------------------------------------------------------

export type ParamValue = number | string | Array<number | string> | null;

export interface EngineParameter {
  key: string;
  label: string;
  value: ParamValue;
  unit: string | null;
  description: string | null;
  /** True once an admin has changed the value from its seeded default. */
  edited: boolean;
}

export interface ParameterGroup {
  category: string;
  params: EngineParameter[];
}

export interface EngineParameters {
  groups: ParameterGroup[];
  methodologyVersion: string | null;
  count: number;
}

/** Every threshold the engine uses, straight from `opp.engine_parameter` — nothing
 *  is hardcoded in the engine. Grouped by methodology section (Feature Spec Appendix
 *  A) and ordered A.3 → A.9. Read-only registry for the Admin › Methodology page. */
export async function getEngineParameters(): Promise<EngineParameters> {
  const rows = await q<{
    param_key: string;
    methodology_version: string | null;
    value_numeric: number | null;
    value_json: string | null;
    unit: string | null;
    category: string | null;
    display_label: string | null;
    description: string | null;
    change_note: string | null;
  }>(
    `SELECT param_key, methodology_version, value_numeric, value_json, unit,
            category, display_label, description, change_note
       FROM opp.engine_parameter
      ORDER BY category ASC, param_key ASC`,
  );

  const parseJson = (raw: string | null): ParamValue => {
    if (raw == null) return null;
    try {
      return JSON.parse(raw) as ParamValue;
    } catch {
      return raw;
    }
  };

  const groups: ParameterGroup[] = [];
  let methodologyVersion: string | null = null;
  for (const r of rows) {
    if (!methodologyVersion && r.methodology_version) methodologyVersion = r.methodology_version;
    const category = r.category ?? "Other";
    const value: ParamValue =
      r.value_numeric != null ? Number(r.value_numeric) : parseJson(r.value_json);
    const param: EngineParameter = {
      key: r.param_key,
      label: r.display_label ?? r.param_key,
      value,
      unit: r.unit,
      description: r.description,
      edited: (r.change_note ?? "seed") !== "seed",
    };
    let group = groups.find((g) => g.category === category);
    if (!group) {
      group = { category, params: [] };
      groups.push(group);
    }
    group.params.push(param);
  }

  // Methodology reading order — sort groups by their Appendix reference (A.3 … A.9).
  const apxOrder = (c: string) => {
    const m = c.match(/A\.(\d+)/);
    return m ? Number(m[1]) : 99;
  };
  groups.sort((a, b) => apxOrder(a.category) - apxOrder(b.category));

  return { groups, methodologyVersion, count: rows.length };
}

export interface ParameterEdit {
  key: string;
  /** Set for single-value dials (rate/share/usd/count/…); null for range params. */
  valueNumeric: number | null;
  /** JSON text for range params (e.g. "[0.05,0.09]"); null for single-value dials. */
  valueJson: string | null;
  note?: string;
}

/** Persist an admin edit to a parameter's value in `opp.engine_parameter` (the served
 *  parameter store). Stamps the audit columns; `change_note != 'seed'` marks it edited.
 *  Save-only by design — the engine applies changed parameters on its next run. */
export async function updateEngineParameter(edit: ParameterEdit): Promise<void> {
  await q(
    `UPDATE opp.engine_parameter
        SET value_numeric = $2,
            value_json     = $3,
            last_changed_by = $4,
            last_changed_at = now()::text,
            change_note    = $5
      WHERE param_key = $1`,
    [edit.key, edit.valueNumeric, edit.valueJson, "admin (Lens console)", edit.note ?? "admin edit"],
  );
}

// ---------------------------------------------------------------------------
// getPlaybooks — execution-approach templates (ref.playbook)
// ---------------------------------------------------------------------------

export interface Playbook {
  id: string;
  label: string;
  sub: string;
  tasks: string[];
  recommendedRoutes: string[];
}

/** Curated approach templates the Act module renders, keyed by lever. Server-side
 *  (admin-adjustable per client) rather than hardcoded in the FE. */
export async function getPlaybooks(): Promise<Playbook[]> {
  const rows = await q<{
    playbook_id: string;
    label: string;
    sub: string;
    tasks: string | null;
    recommended_routes: string | null;
  }>(
    `SELECT playbook_id, label, sub, tasks, recommended_routes
       FROM ref.playbook
      ORDER BY sort_order ASC`,
  );
  const parse = (s: string | null): string[] => {
    if (!s) return [];
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  return rows.map((r) => ({
    id: r.playbook_id,
    label: r.label,
    sub: r.sub,
    tasks: parse(r.tasks),
    recommendedRoutes: parse(r.recommended_routes),
  }));
}

// ---------------------------------------------------------------------------
// getCopilotAnswers
// ---------------------------------------------------------------------------

// TODO: There is no copilot table in the CDM. The copilot endpoint is a
// separate Python service that will be wired in later; return {} for now.
export async function getCopilotAnswers(): Promise<Record<string, unknown>> {
  return {};
}
