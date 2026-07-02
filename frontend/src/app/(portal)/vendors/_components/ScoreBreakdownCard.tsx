"use client";

import type { ScoreCriterion } from "@/types/vendor";
import { scoreColor } from "./vendorMeta";

interface ScoreBreakdownCardProps {
  /** The weighted data-confidence criteria, in breakdown order. */
  breakdown: ScoreCriterion[];
  /** Composite (Σ weight × score, rounded) — the header number. */
  composite: number;
}

/**
 * Data-confidence breakdown card — composite header plus one row per criterion:
 * label (+ optional 11px note), weight "×0.40", mini progress bar, score. This is
 * a measure of how complete our data is on the vendor, NOT a performance score.
 * Colors follow the roster rule: ≥75 green, 50–74 amber, <50 red.
 */
export function ScoreBreakdownCard({ breakdown, composite }: ScoreBreakdownCardProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-medium text-[var(--text-primary)]">Data confidence</span>
      <div
        className="flex flex-col rounded-xl border p-4"
        style={{ borderColor: "var(--border-default)" }}
      >
        <div
          className="flex items-baseline justify-between border-b pb-3"
          style={{ borderColor: "var(--border-light)" }}
        >
          <span className="text-[13px] text-[var(--text-secondary)]">Composite</span>
          <span className="flex items-baseline gap-1">
            <span
              className="text-[20px] font-semibold leading-none"
              style={{ color: scoreColor(composite), fontVariantNumeric: "tabular-nums" }}
            >
              {composite}
            </span>
            <span className="text-[12px] text-[var(--text-secondary)]">/ 100</span>
          </span>
        </div>

        <div className="flex flex-col gap-3 pt-3">
          {breakdown.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <div className="flex w-[150px] shrink-0 flex-col">
                <span className="text-[12px] leading-snug text-[var(--text-primary)]">
                  {c.label}
                </span>
                {c.note && (
                  <span className="text-[11px] leading-snug text-[var(--text-secondary)]">
                    {c.note}
                  </span>
                )}
              </div>
              <span
                className="w-[38px] shrink-0 text-[11px] text-[var(--text-secondary)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                ×{c.weight.toFixed(2)}
              </span>
              <span
                className="block h-1.5 min-w-0 flex-1 overflow-hidden rounded-full"
                style={{ background: "var(--border-light)" }}
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={c.score}
                aria-label={`${c.label} ${c.score} of 100`}
              >
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${Math.max(0, Math.min(100, c.score))}%`,
                    background: scoreColor(c.score),
                    transition: "width 200ms ease-out",
                  }}
                />
              </span>
              <span
                className="w-7 shrink-0 text-right text-[12px] font-medium text-[var(--text-primary)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {c.score}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
