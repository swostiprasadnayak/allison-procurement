import type { ReactNode } from "react";
import { Calculator } from "@phosphor-icons/react";
import { DataTable, type DataTableColumn } from "@navanta-ai/design-system";
import type { Opportunity } from "@/types/opportunity";
import { pct } from "@/lib/format";
import { BAR_GRADIENT, EvidenceBlock } from "./EvidenceBlock";

const GAP_CAP = 20;

/** A 0–1 magnitude bar (fit factor, gap multiplier) so the multiplicative chain
 *  reads visually, not just numerically. */
function ImpactBar({ value, text }: { value: number; text: string }) {
  const clamped = Math.min(100, Math.max(0, value * 100));
  return (
    <div className="flex items-center justify-end gap-2">
      <div
        className="relative hidden h-1 w-[44px] shrink-0 overflow-hidden rounded-full sm:block"
        style={{ background: "var(--muted)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${clamped}%`, background: BAR_GRADIENT }}
        />
      </div>
      <span
        className="text-[13px] font-medium"
        style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
      >
        {text}
      </span>
    </div>
  );
}

interface MathRow {
  id: string;
  factor: string;
  observed: string;
  weight: string;
  impact: ReactNode;
  /** Result rows (sweep formula / confidence) — bold label. */
  result?: boolean;
  /** The headline total (final confidence) — neutral grey band, like the
   *  savings total. Only one row carries this. */
  total?: boolean;
}

/**
 * "What drove this" — the confidence math as a DS DataTable: factor / observed /
 * weight / impact, with the scoring formula `fit × MIN(gap, 20) / 20` resolving
 * to the headline confidence. Analyst-adjusted plays show the raw sweep formula
 * as its own row above the adjusted confidence so the two never contradict.
 */
export function WhatDroveThisCard({ opp }: { opp: Opportunity }) {
  const fit = opp.fitFactor;
  const gap = opp.fragmentationGap;
  const gapMult = Math.min(gap, GAP_CAP) / GAP_CAP;
  const formulaConf = Math.round(fit * gapMult * 100);
  const capped = gap > GAP_CAP;
  // Several plays are scored on analyst judgement, not the raw sweep formula —
  // detect the divergence and label it rather than show a contradicting number.
  const isFormulaScored = Math.abs(formulaConf - opp.confidencePct) <= 1;

  const resultValue = (text: string) => (
    <span
      className="text-[15px] font-semibold"
      style={{ color: "#181A1B", fontVariantNumeric: "tabular-nums" }}
    >
      {text}
    </span>
  );

  const rows: MathRow[] = [
    {
      id: "fit",
      factor: "Functional fit",
      observed: fit.toFixed(2),
      weight: "× fit",
      impact: <ImpactBar value={fit} text={fit.toFixed(2)} />,
    },
    {
      id: "gap",
      factor: "Fragmentation multiplier",
      observed: `MIN(${gap}, ${GAP_CAP}) / ${GAP_CAP}`,
      weight: "× gap",
      impact: <ImpactBar value={gapMult} text={gapMult.toFixed(2)} />,
    },
  ];

  if (isFormulaScored) {
    rows.push({
      id: "confidence",
      factor: "Confidence",
      observed: `${fit.toFixed(2)} × ${gapMult.toFixed(2)}`,
      weight: "=",
      impact: resultValue(pct(formulaConf)),
      result: true,
      total: true,
    });
  } else {
    rows.push({
      id: "sweep",
      factor: "Sweep formula",
      observed: `${fit.toFixed(2)} × ${gapMult.toFixed(2)}`,
      weight: "=",
      impact: resultValue(pct(formulaConf)),
      result: true,
    });
    rows.push({
      id: "confidence",
      factor: "Confidence",
      observed: "analyst-adjusted — see rationale",
      weight: "",
      impact: resultValue(pct(opp.confidencePct)),
      result: true,
      total: true,
    });
  }

  const columns: DataTableColumn<MathRow>[] = [
    {
      key: "factor",
      label: "Factor",
      minWidth: 160,
      cell: (r) => (
        <span
          className={`text-[13px] ${r.result ? "font-semibold" : ""}`}
          style={{ color: "#181A1B" }}
        >
          {r.factor}
        </span>
      ),
    },
    {
      key: "observed",
      label: "Observed",
      minWidth: 120,
      cell: (r) => (
        <span
          className="text-[12px]"
          style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
        >
          {r.observed}
        </span>
      ),
    },
    {
      key: "weight",
      label: "Weight",
      width: 84,
      cell: (r) => (
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {r.weight}
        </span>
      ),
    },
    {
      key: "impact",
      label: "Impact",
      align: "right",
      cellLayout: "end",
      minWidth: 90,
      cell: (r) => r.impact,
    },
  ];

  return (
    <EvidenceBlock
      icon={Calculator}
      title="What drove this · confidence math"
      footnote={
        capped
          ? `Gap is capped at ${GAP_CAP}× in the multiplier — beyond that, more fragmentation no longer lifts confidence. Confidence is independent of $ size: a small clean play outranks a huge messy one.`
          : "Confidence is independent of $ size — a small clean play outranks a huge messy one."
      }
    >
      <div className="flex flex-col gap-1">
        <span
          className="text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--text-secondary)" }}
        >
          Confidence = fit × MIN(gap, 20) / 20
        </span>
        {/* Bleed out of EvidenceBlock's px-3/pb-3 — the DataTable already pads
            its own cells, so the wrapper padding just doubled the inset. */}
        <div className="-mx-3 -mb-3">
          <DataTable<MathRow>
            columns={columns}
            data={rows}
            rowKey={(r) => r.id}
            rowClassName={(r) => (r.total ? "bg-[#F4F4F5]" : "")}
          />
        </div>
      </div>
    </EvidenceBlock>
  );
}
