import type { ReactNode } from "react";
import type { Icon } from "@phosphor-icons/react";

/** IRIS FactorTable weight-bar gradient — shared by every share/impact bar. */
export const BAR_GRADIENT = "linear-gradient(to right, #89A9E5, #234687)";

interface EvidenceBlockProps {
  /** Phosphor icon component (rendered duotone, 16px). */
  icon: Icon;
  title: string;
  iconColor?: string;
  /** Right-aligned slot in the header row (e.g. an unsaved-changes chip). */
  headerRight?: ReactNode;
  /** Muted note pinned below the body, on its own top border. */
  footnote?: ReactNode;
  /** Action row on the sunken surface below the body (e.g. Save / Regenerate). */
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Titled white card with a duotone icon header — the modal's "DataTable inside
 * a Card" chrome, lifted out of ReviewPanel so the entity-comparison and
 * vendor-roster tables and the new analysis cards (functional fit, confidence
 * math, savings waterfall, your input) all read as the same labelled block.
 */
export function EvidenceBlock({
  icon: TitleIcon,
  title,
  iconColor = "#181A1B",
  headerRight,
  footnote,
  footer,
  children,
}: EvidenceBlockProps) {
  return (
    <div
      className="overflow-hidden rounded-[12px]"
      style={{ background: "#FFFFFF", border: "1px solid var(--border-light)" }}
    >
      <div className="flex items-center gap-2 px-3 pt-3 pb-1">
        <TitleIcon size={16} weight="duotone" color={iconColor} />
        <span className="text-[14px] font-medium" style={{ color: "#181A1B" }}>
          {title}
        </span>
        {headerRight && <div className="ml-auto flex items-center">{headerRight}</div>}
      </div>
      <div className="px-3 pb-3">{children}</div>
      {footnote && (
        <div
          className="px-3 py-2 text-xs"
          style={{ color: "var(--text-secondary)", borderTop: "1px solid var(--border-light)" }}
        >
          {footnote}
        </div>
      )}
      {footer && (
        <div
          className="px-3 py-2.5"
          style={{ borderTop: "1px solid var(--border-light)", background: "var(--surface-raised)" }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
