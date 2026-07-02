"use client";

import { usePathname } from "next/navigation";
import { SidebarSimple } from "@phosphor-icons/react";
import { Button } from "@navanta-ai/design-system";
import { useAskMercer } from "@/context/AskMercerContext";
import { useScope } from "@/context/ScopeContext";
import { MercerStar } from "@/components/mercer";
import { GlobalScopeFilter } from "./GlobalScopeFilter";

const ROUTE_LABELS: Record<string, string> = {
  "/dashboard": "Command Center",
  "/opportunities": "Opportunity Feed",
  "/vendors": "Vendor Management",
  "/tracking": "Value Realization",
  "/methodology": "Methodology & Parameters",
};

// Map the route to the copilot "page" id that scopes the suggested prompts +
// the "what Mercer can see" context label.
const ROUTE_PAGES: Record<string, string> = {
  "/dashboard": "cockpit",
  "/opportunities": "feed",
  "/vendors": "vendors",
  "/tracking": "monitor",
  // Methodology has no dedicated copilot page; use the generic cockpit context
  // (the copilot already surfaces engine parameters in its grounding).
  "/methodology": "cockpit",
};

function resolvePage(pathname: string): string {
  if (ROUTE_PAGES[pathname]) return ROUTE_PAGES[pathname];
  const match = Object.keys(ROUTE_PAGES).find((route) => pathname.startsWith(`${route}/`));
  return match ? ROUTE_PAGES[match] : "cockpit";
}

function resolveTitle(pathname: string): string {
  if (ROUTE_LABELS[pathname]) return ROUTE_LABELS[pathname];
  const match = Object.keys(ROUTE_LABELS).find((route) =>
    pathname.startsWith(`${route}/`),
  );
  return match ? ROUTE_LABELS[match] : "Allison";
}

export function TopBar({ onToggleNav }: { onToggleNav: () => void }) {
  const pathname = usePathname();
  const { openMercer } = useAskMercer();
  const { l2 } = useScope();

  return (
    <header
      className="flex h-12 shrink-0 items-center justify-between bg-white px-4"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleNav}
          aria-label="Toggle navigation"
          className="flex size-8 items-center justify-center rounded-lg transition-colors hover:bg-[var(--sidebar-hover-bg)]"
        >
          <SidebarSimple
            size={18}
            weight="bold"
            style={{ color: "var(--text-secondary)" }}
          />
        </button>
        <h1
          className="text-sm font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {resolveTitle(pathname)}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        {/* Persistent scope filter — "MRO ▸ [sub-category]" — holds across pages. */}
        <GlobalScopeFilter />

        {/* Global copilot launcher — scoped to the current route + the active
            sub-category (so Mercer answers within your scope). */}
        <Button
          variant="christy"
          size="sm"
          iconLeft={<MercerStar size={14} />}
          onClick={() =>
            openMercer({
              page: resolvePage(pathname),
              categoryCode: l2 ?? undefined,
              categoryLabel: l2 ?? undefined,
            })
          }
        >
          Ask Mercer
        </Button>
      </div>
    </header>
  );
}
