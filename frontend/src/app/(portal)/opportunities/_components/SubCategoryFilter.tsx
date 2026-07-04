"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type FacetOption,
} from "@navanta-ai/design-system";

/** Sentinel for the "no filter" choice — DS Select values are non-null strings. */
const ALL = "__all";

/**
 * The L2 sub-category Select, sitting next to `ScopeMenu` (Business unit ▸
 * Region/Country ▸ L1 category) in the TopBar. Split out on its own because
 * it's the highest-cardinality, highest-traffic pick in the scope hierarchy —
 * every other level lives inside the ScopeMenu panel. "All sub-categories" → `null`.
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
  return (
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
  );
}
