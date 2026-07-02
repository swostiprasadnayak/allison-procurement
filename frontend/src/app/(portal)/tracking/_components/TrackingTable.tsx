"use client";

import { useMemo, useState } from "react";
import {
  DataTable,
  type DataTableColumn,
  EmptyState,
  type FilterFacet,
  type TabItem,
  TableShell,
} from "@navanta-ai/design-system";
import { ChartLineUp } from "@phosphor-icons/react";
import type { Opportunity } from "@/types/opportunity";
import { CellText } from "@/components/ui/CellText";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useScope } from "@/context/ScopeContext";
import { fmtRange } from "@/lib/format";
import { riskColor, riskStatus } from "@/lib/risk";
import { isLive, lifecycleLabel, realizedPct } from "./stage";

type StageTab = "all" | "not-started" | "live";

interface TrackingTableProps {
  onRowClick: (opp: Opportunity) => void;
}

/** Tab → lifecycle filter: Not started (contract not live) vs Live. */
function matchesTab(opp: Opportunity, tab: StageTab): boolean {
  if (tab === "all") return true;
  return tab === "live" ? isLive(opp) : !isLive(opp);
}

function matchesSearch(opp: Opportunity, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [opp.id, opp.title, opp.category, opp.l2, opp.country]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function TrackingTable({ onRowClick }: TrackingTableProps) {
  const { tracked } = useOpportunityStore();
  // Sub-category is the GLOBAL scope (header filter) — persists across pages.
  const { l2: category, setL2: setCategory } = useScope();

  const [tab, setTab] = useState<StageTab>("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const handleTab = (id: string) => {
    setTab(id as StageTab);
    setPage(1);
  };
  const handleCategory = (value: string | null) => {
    setCategory(value);
    setPage(1);
  };
  const handleSearch = (value: string) => {
    setSearch(value);
    setPage(1);
  };
  const clearFilters = () => {
    setTab("all");
    setCategory(null);
    setSearch("");
    setPage(1);
  };

  const tabs = useMemo<TabItem[]>(() => {
    const count = (t: StageTab) => tracked.filter((o) => matchesTab(o, t)).length;
    return [
      { id: "all", label: "All", badge: tracked.length },
      { id: "not-started", label: "Not started", badge: count("not-started") },
      { id: "live", label: "Live", badge: count("live") },
    ];
  }, [tracked]);

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const opp of tracked) {
      counts.set(opp.l2, (counts.get(opp.l2) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, n]) => ({ value, label: value, count: n }));
  }, [tracked]);

  const filtered = useMemo(
    () =>
      tracked.filter(
        (opp) =>
          matchesTab(opp, tab) &&
          (category === null || opp.l2 === category) &&
          matchesSearch(opp, search),
      ),
    [tracked, tab, category, search],
  );

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  const facets: FilterFacet[] = [
    {
      kind: "select",
      key: "category",
      label: "Sub-category",
      promoted: true,
      placeholder: "All sub-categories",
      value: category,
      onChange: handleCategory,
      options: categoryOptions,
    },
  ];

  const columns = useMemo<DataTableColumn<Opportunity>[]>(
    () => [
      {
        key: "play",
        label: "Opportunity",
        minWidth: 280,
        cellLayout: "col",
        wrapLines: 2,
        cell: (r) => <CellText primary={r.title} secondary={r.id} />,
      },
      {
        key: "category",
        label: "Sub-category",
        minWidth: 140,
        cellLayout: "col",
        wrapLines: 2,
        cell: (r) => <CellText primary={r.l2} secondary={r.country} primaryWeight="regular" />,
      },
      {
        key: "savings",
        label: "Committed savings",
        align: "right",
        cellLayout: "end",
        minWidth: 140,
        cell: (r) => (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtRange(r.savingsLow, r.savingsHigh)}
          </span>
        ),
      },
      {
        key: "status",
        label: "Status",
        minWidth: 120,
        cell: (r) => {
          const live = isLive(r);
          return (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
              style={
                live
                  ? { background: "#EAF7EF", color: "var(--success)" }
                  : { background: "var(--muted,#f4f4f5)", color: "var(--text-neutral)" }
              }
            >
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: live ? "var(--success)" : "var(--border-default,#d4d4d8)" }}
              />
              {lifecycleLabel(r)}
            </span>
          );
        },
      },
      {
        key: "realized",
        label: "Realized",
        minWidth: 140,
        cell: (r) => {
          const p = realizedPct(r);
          return (
            <div className="flex items-center gap-2">
              <span
                className="relative h-[5px] w-[64px] shrink-0 overflow-hidden rounded-full"
                style={{ background: "var(--muted,#f0f0f2)" }}
              >
                <span
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ width: `${Math.max(2, p)}%`, background: "var(--success)" }}
                />
              </span>
              <span className="text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {p > 0 ? `${p.toFixed(0)}%` : "—"}
              </span>
            </div>
          );
        },
      },
      {
        key: "owner",
        label: "Owner",
        minWidth: 110,
        cell: (r) => <span>{r.owner ?? "Maria Vance"}</span>,
      },
      {
        key: "risk",
        label: "Risk",
        minWidth: 130,
        cell: (r) => {
          const risk = riskStatus(r);
          return (
            <span className="inline-flex items-center gap-1.5 text-[13px]">
              <span
                className="inline-block h-[8px] w-[8px] shrink-0 rounded-full"
                style={{ background: riskColor(risk.level) }}
                aria-hidden="true"
              />
              <span
                style={{
                  color:
                    risk.level === "red"
                      ? "var(--destructive)"
                      : risk.level === "amber"
                        ? "var(--warning)"
                        : "var(--text-secondary)",
                }}
              >
                {risk.label}
              </span>
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <TableShell
      title="Committed opportunities"
      icon={ChartLineUp}
      totalItems={filtered.length}
      currentPage={page}
      onPageChange={setPage}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      pageSizeOptions={[10, 25, 50]}
      searchValue={search}
      onSearchChange={handleSearch}
      searchPlaceholder="Search opportunities…"
      facets={facets}
      tabs={tabs}
      activeTab={tab}
      onTabChange={handleTab}
      customize={false}
      isFiltered={Boolean(search.trim()) || category !== null || tab !== "all"}
      emptyState={
        <EmptyState
          icon={<ChartLineUp weight="duotone" />}
          title="Nothing committed yet"
          description="Commit opportunities from the feed to start tracking realization."
          link={{ label: "Open the opportunity feed", href: "/opportunities" }}
        />
      }
      noResultsState={
        <EmptyState
          size="sm"
          title="No opportunities match"
          description="Adjust the stage tab, category filter, or search."
          link={{ label: "Clear filters", onClick: clearFilters }}
        />
      }
    >
      <DataTable<Opportunity>
        columns={columns}
        data={pageRows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />
    </TableShell>
  );
}
