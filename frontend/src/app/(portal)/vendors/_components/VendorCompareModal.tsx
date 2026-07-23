"use client";

import type { ReactNode } from "react";
import { Scales } from "@phosphor-icons/react";
import { Pill } from "@navanta-ai/design-system";
import { ModalShell } from "@/components/ui/ModalShell";
import { usePanelDialog } from "@/lib/usePanelDialog";
import { fmtCompact } from "@/lib/format";
import type { Vendor } from "@/types/vendor";
import {
  ENTITY_PILL_VARIANT,
  ROLE_LABELS,
  ROLE_PILL_VARIANT,
  RELIABILITY_LABELS,
  leadLabel,
  perfColor,
  scoreColor,
  termsLabel,
  typeLabel,
} from "./vendorMeta";

interface VendorCompareModalProps {
  vendors: Vendor[];
  open: boolean;
  onClose: () => void;
}

/** One comparison row: a label plus how to render each vendor's value for it. */
interface CompareRow {
  label: string;
  cell: (v: Vendor) => ReactNode;
}

const ROWS: CompareRow[] = [
  {
    label: "Entity",
    cell: (v) => (
      <Pill variant={ENTITY_PILL_VARIANT[v.entity]} size="sm">
        {v.entity}
      </Pill>
    ),
  },
  { label: "Sub-category", cell: (v) => v.subcategory ?? v.category },
  { label: "Country / region", cell: (v) => `${v.country} · ${v.region}` },
  { label: "Type", cell: (v) => typeLabel(v.type) },
  {
    label: "Annual spend",
    cell: (v) => <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtCompact(v.annualSpend)}</span>,
  },
  {
    label: "Sourcing role",
    cell: (v) => (
      <Pill variant={ROLE_PILL_VARIANT[v.role]} size="sm">
        {ROLE_LABELS[v.role]}
      </Pill>
    ),
  },
  {
    label: "Performance",
    cell: (v) => (
      <span className="font-semibold" style={{ color: perfColor(v.performance.score) }}>
        {v.performance.score}
        {!v.performance.anyLive && (
          <span className="ml-1 text-[10px] font-normal" style={{ color: "var(--text-secondary)" }}>
            illustrative
          </span>
        )}
      </span>
    ),
  },
  {
    label: "Data confidence",
    cell: (v) => (
      <span className="font-semibold" style={{ color: scoreColor(v.score) }}>
        {v.score}
      </span>
    ),
  },
  { label: "Data reliability", cell: (v) => RELIABILITY_LABELS[v.dataReliability] },
  { label: "Payment terms", cell: (v) => termsLabel(v.paymentTermsDays) },
  {
    label: "Lead time",
    cell: (v) => `${leadLabel(v.leadTimeDays)}${v.leadTimeDays !== null ? ` · ${v.leadTimeTrend}` : ""}`,
  },
  { label: "Serves both entities", cell: (v) => (v.overlap ? "Yes" : "No") },
  { label: "In opportunities", cell: (v) => v.opportunities.length },
];

/**
 * Side-by-side vendor comparison — opened either from the Vendors page's own
 * multi-select (2–4 checkboxes → "Compare") or via a deep link from an
 * opportunity's vendor roster (Compare vendors → /vendors?compare=id1,id2).
 * Every field mirrors VendorDetailPanel's own labels/formatters so the two
 * surfaces never disagree on what a number means.
 */
export function VendorCompareModal({ vendors, open, onClose }: VendorCompareModalProps) {
  usePanelDialog(open && vendors.length > 0, onClose, "Compare vendors");

  if (vendors.length === 0) return null;

  return (
    <ModalShell open={open} onClose={onClose} title="Compare vendors" icon={Scales} size="deck">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="w-40 shrink-0 border-b py-2 pr-3 text-left" style={{ borderColor: "var(--border-light)" }} />
              {vendors.map((v) => (
                <th
                  key={v.id}
                  className="min-w-[160px] border-b px-3 py-2 text-left align-bottom"
                  style={{ borderColor: "var(--border-light)" }}
                >
                  <span className="font-semibold" style={{ color: "var(--text-primary)" }}>
                    {v.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <tr key={row.label} style={{ borderTop: i > 0 ? "1px solid var(--border-light)" : undefined }}>
                <td
                  className="py-2 pr-3 align-top text-[12px] font-medium"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {row.label}
                </td>
                {vendors.map((v) => (
                  <td key={v.id} className="px-3 py-2 align-top" style={{ color: "var(--text-primary)" }}>
                    {row.cell(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ModalShell>
  );
}
