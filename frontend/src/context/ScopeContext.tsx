"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Global scope — the header "MRO ▸ [sub-category]" filter, persistent across
 * every page. `l1` is the category (MRO is the only scanned one today; the
 * others are expansion placeholders). `l2` is the sub-category (null = all).
 * Working surfaces (Opportunities · Vendors · Value Realization) hard-filter by
 * `l2`, and it feeds `category_code` to the copilot so Mercer scopes with you.
 */
interface ScopeState {
  l1: string;
  l2: string | null;
  setL1: (l1: string) => void;
  setL2: (l2: string | null) => void;
}

const ScopeContext = createContext<ScopeState | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [l1, setL1] = useState("MRO");
  const [l2, setL2] = useState<string | null>(null);
  const value = useMemo<ScopeState>(() => ({ l1, l2, setL1, setL2 }), [l1, l2]);
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useScope(): ScopeState {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useScope must be used within a ScopeProvider");
  return ctx;
}
