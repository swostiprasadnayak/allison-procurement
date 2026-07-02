import type { ReactNode } from "react";
import { Coins } from "@phosphor-icons/react";
import type { SavingsResolution } from "@/lib/savings";
import type { OppExclusion } from "@/types/opportunity";
import { fmtRange, fmtUSD } from "@/lib/format";
import { EvidenceBlock } from "./EvidenceBlock";

type RowWeight = "regular" | "medium" | "semibold";

interface WaterfallRow {
  label: string;
  /** Optional context under the label (12px secondary). */
  sub?: string;
  value: string;
  /** Operator rendered inline before the value (− carve-out). */
  operator?: string;
  /** Row background highlight (subtotal / total rows). */
  highlight?: "neutral";
  labelWeight?: RowWeight;
  valueWeight?: RowWeight;
}

const WEIGHT_CLASS: Record<RowWeight, string> = {
  regular: "font-normal",
  medium: "font-medium",
  semibold: "font-semibold",
};

/** Iris calculation pattern (Iris-Shareable 1015:3957): rows of label (left) →
 *  value (right) with the operator inline before the value, thin dividers, and
 *  a neutral-tinted semibold total. */
function Row({ row, first }: { row: WaterfallRow; first: boolean }) {
  return (
    <div
      className="flex items-center justify-between gap-4 px-3 py-3"
      style={{
        background: row.highlight === "neutral" ? "#F4F4F5" : undefined,
        borderTop: first ? undefined : "1px solid #F1F3F5",
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span
          className={`text-[14px] leading-[22px] ${WEIGHT_CLASS[row.labelWeight ?? "regular"]}`}
          style={{ color: "#181A1B" }}
        >
          {row.label}
        </span>
        {row.sub && (
          <span className="text-[12px] leading-[18px]" style={{ color: "#52525C" }}>
            {row.sub}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {row.operator && (
          <span className="text-[13px]" style={{ color: "#52525C" }} aria-hidden="true">
            {row.operator}
          </span>
        )}
        <span
          className={`text-[14px] leading-[22px] ${WEIGHT_CLASS[row.valueWeight ?? "regular"]}`}
          style={{ color: "#181A1B", fontVariantNumeric: "tabular-nums" }}
        >
          {row.value}
        </span>
      </div>
    </div>
  );
}

interface SavingsWaterfallCardProps {
  /** Engine pocket spend (L3 × country) before the OEM / winner carve-outs. */
  pocket: number;
  /** OEM / winner carve-outs the engine held out of the pocket. */
  exclusions: OppExclusion[];
  /** Engine movable_value — the contestable spend after the carve-outs. */
  movable: number;
  /** Resolved conservative / stretch savings (re-derived under any override). */
  resolved: SavingsResolution;
}

/**
 * "How we got there" — the savings derivation exactly as the engine computes
 * it: the L3 × country pocket, less each OEM / winner carve-out, leaving the
 * movable (contestable) spend; then the conservative and stretch dollar
 * outcomes and the headline savings range. The pocket / carve-out / movable
 * rows come straight from the engine fields; the conservative / stretch
 * outcomes re-derive through `resolveSavings` so any operator override flows
 * through to the band and the committed figure.
 */
export function SavingsWaterfallCard({
  pocket,
  exclusions,
  movable,
  resolved,
}: SavingsWaterfallCardProps) {
  // The applied savings rates, derived from the resolved figures — shown in parens next to
  // each outcome so the lever's conservative–stretch band (e.g. 5% / 8% for an RFP) is explicit.
  const loPct = movable > 0 ? Math.round((resolved.low / movable) * 100) : null;
  const hiPct = movable > 0 ? Math.round((resolved.high / movable) * 100) : null;
  const rows: WaterfallRow[] = [
    { label: "Pocket spend", value: fmtUSD(pocket) },
    ...exclusions.map((ex) => ({
      label: ex.label,
      sub: ex.reason || undefined,
      operator: "−",
      value: fmtUSD(ex.amount),
    })),
    {
      label: "Addressable",
      value: fmtUSD(movable),
      highlight: "neutral" as const,
      labelWeight: "medium" as const,
      valueWeight: "semibold" as const,
    },
    { label: loPct != null ? `Conservative outcome (${loPct}%)` : "Conservative outcome", value: fmtUSD(resolved.low) },
    { label: hiPct != null ? `Stretch outcome (${hiPct}%)` : "Stretch outcome", value: fmtUSD(resolved.high) },
    {
      label: "Savings range",
      value: fmtRange(resolved.low, resolved.high),
      highlight: "neutral" as const,
      labelWeight: "semibold" as const,
      valueWeight: "semibold" as const,
    },
  ];

  let basis: ReactNode;
  if (resolved.basis === "override") {
    basis = (
      <>
        Pocket → carve-outs → addressable are the engine&apos;s figures. The savings
        range reflects <span style={{ color: "#59349C", fontWeight: 600 }}>your input</span> —
        workbook baseline was {fmtRange(resolved.baseLow, resolved.baseHigh)}.
      </>
    );
  } else {
    basis =
      "Pocket → carve-outs → addressable are the engine's figures; the savings range applies the lever's conservative–stretch rates to the addressable spend.";
  }

  return (
    <EvidenceBlock icon={Coins} title="How we got there · Savings derivation" footnote={basis}>
      {/* Bleed out of EvidenceBlock's px-3/pb-3 so the dividers and the grey
          total band span the full card width (Iris 1015:3957); each row's own
          px-3 insets the text to align with the header. */}
      <div className="-mx-3 -mb-3">
        {rows.map((row, i) => (
          <Row key={`${row.label}-${i}`} row={row} first={i === 0} />
        ))}
      </div>
    </EvidenceBlock>
  );
}
