import type { PerfDimension, VendorPerformance } from "@/types/vendor";

/**
 * Vendor performance (future module) — hybrid: dimensions backed by REAL
 * operational data where we have it (delivery from lead-time, responsiveness
 * from transaction volume), illustrative-but-deterministic otherwise (quality,
 * price, risk). Illustrative values are seeded off the vendor id so they're
 * stable across reloads — never random. The page marks the whole layer
 * "illustrative · future module" once, in the header.
 */

// Deterministic 0..1 from a string (FNV-1a) — stable illustrative values.
function seed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function illustrative(vendorId: string, key: string, lo = 55, hi = 92): number {
  return Math.round(lo + seed(`${vendorId}:${key}`) * (hi - lo));
}

const WEIGHTS = { otd: 0.25, quality: 0.2, price: 0.2, resp: 0.15, risk: 0.2 } as const;

export function buildPerformance(
  vendorId: string,
  leadDays: number | null,
  poCount: number,
): VendorPerformance {
  const dims: PerfDimension[] = [
    // On-time delivery — REAL where a lead time is on file (shorter → better).
    leadDays != null
      ? {
          key: "otd",
          label: "On-time delivery",
          weight: WEIGHTS.otd,
          live: true,
          score: Math.max(45, Math.min(96, Math.round(96 - Math.max(0, leadDays - 10) * 1.1))),
          basis: `Derived from the ${leadDays}-day lead time on file`,
        }
      : {
          key: "otd",
          label: "On-time delivery",
          weight: WEIGHTS.otd,
          live: false,
          score: illustrative(vendorId, "otd"),
          basis: "Illustrative — OTD feed lands with the ERP",
        },
    // Responsiveness — REAL-ish from transaction volume (PO count) where present.
    poCount > 0
      ? {
          key: "resp",
          label: "Responsiveness",
          weight: WEIGHTS.resp,
          live: true,
          score: Math.max(50, Math.min(92, Math.round(55 + Math.log10(1 + poCount) * 14))),
          basis: `Derived from transaction volume (${poCount.toLocaleString("en-US")} POs)`,
        }
      : {
          key: "resp",
          label: "Responsiveness",
          weight: WEIGHTS.resp,
          live: false,
          score: illustrative(vendorId, "resp"),
          basis: "Illustrative — engagement data pending",
        },
    // Illustrative-only (no live source yet).
    { key: "quality", label: "Quality (PPM)", weight: WEIGHTS.quality, live: false, score: illustrative(vendorId, "quality"), basis: "Illustrative — quality/PPM feed pending" },
    { key: "price", label: "Price competitiveness", weight: WEIGHTS.price, live: false, score: illustrative(vendorId, "price"), basis: "Illustrative — should-cost / benchmark pending" },
    { key: "risk", label: "Financial / risk", weight: WEIGHTS.risk, live: false, score: illustrative(vendorId, "risk"), basis: "Illustrative — financial/risk feed pending" },
  ];

  const composite = Math.round(dims.reduce((sum, d) => sum + d.score * d.weight, 0));
  return { score: composite, dimensions: dims, anyLive: dims.some((d) => d.live) };
}
