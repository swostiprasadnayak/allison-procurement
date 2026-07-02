import type { ScoreCriterion } from "@/types/vendor";

/** Static definition of a scoring criterion (weights sum to 1). */
export interface ScoreCriterionDef {
  key: string;
  label: string;
  weight: number;
}

/**
 * The six vendor-score criteria. Order matters: seed data and the score
 * breakdown card render in this order.
 */
export const SCORE_CRITERIA: readonly ScoreCriterionDef[] = [
  { key: "cost-competitiveness", label: "Cost competitiveness", weight: 0.25 },
  { key: "delivery-and-lead-time", label: "Delivery & lead time", weight: 0.2 },
  { key: "terms-vs-benchmark", label: "Terms vs benchmark", weight: 0.15 },
  { key: "range-coverage", label: "Range coverage", weight: 0.15 },
  { key: "risk-and-financial-health", label: "Risk & financial health", weight: 0.15 },
  { key: "data-reliability", label: "Data reliability", weight: 0.1 },
] as const;

export const NO_TERMS_NOTE = "No terms data on file";
export const NO_TERMS_MAX_SCORE = 40;

/** Deterministic composite: Σ weight × score, rounded to an integer. */
export function recomputeScore(breakdown: readonly ScoreCriterion[]): number {
  return Math.round(breakdown.reduce((sum, c) => sum + c.weight * c.score, 0));
}

/**
 * Lead-time edits adjust the delivery-and-lead-time criterion:
 * slip costs ~2pts per day slipped (capped at −30 per edit); improvement
 * recovers at half rate (~1pt per day). Null on either side is a no-op —
 * lead time isn't meaningful for utilities/government/legal vendors.
 */
export function adjustDeliveryForLeadTime(
  breakdown: readonly ScoreCriterion[],
  oldDays: number | null,
  newDays: number | null,
): ScoreCriterion[] {
  if (oldDays === null || newDays === null || oldDays === newDays) {
    return breakdown.map((c) => ({ ...c }));
  }
  const delta = newDays - oldDays;
  return breakdown.map((c) => {
    if (c.key !== "delivery-and-lead-time") return { ...c };
    if (delta > 0) {
      const penalty = Math.min(30, Math.round(delta * 2));
      return {
        ...c,
        score: Math.max(0, c.score - penalty),
        note: `Lead time slipped ${oldDays}d → ${newDays}d · −${penalty}pts`,
      };
    }
    const recovery = Math.round(-delta); // half of the 2pts/day slip rate
    return {
      ...c,
      score: Math.min(100, c.score + recovery),
      note: `Lead time improved ${oldDays}d → ${newDays}d · +${recovery}pts`,
    };
  });
}

/**
 * Payment-terms edits re-derive the terms-vs-benchmark criterion.
 * Null terms (the real Allison data gap) caps the criterion at 40 with the
 * "No terms data on file" note. Numeric terms score against the Net 60
 * benchmark: Net 30 → 50, Net 60 → 80, Net 89 → 95 (clamped 35–95).
 */
export function adjustTermsCriterion(
  breakdown: readonly ScoreCriterion[],
  termsDays: number | null,
): ScoreCriterion[] {
  return breakdown.map((c) => {
    if (c.key !== "terms-vs-benchmark") return { ...c };
    if (termsDays === null) {
      return { ...c, score: Math.min(c.score, NO_TERMS_MAX_SCORE), note: NO_TERMS_NOTE };
    }
    const score = Math.max(35, Math.min(95, 50 + (termsDays - 30)));
    return { ...c, score, note: `Net ${termsDays} vs Net 60 benchmark` };
  });
}
