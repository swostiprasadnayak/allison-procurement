"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * The view context the "Ask Mercer" copilot opens with. `page` scopes the
 * suggested prompts + the "what Mercer can see" label. The in-view ENTITY is
 * optional and anchors retrieval: an opportunity (engine surrogate key, NOT the
 * friendly "OPP-001") on opp surfaces, a vendor on the Suppliers page, or a
 * category (L2) from the global scope filter. The copilot core anchors on
 * whichever is set (opportunity_id / vendor_id / category_code).
 */
export interface AskMercerViewContext {
  page: string;
  opportunityId?: string;
  opportunityTitle?: string;
  vendorId?: string;
  vendorLabel?: string;
  categoryCode?: string; // L2 code/name from the global scope filter
  categoryLabel?: string;
}

interface AskMercerState {
  open: boolean;
  viewContext: AskMercerViewContext;
  openMercer: (ctx?: AskMercerViewContext) => void;
  close: () => void;
}

const DEFAULT_CONTEXT: AskMercerViewContext = { page: "cockpit" };

const AskMercerContext = createContext<AskMercerState | null>(null);

export function AskMercerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [viewContext, setViewContext] = useState<AskMercerViewContext>(DEFAULT_CONTEXT);

  const openMercer = useCallback((ctx?: AskMercerViewContext) => {
    setViewContext(ctx ?? DEFAULT_CONTEXT);
    setOpen(true);
  }, []);

  const close = useCallback(() => setOpen(false), []);

  const value = useMemo<AskMercerState>(
    () => ({ open, viewContext, openMercer, close }),
    [open, viewContext, openMercer, close],
  );

  return <AskMercerContext.Provider value={value}>{children}</AskMercerContext.Provider>;
}

export function useAskMercer(): AskMercerState {
  const ctx = useContext(AskMercerContext);
  if (!ctx) {
    throw new Error("useAskMercer must be used within an AskMercerProvider");
  }
  return ctx;
}
