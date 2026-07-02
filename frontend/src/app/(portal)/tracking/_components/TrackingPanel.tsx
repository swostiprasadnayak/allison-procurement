"use client";

import { useState } from "react";
import {
  Button,
  DetailPanelShell,
  PanelInfoGrid,
  Progress,
  useToast,
} from "@navanta-ai/design-system";
import { CheckCircle, Database, Flask } from "@phosphor-icons/react";
import type { OppEvent, Opportunity } from "@/types/opportunity";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { fmtCompact, fmtDate, fmtK, fmtRange, pct } from "@/lib/format";
import { usePanelDialog } from "@/lib/usePanelDialog";
import { MercerBand, MercerStar } from "@/components/mercer";
import { riskColor, riskStatus, type RiskStatus } from "@/lib/risk";
import { committedMid, goLiveAction, realizedSum } from "./stage";

/** RAG realization-risk banner — level + one-line explanation (pace vs the clock). */
function RiskBanner({ risk }: { risk: RiskStatus }) {
  const c = riskColor(risk.level);
  const tint =
    risk.level === "red"
      ? "rgba(220,38,38,0.06)"
      : risk.level === "amber"
        ? "rgba(245,158,11,0.09)"
        : "rgba(16,185,129,0.08)";
  return (
    <div
      className="flex items-start gap-2.5 rounded-[10px] p-3"
      style={{ background: tint, border: `1px solid ${c}40` }}
    >
      <span
        className="mt-[3px] inline-block h-[10px] w-[10px] shrink-0 rounded-full"
        style={{ background: c }}
        aria-hidden="true"
      />
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
          Realization risk · {risk.label}
        </span>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {risk.detail}
        </p>
      </div>
    </div>
  );
}

interface TrackingPanelProps {
  /** Live opportunity from the store; null when the panel is closed. */
  opp: Opportunity | null;
  onClose: () => void;
}

const EVENT_KIND_LABELS: Record<OppEvent["kind"], string> = {
  surfaced: "Surfaced",
  qualified: "Qualified",
  committed: "Committed",
  rejected: "Rejected",
  parked: "Parked",
  "stage-advanced": "Stage advanced",
  "drift-flagged": "Drift flagged",
  "drift-cleared": "Drift cleared",
  note: "Note",
};

function eventDotColor(kind: OppEvent["kind"]): string {
  switch (kind) {
    case "committed":
    case "drift-cleared":
      return "var(--success)";
    case "drift-flagged":
      return "var(--warning)";
    case "rejected":
      return "var(--destructive)";
    case "parked":
      return "var(--text-neutral)";
    case "stage-advanced":
    case "qualified":
      return "var(--info)";
    default:
      return "var(--text-neutral)";
  }
}

