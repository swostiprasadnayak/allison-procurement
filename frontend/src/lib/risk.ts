import type { Opportunity } from "@/types/opportunity";
import { fmtCompact } from "@/lib/format";

/**
 * Realization risk (RAG) for a committed opportunity — judged on PACE vs the CLOCK.
 *
 *  • ERP connected (realized actuals > 0): compare realized-to-date against the
 *    plan prorated to now → green (on/ahead of pace) · amber (behind, recoverable)
 *    · red (well behind with the committed date approaching).
 *  • Pre-ERP (no actuals yet): the only honest signal is the schedule — an opp
 *    past its committed date and not yet realized is behind (amber/red); otherwise
 *    it's "on plan (projected)", with realized confirming once the ERP connects.
 *
 * This is the single source of truth for risk on both the Value Realization page
 * and the homepage "At risk" roll-up.
 */
export type RiskLevel = "green" | "amber" | "red" | "none";

export interface RiskStatus {
  level: RiskLevel;
  label: string;
  detail: string;
}

export function committedMid(opp: Opportunity): number {
  return Math.round((opp.savingsLow + opp.savingsHigh) / 2);
}

export function realizedToDate(opp: Opportunity): number {
  return (opp.ramp ?? []).reduce((sum, r) => sum + (r.realized ?? 0), 0);
}

/** "Q4 2026" → last day of that quarter. Null when unparseable/absent. */
function timingEnd(timing?: string): Date | null {
  if (!timing) return null;
  const m = /Q([1-4])\s+(\d{4})/.exec(timing);
  if (!m) return null;
  const q = Number(m[1]);
  const year = Number(m[2]);
  return new Date(year, q * 3, 0); // day 0 of the month after the quarter's end month
}

/** Plan prorated to `now` — how much of the committed target should be realized by today. */
function expectedByNow(opp: Opportunity, now: Date, end: Date | null): number {
  const target = committedMid(opp);
  const start = opp.committedAt ? new Date(opp.committedAt) : null;
  if (!start || !end || end <= start) return target;
  const frac = Math.min(1, Math.max(0, (now.getTime() - start.getTime()) / (end.getTime() - start.getTime())));
  return target * frac;
}

export function riskStatus(opp: Opportunity, now: Date = new Date()): RiskStatus {
  if (opp.status === "realized")
    return { level: "green", label: "Realized", detail: "Fully realized against the committed target." };
  if (opp.status !== "in-execution" && opp.status !== "committed")
    return { level: "none", label: "—", detail: "" };

  // DEMO override — a "simulate SAP" trigger forces the RAG so green/amber/red can
  // be shown without real ERP data; uses the injected realized for the figures.
  if (opp.demoRisk) {
    const r = realizedToDate(opp);
    const target = committedMid(opp);
    const label = opp.demoRisk === "red" ? "At risk" : opp.demoRisk === "amber" ? "Behind" : "On track";
    const tail =
      opp.demoRisk === "green"
        ? "on pace to the committed target"
        : opp.demoRisk === "amber"
          ? "behind the projected pace — recoverable"
          : "well behind — at risk of missing the committed target";
    return {
      level: opp.demoRisk,
      label,
      detail: `Simulated SAP actuals · ${fmtCompact(r)} realized of ${fmtCompact(target)} committed — ${tail}.`,
    };
  }

  const realized = realizedToDate(opp);
  const end = timingEnd(opp.committedTiming);

  // ERP connected — judge pace against the plan-to-date.
  if (realized > 0) {
    const expected = expectedByNow(opp, now, end);
    const pace = expected > 0 ? realized / expected : 1;
    if (pace >= 0.95)
      return {
        level: "green",
        label: "On track",
        detail: `Realized ${fmtCompact(realized)} of ~${fmtCompact(expected)} expected by now — on pace to the committed target.`,
      };
    if (pace >= 0.7)
      return {
        level: "amber",
        label: "Behind",
        detail: `Realized ${fmtCompact(realized)} of ~${fmtCompact(expected)} expected — recoverable with time remaining.`,
      };
    return {
      level: "red",
      label: "At risk",
      detail: `Realized ${fmtCompact(realized)} of ~${fmtCompact(expected)} expected — ${fmtCompact(Math.max(0, expected - realized))} short with the committed date approaching.`,
    };
  }

  // Pre-ERP — the schedule is the only honest signal.
  if (end && now > end) {
    const monthsPast = (now.getFullYear() - end.getFullYear()) * 12 + (now.getMonth() - end.getMonth());
    const level: RiskLevel = monthsPast > 3 ? "red" : "amber";
    return {
      level,
      label: level === "red" ? "At risk" : "Behind schedule",
      detail: `Past the committed ${opp.committedTiming} date and not yet realized — realized value confirms once the ERP is connected.`,
    };
  }
  if (opp.drift?.flagged)
    return { level: "amber", label: "Watch", detail: opp.drift.note || "Flagged for review — realized actuals pending ERP." };
  return {
    level: "green",
    label: "On plan",
    detail: opp.committedTiming
      ? `On track to the committed ${opp.committedTiming} date — realized value populates once the ERP is connected.`
      : "Tracking to the committed target — realized value populates once the ERP is connected.",
  };
}

/** Σ committed value of amber + red plays — the "$ at risk" roll-up. */
export function atRiskTotal(opps: Opportunity[]): { value: number; count: number } {
  let value = 0;
  let count = 0;
  for (const o of opps) {
    const lvl = riskStatus(o).level;
    if (lvl === "amber" || lvl === "red") {
      value += committedMid(o);
      count += 1;
    }
  }
  return { value, count };
}

/** DS-free color token for a RAG level. */
export function riskColor(level: RiskLevel): string {
  return level === "red"
    ? "var(--destructive)"
    : level === "amber"
      ? "var(--warning)"
      : level === "green"
        ? "var(--success)"
        : "var(--text-neutral)";
}
