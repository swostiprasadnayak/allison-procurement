import type { Archetype, EvidenceBasis, OpportunityStatus } from "@/types/opportunity";
import type { VendorEntity, VendorType } from "@/types/vendor";

/** Pill variants supported by the DS (NO success variant exists). */
export type PillVariant = "info" | "danger" | "warning" | "neutral";

export const ARCHETYPE_LABELS: Record<Archetype, string> = {
  consolidation: "Consolidation",
  "operating-model": "Operating model",
  substitution: "Substitution",
  "payment-terms": "Payment terms",
  "tail-rationalization": "Tail rationalization",
};

export const ARCHETYPE_VARIANTS: Record<Archetype, PillVariant> = {
  consolidation: "info",
  "operating-model": "warning",
  substitution: "neutral",
  "payment-terms": "info",
  "tail-rationalization": "neutral",
};

/** Display order for the archetype toggle-group facet. */
export const ARCHETYPE_ORDER: readonly Archetype[] = [
  "consolidation",
  "operating-model",
  "substitution",
  "payment-terms",
  "tail-rationalization",
];

/**
 * The real engine lever, keyed by `play_route`. Short table labels that match
 * the detail panel's lever wording (Consolidate / Competitive RFP / OEM carve-out).
 */
export const LEVER_LABELS: Record<string, string> = {
  consolidate: "Consolidate",
  rfp: "Competitive RFP",
  "carve-out": "OEM carve-out",
  "sub-classify": "Sub-classify",
};

export const LEVER_VARIANTS: Record<string, PillVariant> = {
  consolidate: "info",
  rfp: "neutral",
  "carve-out": "warning",
  "sub-classify": "warning",
};

export const EVIDENCE_LABELS: Record<EvidenceBasis, string> = {
  evidence: "Evidence",
  benchmark: "Benchmark",
  mixed: "Mixed",
};

export const EVIDENCE_VARIANTS: Record<EvidenceBasis, PillVariant> = {
  evidence: "info",
  benchmark: "warning",
  mixed: "neutral",
};

export const ENTITY_VARIANTS: Record<VendorEntity, PillVariant> = {
  AT: "info",
  AOH: "warning",
  Both: "neutral",
};

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  manufacturer: "Manufacturer",
  distributor: "Distributor",
  "service-provider": "Service provider",
  "managed-service": "Managed service",
  utility: "Utility",
  government: "Government",
};

/** "in-execution" → "In execution" — sentence-case status for table cells. */
export function statusLabel(status: OpportunityStatus): string {
  const text = status.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