/** Compact newest-first activity list built from the play's audit events. */
function ActivityList({ events }: { events: OppEvent[] }) {
  const ordered = [...events].reverse();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[14px] font-medium" style={{ color: "var(--text-primary)" }}>
        Activity
      </span>
      <ul
        className="overflow-hidden rounded-xl"
        style={{ background: "var(--surface-raised)" }}
      >
        {ordered.map((event, idx) => (
          <li
            key={`${event.kind}-${event.at}-${idx}`}
            className="flex flex-col gap-0.5 px-4 py-2.5"
            style={{
              borderBottom:
                idx < ordered.length - 1 ? "1px solid var(--border-default)" : "none",
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium">
                <span
                  className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{ background: eventDotColor(event.kind) }}
                  aria-hidden="true"
                />
                {event.actor === "Mercer" && <MercerStar size={10} />}
                <span className="truncate" style={{ color: "var(--text-primary)" }}>
                  {event.actor}
                </span>
                <span className="shrink-0" style={{ color: "var(--text-neutral)" }}>
                  · {EVENT_KIND_LABELS[event.kind]}
                </span>
              </span>
              <span
                className="shrink-0 text-[11px]"
                style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}
              >
                {fmtDate(event.at)}
              </span>
            </div>
            {event.note && (
              <p
                className="pl-[14px] text-xs leading-relaxed"
                style={{ color: "var(--text-secondary)" }}
              >
                {event.note}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Value Realization detail panel: drift triage (Mercer alert + actions),
 * commitment facts, realized-vs-target progress, milestone timeline and the
 * full audit trail, with stage advancement in the footer.
 */
export function TrackingPanel({ opp, onClose }: TrackingPanelProps) {
  const { advanceStage, regressStage, clearDrift, simulateSap, resetSap } = useOpportunityStore();
  const { addToast } = useToast();

  // Escape-to-close, focus management and dialog semantics for the portaled shell.
  usePanelDialog(Boolean(opp), onClose, opp ? `${opp.id} value realization` : undefined);

  // DetailPanelShell stays mounted and animates on `open` — keep the last
  // non-null play around so content doesn't vanish during the exit slide.
  // (React's "adjust state during render" pattern; converges in one pass.)
  const [lastOpp, setLastOpp] = useState<Opportunity | null>(null);
  if (opp && opp !== lastOpp) setLastOpp(opp);
  const view = opp ?? lastOpp;

  const handleClearDrift = (id: string, action: string) => {
    clearDrift(id, action);
    addToast(`Drift cleared · ${action}`, "success");
  };

  // Single lifecycle toggle: Not started ↔ Live. Reuses the store's stage
  // transitions (committed ↔ in-execution); realization is measured, not advanced.
  const handleGoLive = (o: Opportunity) => {
    const action = goLiveAction(o);
    if (!action) return;
    if (action.live) advanceStage(o.id);
    else regressStage(o.id);
    addToast(action.live ? `${o.id} marked live` : `${o.id} marked not started`, action.live ? "success" : "info");
  };

  const mid = view ? committedMid(view) : 0;
  const realized = view ? realizedSum(view) : 0;
  const progressPct = mid > 0 ? Math.min(100, (realized / mid) * 100) : 0;
  const risk = view ? riskStatus(view) : null;
  const goLive = view ? goLiveAction(view) : null;

  return (
    <DetailPanelShell
      open={Boolean(opp)}
      onClose={onClose}
      title={view?.id ?? ""}
      subtitle={view?.title}
      width={460}
      footer={
        view ? (
          <div className="flex w-full items-center justify-end gap-2">
            {goLive ? (
              <Button
                variant={goLive.live ? "primary" : "outline"}
                onClick={() => handleGoLive(view)}
              >
                {goLive.label}
              </Button>
            ) : (
              <span
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: "var(--success)" }}
              >
                <CheckCircle size={18} weight="duotone" color="var(--success)" />
                Closed
              </span>
            )}
          </div>
        ) : undefined
      }
    >
      {view && (
        <div className="flex flex-col gap-4">
          {/* RAG realization risk — pace vs the clock, with a plain-English read. */}
          {risk && risk.level !== "none" && <RiskBanner risk={risk} />}
          {view.drift?.flagged && (
            <>
              <MercerBand
                caption="Mercer recommends"
                headline={
                  view.drift.mercerAction ??
                  "Review the ramp against plan and re-baseline the opportunity"
                }
                actions={
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleClearDrift(view.id, "Revised ramp applied")}
                    >
                      Apply revised ramp
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleClearDrift(view.id, "Escalated to plant GM")}
                    >
                      Escalate
                    </Button>
                  </>
                }
              />
            </>
          )}

          <PanelInfoGrid
            title="Commitment"
            rows={[
              {
                label: "Committed savings",
                value: fmtRange(view.savingsLow, view.savingsHigh),
              },
              { label: "Addressable", value: fmtCompact(view.movableValue ?? view.addressableSpend) },
              // Operator's commitment facts, captured at commit (Act workspace).
              ...(view.committedBasis ? [{ label: "Basis", value: view.committedBasis }] : []),
              ...(view.committedTiming
                ? [{ label: "Expected timing", value: view.committedTiming }]
                : []),
              { label: "Owner", value: view.owner ?? "Maria Vance" },
              {
                label: "Committed on",
                value: view.committedAt ? fmtDate(view.committedAt) : "—",
              },
              {
                label: "Source",
                value: `Mercer sweep · confidence ${pct(view.confidencePct)} at commit`,
              },
            ]}
          />

          <div className="flex flex-col gap-2">
            <span
              className="text-[14px] font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              Realized vs target
            </span>
            {realized > 0 ? (
              <>
                <Progress
                  value={progressPct}
                  max={100}
                  variant={view.drift?.flagged ? "warning" : "success"}
                  size="md"
                />
                <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {fmtK(realized)} of {fmtK(mid)} target
                </span>
              </>
            ) : (
              // No fabricated realized value: show the committed target and be
              // honest that realized tracking is fed by the ERP once connected (§8.2).
              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                Committed target {fmtRange(view.savingsLow, view.savingsHigh)}.
              </span>
            )}
            {/* Where the realized number comes from — the ERP, measuring actual contract
                execution (not a Navanta estimate). Makes the data source explicit. */}
            <div
              className="mt-1 flex items-start gap-2 rounded-[8px] px-3 py-2"
              style={{ background: "var(--surface-raised)" }}
            >
              <Database size={14} weight="duotone" color="var(--text-neutral)" className="mt-[1px] shrink-0" />
              <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Realized savings are read from the <strong style={{ color: "var(--text-primary)" }}>ERP</strong> —
                as POs, goods receipts and invoices post against the awarded contract, actual spend is
                measured against the committed baseline. {realized > 0 ? "Live from SAP actuals." : "Populates once SAP actuals are connected."}
              </span>
            </div>
          </div>

          {/* DEMO — simulate an SAP posting so realization + RAG light up without
              real ERP data. In-memory only; a refresh resets it. */}
          <div
            className="flex flex-col gap-2 rounded-[10px] border border-dashed p-3"
            style={{ borderColor: "var(--border-default)", background: "var(--surface-raised)" }}
          >
            <div className="flex items-center gap-1.5">
              <Flask size={13} weight="duotone" style={{ color: "var(--text-neutral)" }} />
              <span
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--text-neutral)" }}
              >
                Demo · simulate SAP
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => simulateSap(view.id, "green")}>
                On track
              </Button>
              <Button size="sm" variant="outline" onClick={() => simulateSap(view.id, "amber")}>
                Behind
              </Button>
              <Button size="sm" variant="outline" onClick={() => simulateSap(view.id, "red")}>
                At risk
              </Button>
              <Button size="sm" variant="ghost" onClick={() => resetSap(view.id)}>
                Reset
              </Button>
            </div>
            <span className="text-[10px]" style={{ color: "var(--text-neutral)" }}>
              Injects sample realized actuals — not real ERP data.
            </span>
          </div>

          <ActivityList events={view.events} />
        </div>
      )}
    </DetailPanelShell>
  );
}
