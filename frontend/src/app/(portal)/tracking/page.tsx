"use client";

import { useState } from "react";
import { Button, EmptyState } from "@navanta-ai/design-system";
import { ChartLineUp, Flask } from "@phosphor-icons/react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { TrackingKpis } from "./_components/TrackingKpis";
import { RampChart } from "./_components/RampChart";
import { TrackingTable } from "./_components/TrackingTable";
import { TrackingPanel } from "./_components/TrackingPanel";

export default function TrackingPage() {
  const { opportunities, tracked, postQuarterActuals, resetSap } = useOpportunityStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Resolve the selected play live from the store so drift clears, stage
  // advances and event appends reflect in the open panel immediately. A play
  // can only leave the tracked set via undoCommit (not possible from this
  // page), so the panel never strands on a stale row.
  const selected =
    selectedId !== null
      ? opportunities.find((o) => o.id === selectedId && o.committedAt) ?? null
      : null;

  return (
    <>
      {tracked.length === 0 ? (
        <div
          className="rounded-xl border bg-[var(--card)] py-10"
          style={{ borderColor: "var(--border-light)" }}
        >
          <EmptyState
            icon={<ChartLineUp weight="duotone" />}
            title="Nothing committed yet"
            description="Commit opportunities from the feed to start tracking realization."
            link={{ label: "Open the opportunity feed", href: "/opportunities" }}
          />
        </div>
      ) : (
        <>
          {/* DEMO — walk realization forward without real ERP data (in-memory). */}
          <div
            className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed px-3 py-2"
            style={{ borderColor: "var(--border-default)", background: "var(--surface-raised)" }}
          >
            <span
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: "var(--text-neutral)" }}
            >
              <Flask size={13} weight="duotone" /> Demo · simulate SAP
            </span>
            <Button size="sm" variant="outline" onClick={postQuarterActuals}>
              Post next quarter
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resetSap()}>
              Reset actuals
            </Button>
            <span className="text-[10px]" style={{ color: "var(--text-neutral)" }}>
              Fills each live play&apos;s next quarter on-pace — not real ERP data.
            </span>
          </div>

          <TrackingKpis />
          <RampChart />
          <TrackingTable onRowClick={(opp) => setSelectedId(opp.id)} />
        </>
      )}

      <TrackingPanel opp={selected} onClose={() => setSelectedId(null)} />
    </>
  );
}
