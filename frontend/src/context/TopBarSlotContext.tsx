"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

/**
 * Lets a page project a control into the shared TopBar's right-hand region.
 * When a page sets `rightSlot`, the TopBar renders it in place of the default
 * Mercer sweep chip; clearing it (on unmount) restores the chip. This keeps
 * the TopBar generic while letting a single route — e.g. the Opportunity Feed
 * sub-category filter — own what shows there.
 */
interface TopBarSlot {
  rightSlot: ReactNode;
  setRightSlot: (node: ReactNode) => void;
}

const TopBarSlotContext = createContext<TopBarSlot | null>(null);

export function TopBarSlotProvider({ children }: { children: ReactNode }) {
  const [rightSlot, setRightSlot] = useState<ReactNode>(null);
  return (
    <TopBarSlotContext.Provider value={{ rightSlot, setRightSlot }}>
      {children}
    </TopBarSlotContext.Provider>
  );
}

export function useTopBarSlot(): TopBarSlot {
  const ctx = useContext(TopBarSlotContext);
  if (!ctx) {
    throw new Error("useTopBarSlot must be used within a TopBarSlotProvider");
  }
  return ctx;
}
