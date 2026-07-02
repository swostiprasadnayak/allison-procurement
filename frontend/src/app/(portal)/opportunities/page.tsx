"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DataTable,
  EmptyState,
  TableShell,
  facetsActiveCount,
  useToast,
  type DataTableSortState,
  type FacetOption,
  type FilterFacet,
  type TabItem,
} from "@navanta-ai/design-system";
import { Briefcase, CheckCircle } from "@phosphor-icons/react";
import type { Opportunity, OpportunityStatus } from "@/types/opportunity";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useScope } from "@/context/ScopeContext";
import { buildOpportunityColumns } from "./_components/opportunityColumns";
import { MorningBrief } from "./_components/MorningBrief";
import { ReviewPanel } from "./_components/ReviewPanel";
import { RunPlayModal } from "./_components/RunPlayModal";
import { RejectDialog } from "./_components/RejectDialog";
import { ParkDialog } from "./_components/ParkDialog";
import { LEVER_LABELS } from "./_components/labels";

/** IRIS resolve choreography: green flash, then fade, then drop from the feed. */
const RESOLVED_VISIBLE_MS = 2000;
const FADE_MS = 200;

const PAGE_SIZE_OPTIONS = [10, 25, 50];

const FEED_STATUSES: ReadonlySet<OpportunityStatus> = new Set([
  "surfaced",
  "qualifying",
  "qualified",
]);

/** Real engine levers (play_route), in display order — the Lever facet. */
const LEVER_ROUTES = ["consolidate", "rfp", "carve-out", "sub-classify"] as const;

type TabId = "feed" | "act" | "parked" | "rejected";

interface ResolveState {
  kind: "committed" | "rejected" | "parked";
  /** "pending" keeps the row in the feed with NO flash (panel still open);
   *  "resolved" paints the flash; "fading" runs the 200ms exit. */
  phase: "pending" | "resolved" | "fading";
}


