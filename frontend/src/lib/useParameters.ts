"use client";

import { useCallback, useEffect, useState } from "react";
import type { EngineParameters } from "@/lib/cdm";

/**
 * Live engine parameter registry (opp.engine_parameter) from the CDM via
 * /api/parameters. Powers the Admin › Methodology & Parameters page. Returns a
 * `reload` so the page can refetch after saving an edit.
 */
export function useParameters(): { params: EngineParameters | null; reload: () => void } {
  const [params, setParams] = useState<EngineParameters | null>(null);

  const reload = useCallback(() => {
    fetch("/api/parameters")
      .then((r) => r.json())
      .then((d: EngineParameters) => setParams(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return { params, reload };
}
