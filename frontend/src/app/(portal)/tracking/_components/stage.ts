import type { Opportunity } from "@/types/opportunity";

/**
 * Post-commit lifecycle — deliberately NOT a multi-stage funnel. Realization is
 * continuous (a climbing %, ERP-measured), so the only manual state that matters
 * is whether the awarded contract has gone LIVE. Everything else is expressed as
 * realized-% (progress) + RAG (health, see lib/risk.ts):
 *
 *   Not started (committed) ──manual "Mark live"──▶ Live (in-execution)
 *
 * "Realized" is the progress bar reaching 100% — an ERP-measured outcome, never
 * a button. (status === "realized" from legacy data reads as "Closed".)
 */

/** Mid-point of the committed savings range, whole dollars. */
export function committedMid(opp: Opportunity): number {
  return Math.round((opp.savingsLow + opp.savingsHigh) / 2);
}

/** Σ realized across the ramp (ERP-fed; 0 until SAP connects). */
export function realizedSum(opp: Opportunity): number {
  return (opp.ramp ?? []).reduce((sum, r) => sum + (r.realized ?? 0), 0);
}

/** Realized as a % of the committed target (0–100). The primary progress signal. */
export function realizedPct(opp: Opportunity): number {
  const mid = committedMid(opp);
  return mid > 0 ? Math.min(100, (realizedSum(opp) / mid) * 100) : 0;
}

/** Live once the awarded contract is active (in-execution or closed). */
export function isLive(opp: Opportunity): boolean {
  return opp.status === "in-execution" || opp.status === "realized";
}

/** Lifecycle label — the two states that matter, plus terminal "Closed". */
export function lifecycleLabel(opp: Opportunity): string {
  if (opp.status === "realized") return "Closed";
  return isLive(opp) ? "Live" : "Not started";
}

/**
 * The go-live toggle for this opp: flip Not started ↔ Live. Null once closed
 * (a terminal, ERP-confirmed end state). `live` is the target state.
 */
export function goLiveAction(opp: Opportunity): { label: string; live: boolean } | null {
  if (opp.status === "realized") return null;
  return isLive(opp) ? { label: "Mark not started", live: false } : { label: "Mark live", live: true };
}
