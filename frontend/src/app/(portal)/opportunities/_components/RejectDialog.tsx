"use client";

import { useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@navanta-ai/design-system";
import { Prohibit } from "@phosphor-icons/react";
import { ModalShell } from "@/components/ui/ModalShell";
import { usePanelDialog } from "@/lib/usePanelDialog";

/** Canned rejection reasons — model feedback for the sweep's fit screen. */
export const REJECT_REASONS = [
  "Non-negotiable counterparty (gov/utility)",
  "Intercompany spend",
  "OEM-locked sole source",
  "Already consolidated",
  "Plant constraint",
  "Data quality insufficient",
  "Other (specify)",
] as const;

const OTHER_REASON = "Other (specify)";

interface RejectDialogProps {
  open: boolean;
  oppId: string | null;
  onCancel: () => void;
  onConfirm: (reason: string, note?: string) => void;
}

/**
 * Rejection reason dialog. Built on the app's ModalShell (same pattern as
 * RunPlayModal / the review panel), elevated to z-[120] so it layers above the
 * open review ModalShell.
 */
export function RejectDialog({ open, oppId, onCancel, onConfirm }: RejectDialogProps) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const isOther = reason === OTHER_REASON;
  const canConfirm = reason !== "" && (!isOther || note.trim().length > 0);

  // The dialog only ever leaves via these two paths, so resetting here keeps
  // the form fresh for the next open without effect-driven state churn.
  const resetForm = () => {
    setReason("");
    setNote("");
  };

  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    const trimmed = note.trim();
    resetForm();
    onConfirm(reason, trimmed === "" ? undefined : trimmed);
  };

  usePanelDialog(open, handleCancel, oppId ? `Reject ${oppId}` : "Reject opportunity");

  return (
    <ModalShell
      open={open}
      onClose={handleCancel}
      elevated
      size="default"
      icon={Prohibit}
      iconColor="var(--danger)"
      title={oppId ? `Reject ${oppId}` : "Reject opportunity"}
      subtitle="Tunes Mercer's fit screen; stays visible under Rejected."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canConfirm} onClick={handleConfirm}>
            Reject opportunity
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
          Reason
        </span>
        <Select
          value={reason}
          onValueChange={(v) => {
            setReason(v);
            // A note typed for "Other" must not ride along with a canned
            // reason — it would land misattributed in the audit event.
            if (v !== OTHER_REASON) setNote("");
          }}
        >
          <SelectTrigger size="md">
            <SelectValue placeholder="Select a rejection reason" />
          </SelectTrigger>
          <SelectContent>
            {REJECT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isOther && (
        <Textarea
          label="Specify the reason"
          placeholder="What disqualifies this bucket?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
        />
      )}
    </ModalShell>
  );
}
