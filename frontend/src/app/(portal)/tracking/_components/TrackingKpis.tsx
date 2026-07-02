"use client";

import { KpiBreakdownCard, KpiGrid } from "@navanta-ai/design-system";
import { CheckCircle, Warning } from "@phosphor-icons/react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { fmtCompact } from "@/lib/format";
import { atRiskTotal } from "@/lib/risk";
import { committedMid } from "./stage";

/**
 * "At risk" KPI — the committed $ of amber+red plays (RAG risk model), with a
 * count. Tonal value (destructive when any risk, success when all on plan);
 * KpiBreakdownCard hard-codes the value color, so this mirrors its exact chrome.
 */
function RiskKpiCard({ value, count }: { value: number; count: number }) {
  const alert = count > 0;
  const tone = alert ? "var(--destructive)" : "var(--success)";
  return (
    <div className="mx-auto flex min-h-[var(--kpi-card-min-h,128px)] w-full max-w-[320px] flex-col items-start gap-[var(--kpi-stack-gap,16px)] rounded-[8px] bg-[var(--card)] p-[var(--kpi-card-pad,16px)] text-[var(--card-foreground)] shadow-[0px_0px_1px_0px_rgba(0,0,0,0.25),0px_1px_4px_0px_rgba(0,0,0,0.06)]">
      <div className="flex w-full items-center gap-1">
        <p className="min-w-0 truncate text-[14px] font-semibold leading-[22px] text-[var(--foreground)]">
          At risk
        </p>
        <span className="inline-flex h-[14px] shrink-0 items-center leading-none">
          {alert ? (
            <Warning size={14} weight="duotone" color="var(--destructive)" />
          ) : (
            <CheckCircle size={14} weight="duotone" color="var(--success)" />
          )}
        </span>
      </div>
      <p
        className="text-[22px] font-semibold leading-[1.14] tracking-[-0.02em]"
        style={{ color: tone, fontVariantNumeric: "tabular-nums" }}
      >
        {alert ? fmtCompact(value) : "None"}
      </p>
      <p className="w-full truncate text-[13px] leading-[18px] text-[var(--muted-foreground)]">
        {alert ? `${count} ${count === 1 ? "play" : "plays"} behind pace` : "All plays on plan"}
      </p>
    </div>
  );
}

export function TrackingKpis() {
  const { tracked, committedMidTotal, realizedYtdTotal } = useOpportunityStore();

  const inExecution = tracked.filter((o) => o.status === "in-execution");
  const inExecutionMid = inExecution.reduce((sum, o) => sum + committedMid(o), 0);
  const risk = atRiskTotal(tracked);

  return (
    <KpiGrid columns={4} className="kpi-dark-tips">
      <KpiBreakdownCard
        title="Committed value"
        value={fmtCompact(committedMidTotal)}
        subtitle={`${tracked.length} ${tracked.length === 1 ? "opportunity" : "opportunities"} tracked`}
        info="Mid-point of committed savings ranges"
      />
      <KpiBreakdownCard
        title="Live"
        value={String(inExecution.length)}
        subtitle={`${fmtCompact(inExecutionMid)} in flight`}
        info="Awarded contracts that have gone live — savings accruing (measured by the ERP)"
      />
      <KpiBreakdownCard
        title="Realized YTD"
        value={fmtCompact(realizedYtdTotal)}
        subtitle={`of ${fmtCompact(committedMidTotal)} committed`}
        info="Realized dollars booked against opportunity ramps"
      />
      <RiskKpiCard value={risk.value} count={risk.count} />
    </KpiGrid>
  );
}
