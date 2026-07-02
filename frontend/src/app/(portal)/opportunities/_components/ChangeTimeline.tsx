import { ClockCounterClockwise } from "@phosphor-icons/react";
import { PanelTimeline, type TimelineMilestone } from "@navanta-ai/design-system";
import type { OppEvent } from "@/types/opportunity";
import { fmtDay } from "@/lib/format";
import { EvidenceBlock } from "./EvidenceBlock";

/** Verb phrase per event kind — the light text that follows the actor. */
const KIND_PHRASE: Record<OppEvent["kind"], string> = {
  surfaced: "surfaced this opportunity",
  qualified: "assembled the evidence pack",
  committed: "committed the play",
  rejected: "rejected this opportunity",
  parked: "parked this opportunity",
  "stage-advanced": "advanced the stage",
  "drift-flagged": "flagged drift on this play",
  "drift-cleared": "cleared the drift",
  note: "added a note",
};

/** OppEvent → PanelTimeline milestone. Every surfacing event is a completed
 *  milestone; its reason is folded onto the date line since PanelTimeline only
 *  renders standalone notes for warning/critical events. */
function toMilestones(events: OppEvent[]): TimelineMilestone[] {
  return events.map((e, i) => {
    const day = fmtDay(e.at);
    const label =
      e.kind === "note" && e.note ? `${e.actor}: ${e.note}` : `${e.actor} ${KIND_PHRASE[e.kind]}`;
    return {
      id: `${e.at}-${i}`,
      label,
      status: "completed" as const,
      date: e.kind !== "note" && e.note ? `${day} · ${e.note}` : day,
      events: [],
    };
  });
}

/**
 * How this surfaced — the opportunity's origin event, rendered through the DS
 * PanelTimeline (the same audit-rail the vendor and tracking panels use) rather
 * than hand-rolled markup. Only the surfacing origin is shown; the rest of the
 * audit trail (qualified / commit / reject / park …) is intentionally omitted.
 */
export function ChangeTimeline({ events }: { events: OppEvent[] }) {
  const rows = events.filter((e) => e.kind === "surfaced");
  if (rows.length === 0) return null;

  return (
    <EvidenceBlock icon={ClockCounterClockwise} title="How this surfaced">
      {/* Neutral-dot marker (not the DS status check) — see .opp-surfaced-timeline
          in globals.css; a surfacing event is an origin marker, not a success. */}
      <div className="opp-surfaced-timeline">
        <PanelTimeline title="" idPrefix="opp-surfaced" milestones={toMilestones(rows)} />
      </div>
    </EvidenceBlock>
  );
}
