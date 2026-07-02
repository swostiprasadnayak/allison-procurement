"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "@navanta-ai/design-system";
import { CellText } from "@/components/ui/CellText";
import type { CategoryFootprint, FootprintCategory } from "@/lib/cdm";
import { fmtCompact, fmtM } from "@/lib/format";

interface EstateScanCardProps {
  /** MRO's live addressable (engine movable) — MRO is the one scanned L1. */
  mroAddressable: number;
  /** MRO's open opportunity count. */
  mroOpps: number;
}

interface EstateRow extends FootprintCategory {
  share: number; // % of total estate spend
  addressable: number | null; // scanned only
  opps: number | null;
}

const SHARE_BAR = "linear-gradient(90deg, #7C4DDB 0%, #A87DEE 100%)";

function StatusBadge({ scanned }: { scanned: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={
        scanned
          ? { background: "#F1EAFE", color: "#59349C" }
          : { background: "var(--muted,#f4f4f5)", color: "var(--text-neutral)" }
      }
    >
      <span
        className="inline-block h-[6px] w-[6px] rounded-full"
        style={{ background: scanned ? "#7C4DDB" : "var(--border-default,#d4d4d8)" }}
      />
      {scanned ? "Scanned" : "Not yet scanned"}
    </span>
  );
}

function makeColumns(maxShare: number): DataTableColumn<EstateRow>[] {
  const muted = (row: EstateRow, text: string) => (
    <span className="tabular-nums" style={{ color: row.scanned ? "var(--text-primary)" : "var(--text-neutral)" }}>
      {text}
    </span>
  );
  return [
    {
      key: "name",
      label: "Category",
      width: "16%",
      cell: (row) => (
        <span className="text-[13px] font-medium" style={{ color: row.scanned ? "var(--text-primary)" : "var(--text-neutral)" }}>
          {row.name}
        </span>
      ),
    },
    {
      key: "spend",
      label: "Spend",
      align: "right",
      cellLayout: "end",
      width: "12%",
      sortable: true,
      caretSide: "leading",
      cell: (row) => muted(row, fmtM(row.spend)),
    },
    {
      key: "share",
      label: "% of spend",
      width: "12%",
      sortable: true,
      caretSide: "leading",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="relative h-[5px] w-[64px] shrink-0 overflow-hidden rounded-full" style={{ background: "var(--muted,#f0f0f2)" }}>
            <span
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.max(3, (row.share / maxShare) * 100)}%`, background: row.scanned ? SHARE_BAR : "var(--border-default,#d4d4d8)" }}
            />
          </span>
          <span className="tabular-nums text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {row.share.toFixed(0)}%
          </span>
        </div>
      ),
    },
    {
      key: "vendors",
      label: "Vendors",
      align: "right",
      cellLayout: "end",
      width: "12%",
      sortable: true,
      caretSide: "leading",
      cell: (row) => muted(row, row.vendors.toLocaleString("en-US")),
    },
    {
      key: "lineCount",
      label: "Line items",
      align: "right",
      cellLayout: "end",
      width: "12%",
      sortable: true,
      caretSide: "leading",
      cell: (row) => muted(row, row.lineCount.toLocaleString("en-US")),
    },
    {
      key: "scanned",
      label: "Status",
      width: "12%",
      cell: (row) => <StatusBadge scanned={row.scanned} />,
    },
    {
      key: "addressable",
      label: "Addressable",
      align: "right",
      cellLayout: "end",
      width: "12%",
      cell: (row) =>
        row.addressable != null ? (
          <span className="tabular-nums font-medium" style={{ color: "#59349C" }}>{fmtCompact(row.addressable)}</span>
        ) : (
          <span style={{ color: "var(--border-default,#d4d4d8)" }}>—</span>
        ),
    },
    {
      key: "opps",
      label: "Opportunities",
      align: "right",
      cellLayout: "end",
      width: "12%",
      cell: (row) =>
        row.opps != null ? (
          <span className="tabular-nums font-medium" style={{ color: "var(--text-primary)" }}>{row.opps}</span>
        ) : (
          <span style={{ color: "var(--border-default,#d4d4d8)" }}>—</span>
        ),
    },
  ];
}

/**
 * Indirect estate scan — the top-level command-center view. Every indirect L1
 * category from the real footprint (ref.category_footprint) as a sortable
 * table: spend, share of estate, line items, scan status, and (for the one
 * scanned category, MRO) live addressable + opps. MRO's row is clickable → the
 * feed; the rest are the expansion runway. Scales as more categories scan.
 */
export function EstateScanCard({ mroAddressable, mroOpps }: EstateScanCardProps) {
  const router = useRouter();
  const [data, setData] = useState<CategoryFootprint | null>(null);
  const [sort, setSort] = useState<DataTableSortState>({ field: "spend", dir: "desc" });

  useEffect(() => {
    let alive = true;
    fetch("/api/footprint")
      .then((r) => r.json())
      .then((d: CategoryFootprint) => {
        if (alive) setData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const total = data?.totalSpend || 1;
  const rows: EstateRow[] = (data?.categories ?? []).map((c) => ({
    ...c,
    share: (c.spend / total) * 100,
    addressable: c.scanned ? mroAddressable : null,
    opps: c.scanned ? mroOpps : null,
  }));
  const maxShare = rows.reduce((m, r) => Math.max(m, r.share), 0) || 1;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Indirect spend · category scan</CardTitle>
        <CardDescription>
          {data
            ? `${data.scannedCount} of ${data.totalCount} categories scanned · ${fmtM(data.totalSpend)} total indirect spend · MRO is the proven wedge; the scan extends to the rest next.`
            : "Loading the estate footprint…"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable<EstateRow>
          columns={makeColumns(maxShare)}
          data={rows}
          rowKey={(row) => row.name}
          sortMode="client"
          sort={sort}
          onSortChange={setSort}
          isRowClickable={(row) => row.scanned}
          onRowClick={(row) => {
            if (row.scanned) router.push("/opportunities");
          }}
        />
      </CardContent>
    </Card>
  );
}
