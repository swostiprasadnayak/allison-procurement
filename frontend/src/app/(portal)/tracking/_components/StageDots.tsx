"use client";

interface StageDotsProps {
  /** Dots filled, 0–3 (committed → in-execution → realized). */
  filled: number;
  /** Stage label rendered next to the dots, e.g. "In execution". */
  label: string;
  /** Drift-flagged opportunities tint the dots and label to the warning tone. */
  drift?: boolean;
}

/**
 * 3-dot stage progress, visually matched to the DS table status cells:
 * filled dots in `--success` (or `--warning` when the opportunity has drifted),
 * unfilled dots in the default border tone, 12px label alongside.
 */
export function StageDots({ filled, label, drift = false }: StageDotsProps) {
  const fillColor = drift ? "var(--warning)" : "var(--success)";
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-[7px] w-[7px] rounded-full"
            style={{ background: i < filled ? fillColor : "var(--border-default)" }}
          />
        ))}
      </div>
      <span
        className="whitespace-nowrap text-xs"
        style={{ color: drift ? "var(--warning)" : "var(--text-secondary)" }}
      >
        {label}
      </span>
    </div>
  );
}
