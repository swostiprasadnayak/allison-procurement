"use client";

import { useEffect, useState } from "react";
import type { CategoryFootprint } from "@/lib/cdm";

/**
 * Live indirect-estate footprint (all L1 categories, spend, scan status) from
 * the CDM via /api/footprint. Powers the estate-level KPI tiles + the estate
 * scan table.
 */
export function useFootprint(): CategoryFootprint | null {
  const [footprint, setFootprint] = useState<CategoryFootprint | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/footprint")
      .then((r) => r.json())
      .then((d: CategoryFootprint) => {
        if (alive) setFootprint(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return footprint;
}
