"use client";

import { useState } from "react";
import { CaretDown, CheckCircle, Info, ShieldCheck, Warning } from "@phosphor-icons/react";
import { Pill } from "@navanta-ai/design-system";
import type { FitDimension, FitVerdict, Opportunity } from "@/types/opportunity";
import { EvidenceBlock } from "./EvidenceBlock";

const VERDICT_META: Record<FitVerdict, { label: string; icon: typeof CheckCircle; color: string }> = {
  pass: { label: "Fits", icon: CheckCircle, color: "#008234" },
  watch: { label: "Watch", icon: Warning, color: "var(--warning)" },
  info: { label: "Note", icon: Info, color: "var(--text-secondary)" },
};

/** Pill has no success variant — a custom green chip for "Fits", DS pills for the others. */
function VerdictChip({ verdict }: { verdict: FitVerdict }) {
  const meta = VERDICT_META[verdict];
  if (verdict === "pass") {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
        style={{ background: "#ECFDF5", color: "#008234" }}
      >
        <CheckCircle size={12} weight="fill" color="#008234" />
        {meta.label}
      </span>
    );
  }
  return (
    <Pill size="sm" variant={verdict === "watch" ? "warning" : "neutral"}>
      {meta.label}
    </Pill>
  );
}

function FitRow({ dim, first, showDetail }: { dim: FitDimension; first: boolean; showDetail: boolean }) {
  const meta = VERDICT_META[dim.verdict];
  const RowIcon = meta.icon;
  return (
    <div
      className="flex items-start gap-3 px-3 py-2"
      style={{ borderTop: first ? undefined : "1px solid var(--border-light)" }}
    >
      <RowIcon size={16} weight="duotone" color={meta.color} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {dim.label}
          </span>
          <VerdictChip verdict={dim.verdict} />
        </div>
        {showDetail && (
          <span className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {dim.detail}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Functional fit — the qualitative read on whether this opportunity is executable. Every row is
 * DERIVED FROM REAL ENGINE SIGNALS (cdm.ts → deriveFunctionalFit: cross-BU from business_unit,
 * brand independence from OEM share, geography from country, play type from the lever). No canned
 * text. Renders nothing if the engine didn't supply a functionalFit.
 */
export function FunctionalFitCard({ opp }: { opp: Opportunity }) {
  const [showDetail, setShowDetail] = useState(false);
  const fit = opp.functionalFit;
  if (!fit) return null;
  const dims: FitDimension[] = [
    fit.assetScopeOverlap,
    fit.vendorIndependence,
    fit.geographyProof,
    fit.operatingModel,
  ];

  return (
    <EvidenceBlock
      icon={ShieldCheck}
      title="Functional fit"
      headerRight={
        <button
          type="button"
          onClick={() => setShowDetail((v) => !v)}
          className="flex items-center gap-1 text-xs font-medium"
          style={{ color: "#59349C" }}
          aria-expanded={showDetail}
        >
          <CaretDown
            size={12}
            weight="bold"
            style={{
              transform: showDetail ? "rotate(0deg)" : "rotate(-90deg)",
              transition: "transform 150ms ease",
            }}
          />
          {showDetail ? "Hide reasoning" : "Show reasoning"}
        </button>
      }
    >
      {/* Bleed out of EvidenceBlock's padding so dividers span the full card width. */}
      <div className="-mx-3 -mb-3 flex flex-col">
        {dims.map((dim, i) => (
          <FitRow key={dim.label} dim={dim} first={i === 0} showDetail={showDetail} />
        ))}
      </div>
    </EvidenceBlock>
  );
}
