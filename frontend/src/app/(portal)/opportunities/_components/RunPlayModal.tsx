"use client";

import { useEffect, useState } from "react";
import { Button } from "@navanta-ai/design-system";
import { Check, Lightning } from "@phosphor-icons/react";
import type { Opportunity } from "@/types/opportunity";
import { useVendorStore } from "@/context/VendorStoreContext";
import { ConfidenceMeter } from "@/components/mercer";
import { ModalShell } from "@/components/ui/ModalShell";
import { usePanelDialog } from "@/lib/usePanelDialog";
import { ActStep } from "./ActStep";

interface RunPlayModalProps {
  opp: Opportunity | null;
  open: boolean;
  onClose: () => void;
  onCommit: (meta: { timing?: string; basis?: string }) => void;
}

/**
 * "Run the play" modal — opened from a row on the opportunities feed's Act tab.
 * Wraps the ActStep workspace (playbook · checklist · Mercer drafts) and commits
 * the value, which hands the opportunity off to Value Realization (Monitor).
 */
export function RunPlayModal({ opp, open, onClose, onCommit }: RunPlayModalProps) {
  const { vendors } = useVendorStore();
  usePanelDialog(open && Boolean(opp), onClose, opp ? `Run ${opp.id}` : undefined);

  // Freeze the opp while closing so the exit slide never flickers.
  const [snapshot, setSnapshot] = useState<Opportunity | null>(null);
  if (open && opp && snapshot !== opp) setSnapshot(opp);
  const view = open ? opp : (snapshot ?? opp);

  // Commit inputs live here (owned by the modal) so both the ActStep body and
  // the footer's Commit button share them; reset when a different play opens.
  const [timing, setTiming] = useState("");
  const [basis, setBasis] = useState("");
  useEffect(() => {
    setTiming("");
    setBasis("");
  }, [opp?.id]);

  const anchorName = view?.consolidatedSide.anchorVendorId
    ? vendors.find((v) => v.id === view.consolidatedSide.anchorVendorId)?.name
    : undefined;

  const footer = view ? (
    <div className="flex items-center gap-2">
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
      <div className="flex-1" />
      <Button
        variant="christy"
        iconLeft={<Check size={14} weight="bold" />}
        onClick={() => onCommit({ timing, basis })}
      >
        Commit value
      </Button>
    </div>
  ) : null;

  return (
    <ModalShell
      open={open && !!opp}
      onClose={onClose}
      title={view?.id ?? ""}
      subtitle={view?.title}
      icon={Lightning}
      size="deck"
      headerMeta={
        view ? (
          <>
            <span
              className="rounded-[4px] px-2 py-0.5 text-[12px]"
              style={{ background: "var(--muted)", color: "var(--text-primary)" }}
            >
              {view.l2} · {view.country}
            </span>
            <ConfidenceMeter pct={view.confidencePct} size="md" />
          </>
        ) : undefined
      }
      footer={footer}
    >
      {view ? (
        <ActStep
          key={view.id}
          opp={view}
          anchorVendorName={anchorName}
          timing={timing}
          basis={basis}
          onTimingChange={setTiming}
          onBasisChange={setBasis}
        />
      ) : null}
    </ModalShell>
  );
}
