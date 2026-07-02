"use client";

import { Tooltip } from "@navanta-ai/design-system";
import { Info } from "@phosphor-icons/react";

/**
 * KpiBreakdownProgressCard — a progress KPI in KpiBreakdownCard's clothes.
 *
 * The DS KpiProgressCard uses a title-left/value-right header that auto-
 * compacts (stacking and growing) at the widths our 5-up KPI rows actually
 * render at. This card mirrors KpiBreakdownCard's exact chrome instead —
 * vertical stack, token footprint (`--kpi-card-min-h/pad`), standard 14px
 * Info affordance — and slots the DS 7px progress bar between value and
 * subtitle, so the subtitle bottom-aligns with the breakdown cards beside it
 * and the card can never stretch the row.
 */

const DESTRUCTIVE_GRADIENT =
  "linear-gradient(to left, #DE1010 0%, rgba(222,16,16,0.4) 17.788%, rgba(222,16,16,0.4) 100%)";

export interface KpiBreakdownProgressCardProps {
  title: string;
  value: string;
  subtitle?: string;
  /** Standard info icon beside the title; pass a string to attach a tooltip. */
  info?: boolean | string;
  /** 0–100, clamped. */
  progress: number;
  tone?: "primary" | "success" | "warning" | "destructive";
  className?: string;
}

export function KpiBreakdownProgressCard({
  title,
  value,
  subtitle,
  info,
  progress,
  tone = "primary",
  className,
}: KpiBreakdownProgressCardProps) {
  const clamped = Math.min(100, Math.max(0, progress));
  const fillStyle: React.CSSProperties =
    tone === "destructive"
      ? { width: `${clamped}%`, backgroundImage: DESTRUCTIVE_GRADIENT }
      : {
          width: `${clamped}%`,
          backgroundColor:
            tone === "success"
              ? "var(--success)"
              : tone === "warning"
                ? "var(--warning)"
                : "var(--primary)",
        };

  const infoGlyph = (
    <span className="inline-flex h-[14px] shrink-0 items-center text-[var(--muted-foreground)] [&_svg]:block [&_svg]:size-[14px]">
      <Info size={14} weight="regular" aria-hidden={typeof info === "string" ? undefined : true} />
    </span>
  );

  return (
    <div
      className={`mx-auto flex min-h-[var(--kpi-card-min-h,128px)] w-full max-w-[320px] flex-col items-start justify-between rounded-[8px] bg-[var(--card)] p-[var(--kpi-card-pad,16px)] text-[var(--card-foreground)] shadow-[0px_0px_1px_0px_rgba(0,0,0,0.25),0px_1px_4px_0px_rgba(0,0,0,0.06)] ${className ?? ""}`}
    >
      <div className="flex w-full items-center gap-1">
        <p className="min-w-0 truncate text-[14px] font-semibold leading-[22px] text-[var(--foreground)]">
          {title}
        </p>
        {info != null && info !== false && (
          <span aria-label={typeof info === "string" ? info : undefined}>
            {typeof info === "string" ? <Tooltip content={info}>{infoGlyph}</Tooltip> : infoGlyph}
          </span>
        )}
      </div>

      <p
        className="text-[22px] font-semibold leading-[1.14] tracking-[-0.02em] text-[var(--foreground)]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>

      <div
        className="h-[7px] w-full overflow-hidden rounded-[100px] bg-[#E0E0E0]"
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-l-[2px] rounded-r-[100px] transition-[width]"
          style={fillStyle}
        />
      </div>

      {subtitle && (
        <p className="w-full truncate text-[13px] leading-[18px] text-[var(--muted-foreground)]">
          {subtitle}
        </p>
      )}
    </div>
  );
}
