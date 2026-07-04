"use client";

import { useEffect, useState } from "react";
import type { GeographyRegion } from "@/lib/cdm";

/**
 * Live region -> country spend hierarchy from the CDM via /api/geography.
 * Powers the ScopeMenu's Region/Country pickers and the Opportunity Feed's
 * region-as-country-set filter (see ScopeContext.region for why region isn't
 * a native opportunity field).
 */
export function useGeography(): GeographyRegion[] {
  const [regions, setRegions] = useState<GeographyRegion[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/geography")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d?.regions)) setRegions(d.regions);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return regions;
}
