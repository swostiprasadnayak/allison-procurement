"use client";

import { useMemo } from "react";
import { CaretRight } from "@phosphor-icons/react";
import { useScope } from "@/context/ScopeContext";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { SubCategoryFilter } from "@/app/(portal)/opportunities/_components/SubCategoryFilter";
import { ScopeMenu } from "./ScopeMenu";

/**
 * The persistent header scope filter, wired to the global ScopeContext so its
 * selection holds across every page: `ScopeMenu` (Business unit ▸
 * Region/Country ▸ L1 category) followed by the L2 sub-category Select.
 * Sub-category options are the L2s that carry opportunities (from the store).
 */
export function GlobalScopeFilter() {
  const { l2, setL2 } = useScope();
  const { opportunities } = useOpportunityStore();

  const l2Options = useMemo(() => {
    const counts = new Map<string, number>();
    for (const o of opportunities) counts.set(o.l2, (counts.get(o.l2) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([value, count]) => ({ value, label: value, count }));
  }, [opportunities]);

  return (
    <div className="flex items-center gap-1.5">
      <ScopeMenu />
      <CaretRight size={12} weight="bold" aria-hidden="true" style={{ color: "var(--text-secondary)" }} />
      <SubCategoryFilter value={l2} options={l2Options} onChange={setL2} />
    </div>
  );
}
