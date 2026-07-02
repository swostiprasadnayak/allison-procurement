"use client";

import { useMemo } from "react";
import { KpiBreakdownCard, KpiGrid } from "@navanta-ai/design-system";
import { useVendorStore } from "@/context/VendorStoreContext";
import { fmtM } from "@/lib/format";

/**
 * Supplier KPI row — real backbone (roster · spend · overlap · in-a-play from
 * opp.opportunity_vendor) plus the illustrative-forward performance average
 * (future module; the page header carries the "illustrative" note).
 */
export function VendorKpis() {
  const { vendors, totalSpend, overlapCount } = useVendorStore();

  const inPlay = useMemo(() => vendors.filter((v) => v.role !== "none").length, [vendors]);
  const avgPerformance = useMemo(
    () => (vendors.length ? Math.round(vendors.reduce((s, v) => s + v.performance.score, 0) / vendors.length) : 0),
    [vendors],
  );

  return (
    <KpiGrid columns={4} className="kpi-dark-tips xl:grid-cols-5">
      <KpiBreakdownCard
        title="Vendors under management"
        value={vendors.length.toLocaleString("en-US")}
        subtitle="AT + AOH combined"
        info="Combined MRO supplier base loaded from the CDM"
      />
      <KpiBreakdownCard
        title="Spend covered"
        value={fmtM(totalSpend)}
        subtitle="annual, combined"
        info="Annual MRO spend of the loaded roster"
      />
      <KpiBreakdownCard
        title="Overlap vendors"
        value={overlapCount.toLocaleString("en-US")}
        subtitle="serve both entities"
        info="Vendors buying in both AT and AOH — the cross-division consolidation leverage"
      />
      <KpiBreakdownCard
        title="In opportunities"
        value={inPlay.toLocaleString("en-US")}
        subtitle={`of ${vendors.length.toLocaleString("en-US")} suppliers`}
        info="Suppliers that appear in a surfaced opportunity — as incumbent, OEM, leverage, consolidate or tail"
      />
      <KpiBreakdownCard
        title="Avg performance"
        value={String(avgPerformance)}
        subtitle="0–100 composite"
        info="Illustrative vendor-performance composite (future module) — real where operational data exists (delivery, transaction volume)"
      />
    </KpiGrid>
  );
}
