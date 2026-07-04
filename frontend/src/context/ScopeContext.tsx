"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/** "ALL" = both entities. Mirrors the CDM's raw business_unit code (AT/OH); "both" is an
 *  opportunity-level value (cross-BU pockets), not a filter choice, so it isn't a BusinessUnit. */
export type BusinessUnit = "ALL" | "AT" | "OH";

/**
 * Global scope — the header hierarchy filter, persistent across every page:
 * Business Unit -> Region/Country (Plant is a placeholder — see below) -> L1
 * category -> L2 sub-category. `l1` is the category (MRO is the only scanned
 * one today; the others are expansion placeholders). `l2` is the sub-category
 * (null = all). Working surfaces (Opportunities · Vendors · Value Realization)
 * hard-filter by these, and `l2` feeds `category_code` to the copilot so
 * Mercer scopes with you.
 *
 * `region` is a UI grouping over its member countries, not a native
 * opportunity field (pockets don't carry region — see
 * engine/core/opportunities/generate.py) — selecting a region filters
 * "country in this region's list," same effect, no fabricated column.
 * Plant/location isn't in ScopeState at all: `location_id` is NULL
 * engine-wide until the SAP location-master feed lands, so there is nothing
 * real to filter by yet (the menu shows it disabled with that explanation).
 */
interface ScopeState {
  l1: string;
  l2: string | null;
  businessUnit: BusinessUnit;
  region: string | null;
  country: string | null;
  setL1: (l1: string) => void;
  setL2: (l2: string | null) => void;
  setBusinessUnit: (bu: BusinessUnit) => void;
  setRegion: (region: string | null) => void;
  setCountry: (country: string | null) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [l1, setL1] = useState("MRO");
  const [l2, setL2] = useState<string | null>(null);
  const [businessUnit, setBusinessUnit] = useState<BusinessUnit>("ALL");
  const [region, setRegionState] = useState<string | null>(null);
  const [country, setCountryState] = useState<string | null>(null);

  // Picking a region clears any previously-picked country (it likely belongs
  // to a different region); picking a country leaves region as-is (the menu
  // always sets both together from the same row).
  const setRegion = (r: string | null) => {
    setRegionState(r);
    setCountryState(null);
  };
  const setCountry = (c: string | null) => setCountryState(c);

  const value = useMemo<ScopeState>(
    () => ({ l1, l2, businessUnit, region, country, setL1, setL2, setBusinessUnit, setRegion, setCountry }),
    [l1, l2, businessUnit, region, country],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeState {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within a ScopeProvider");
  return ctx;
}
