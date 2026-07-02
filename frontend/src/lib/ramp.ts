/**
 * Quarterly realization ramp — savings build from the committed quarter, not a
 * hardcoded calendar year. Committed savings is an annual run-rate; realization
 * ramps up over the first two quarters (50% → 75% → full) from the committed
 * timing (e.g. "Q2 2027"), so the chart never shows savings before the play starts.
 */
export interface RampPoint {
  period: string; // "Q2 2027"
  projected: number;
  realized?: number;
}

interface Quarter {
  year: number;
  q: number; // 1–4
}

/** Parse "Q2 2027" or an ISO date to its quarter. Null when unparseable. */
export function parseQuarter(s?: string | null): Quarter | null {
  if (!s) return null;
  const m = /Q([1-4])\s+(\d{4})/.exec(s);
  if (m) return { year: Number(m[2]), q: Number(m[1]) };
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return { year: d.getFullYear(), q: Math.floor(d.getMonth() / 3) + 1 };
  return null;
}

/** Chronological sort key for a "Q2 2027" period label. */
export function quarterKey(period: string): number {
  const q = parseQuarter(period);
  return q ? q.year * 4 + q.q : 0;
}

/** Compact axis label: "Q2 2027" → "Q2 '27". */
export function shortQuarter(period: string): string {
  const q = parseQuarter(period);
  return q ? `Q${q.q} '${String(q.year).slice(2)}` : period;
}

/**
 * Build a quarterly ramp of `quarters` points from the committed timing (falling
 * back to the commit date, then today). `annualMid` = committed annual run-rate.
 */
export function buildRamp(
  annualMid: number,
  timing?: string | null,
  committedAt?: string | null,
  quarters = 8,
): RampPoint[] {
  const now = new Date();
  const start =
    parseQuarter(timing) ??
    parseQuarter(committedAt) ?? { year: now.getFullYear(), q: Math.floor(now.getMonth() / 3) + 1 };
  const qRate = annualMid / 4;
  const curve = [0.5, 0.75, 1]; // ramp-up over the first two quarters, then full run-rate
  const points: RampPoint[] = [];
  let { year, q } = start;
  for (let i = 0; i < quarters; i++) {
    const factor = curve[Math.min(i, curve.length - 1)];
    points.push({ period: `Q${q} ${year}`, projected: Math.round(qRate * factor) });
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return points;
}
