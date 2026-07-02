"use client";

import Link from "next/link";
import { ArrowRight, CaretRight } from "@phosphor-icons/react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { fmtCompact } from "@/lib/format";

interface CategoryRow {
  category: string;
  addressable: number;
  count: number;
}

const BAR = "linear-gradient(90deg, #7C4DDB 0%, #A87DEE 100%)";

/**
 * MRO categories — the deep-dive scope ranked by addressable, aggregated live
 * from the opportunity store (so it ties to the feed / $67.37M, not the retired
 * hardcoded split). Each row is clickable → the opportunity feed. Replaces the
 * old stacked-bar chart + fragmentation table with one clean module.
 */
export function MroCategoriesCard() {
  const { feed, tracked, parked } = useOpportunityStore();

  const map = new Map<string, CategoryRow>();
  for (const o of [...feed, ...tracked, ...parked]) {
    const key = o.l2 || o.category || "—";
    const row = map.get(key) ?? { category: key, addressable: 0, count: 0 };
    row.addressable += o.movableValue ?? 0;
    row.count += 1;
    map.set(key, row);
  }
  const rows = [...map.values()].sort((a, b) => b.addressable - a.addressable);
  const max = rows.reduce((m, r) => Math.max(m, r.addressable), 0) || 1;
  const totalAddressable = rows.reduce((s, r) => s + r.addressable, 0);

  return (
    <div
      className="flex flex-col rounded-xl"
      style={{ background: "var(--surface-base,#fff)", border: "1px solid var(--border-light)", boxShadow: "var(--shadow-card)" }}
    >
      <div className="flex items-baseline justify-between px-5 pt-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
            MRO categories
          </span>
          <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
            Addressable across the deep-dive scope · {fmtCompact(totalAddressable)} total
          </span>
        </div>
        <Link
          href="/opportunities"
          className="inline-flex items-center gap-1 text-[12px] font-medium transition-colors hover:brightness-95"
          style={{ color: "#59349C" }}
        >
          View feed <ArrowRight size={12} weight="bold" />
        </Link>
      </div>

      <div className="flex flex-col px-2 py-2">
        {rows.map((r) => (
          <Link
            key={r.category}
            href="/opportunities"
            className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[var(--sidebar-hover-bg,#f5f3fb)]"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {r.category}
                </span>
                <span
                  className="shrink-0 text-[13px] font-semibold"
                  style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
                >
                  {fmtCompact(r.addressable)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-full" style={{ background: "var(--muted,#eee)" }}>
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.max(3, (r.addressable / max) * 100)}%`, background: BAR }}
                  />
                </span>
                <span className="shrink-0 text-[11px]" style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                  {r.count} {r.count === 1 ? "opp" : "opps"}
                </span>
              </div>
            </div>
            <CaretRight
              size={14}
              className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100"
              style={{ color: "var(--text-neutral)" }}
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
