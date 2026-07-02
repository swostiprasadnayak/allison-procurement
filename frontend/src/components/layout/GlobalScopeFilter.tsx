"use client";

import { useMemo } from "react";
import { useScope } from "@/context/ScopeContext";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { SubCategoryFilter } from "@/app/(portal)/opportunities/_components/SubCategoryFilter";

/**
 * The persistent header scope filter ("MRO ▸ [sub-category]"), wired to the
 * global ScopeContext so its selection holds across every page. Sub-category
 * options are the L2s that carry opportunities (from the store).
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

  return <SubCategoryFilter value={l2} options={l2Options} onChange={setL2} />;
}
