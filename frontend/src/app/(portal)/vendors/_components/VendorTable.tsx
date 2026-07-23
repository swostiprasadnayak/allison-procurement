"use client";

import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  DataTable,
  EmptyState,
  Pill,
  TableShell,
  facetsActiveCount,
  type DataTableColumn,
  type DataTableSortState,
  type FilterFacet,
} from "@navanta-ai/design-system";
import { Factory, Scales, X } from "@phosphor-icons/react";
import { CellText } from "@/components/ui/CellText";
import { useVendorStore } from "@/context/VendorStoreContext";
import { useScope } from "@/context/ScopeContext";
import { fmtCompact } from "@/lib/format";
import type { Vendor, VendorRole } from "@/types/vendor";
import {
  ENTITY_PILL_VARIANT,
  ROLE_LABELS,
  ROLE_PILL_VARIANT,
  perfColor,
  typeLabel,
} from "./vendorMeta";

const PAGE_SIZE_OPTIONS = [12, 24, 48];

/** Past this many, a side-by-side table stops being readable. */
const MAX_COMPARE = 4;

interface VendorTableProps {
  /** Row click → open the detail panel for this vendor id. */
  onSelect: (id: string) => void;
  /** Compare selection — lifted to the page so a deep link (?compare=) and
   *  the table's own checkboxes share the same state. */
  compareIds: Set<string>;
  onCompareIdsChange: (next: Set<string>) => void;
  onOpenCompare: () => void;
}

/** Role facet order — most actionable first. */
const ROLE_ORDER: VendorRole[] = ["winner", "oem", "consolidate", "leverage", "strategic", "tail", "none"];

function buildColumns(
  compareIds: Set<string>,
  onToggleCompare: (id: string) => void,
): DataTableColumn<Vendor>[] {
  const atCap = compareIds.size >= MAX_COMPARE;
  return [
    {
      key: "compare",
      label: "",
      width: 40,
      cell: (v) => (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={compareIds.has(v.id)}
            disabled={!compareIds.has(v.id) && atCap}
            onChange={() => onToggleCompare(v.id)}
            aria-label={`Select ${v.name} to compare`}
          />
        </span>
      ),
    },
    {
      key: "vendor",
    label: "Vendor",
    minWidth: 220,
    cellLayout: "col",
    cell: (v) => <CellText primary={v.name} secondary={typeLabel(v.type)} />,
  },
  {
    key: "entity",
    label: "Entity",
    width: 90,
    cell: (v) => (
      <Pill variant={ENTITY_PILL_VARIANT[v.entity]} size="sm">
        {v.entity}
      </Pill>
    ),
  },
  {
    key: "subcategory",
    label: "Sub-category",
    minWidth: 150,
    cellLayout: "col",
    wrapLines: 2,
    cell: (v) => <span>{v.subcategory ?? v.category}</span>,
  },
  {
    key: "spend",
    label: "Spend",
    align: "right",
    cellLayout: "end",
    sortable: true,
    caretSide: "leading",
    width: 110,
    cell: (v) => (
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtCompact(v.annualSpend)}</span>
    ),
  },
  {
    key: "role",
    label: "Sourcing role",
    minWidth: 170,
    cell: (v) => (
      <Pill variant={ROLE_PILL_VARIANT[v.role]} size="sm">
        {ROLE_LABELS[v.role]}
      </Pill>
    ),
  },
  {
    key: "performance",
    label: "Performance",
    align: "right",
    cellLayout: "end",
    sortable: true,
    caretSide: "leading",
    width: 120,
    cell: (v) => (
      <span className="font-semibold" style={{ color: perfColor(v.performance.score), fontVariantNumeric: "tabular-nums" }}>
        {v.performance.score}
      </span>
    ),
    },
  ];
}

/**
 * Supplier roster — real role across the plays (opp.opportunity_vendor) + the
 * illustrative-forward performance score (future module; real where operational
 * data exists). Search / facets / controlled pagination + sort. A leading
 * checkbox column plus a floating action bar power multi-select "Compare".
 */
