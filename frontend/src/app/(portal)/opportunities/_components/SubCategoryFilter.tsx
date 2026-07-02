"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  type FacetOption,
} from "@navanta-ai/design-system";
import { CaretRight } from "@phosphor-icons/react";
import { fmtCompact } from "@/lib/format";

/** Sentinel for the "no filter" choice — DS Select values are non-null strings. */
const ALL = "__all";

type FootprintCategory = { name: string; spend: number; scanned: boolean };

/**
 * Opportunity Feed scope filter in the TopBar. Reads as the hierarchy
 * "MRO ▸ [All sub-categories]": an L1 selector followed by the sub-category
 * Select. The L1 list is the REAL indirect taxonomy (`ref.category_footprint`,
 * from the cube's `Consol 1`) — MRO is the only scanned L1 and is selectable;
 * its siblings appear disabled with their real spend, conveying the platform's
 * expansion without fabricating opportunity data. "All sub-categories" → `null`.
 */
export function SubCategoryFilter({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: FacetOption[];
  onChange: (value: string | null) => void;
}) {
  const [cats, setCats] = useState<FootprintCategory[]>([]);

  useEffect(() => {
    let alive = true;
    fetch("/api/footprint")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d?.categories)) setCats(d.categories);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const scanned = cats.find((c) => c.scanned);
  const expansion = cats.filter((c) => !c.scanned);

  return (
    <div className="flex items-center gap-1.5">
      {/* L1 scope selector — MRO (scanned) is selectable; its indirect siblings
          are disabled placeholders with real spend from the cube. */}
      <Select value="MRO" onValueChange={() => {}}>
        <SelectTrigger size="md" className="w-auto min-w-[84px]">
          <SelectValue />
        </SelectTrigger>
        {/* min-w overrides the DS's trigger-pinned width so the sibling labels +
            spend stay on one line while the trigger ("MRO") stays compact. */}
        <SelectContent className="min-w-[280px]">
          <SelectItem value="MRO">
            <span className="flex w-full items-center justify-between gap-8">
              <span>MRO</span>
              {scanned && (
                <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {fmtCompact(scanned.spend)}
                </span>
              )}
            </span>
          </SelectItem>
          {expansion.length > 0 && (
            <SelectGroup>
              <SelectLabel>Expanding to</SelectLabel>
              {expansion.map((c) => (
                <SelectItem key={c.name} value={c.name} disabled>
                  <span className="flex w-full items-center justify-between gap-8">
                    <span>{c.name}</span>
                    <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      {fmtCompact(c.spend)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
      <CaretRight size={12} weight="bold" aria-hidden="true" style={{ color: "var(--text-secondary)" }} />
      <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? null : v)}>
        {/* The DS pins the dropdown's width to the trigger's, and the trigger is
            right-anchored in the header (grows leftward). Sizing it to the
            longest label keeps every item on one line — no wrap in the list, no
            line-clamp ellipsis on a long selected value — without overflowing. */}
        <SelectTrigger size="md" className="w-auto min-w-[320px]">
          <SelectValue placeholder="All sub-categories" />
        </SelectTrigger>
        <SelectContent>
          {/* Labels only — no count badges, so the selected value mirrors into
              the trigger cleanly (a count would render as e.g. "Chemicals2"). */}
          <SelectItem value={ALL}>All sub-categories</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
