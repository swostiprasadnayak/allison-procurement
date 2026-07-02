import type { ReactNode } from "react";

/**
 * CellText — the standard two-line table cell: a primary body line with a
 * secondary label line underneath. Use inside DataTable columns with
 * `cellLayout: "col"` (the layout stacks the fragment's children).
 *
 * This standardizes the stack we previously hand-rolled per table
 * (13px primary / 12px secondary, consistent colors and line heights).
 * Candidate for upstreaming into @navanta-ai/design-system — the DataTable
 * documents the `col` layout but ships no content component for it.
 */
export interface CellTextProps {
  primary: ReactNode;
  /** Label line under the body text — omitted cleanly when empty. */
  secondary?: ReactNode;
  /** Primary line weight — "medium" (default) for identity columns,
   *  "regular" for descriptive ones. */
  primaryWeight?: "medium" | "regular";
}

export function CellText({ primary, secondary, primaryWeight = "medium" }: CellTextProps) {
  return (
    <>
      <span
        className={`text-[13px] leading-snug ${primaryWeight === "medium" ? "font-medium" : "font-normal"}`}
        style={{ color: "var(--text-primary)" }}
      >
        {primary}
      </span>
      {secondary != null && secondary !== "" && (
        <span className="text-xs leading-snug" style={{ color: "var(--text-secondary)" }}>
          {secondary}
        </span>
      )}
    </>
  );
}
