"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChartLineUp, Lightning, Users } from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useVendorStore } from "@/context/VendorStoreContext";
import { fmtCompact, fmtM, pct } from "@/lib/format";
import { atRiskTotal } from "@/lib/risk";

/**
 * The homepage's summary-of-summaries: three roll-up cards that mirror the
 * working surfaces (Opportunities · Value Realization · Vendors), each a
 * headline + a few live stats + a drill-in. The Command Center reads the whole
 * program at a glance; the depth lives on the linked pages.
 */

function SummaryCard({
  icon: SummaryIcon,
  title,
  href,
  linkLabel,
  headline,
  sub,
  rows,
}: {
  icon: Icon;
  title: string;
  href: string;
  linkLabel: string;
  headline: string;
  sub: string;
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <div
      className="flex flex-col rounded-xl p-4"
      style={{ background: "var(--surface-base,#fff)", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SummaryIcon size={16} weight="duotone" style={{ color: "#59349C" }} />
          <span className="text-[14px] font-semibold" style={{ color: "var(--text-primary)" }}>
            {title}
          </span>
        </div>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[11px] font-medium transition-colors hover:brightness-95"
          style={{ color: "#59349C" }}
        >
          {linkLabel} <ArrowRight size={11} weight="bold" />
        </Link>
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[26px] font-semibold leading-none" style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
          {headline}
        </span>
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          {sub}
        </span>
      </div>

      <div className="mt-3 flex flex-col">
        {rows.map((r, i) => (
          <div
            key={r.label}
            className="flex items-center justify-between py-1.5 text-[12px]"
            style={{ borderTop: i === 0 ? "none" : "1px solid var(--border-light)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{r.label}</span>
            <span style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", fontWeight: 500 }}>
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProgramSummaryCards() {
  const { feed, parked, rejected, tracked, committedMidTotal, realizedYtdTotal } =
    useOpportunityStore();
  const { vendors, totalSpend, overlapCount, avgScore } = useVendorStore();

  // Opportunities — lifecycle distribution across statuses.
  const totalOpps = feed.length + parked.length + rejected.length + tracked.length;

  // Value — status counts + $ at risk (committed value of drift-flagged plays).
  const inExecution = tracked.filter((o) => o.status === "in-execution").length;
  const realizedCount = tracked.filter((o) => o.status === "realized").length;
  const realizedShare = committedMidTotal > 0 ? pct((realizedYtdTotal / committedMidTotal) * 100) : "0%";
  const risk = atRiskTotal(tracked); // RAG amber+red — same logic as the Value Realization page

  // Suppliers — top-10 concentration (fragmentation read); replaces the
  // missing-payment-terms metric, which is a source-file gap, not a signal.
  const top10Share =
    totalSpend > 0
      ? ([...vendors].sort((a, b) => b.annualSpend - a.annualSpend).slice(0, 10).reduce((s, v) => s + v.annualSpend, 0) /
          totalSpend) *
        100
      : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <SummaryCard
        icon={Lightning}
        title="Opportunities"
        href="/opportunities"
        linkLabel="Triage feed"
        headline={String(totalOpps)}
        sub="opportunities"
        rows={[
          { label: "In feed (awaiting triage)", value: feed.length },
          { label: "Committed", value: tracked.length },
          { label: "Parked", value: parked.length },
          { label: "Rejected", value: rejected.length },
        ]}
      />

      <SummaryCard
        icon={ChartLineUp}
        title="Value realization"
        href="/tracking"
        linkLabel="Track value"
        headline={fmtCompact(committedMidTotal)}
        sub={`${tracked.length} ${tracked.length === 1 ? "play" : "plays"}`}
        rows={[
          { label: "Realized YTD", value: `${fmtCompact(realizedYtdTotal)} · ${realizedShare}` },
          { label: "In execution", value: `${inExecution} ${inExecution === 1 ? "play" : "plays"}` },
          { label: "Realized", value: `${realizedCount} ${realizedCount === 1 ? "play" : "plays"}` },
          {
            label: "At risk",
            value: (
              <span style={{ color: risk.count > 0 ? "var(--warning)" : "var(--text-secondary)" }}>
                {risk.count > 0
                  ? `${fmtCompact(risk.value)} · ${risk.count} ${risk.count === 1 ? "play" : "plays"}`
                  : "None at risk"}
              </span>
            ),
          },
        ]}
      />

      <SummaryCard
        icon={Users}
        title="Suppliers"
        href="/vendors"
        linkLabel="Manage vendors"
        headline={vendors.length ? vendors.length.toLocaleString("en-US") : "—"}
        sub={`${fmtM(totalSpend)} managed`}
        rows={[
          { label: "Shared AT + AOH", value: overlapCount.toLocaleString("en-US") },
          { label: "Top-10 vendor share", value: vendors.length ? `${top10Share.toFixed(0)}%` : "—" },
          { label: "Avg data confidence", value: avgScore ? String(avgScore) : "—" },
        ]}
      />
    </div>
  );
}
