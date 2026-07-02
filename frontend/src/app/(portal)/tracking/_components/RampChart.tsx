"use client";

import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@navanta-ai/design-system";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { fmtCompact, fmtK } from "@/lib/format";
import { quarterKey, shortQuarter } from "@/lib/ramp";

const CHART_HEIGHT = 168; // px, bar area only

interface PeriodTotals {
  period: string;
  projected: number;
  realized: number;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-[8px] w-[8px] rounded-[2px]"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
        {label}
      </span>
    </span>
  );
}

interface BarProps {
  value: number;
  max: number;
  color: string;
  /** Accessible series name, e.g. "Projected 2027". */
  name: string;
}

function RampBar({ value, max, color, name }: BarProps) {
  const height =
    value > 0 ? Math.max(4, Math.round((value / max) * CHART_HEIGHT)) : 2;
  return (
    <div className="flex w-[44px] flex-col items-center justify-end gap-1">
      <span
        className="text-[11px] leading-none"
        style={{
          color: value > 0 ? "var(--text-secondary)" : "var(--text-neutral)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value > 0 ? fmtK(value) : "—"}
      </span>
      <div
        role="img"
        aria-label={`${name}: ${value > 0 ? fmtK(value) : "$0K"}`}
        className="w-full rounded-t-[8px]"
        style={{
          height,
          background: value > 0 ? color : "var(--border-default)",
        }}
      />
    </div>
  );
}

/**
 * "Savings ramp 2026–2029" — DS BarChart is single-series, so this is a
 * compact custom grouped chart (two bars per year): projected in the
 * chart-blue token, realized in success green, $K labels above each bar,
 * 12px secondary axis labels — visually consistent with the DS charts.
 * Aggregates live from every tracked play's ramp, so committing a new
 * opportunity from the feed moves the bars immediately.
 */
export function RampChart() {
  const { tracked, realizedYtdTotal } = useOpportunityStore();

  // Aggregate every play's quarterly ramp into absolute-quarter buckets, in
  // chronological order — so the x-axis spans the committed plays' actual timing,
  // starting at the earliest committed quarter (never a hardcoded calendar year).
  const totals = useMemo<PeriodTotals[]>(() => {
    const map = new Map<string, PeriodTotals>();
    for (const opp of tracked) {
      for (const r of opp.ramp ?? []) {
        const e = map.get(r.period) ?? { period: r.period, projected: 0, realized: 0 };
        e.projected += r.projected;
        e.realized += r.realized ?? 0;
        map.set(r.period, e);
      }
    }
    return [...map.values()].sort((a, b) => quarterKey(a.period) - quarterKey(b.period));
  }, [tracked]);

  const max = Math.max(1, ...totals.flatMap((t) => [t.projected, t.realized]));
  const fullRampProjected = totals.reduce((sum, t) => sum + t.projected, 0);
  const first = totals[0]?.period;
  const last = totals[totals.length - 1]?.period;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Savings ramp · quarterly</CardTitle>
        <CardDescription>
          Projected vs realized savings by quarter from each play&apos;s committed timing, aggregated
          across {tracked.length} committed {tracked.length === 1 ? "opportunity" : "opportunities"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <LegendDot color="var(--chart-2)" label="Projected" />
          <LegendDot color="var(--success)" label="Realized" />
        </div>

        <div className="overflow-x-auto">
          <div className="flex min-w-max flex-col gap-1">
            <div
              className="flex items-end gap-4 border-b pb-0"
              style={{ borderColor: "var(--border-light)", minHeight: CHART_HEIGHT + 18 }}
            >
              {totals.map((t) => (
                <div key={t.period} className="flex items-end gap-1">
                  <RampBar value={t.projected} max={max} color="var(--chart-2)" name={`Projected ${t.period}`} />
                  <RampBar value={t.realized} max={max} color="var(--success)" name={`Realized ${t.period}`} />
                </div>
              ))}
            </div>

            <div className="flex items-start gap-4">
              {totals.map((t) => (
                <span
                  key={t.period}
                  className="text-center text-xs"
                  style={{
                    width: 92, // two 44px bars + the 4px gap-1 between them
                    color: "var(--text-secondary)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {shortQuarter(t.period)}
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Realized to date {fmtCompact(realizedYtdTotal)} · ramp projects {fmtCompact(fullRampProjected)}
          {first ? ` across ${totals.length} quarters (${shortQuarter(first)}–${shortQuarter(last ?? first)})` : ""}.
          Realized fills once the ERP is connected.
        </p>
      </CardContent>
    </Card>
  );
}
