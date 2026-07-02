import type { RampPoint } from "@/lib/ramp";

export type OpportunityStatus =
  | "surfaced"
  | "qualifying"
  | "qualified" // feed
  | "accepted" // in Act — accepted, running the play
  | "parked" // parked — awaiting a revisit trigger
  | "committed"
  | "in-execution"
  | "realized" // tracking
  | "rejected"; // casualties

export type Archetype =
  | "consolidation" // compete incumbent platforms
  | "operating-model" // e.g. self-managed → managed service
  | "payment-terms" // terms harmonization
  | "substitution" // HHI-directed absorb (one side absorbs other)
  | "tail-rationalization"; // integrated supply / tail elimination

export type EvidenceBasis = "benchmark" | "evidence" | "mixed";

export interface SideProfile {
  entity: "AT" | "AOH";
  vendorCount: number;
  topShare: number; // top-5 share, 0–100
  spend: number;
}

export interface OppEvent {
  kind:
    | "surfaced"
    | "qualified"
    | "committed"
    | "rejected"
    | "parked"
    | "stage-advanced"
    | "drift-flagged"
    | "drift-cleared"
    | "note";
  actor: "Mercer" | "Maria Vance";
  at: string; // ISO date
  note?: string;
}

export interface MilestoneEvent {
  type: string;
  date: string;
  severity: "info" | "warning" | "critical";
  note?: string;
  resolved?: boolean;
}

export interface Milestone {
  id: string;
  label: string;
  status: "completed" | "active" | "pending";
  date?: string;
  events: MilestoneEvent[];
}

export interface OppExclusion {
  label: string;
  amount: number;
  reason: string;
}

export interface OppDrift {
  flagged: boolean;
  note: string;
  mercerAction?: string;
}

export type FitVerdict = "pass" | "watch" | "info";

export interface FitDimension {
  label: string;
  detail: string;
  verdict: FitVerdict;
}

/**
 * Qualitative go/no-go proof that a consolidation / operating-model play is
 * actually executable — the human-readable counterpart to the confidence
 * math. Authored per opportunity where the nuance matters; a generic version
 * is derived from the opportunity's own fields when this is absent.
 */
export interface FunctionalFitCheck {
  assetScopeOverlap: FitDimension;
  vendorIndependence: FitDimension;
  geographyProof: FitDimension;
  operatingModel: FitDimension;
}

/**
 * Human context layered on top of Mercer's sweep — supplier knowledge, market
 * intel and figure overrides captured in the "Your Input" card. Overrides flow
 * through `resolveSavings()` into the savings waterfall and the committed
 * figures, so a committed number traces back to the operator's input.
 */
export interface OppUserInput {
  context?: string; // supplier relationships, contract knowledge, category insight
  marketIntel?: string; // quotes, supplier conversations, benchmark data, contract terms
  vendorNotes?: string; // anchor-vendor-specific notes
  overrideAddressable?: number | null; // addressable $ override
  overrideSavingsPct?: number | null; // conservative applied savings rate, %
  savedAt?: string; // ISO date of last save
}

export interface Opportunity {
  id: string; // "OPP-001"
  /** Stable engine surrogate key (hash) — used to resolve the row for the copilot. */
  engineId?: string;
  /** Stable NATURAL key (hash of l3 × country) — the write-back persists against this so
   *  decisions survive engine re-runs (which change the run-scoped engineId). */
  opportunityKey?: string;
  title: string;
  category: string;
  /** L3 commodity name — the opportunity's own level, split from the engine title. */
  l3?: string;
  l2: string;
  country: string;
  archetype: Archetype;
  /** Engine play_route — consolidate | rfp | carve-out. Drives the Lever column. */
  playRoute?: string;
  /** Vendors in the pocket (real engine count). */
  vendorCount?: number;
  /** Business unit — AT | AOH | Both (mapped from engine business_unit). */
  businessUnit?: string;
  addressableSpend: number;
  /** Engine movable_value — contestable spend after OEM / winner carve-outs. */
  movableValue?: number;
  /** Engine "Pocket spend" evidence factor — the L3×country pocket before carve-outs. */
  pocketSpend?: number;
  savingsLow: number;
  savingsHigh: number;
  fragmentationGap: number; // ×
  fitFactor: number; // 0–1
  confidencePct: number; // fit × min(gap,20)/20 × 100
  evidenceBasis: EvidenceBasis;
  status: OpportunityStatus;
  mercerSummary: string; // dense narrative w/ mid-dot separators
  rationale: string[];
  recommendedAction: string; // "Consolidate 18 vendors onto Fuchs · RFQ by Jul 10"
  fragmentedSide: SideProfile;
  consolidatedSide: SideProfile & { anchorVendorId?: string };
  vendorIds: string[]; // roster refs into vendors.ts
  /** Real per-vendor roster (name/share/spend, from opp.opportunity_vendor) — the
   *  detail panel's supplier table + the Act draft. `share` is share of the pocket. */
  vendorRoster?: {
    name: string;
    share: number;
    spend: number;
    isWinner: boolean;
    isOem: boolean;
    capabilityClass?: string | null;
    /** Per-vendor spend split by business unit (AT / AOH) within the pocket. */
    at?: number;
    aoh?: number;
  }[];
  exclusions?: OppExclusion[];
  caveats?: string[]; // data-quality warnings (PanelAlert)
  rejectReason?: string;
  parkTrigger?: string; // revisit trigger — a date or condition string
  owner?: string; // tracking
  committedAt?: string;
  committedTiming?: string; // operator's expected timing captured at commit (e.g. "Q4 2026")
  committedBasis?: string; // operator's commitment basis captured at commit (e.g. "signed terms")
  approach?: string; // chosen playbook id (Act workspace), persisted
  doneTasks?: string[]; // completed task labels (Act workspace), persisted
  milestones?: Milestone[];
  ramp?: RampPoint[];
  /** DEMO-ONLY, in-memory: forces the RAG level so a "simulate SAP" trigger can
   *  show green/amber/red without real ERP data. Never persisted. */
  demoRisk?: "green" | "amber" | "red";
  drift?: OppDrift;
  functionalFit?: FunctionalFitCheck; // authored qualitative fit proof (else derived)
  userInput?: OppUserInput; // operator context + figure overrides
  events: OppEvent[];
}
