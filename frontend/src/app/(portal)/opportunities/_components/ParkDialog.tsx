"use client";

import { useState } from "react";
import {
  Button,
  DatePicker,
  SegmentedControl,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@navanta-ai/design-system";
import { PauseCircle } from "@phosphor-icons/react";
import { ModalShell } from "@/components/ui/ModalShell";
import { usePanelDialog } from "@/lib/usePanelDialog";

/** Common revisit conditions — the qualitative trigger that resurfaces a park. */
export const PARK_CONDITIONS = [
  "Contract renewal",
  "Next budget cycle",
  "Price movement >5%",
  "Supplier consolidation elsewhere",
  "Volume threshold reached",
  "Other (specify)",
] as const;

const OTHER_CONDITION = "Other (specify)";

type TriggerType = "date" | "condition";

interface ParkDialogProps {
  open: boolean;
  oppId: string | null;
  onCancel: () => void;
  onConfirm: (trigger: string) => void;
}

/** Local YYYY-MM-DD (no timezone shift from toISOString). */
function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Park dialog — captures the revisit trigger (a date OR a condition) that
 * resurfaces a parked opportunity. Built on the app's ModalShell (same pattern
 * as RunPlayModal / the review panel), elevated to z-[120] so it layers above
 * the open review ModalShell.
 */
export function ParkDialog({ open, oppId, onCancel, onConfirm }: ParkDialogProps) {
  const [triggerType, setTriggerType] = useState<TriggerType>("date");
  const [date, setDate] = useState<Date | null>(null);
  const [condition, setCondition] = useState("");
  const [otherText, setOtherText] = useState("");

  const isOther = condition === OTHER_CONDITION;
  const canConfirm =
    triggerType === "date"
      ? date !== null
      : condition !== "" && (!isOther || otherText.trim().length > 0);

  // The composed human-readable trigger string.
  const composedTrigger =
    triggerType === "date"
      ? date
        ? toIsoDate(date)
        : ""
      : isOther
        ? otherText.trim()
        : condition;

  // The dialog only ever leaves via these two paths, so resetting here keeps
  // the form fresh for the next open without effect-driven state churn.
  const resetForm = () => {
    setTriggerType("date");
    setDate(null);
    setCondition("");
    setOtherText("");
  };

  const handleCancel = () => {
    resetForm();
    onCancel();
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    const trigger = composedTrigger;
    resetForm();
    onConfirm(trigger);
  };

  usePanelDialog(open, handleCancel, oppId ? `Park ${oppId}` : "Park opportunity");

  return (
    <ModalShell
      open={open}
      onClose={handleCancel}
      elevated
      overflowVisible
      size="default"
      icon={PauseCircle}
      iconColor="var(--warning)"
      title={oppId ? `Park ${oppId}` : "Park opportunity"}
      subtitle="Resurfaces when its revisit trigger fires."
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canConfirm} onClick={handleConfirm}>
            Park opportunity
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
          Revisit trigger
        </span>
        <SegmentedControl
          size="md"
          fullWidth
          value={triggerType}
          onValueChange={(v) => setTriggerType(v as TriggerType)}
          options={[
            { value: "date", label: "Date" },
            { value: "condition", label: "Condition" },
          ]}
          aria-label="Revisit trigger type"
        />
      </div>

      {triggerType === "date" ? (
        <DatePicker
          label="Revisit on"
          placeholder="Select a revisit date"
          value={date}
          onChange={setDate}
          size="md"
        />
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
              Condition
            </span>
            <Select
              value={condition}
              onValueChange={(v) => {
                setCondition(v);
                // Free text only rides along with "Other" — clear it otherwise
                // so it never lands misattributed on a canned condition.
                if (v !== OTHER_CONDITION) setOtherText("");
              }}
            >
              <SelectTrigger size="md">
                <SelectValue placeholder="Select a revisit condition" />
              </SelectTrigger>
              <SelectContent>
                {PARK_CONDITIONS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isOther && (
            <Textarea
              label="Specify the condition"
              placeholder="What should resurface this bucket?"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              rows={3}
            />
          )}
        </>
      )}
    </ModalShell>
  );
}
