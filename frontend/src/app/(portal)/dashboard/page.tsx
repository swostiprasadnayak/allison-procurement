"use client";

import { MercerNarrativeCard } from "@/components/mercer";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useVendorStore } from "@/context/VendorStoreContext";
import { useCockpit } from "@/lib/useCockpit";
import { useFootprint } from "@/lib/useFootprint";
import { fmtCompact, fmtM } from "@/lib/format";
import { DashboardKpis } from "./_components/DashboardKpis";
import { EstateScanCard } from "./_components/EstateScanCard";
import { ProgramSummaryCards } from "./_components/ProgramSummaryCards";

/**
 * Command Center — the MRO landing page. Unlike the working surfaces
 * (Opportunities = triage queue, Value Realization = execution tracker,
 * Vendors = supplier detail), this is the program-level roll-up: state of the
 * whole program + a route into each. Everything reads live from the CDM.
 */
export default function DashboardPage() {
  const { feed, tracked, committedMidTotal, realizedYtdTotal, driftCount } = useOpportunityStore();
  const { overlapCount } = useVendorStore();
  const { cockpit } = useCockpit();
  const footprint = useFootprint();

  const k = cockpit?.kpis;
  const categoryCount = new Set([...feed, ...tracked].map((o) => o.l2 || o.category)).size;

  // Program synthesis — leads with the whole indirect footprint, frames MRO as
  // the CURRENT focus (the one scanned category), then the live MRO update.
  // Distinct from the opportunities brief, which is "today's triage queue".
  const paragraph =
    k && footprint
      ? `Allison's indirect spend runs ${fmtM(footprint.totalSpend)} across ${footprint.totalCount} categories. ` +
        `Current focus is MRO — ${fmtM(k.mroNetSpend)} across ${k.vendorCount.toLocaleString("en-US")} vendors, ` +
        `the first category scanned. The sweep surfaced ${k.openOpportunities} opportunities holding ` +
        `${fmtCompact(k.totalMovable)} of addressable spend — about ${fmtCompact(k.identifiedValueMid)} in identified ` +
        `savings across the top ${categoryCount} sub-categories. ${feed.length} sit in the feed awaiting triage; ` +
        `${tracked.length} ${tracked.length === 1 ? "play is" : "plays are"} committed ` +
        `(${fmtCompact(committedMidTotal)}), with ${fmtCompact(realizedYtdTotal)} realized so far` +
        `${driftCount > 0 ? ` · ${driftCount} flagged for drift` : ""}. ` +
        `${overlapCount} vendors serve both AT and AOH — the cross-division leverage. ` +
        `The scan extends to the remaining categories next.`
      : "Loading the latest sweep…";

  return (
    <>
      <MercerNarrativeCard
        title="Mercer synthesis"
        paragraph={paragraph}
        chips={[
          { label: `Triage ${feed.length} opportunities`, href: "/opportunities" },
          { label: `${tracked.length} committed plays`, href: "/tracking" },
          { label: "Supplier base", href: "/vendors" },
        ]}
      />

      <DashboardKpis />

      {/* Summary-of-summaries — the three working surfaces rolled up, above the
          estate scan (per the command-center read: status first, reach below). */}
      <ProgramSummaryCards />

      {/* Indirect estate scan — all L1 categories; MRO is the one scanned (live
          addressable + opps), the rest are the expansion runway. */}
      <EstateScanCard mroAddressable={k?.totalMovable ?? 0} mroOpps={k?.openOpportunities ?? 0} />
    </>
  );
}
