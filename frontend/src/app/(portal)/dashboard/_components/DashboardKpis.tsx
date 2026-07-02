"use client";

import { KpiBreakdownCard, KpiGrid } from "@navanta-ai/design-system";
import { KpiBreakdownProgressCard } from "@/components/ui/KpiBreakdownProgressCard";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useCockpit } from "@/lib/useCockpit";
import { useFootprint } from "@/lib/useFootprint";
import { fmtCompact, fmtM, pct } from "@/lib/format";

/**
 * Command Center KPI row — ESTATE-level (not MRO-specific), since the homepage
 * is the enterprise command center. Total indirect estate + how much is scanned
 * (MRO today) + addressable identified, then the live committed / realized
 * figures from the opportunity store. All live: footprint + cockpit + store.
 */
export function DashboardKpis() {
  const { tracked, committedMidTotal, realizedYtdTotal } = useOpportunityStore();
  const { cockpit } = useCockpit();
  const footprint = useFootprint();

  const totalSpend = footprint?.totalSpend ?? 0;
  const scannedSpend = footprint?.scannedSpend ?? 0;
  const scannedCount = footprint?.scannedCount ?? 0;
  const totalCount = footprint?.totalCount ?? 0;
  const scannedPct = totalSpend > 0 ? (scannedSpend / totalSpend) * 100 : 0;
  const addressable = cockpit?.kpis.totalMovable ?? 0;
  const realizedShare =
    committedMidTotal > 0 ? pct((realizedYtdTotal / committedMidTotal) * 100) : "0%";

  return (
    <KpiGrid columns={4} className="kpi-dark-tips xl:grid-cols-5 [&>*]:mx-0 [&>*]:max-w-none">
      <KpiBreakdownCard
        title="Indirect spend"
        value={fmtM(totalSpend)}
        subtitle={`${totalCount} categories · AT + AOH`}
        info="Total indirect spend across all L1 categories (spend cube · Consol 1)"
      />
      <KpiBreakdownProgressCard
        title="Scan coverage"
        value={`${Math.round(scannedPct)}%`}
        subtitle={`MRO · ${scannedCount} of ${totalCount} categories`}
        info={`The scan engine has analyzed ${fmtM(scannedSpend)} of ${fmtM(totalSpend)} — MRO is live; the rest is the expansion runway`}
        progress={scannedPct}
        tone={scannedPct >= 50 ? "success" : "warning"}
      />
      <KpiBreakdownCard
        title="Addressable identified"
        value={fmtCompact(addressable)}
        subtitle="contestable in scanned"
        info="Contestable (movable) spend in the scanned categories, after OEM / sole-source carve-outs"
      />
      <KpiBreakdownCard
        title="Committed"
        value={fmtCompact(committedMidTotal)}
        subtitle={`${tracked.length} ${tracked.length === 1 ? "play" : "plays"} tracked`}
        info="Mid-point of committed savings ranges in Value Realization"
      />
      <KpiBreakdownCard
        title="Realized YTD"
        value={fmtCompact(realizedYtdTotal)}
        subtitle={`${realizedShare} of committed`}
        info="Realized dollars booked against play ramps this year"
      />
    </KpiGrid>
  );
}
