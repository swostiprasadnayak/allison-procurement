"use client";

import { useEffect, useState } from "react";
import type { Cockpit } from "@/lib/cdm";

/**
 * Live cockpit roll-up (KPIs, savings-by-category, terms gap) from the CDM via
 * /api/cockpit. Client hook so the Command Center reads real engine figures
 * instead of the retired hardcoded `dashboard.ts` constants.
 */
export function useCockpit(): { cockpit: Cockpit | null; loading: boolean } {
  const [cockpit, setCockpit] = useState<Cockpit | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch("/api/cockpit")
      .then((r) => r.json())
      .then((d: Cockpit) => {
        if (alive) setCockpit(d);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return { cockpit, loading };
}
