/**
 * Currency / percentage formatters. All amounts are stored as raw dollars in
 * the data layer and formatted at the edge with these helpers.
 */

/** Full dollars with thousands separators: 761600000 → "$761,600,000". */
export function fmtUSD(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

/** Millions with one decimal, trailing .0 stripped: 761_600_000 → "$761.6M". */
export function fmtM(n: number): string {
  const sign = n < 0 ? "-" : "";
  const s = (Math.abs(n) / 1_000_000).toFixed(1).replace(/\.0$/, "");
  return `${sign}$${s}M`;
}

/** Thousands, rounded: 405_000 → "$405K"; 1_174_000 → "$1,174K". */
export function fmtK(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n) / 1_000).toLocaleString("en-US")}K`;
}

/**
 * Auto-picks K/M by magnitude: 405_000 → "$405K"; 1_570_000 → "$1.57M";
 * 761_600_000 → "$761.6M". Values under $10M keep two decimals so savings
 * ranges like "$636K–$1.02M" stay faithful to the model.
 */
export function fmtCompact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 10_000_000) return fmtM(n);
  if (abs >= 1_000_000) {
    const sign = n < 0 ? "-" : "";
    const s = (abs / 1_000_000).toFixed(2).replace(/0$/, "").replace(/\.0$/, "");
    return `${sign}$${s}M`;
  }
  if (abs >= 1_000) return fmtK(n);
  return fmtUSD(n);
}

/** Savings range with en-dash: fmtRange(405_000, 648_000) → "$405K–$648K". */
export function fmtRange(low: number, high: number): string {
  return `${fmtCompact(low)}–${fmtCompact(high)}`;
}

/** Percentage, up to one decimal, trailing .0 stripped: 80 → "80%"; 33.6 → "33.6%". */
export function pct(n: number): string {
  return `${Math.round(n * 10) / 10}%`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/**
 * Timezone-safe "2026-06-12" → "Jun 12". Bare ISO dates parsed via
 * `new Date()` land at UTC midnight and shift a day west of UTC (and cause
 * SSR hydration mismatches) — these helpers split the string instead.
 * PanelTimeline strips trailing years, so the day form omits it.
 */
export function fmtDay(iso: string): string {
  const [, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${month} ${Number(d)}`;
}

/** Timezone-safe "2026-09-30" → "Sep 30, 2026". */
export function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  const month = MONTHS[Number(m) - 1] ?? m;
  return `${month} ${Number(d)}, ${y}`;
}
