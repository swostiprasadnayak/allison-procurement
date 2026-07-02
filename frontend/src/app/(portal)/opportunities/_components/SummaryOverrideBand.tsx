"use client";

import { ArrowsClockwise } from "@phosphor-icons/react";
import { Button, Input } from "@navanta-ai/design-system";
import type { SavingsResolution } from "@/lib/savings";
import { fmtRange, fmtUSD, pct } from "@/lib/format";

interface SummaryOverrideBandProps {
  addressable: string;
  savingsPct: string;
  onAddressableChange: (v: string) => void;
  onSavingsPctChange: (v: string) => void;
  baseAddressable: number;
  baseLowPct: number;
  baseHighPct: number;
  /** Savings resolved from the live draft. */
  preview: SavingsResolution;
  addressableValid: boolean;
  savingsPctValid: boolean;
  /** Apply is blocked when invalid or unchanged from what's already saved. */
  applyDisabled: boolean;
  onCancel: () => void;
  onApply: () => void;
}

/**
 * The inline override editor — adapted from the IRIS DemandDeck OverrideBand.
 * Swaps in for the Mercer recommendation band when the operator clicks
 * "Override figures", keeping the same lavender gradient so it reads as the
 * same surface. Two figure inputs (addressable $, conservative savings rate)
 * with the workbook values as hints, a live re-derivation preview, and
 * Cancel / Apply. Applying writes the override to the store; from there it
 * flows into the savings waterfall and the committed figure.
 */
export function SummaryOverrideBand({
  addressable,
  savingsPct,
  onAddressableChange,
  onSavingsPctChange,
  baseAddressable,
  baseLowPct,
  baseHighPct,
  preview,
  addressableValid,
  savingsPctValid,
  applyDisabled,
  onCancel,
  onApply,
}: SummaryOverrideBandProps) {
  const overriding = preview.basis === "override";
  return (
    <div
      className="flex flex-col gap-3 p-3"
      style={{ background: "linear-gradient(to right, #EBDFFF 72%, #F3ECFE 100%)" }}
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium" style={{ color: "#181A1B" }}>
          Override Mercer&apos;s figures
        </span>
        <span className="text-xs leading-relaxed" style={{ color: "#52525C" }}>
          Replace the workbook figures with your own. They flow into the savings derivation and the
          number you commit — logged against the workbook baseline.
        </span>
      </div>

      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-[160px] flex-1">
          <Input
            label="Addressable spend"
            type="text"
            inputMode="numeric"
            iconLeft={<span style={{ color: "#52525C" }}>$</span>}
            // Display with thousands separators; strip them (and any stray
            // non-digits) back to a plain numeric string on change so
            // parseOverrideDraft still reads it as a number on save.
            value={addressable === "" ? "" : Number(addressable).toLocaleString("en-US")}
            onChange={(e) => onAddressableChange(e.target.value.replace(/[^\d]/g, ""))}
            placeholder={baseAddressable.toLocaleString("en-US")}
            helperText={`Workbook: ${fmtUSD(baseAddressable)}`}
            error={addressableValid ? undefined : "Enter a non-negative number"}
            clearable
            onClear={() => onAddressableChange("")}
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <Input
            label="Savings rate %"
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={savingsPct}
            onChange={(e) => onSavingsPctChange(e.target.value)}
            placeholder={baseLowPct.toFixed(1)}
            helperText={`Workbook: ${pct(baseLowPct)}–${pct(baseHighPct)}`}
            error={savingsPctValid ? undefined : "Enter a rate between 0 and 100"}
            clearable
            onClear={() => onSavingsPctChange("")}
          />
        </div>
      </div>

      {overriding && addressableValid && savingsPctValid && (
        <div
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px]"
          style={{ background: "#FFFFFF", color: "#59349C" }}
        >
          <ArrowsClockwise size={13} weight="bold" />
          <span>
            Re-derives savings to{" "}
            <span style={{ fontWeight: 600 }}>{fmtRange(preview.low, preview.high)}</span> ·{" "}
            {pct(preview.lowPct)}–{pct(preview.highPct)} on {fmtUSD(preview.addressable)}
          </span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="christy" size="sm" onClick={onApply} disabled={applyDisabled}>
          Apply override
        </Button>
      </div>
    </div>
  );
}
