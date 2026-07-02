import { Progress } from "@navanta-ai/design-system";

interface ConfidenceMeterProps {
  /** Confidence percentage, 0–100. */
  pct: number;
  /** "sm" = 64px track (table rows), "md" = 96px track (panels). */
  size?: "sm" | "md";
}

/**
 * Confidence is independent of dollar size — a small clean opportunity outranks
 * a huge messy one — so the meter color encodes trust, not value:
 * ≥60 success (green), 30–59 warning (amber), <30 neutral.
 */
function variantFor(pct: number): "success" | "warning" | "neutral" {
  if (pct >= 60) return "success";
  if (pct >= 30) return "warning";
  return "neutral";
}

/**
 * Compact confidence bar + percentage label. The bar is the DS `Progress`
 * component (gradient fill, track token, progressbar semantics) constrained to
 * the table/panel track width; the label keeps the app's table convention
 * (primary, medium, tabular-nums) rather than Progress's muted mono `showLabel`.
 */
export function ConfidenceMeter({ pct, size = "sm" }: ConfidenceMeterProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const trackWidth = size === "md" ? 96 : 64;

  return (
    <span className="inline-flex items-center gap-2">
      <Progress
        value={clamped}
        variant={variantFor(clamped)}
        size={size}
        aria-label={`Confidence ${clamped}%`}
        style={{ width: trackWidth }}
      />
      <span
        className={size === "md" ? "text-sm font-medium" : "text-xs font-medium"}
        style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-primary)" }}
      >
        {clamped}%
      </span>
    </span>
  );
}
