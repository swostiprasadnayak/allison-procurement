"use client";

import { useMemo } from "react";
import { KpiBreakdownCard, KpiGrid } from "@navanta-ai/design-system";
import type { EngineParameters } from "@/lib/cdm";

/**
 * Methodology KPI row — the parameter registry at a glance: how many dials, how
 * many methodology sections, the active methodology version, and how many have
 * been changed from their seeded defaults (applied on the engine's next run).
 */
export function MethodologyKpis({ data }: { data: EngineParameters | null }) {
  const editedCount = useMemo(
    () => (data ? data.groups.flatMap((g) => g.params).filter((p) => p.edited).length : 0),
    [data],
  );

  return (
    <KpiGrid columns={4} className="kpi-dark-tips">
      <KpiBreakdownCard
        title="Parameters"
        value={data ? String(data.count) : "—"}
        subtitle="engine decision dials"
        info="Every threshold the engine uses lives in opp.engine_parameter — nothing is hardcoded"
      />
      <KpiBreakdownCard
        title="Methodology sections"
        value={data ? String(data.groups.length) : "—"}
        subtitle="decision-logic groups"
        info="Scan scoring, vendor tiers, opportunity generation, savings rates, benchmark, maverick & tail"
      />
      <KpiBreakdownCard
        title="Methodology version"
        value={data?.methodologyVersion ?? "—"}
        subtitle="active parameter set"
        info="The methodology_version stamped on this parameter set and every engine run that uses it"
      />
      <KpiBreakdownCard
        title="Changed from default"
        value={String(editedCount)}
        subtitle={editedCount === 0 ? "all at seed" : "applied on next run"}
        info="Parameters an admin has edited from their seeded methodology default; the engine applies them on its next run"
      />
    </KpiGrid>
  );
}