export default function OpportunitiesPage() {
  const { opportunities, feed, accepted, parked, rejected, accept, commit, qualify, reject, park, unpark } =
    useOpportunityStore();
  const { addToast } = useToast();

  // ── Table state ─────────────────────────────────────────────────────────
  const [tab, setTab] = useState<TabId>("feed");
  const [search, setSearch] = useState("");
  const { l2, setL2 } = useScope(); // sub-category scope is global (persists across pages)
  const [lever, setLever] = useState<string | null>(null);
  const [bu, setBu] = useState<string | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const [highConfOnly, setHighConfOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<DataTableSortState>({ field: "confidencePct", dir: "desc" });

  // ── Review panel + commit/reject/park flow state ────────────────────────
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [runOpen, setRunOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [parkOpen, setParkOpen] = useState(false);

  // Rows that have left the feed but are still rendered for the resolve
  // animation — Map<id, {kind, phase}> with timers tracked in a ref.
  const [resolving, setResolving] = useState<Map<string, ResolveState>>(new Map());
  const resolveTimers = useRef<Map<string, number[]>>(new Map());

  useEffect(() => {
    const timers = resolveTimers.current;
    return () => {
      timers.forEach((ids) => ids.forEach((t) => window.clearTimeout(t)));
      timers.clear();
    };
  }, []);

  const active = useMemo(
    () => (activeId ? (opportunities.find((o) => o.id === activeId) ?? null) : null),
    [opportunities, activeId],
  );

  // ── Resolve-animation lifecycle ─────────────────────────────────────────
  const beginResolve = useCallback(
    (id: string, kind: ResolveState["kind"], phase: "pending" | "resolved" = "resolved") => {
      setResolving((prev) => {
        const next = new Map(prev);
        next.set(id, { kind, phase });
        return next;
      });
    },
    [],
  );

  const startResolveTimers = useCallback((id: string) => {
    if (resolveTimers.current.has(id)) return;
    const fadeTimer = window.setTimeout(() => {
      setResolving((prev) => {
        const entry = prev.get(id);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(id, { ...entry, phase: "fading" });
        return next;
      });
    }, RESOLVED_VISIBLE_MS);
    const dropTimer = window.setTimeout(() => {
      resolveTimers.current.delete(id);
      setResolving((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }, RESOLVED_VISIBLE_MS + FADE_MS);
    resolveTimers.current.set(id, [fadeTimer, dropTimer]);
  }, []);

  // ── Panel + decision handlers ───────────────────────────────────────────
  const handleRowClick = useCallback(
    (opp: Opportunity) => {
      setActiveId(opp.id);
      // An accepted play (the Act tab) opens the Run-the-play modal; everything
      // else opens the decide/review modal.
      if (opp.status === "accepted") {
        setRunOpen(true);
        return;
      }
      setPanelOpen(true);
      // Opening a surfaced opp IS qualifying it (Feature Spec §3.2: "In Qualify
      // — a CM has opened it and is deciding"). Mercer revises confidence once
      // on open — silently, no toast.
      if (opp.status === "surfaced") {
        qualify(opp.id);
      }
    },
    [qualify],
  );

  // Accept → move the opportunity into Act (status "accepted") and switch to the
  // Act tab, where the play is run and the value committed (Design §4.4).
  const handleAccept = useCallback(() => {
    if (!activeId) return;
    accept(activeId);
    setPanelOpen(false);
    setTab("act");
    setPage(1);
    addToast("Approved — moved to Act", "success");
  }, [activeId, accept, addToast]);

  const handlePanelClose = useCallback(() => {
    if (rejectOpen || parkOpen) return; // the reject/park dialog layer owns Escape/backdrop
    setPanelOpen(false);
  }, [rejectOpen, parkOpen]);

  // Run-the-play modal (Act tab): commit the value (with the operator's timing +
  // basis) → hands off to Monitor.
  const handleRunCommit = useCallback(
    (meta: { timing?: string; basis?: string }) => {
      if (!activeId) return;
      commit(activeId, meta);
      setRunOpen(false);
      addToast(`${activeId} committed — tracking in Value Realization`, "success");
    },
    [activeId, commit, addToast],
  );

  const handleRejectRequest = useCallback(() => setRejectOpen(true), []);
  const handleRejectCancel = useCallback(() => setRejectOpen(false), []);

  const handleRejectConfirm = useCallback(
    (reason: string, note?: string) => {
      if (!activeId) return;
      reject(activeId, reason, note);
      setRejectOpen(false);
      setPanelOpen(false);
      // Resolve choreography only applies on the feed tab — elsewhere the
      // row stays put and simply re-renders as rejected.
      if (tab === "feed") {
        beginResolve(activeId, "rejected");
        startResolveTimers(activeId);
      }
      addToast("Rejected — logged for sweep calibration", "info");
    },
    [activeId, tab, reject, beginResolve, startResolveTimers, addToast],
  );

  const handleParkRequest = useCallback(() => setParkOpen(true), []);
  const handleParkCancel = useCallback(() => setParkOpen(false), []);

  const handleParkConfirm = useCallback(
    (trigger: string) => {
      if (!activeId) return;
      park(activeId, trigger);
      setParkOpen(false);
      setPanelOpen(false);
      // Resolve choreography only applies on the feed tab — elsewhere the
      // row stays put and simply re-renders as parked.
      if (tab === "feed") {
        beginResolve(activeId, "parked");
        startResolveTimers(activeId);
      }
      addToast(`Parked — revisit: ${trigger}`, "info");
    },
    [activeId, tab, park, beginResolve, startResolveTimers, addToast],
  );

  // Un-park (from the Parked tab): return the opp to the feed as qualified.
  const handleUnpark = useCallback(() => {
    if (!activeId) return;
    unpark(activeId);
    setPanelOpen(false);
    addToast("Returned to feed", "success");
  }, [activeId, unpark, addToast]);

  // ── Row derivation: tab → search → facets → sort → page slice ───────────
  const tabRows = useMemo<Opportunity[]>(() => {
    if (tab === "feed") {
      // Keep just-resolved rows in the feed view for the green-flash lifecycle.
      return opportunities.filter((o) => FEED_STATUSES.has(o.status) || resolving.has(o.id));
    }
    if (tab === "act") return accepted;
    if (tab === "parked") return parked;
    if (tab === "rejected") return rejected;
    return opportunities;
  }, [tab, opportunities, accepted, parked, rejected, resolving]);

  const q = search.trim().toLowerCase();
  const searchedRows = useMemo(() => {
    if (!q) return tabRows;
    return tabRows.filter((o) =>
      [o.title, o.l2, o.country].some((s) => s.toLowerCase().includes(q)),
    );
  }, [tabRows, q]);

  const filtered = useMemo(
    () =>
      searchedRows.filter(
        (o) =>
          (!l2 || o.l2 === l2) &&
          (!lever || o.playRoute === lever) &&
          (!bu || o.businessUnit === bu) &&
          (!country || o.country === country) &&
          (!highConfOnly || o.confidencePct >= 60),
      ),
    [searchedRows, l2, lever, bu, country, highConfOnly],
  );

  // Sort the FULL filtered set (pagination needs a global order); semantics
  // mirror the DataTable client comparator so its in-page re-sort is a no-op.
  const sorted = useMemo(() => {
    const rows = filtered.slice();
    const field = sort.field;
    if (!field) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[field];
      const bv = (b as unknown as Record<string, unknown>)[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return rows;
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  );

  // Columns rebuild per page so the leading # column numbers globally
  // (page 2 at size 10 starts at 11).
  const columns = useMemo(
    () => buildOpportunityColumns((safePage - 1) * pageSize),
    [safePage, pageSize],
  );

  // ── Facets ──────────────────────────────────────────────────────────────

  const leverOptions = useMemo<FacetOption[]>(
    () =>
      LEVER_ROUTES.map((r) => ({
        value: r,
        label: LEVER_LABELS[r] ?? r,
        count: searchedRows.filter((o) => o.playRoute === r).length,
      })),
    [searchedRows],
  );

  const buOptions = useMemo<FacetOption[]>(() => {
    const all = Array.from(
      new Set(opportunities.map((o) => o.businessUnit).filter((x): x is string => !!x)),
    ).sort();
    return all.map((value) => ({
      value,
      label: value,
      count: searchedRows.filter((o) => o.businessUnit === value).length,
    }));
  }, [opportunities, searchedRows]);

  const countryOptions = useMemo<FacetOption[]>(() => {
    const all = Array.from(new Set(opportunities.map((o) => o.country))).sort();
    return all.map((c) => ({
      value: c,
      label: c,
      count: searchedRows.filter((o) => o.country === c).length,
    }));
  }, [opportunities, searchedRows]);

  const highConfCount = useMemo(
    () => searchedRows.filter((o) => o.confidencePct >= 60).length,
    [searchedRows],
  );

  // Sub-category lives in the TopBar (see the slot effect below). The toolbar
  // promotes Lever, Country and High-confidence (3 inline chips); Business Unit
  // sits in "More filters".
  const facets: FilterFacet[] = [
    {
      kind: "select",
      key: "lever",
      label: "Lever",
      promoted: true,
      group: "Lever",
      placeholder: "All levers",
      value: lever,
      onChange: (v) => {
        setLever(v);
        setPage(1);
      },
      options: leverOptions,
    },
    {
      kind: "select",
      key: "country",
      label: "Country",
      promoted: true,
      group: "Scope",
      placeholder: "All countries",
      value: country,
      onChange: (v) => {
        setCountry(v);
        setPage(1);
      },
      options: countryOptions,
    },
    {
      kind: "toggle",
      key: "high-confidence",
      label: "High confidence ≥60%",
      promoted: true,
      group: "Insights",
      variant: "info",
      count: highConfCount,
      active: highConfOnly,
      onToggle: () => {
        setHighConfOnly((v) => !v);
        setPage(1);
      },
    },
    {
      kind: "select",
      key: "businessUnit",
      label: "Business Unit",
      group: "Scope",
      placeholder: "All business units",
      value: bu,
      onChange: (v) => {
        setBu(v);
        setPage(1);
      },
      options: buOptions,
    },
  ];

  // l2 is filtered from the TopBar now, so it's outside `facets` — fold it in.
  const isFiltered = q !== "" || l2 != null || facetsActiveCount(facets) > 0;

  // Sub-category scope now lives in the global header filter (persists across
  // pages); the feed reads it via useScope() and filters `o.l2 === l2` above.

  const clearAllFilters = useCallback(() => {
    setSearch("");
    setL2(null);
    setLever(null);
    setBu(null);
    setCountry(null);
    setHighConfOnly(false);
    setPage(1);
  }, []);

  const tabs: TabItem[] = [
    { id: "feed", label: "Feed", badge: feed.length },
    { id: "act", label: "Act", badge: accepted.length },
    { id: "parked", label: "Parked", badge: parked.length },
    { id: "rejected", label: "Rejected", badge: rejected.length },
  ];

  // ── Row presentation ────────────────────────────────────────────────────
  const rowClassName = useCallback(
    (o: Opportunity) => {
      const classes: string[] = [];
      if (tab === "feed") {
        const entry = resolving.get(o.id);
        if (entry && entry.phase !== "pending") {
          // Commit flashes success-green; rejection/parking is calibration
          // feedback, not a win — it gets the neutral wash instead.
          classes.push(entry.kind === "committed" ? "row-resolved" : "row-dismissed");
          if (entry.phase === "fading") classes.push("row-fading");
        }
      }
      // Rejected rows are identified by their "Rejected · reason" descriptor,
      // not by fading — opacity read as "disabled", so it's intentionally absent.
      return classes.join(" ");
    },
    [tab, resolving],
  );

  const isRowClickable = useCallback((o: Opportunity) => !resolving.has(o.id), [resolving]);

  return (
    <>
      {/* Mercer Brief (IRIS card) above the table so the feed gets the full
          page width — dynamic narrative + live metric cards, scoped to the
          page's sub-category filter. */}
      <MorningBrief l2={l2} />

      <TableShell
          title="Opportunities"
          icon={Briefcase}
          totalItems={filtered.length}
          currentPage={safePage}
          onPageChange={setPage}
          pageSize={pageSize}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
          searchPlaceholder="Search title, sub-category, country…"
          facets={facets}
          // Two promoted chips: the archetype select and the high-confidence
          // toggle. Country sits in "More filters"; sub-category is in the TopBar.
          maxInlineChips={3}
          tabs={tabs}
          activeTab={tab}
          onTabChange={(id) => {
            setTab(id as TabId);
            setPage(1);
          }}
          customize={false}
          isFiltered={isFiltered}
          emptyState={
            <EmptyState
              icon={<CheckCircle weight="duotone" />}
              title="All opportunities reviewed"
              description="Mercer's next sweep runs at 04:00."
              link={{ label: "View committed plays in Value Realization", href: "/tracking" }}
            />
          }
          noResultsState={
            <EmptyState
              icon={<Briefcase weight="duotone" />}
              title="No opportunities match"
              description="Widen the filters or clear the search to see more of the sweep."
              link={{ label: "Clear all filters", onClick: clearAllFilters }}
            />
          }
        >
          <DataTable<Opportunity>
            columns={columns}
            data={pageRows}
            rowKey={(o) => o.id}
            sort={sort}
            onSortChange={setSort}
            sortMode="client"
            onRowClick={handleRowClick}
            isRowClickable={isRowClickable}
            rowClassName={rowClassName}
          />
      </TableShell>

      <ReviewPanel
        opp={active}
        open={panelOpen}
        onClose={handlePanelClose}
        onAccept={handleAccept}
        onRejectRequest={handleRejectRequest}
        onParkRequest={handleParkRequest}
        onUnpark={handleUnpark}
      />

      <RunPlayModal
        opp={active}
        open={runOpen}
        onClose={() => setRunOpen(false)}
        onCommit={handleRunCommit}
      />

      <RejectDialog
        open={rejectOpen}
        oppId={activeId}
        onCancel={handleRejectCancel}
        onConfirm={handleRejectConfirm}
      />

      <ParkDialog
        open={parkOpen}
        oppId={activeId}
        onCancel={handleParkCancel}
        onConfirm={handleParkConfirm}
      />
    </>
  );
}
