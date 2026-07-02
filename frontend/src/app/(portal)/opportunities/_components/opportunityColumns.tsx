"use client";

import { Pill, type DataTableColumn } from "@navanta-ai/design-system";
import { CellText } from "@/components/ui/CellText";
import type { Opportunity } from "@/types/opportunity";
import { fmtM, fmtRange } from "@/lib/format";
import { ConfidenceMeter } from "@/components/mercer";
import { LEVER_LABELS, LEVER_VARIANTS } from "./labels";

/**
 * Declarative columns for the opportunity feed. Every value is a real engine
 * field — no synthesized metrics. Sortable keys map to raw Opportunity
 * properties ("pocketSpend", "movableValue", "confidencePct") so the DataTable
 * sorts the underlying numbers, not formatted text.
 *
 * Layout matches the detail panel: name (L3) · sub-category (L2) · lever · then
 * Total spend → Addressable read left-to-right, same as the detail tiles.
 *
 * `serialOffset` keeps the leading # column global across pagination —
 * page 2 at size 10 starts at 11, not 1.
 */
export function buildOpportunityColumns(serialOffset = 0): DataTableColumn<Opportunity>[] {
  return [
    {
      key: "serial",
      label: "#",
      width: 48,
      align: "center",
      cellLayout: "center",
      // Matches the DS Table `serial` cell variant (v0.4.4): 14px/22px,
      // muted, tabular figures. DataTable has no cell variants, so we mirror
      // its spec here in the column's render fn.
      cell: (_o, ctx) => (
        <span
          className="whitespace-nowrap text-[14px] leading-[22px] tabular-nums"
          style={{ color: "var(--text-secondary)" }}
        >
          {serialOffset + ctx.index + 1}
        </span>
      ),
    },
    {
      key: "l3",
      label: "Opportunity",
      minWidth: 180,
      cellLayout: "col",
      wrapLines: 2,
      // The opportunity's own level is the L3 commodity; fall back to the full
      // engine title if L3 wasn't carried. Rejected rows keep their reason as a subtitle.
      cell: (o) => (
        <CellText
          primary={o.l3 ?? o.title}
          secondary={
            o.status === "rejected" && o.rejectReason
              ? `Rejected · ${o.rejectReason}`
              : undefined
          }
        />
      ),
    },
    {
      key: "l2",
      label: "Sub-category",
      minWidth: 150,
      cellLayout: "col",
      wrapLines: 2,
      sortable: true,
      cell: (o) => <CellText primary={o.l2} primaryWeight="regular" />,
    },
    {
      key: "country",
      label: "Country",
      minWidth: 120,
      cellLayout: "col",
      sortable: true,
      cell: (o) => <CellText primary={o.country || "—"} primaryWeight="regular" />,
    },
    {
      key: "lever",
      label: "Lever",
      minWidth: 130,
      cell: (o) => {
        const route = o.playRoute ?? "";
        const label = LEVER_LABELS[route] ?? o.recommendedAction;
        const variant = LEVER_VARIANTS[route] ?? "neutral";
        return (
          <Pill size="sm" variant={variant}>
            {label}
          </Pill>
        );
      },
    },
    {
      key: "pocketSpend",
      label: "Total spend",
      align: "right",
      cellLayout: "end",
      caretSide: "leading",
      sortable: true,
      minWidth: 104,
      cell: (o) => (
        <span className="text-[13px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtM(o.pocketSpend ?? 0)}
        </span>
      ),
    },
    {
      key: "movableValue",
      label: "Addressable",
      align: "right",
      cellLayout: "end",
      caretSide: "leading",
      sortable: true,
      minWidth: 104,
      cell: (o) => (
        <span className="text-[13px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtM(o.movableValue ?? 0)}
        </span>
      ),
    },
    {
      key: "vendorCount",
      label: "Vendors",
      align: "right",
      cellLayout: "end",
      caretSide: "leading",
      sortable: true,
      minWidth: 72,
      cell: (o) => (
        <span className="text-[13px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {o.vendorCount ?? o.fragmentedSide?.vendorCount ?? 0}
        </span>
      ),
    },
    {
      key: "confidencePct",
      label: "Confidence",
      align: "right",
      cellLayout: "end",
      caretSide: "leading",
      sortable: true,
      minWidth: 110,
      cell: (o) => <ConfidenceMeter pct={o.confidencePct} size="sm" />,
    },
    {
      key: "savings",
      label: "Savings",
      align: "right",
      cellLayout: "end",
      minWidth: 118,
      cell: (o) => (
        <span className="text-[13px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {fmtRange(o.savingsLow, o.savingsHigh)}
        </span>
      ),
    },
  ];
}
