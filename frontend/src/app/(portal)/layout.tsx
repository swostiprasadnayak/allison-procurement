"use client";

import { useState } from "react";
import { OpportunityStoreProvider } from "@/context/OpportunityStoreContext";
import { VendorStoreProvider } from "@/context/VendorStoreContext";
import { TopBarSlotProvider } from "@/context/TopBarSlotContext";
import { AskMercerProvider } from "@/context/AskMercerContext";
import { ScopeProvider } from "@/context/ScopeContext";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { AskMercerPanel } from "@/components/mercer";

export default function PortalLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // SideNav expansion is controlled here so the TopBar toggle (HMTX-portal
  // pattern) and the panel's own collapse/backdrop stay in sync.
  const [navExpanded, setNavExpanded] = useState(false);

  return (
    <OpportunityStoreProvider>
      <VendorStoreProvider>
        <ScopeProvider>
        <TopBarSlotProvider>
          <AskMercerProvider>
            <div className="flex h-screen overflow-hidden">
              <Sidebar expanded={navExpanded} onExpandedChange={setNavExpanded} />
              <div className="flex min-w-0 flex-1 flex-col">
                <TopBar onToggleNav={() => setNavExpanded((v) => !v)} />
                <main
                  className="flex-1 overflow-y-auto"
                  style={{ background: "var(--surface-raised)" }}
                >
                  <div className="mx-auto flex w-full max-w-[1648px] flex-col gap-6 px-6 py-6">
                    {children}
                  </div>
                </main>
              </div>
            </div>
            {/* The copilot slide-over lives once at the layout root so every
                page can open it via the AskMercer context. */}
            <AskMercerPanel />
          </AskMercerProvider>
        </TopBarSlotProvider>
        </ScopeProvider>
      </VendorStoreProvider>
    </OpportunityStoreProvider>
  );
}
