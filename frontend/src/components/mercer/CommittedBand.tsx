"use client";

import { Button } from "@navanta-ai/design-system";
import { ArrowCounterClockwise, CheckCircle } from "@phosphor-icons/react";

interface CommittedBandProps {
  /** Success headline, e.g. "OPP-002 committed · tracking in Value Realization". */
  headline: string;
  /** Secondary line, e.g. "Owner Maria Vance · default milestones generated". */
  sub?: string;
  /** Undo the commit — restores the prior feed status. */
  onUndo: () => void;
}

/**
 * The green commit-success band that replaces the lavender MercerBand after a
 * commit. The CALLER wraps this in `.mercer-commit-success` so the entrance
 * animation fires on swap; the CheckCircle pops via `.mercer-check-burst`.
 */
export function CommittedBand({ headline, sub, onUndo }: CommittedBandProps) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg p-3"
      style={{
        background: "linear-gradient(to right, #D6F5E2 0%, #F3FAF6 100%)",
        borderTop: "1px solid #CCCCFF",
      }}
    >
      <span className="mercer-check-burst mt-0.5 inline-flex">
        <CheckCircle size={22} weight="duotone" color="#008234" />
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium leading-snug" style={{ color: "#181A1B" }}>
          {headline}
        </p>
        {sub && (
          <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {sub}
          </p>
        )}
      </div>

      <Button
        size="sm"
        variant="outline"
        onClick={onUndo}
        iconLeft={<ArrowCounterClockwise size={14} />}
      >
        Undo
      </Button>
    </div>
  );
}
