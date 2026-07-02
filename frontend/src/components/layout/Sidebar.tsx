"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  SideNav,
  type SideNavIconProps,
  type SideNavItem,
  type SideNavSection,
} from "@navanta-ai/design-system";
import {
  Briefcase,
  ChartLineUp,
  Factory,
  House,
  SlidersHorizontal,
  type Icon,
} from "@phosphor-icons/react";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { CURRENT_USER } from "@/lib/session";

/* Routes live in `key` and deliberately omit `href`: SideNav renders href
 * items as plain <a> anchors, and a full-page navigation would reset the
 * in-memory opportunity/vendor stores. `onNavigate` + router.push keeps it SPA. */

const ROUTES = {
  dashboard: "/dashboard",
  opportunities: "/opportunities",
  vendors: "/vendors",
  tracking: "/tracking",
  methodology: "/methodology",
} as const;

/**
 * The DS SideNav has no badge slot (upstream gap — flagged for the design
 * system). Badges ride in through the icon component instead: each item's
 * icon can wrap the Phosphor glyph with a corner bubble/dot, and SideNav
 * renders it at both rail (20px) and panel (16px) sizes.
 */
function withBadge(
  Glyph: Icon,
  badge: { kind: "count"; value: number } | { kind: "dot" } | null,
) {
  function BadgedIcon(props: SideNavIconProps) {
    return (
      <span className="relative inline-flex">
        <Glyph {...props} />
        {badge?.kind === "count" && badge.value > 0 && (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
            style={{
              backgroundImage: "var(--gradient-christy)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {badge.value}
          </span>
        )}
        {badge?.kind === "dot" && (
          <span
            aria-hidden="true"
            className="absolute -right-1 -top-1 inline-block h-2 w-2 rounded-full"
            style={{ background: "var(--warning)" }}
          />
        )}
      </span>
    );
  }
  return BadgedIcon;
}

/* eslint-disable @next/next/no-img-element */

/** Full Allison Transmission wordmark — expanded panel. The asset is ~4:1
 *  (2500×624), so a fixed height with auto width keeps it crisp. */
function FullLogo() {
  return (
    <img
      src="/allison-transmission-full.svg"
      alt="Allison Transmission"
      className="px-1"
      style={{ height: 26, width: "auto" }}
    />
  );
}

/** Allison Transmission monogram — collapsed rail. Near-square (625×624). */
function SmallLogo() {
  return (
    <img
      src="/allison-transmission-small.svg"
      alt="Allison Transmission"
      style={{ height: 30, width: 30 }}
    />
  );
}

export function Sidebar({
  expanded,
  onExpandedChange,
}: {
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { surfacedCount, driftCount } = useOpportunityStore();

  // Sections: Dashboard alone, then the operating loop. The label renders in
  // the expanded panel; the rail shows a divider between sections.
  const sections = useMemo<SideNavSection[]>(
    () => [
      {
        items: [{ key: ROUTES.dashboard, label: "Dashboard", icon: House }],
      },
      {
        label: "Operate",
        items: [
          {
            key: ROUTES.opportunities,
            label: "Opportunities",
            icon: withBadge(Briefcase, { kind: "count", value: surfacedCount }),
          },
          { key: ROUTES.vendors, label: "Vendors", icon: Factory },
          {
            key: ROUTES.tracking,
            label: "Value Realization",
            icon: withBadge(ChartLineUp, driftCount > 0 ? { kind: "dot" } : null),
          },
        ],
      },
      {
        label: "Admin",
        items: [
          { key: ROUTES.methodology, label: "Methodology", icon: SlidersHorizontal },
        ],
      },
    ],
    [surfacedCount, driftCount],
  );

  const activeKey = Object.values(ROUTES).find(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  const handleNavigate = (item: SideNavItem) => {
    router.push(item.key);
  };

  return (
    <SideNav
      sections={sections}
      activeKey={activeKey}
      onNavigate={handleNavigate}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      logo={<FullLogo />}
      logoCollapsed={<SmallLogo />}
      user={{
        name: CURRENT_USER.name,
        description: CURRENT_USER.role,
        initials: CURRENT_USER.initials,
      }}
    />
  );
}
