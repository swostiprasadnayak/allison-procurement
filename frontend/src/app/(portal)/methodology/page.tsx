"use client";

import { useParameters } from "@/lib/useParameters";
import { MethodologyExplainer } from "./_components/MethodologyExplainer";
import { MethodologyKpis } from "./_components/MethodologyKpis";
import { ParameterRegistry } from "./_components/ParameterRegistry";

/**
 * Admin › Methodology & Parameters — the engine's decision logic and knobs,
 * read live from opp.engine_parameter and grouped by methodology section (Feature
 * Spec Appendix A). KPI strip → how-it-calculates explainer → editable parameter
 * registry. Numeric dials are editable (save-only: the engine applies changes on
 * its next run); structural parameters are read-only.
 */
export default function MethodologyPage() {
  const { params, reload } = useParameters();
  return (
    <div className="flex flex-col gap-5">
      <MethodologyKpis data={params} />
      <MethodologyExplainer />
      <ParameterRegistry data={params} onSaved={reload} />
    </div>
  );
}
