import type { PillProps, TimelineMilestone } from "@navanta-ai/design-system";
import { fmtDay } from "@/lib/format";
import type {
  DataReliability,
  Vendor,
  VendorEntity,
  VendorEvent,
  VendorRole,
  VendorStatus,
  VendorType,
} from "@/types/vendor";

/** Humanized vendor-type labels (the 12px secondary line under the name). */
export const TYPE_LABELS: Record<VendorType, string> = {
  manufacturer: "Manufacturer",
  distributor: "Distributor",
  "service-provider": "Service provider",
  "managed-service": "Managed service",
  utility: "Utility",
  government: "Government",
};

/** Label a vendor type, falling back to an em-dash when the engine left it
 *  unknown (no guessed "Distributor" placeholder). */
export function typeLabel(type: VendorType | undefined): string {
  return type ? TYPE_LABELS[type] : "—";
}

export const STATUS_LABELS: Record<VendorStatus, string> = {
  active: "Active",
  preferred: "Preferred",
  "consolidation-target": "Consolidation target",
  "exit-planned": "Exit planned",
};

export const STATUS_PILL_VARIANT: Record<VendorStatus, PillProps["variant"]> = {
  preferred: "info",
  "consolidation-target": "warning",
  "exit-planned": "danger",
  active: "neutral",
};

/** Real role across the plays (opp.opportunity_vendor) — replaces the fake status. */
export const ROLE_LABELS: Record<VendorRole, string> = {
  winner: "Winner / incumbent",
  oem: "OEM / sole-source",
  strategic: "Strategic / broad-line",
  leverage: "Leverage",
  consolidate: "Consolidate (fold)",
  tail: "Tail / exit",
  none: "Not in an opportunity",
};

export const ROLE_PILL_VARIANT: Record<VendorRole, PillProps["variant"]> = {
  winner: "info",
  oem: "warning",
  strategic: "info",
  leverage: "neutral",
  consolidate: "warning",
  tail: "danger",
  none: "neutral",
};

/** Performance color — higher is better: ≥80 green, 60–79 amber, <60 red. */
export function perfColor(score: number): string {
  if (score >= 80) return "var(--success)";
  if (score >= 60) return "var(--warning)";
  return "var(--destructive)";
}

export const ENTITY_PILL_VARIANT: Record<VendorEntity, PillProps["variant"]> = {
  AT: "info",
  AOH: "warning",
  Both: "neutral",
};

export const RELIABILITY_LABELS: Record<DataReliability, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Composite / criterion score color: ≥75 green, 50–74 amber, <50 red. */
export function scoreColor(score: number): string {
  if (score >= 75) return "var(--success)";
  if (score >= 50) return "var(--warning)";
  return "var(--destructive)";
}

/** "Net 60" | "— no data" — matches the store's audit-event formatting. */
export function termsLabel(days: number | null): string {
  return days === null ? "— no data" : `Net ${days}`;
}

/** "14d" | "—" — matches the store's audit-event formatting. */
export function leadLabel(days: number | null): string {
  return days === null ? "—" : `${days}d`;
}

// Timezone-safe date formatters now live in lib/format for app-wide use;
// re-exported here so existing vendor imports keep working.
export { fmtDay, fmtDate } from "@/lib/format";

const EVENT_KIND_LABELS: Record<VendorEvent["kind"], string> = {
  "lead-time-updated": "Lead time updated",
  "terms-updated": "Payment terms updated",
  "status-changed": "Status updated",
  "category-changed": "Category updated",
  "score-recomputed": "Data confidence recomputed",
  note: "Note",
  "mercer-flag": "Mercer flag",
};

const FIELD_LABELS: Record<string, string> = {
  leadTimeDays: "Lead time",
  leadTimeTrend: "Lead-time trend",
  paymentTermsDays: "Payment terms",
  status: "Status",
  category: "Category",
  notes: "Notes",
  contractExpiry: "Contract expiry",
};

/**
 * Audit log → PanelTimeline milestones, chronological top-to-bottom. Every
 * event renders as a completed milestone; change events carry a
 * "Lead time 14d → 42d" detail on the date line; Mercer flags nest an
 * unresolved warning event so the note renders amber.
 */
export function historyMilestones(vendor: Vendor): TimelineMilestone[] {
  return vendor.events.map((event, i) => {
    const day = fmtDay(event.at);
    const detail = event.change
      ? `${FIELD_LABELS[event.change.field] ?? event.change.field} ${event.change.from} → ${event.change.to}`
      : event.note;
    const isFlag = event.kind === "mercer-flag";

    return {
      id: `${vendor.id}-ev-${i}`,
      label: `${EVENT_KIND_LABELS[event.kind]} · ${event.actor}`,
      status: "completed" as const,
      date: isFlag || !detail ? day : `${day} · ${detail}`,
      events: isFlag
        ? [
            {
              type: "flag",
              date: day,
              severity: "warning" as const,
              note: event.note ?? "Mercer flagged this vendor",
              resolved: false,
            },
          ]
        : [],
    };
  });
}