export function VendorTable({ onSelect, compareIds, onCompareIdsChange, onOpenCompare }: VendorTableProps) {
  const { vendors, overlapCount } = useVendorStore();
  // Sub-category is the GLOBAL scope (header filter) — persists across pages.
  const { l2: subcategory, setL2: setSubcategory } = useScope();

  const [q, setQ] = useState("");
  const [entity, setEntity] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [overlapOnly, setOverlapOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
  const [sort, setSort] = useState<DataTableSortState>({ field: "spend", dir: "desc" });

  const toggleCompare = (id: string) => {
    const next = new Set(compareIds);
    if (next.has(id)) next.delete(id);
    else if (next.size < MAX_COMPARE) next.add(id);
    onCompareIdsChange(next);
  };
  // Cheap to rebuild each render (small, static-shaped array) — not worth a
  // useMemo whose only varying input (toggleCompare) is itself unstable.
  const columns = buildColumns(compareIds, toggleCompare);

  const subcategoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    vendors.forEach((v) => {
      const key = v.subcategory ?? v.category;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [vendors]);

  const roleOptions = useMemo(() => {
    const counts = new Map<VendorRole, number>();
    vendors.forEach((v) => counts.set(v.role, (counts.get(v.role) ?? 0) + 1));
    return ROLE_ORDER.filter((r) => (counts.get(r) ?? 0) > 0).map((r) => ({
      value: r,
      label: ROLE_LABELS[r],
      count: counts.get(r) ?? 0,
    }));
  }, [vendors]);

  const entityCounts = useMemo(() => {
    const counts = { AT: 0, AOH: 0, Both: 0 };
    vendors.forEach((v) => {
      counts[v.entity] += 1;
    });
    return counts;
  }, [vendors]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors.filter((v) => {
      if (subcategory && (v.subcategory ?? v.category) !== subcategory) return false;
      if (entity && v.entity !== entity) return false;
      if (role && v.role !== role) return false;
      if (overlapOnly && !v.overlap) return false;
      if (needle) {
        const hay = `${v.name} ${v.category} ${v.subcategory ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [vendors, subcategory, entity, role, overlapOnly, q]);

  const sorted = useMemo(() => {
    if (!sort.field) return filtered;
    const mul = sort.dir === "asc" ? 1 : -1;
    const get = (v: Vendor) => (sort.field === "performance" ? v.performance.score : v.annualSpend);
    return [...filtered].sort((a, b) => (get(a) - get(b)) * mul || a.name.localeCompare(b.name));
  }, [filtered, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const facets: FilterFacet[] = [
    {
      kind: "select",
      key: "role",
      label: "Sourcing role",
      promoted: true,
      group: "Scope",
      placeholder: "All roles",
      value: role,
      onChange: (v) => {
        setRole(v);
        setPage(1);
      },
      options: roleOptions,
    },
    {
      kind: "select",
      key: "subcategory",
      label: "Sub-category",
      promoted: true,
      group: "Scope",
      placeholder: "All sub-categories",
      value: subcategory,
      onChange: (v) => {
        setSubcategory(v);
        setPage(1);
      },
      options: subcategoryOptions,
    },
    {
      kind: "select",
      key: "entity",
      label: "Entity",
      group: "Scope",
      placeholder: "All entities",
      value: entity,
      onChange: (v) => {
        setEntity(v);
        setPage(1);
      },
      options: [
        { value: "AT", label: "AT", count: entityCounts.AT },
        { value: "AOH", label: "AOH", count: entityCounts.AOH },
        { value: "Both", label: "Both", count: entityCounts.Both },
      ],
    },
    {
      kind: "toggle",
      key: "overlap",
      label: "Serves both entities",
      promoted: true,
      group: "Insights",
      variant: "info",
      count: overlapCount,
      active: overlapOnly,
      onToggle: () => {
        setOverlapOnly((prev) => !prev);
        setPage(1);
      },
    },
  ];

  const isFiltered = q.trim() !== "" || facetsActiveCount(facets) > 0;

  const clearFilters = () => {
    setQ("");
    setSubcategory(null);
    setEntity(null);
    setRole(null);
    setOverlapOnly(false);
    setPage(1);
  };

  return (
    <>
      {compareIds.size > 0 && (
        <div
          className="flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2"
          style={{ borderColor: "var(--border-default)", background: "var(--surface-raised)" }}
        >
          <span className="flex items-center gap-1.5 text-[13px]" style={{ color: "var(--text-primary)" }}>
            <Scales size={14} weight="bold" />
            {compareIds.size} vendor{compareIds.size > 1 ? "s" : ""} selected
            {compareIds.size >= MAX_COMPARE && (
              <span style={{ color: "var(--text-secondary)" }}>· max {MAX_COMPARE}</span>
            )}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              iconLeft={<X size={13} weight="bold" />}
              onClick={() => onCompareIdsChange(new Set())}
            >
              Clear
            </Button>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Scales size={13} weight="bold" />}
              onClick={onOpenCompare}
              disabled={compareIds.size < 2}
            >
              Compare
            </Button>
          </div>
        </div>
      )}
      <TableShell
      title="Suppliers"
      icon={Factory}
      totalItems={sorted.length}
      currentPage={safePage}
      onPageChange={setPage}
      pageSize={pageSize}
      onPageSizeChange={(size) => {
        setPageSize(size);
        setPage(1);
      }}
      pageSizeOptions={PAGE_SIZE_OPTIONS}
      searchValue={q}
      onSearchChange={(value) => {
        setQ(value);
        setPage(1);
      }}
      searchPlaceholder="Search vendors, sub-categories…"
      facets={facets}
      maxInlineChips={3}
      customize={false}
      isFiltered={isFiltered}
      emptyState={
        <EmptyState
          icon={<Factory weight="duotone" />}
          title="No vendors yet"
          description="The combined AT + AOH roster has not been loaded."
        />
      }
      noResultsState={
        <EmptyState
          icon={<Factory weight="duotone" />}
          title="No vendors match"
          description="Search and filters returned no vendors from the combined roster."
          link={{ label: "Clear filters", onClick: clearFilters }}
        />
      }
    >
      <DataTable<Vendor>
        columns={columns}
        data={pageRows}
        rowKey={(v) => v.id}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        onRowClick={(v) => onSelect(v.id)}
      />
      </TableShell>
    </>
  );
}
