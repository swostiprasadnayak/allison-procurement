export type VendorEntity = "AT" | "AOH" | "Both";

export type VendorType =
  | "manufacturer"
  | "distributor"
  | "service-provider"
  | "managed-service"
  | "utility"
  | "government";

export type VendorStatus =
  | "active"
  | "preferred"
  | "consolidation-target"
  | "exit-planned";

export interface ScoreCriterion {
  key: string;
  label: string;
  weight: number; // sum = 1
  score: number; // 0–100
  note?: string;
}

export interface VendorEvent {
  kind:
    | "lead-time-updated"
    | "terms-updated"
    | "status-changed"
    | "category-changed"
    | "score-recomputed"
    | "note"
    | "mercer-flag";
  actor: "Mercer" | "Maria Vance";
  at: string;
  note?: string;
  change?: { field: string; from: string; to: string };
}

export type LeadTimeTrend = "improving" | "stable" | "slipping";

export type DataReliability = "high" | "medium" | "low";

export type VendorRegion = "Americas" | "EMEA" | "APAC";

/** The vendor's role across the opportunities, derived from opp.opportunity_vendor. */
export type VendorRole =
  | "winner" // largest non-OEM in a pocket — the consolidation incumbent
  | "oem" // OEM / sole-source
  | "strategic" // keep — strategic / broad-line
  | "leverage" // leverage — negotiate
  | "consolidate" // consolidate — fold to winner
  | "tail" // exit — tail / maverick
  | "none"; // not in any surfaced play

/** One performance dimension — real where operational data exists, else illustrative. */
export interface PerfDimension {
  key: string;
  label: string;
  score: number; // 0–100
  weight: number; // contribution to the composite (weights sum to 1)
  live: boolean; // true = derived from real operational data; false = illustrative (future module)
  basis: string; // how it's derived — powers the "how it's calculated" table
}

/** Illustrative-forward vendor performance (future module) — composite + dimensions. */
export interface VendorPerformance {
  score: number; // 0–100 composite
  dimensions: PerfDimension[];
  anyLive: boolean; // any dimension backed by real data
}

/** An opportunity this vendor appears in, and how (the opps tie-out). */
export interface VendorOppRef {
  id: string;
  title: string;
  isWinner: boolean;
  isOem: boolean;
  addressable: number; // the opportunity's addressable (movable) — the savings in scope
}

export interface Vendor {
  id: string; // "VEN-001"
  name: string;
  entity: VendorEntity;
  category: string; // L1 (10 Navanta L1s)
  subcategory?: string; // L2
  country: string;
  region: VendorRegion;
  annualSpend: number;
  /** Derived from the engine `capability_class`; undefined when unknown (no guessed label). */
  type?: VendorType;
  paymentTermsDays: number | null; // null = data gap (real Allison problem)
  leadTimeDays: number | null;
  leadTimeTrend: LeadTimeTrend;
  overlap: boolean;
  dataReliability: DataReliability;
  /** 0–100 weighted DATA-CONFIDENCE composite (how complete our data on the vendor
   *  is) — NOT a merit/performance score. Labeled "Data confidence" in the UI. */
  score: number;
  scoreBreakdown: ScoreCriterion[];
  status: VendorStatus;
  /** Real role across the plays (opp.opportunity_vendor) — replaces the fake status. */
  role: VendorRole;
  /** Opportunities this vendor appears in (the opps tie-out). */
  opportunities: VendorOppRef[];
  /** Illustrative-forward performance (future module; real where operational data exists). */
  performance: VendorPerformance;
  contractExpiry?: string | null;
  notes?: string;
  events: VendorEvent[];
}
