"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import * as ReactDOM from "react-dom";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  SegmentedControl,
  Tooltip,
} from "@navanta-ai/design-system";
import { CaretDown, Info } from "@phosphor-icons/react";
import { fmtCompact } from "@/lib/format";
import { useScope, type BusinessUnit } from "@/context/ScopeContext";
import { useGeography } from "@/lib/useGeography";

const ALL_COUNTRY = "__all_country";

type FootprintCategory = { name: string; spend: number; scanned: boolean };

/**
 * The scope hierarchy menu — Business Unit -> Region/Country -> Category (L1).
 * A single trigger (matches the app's other header controls) opens a panel with
 * every level; L2 sub-category stays its own adjacent Select (SubCategoryFilter)
 * since it's the highest-cardinality, highest-traffic pick.
 *
 * Plant is shown disabled with an explanation rather than omitted outright —
 * `location_id` is NULL engine-wide until the SAP location-master feed lands
 * (same "designed for, not yet populated" pattern as vendor_performance's
 * on_time_pct/fill_rate_pct). Region is a UI grouping over its member
 * countries (pockets don't carry region), not a separate DB column.
 */
export function ScopeMenu() {
  const { l1, setL1, businessUnit, setBusinessUnit, region, setRegion, country, setCountry } = useScope();

  const [open, setOpen] = useState(false);
  const [cats, setCats] = useState<FootprintCategory[]>([]);
  const regions = useGeography();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState({ top: 0, left: 0 });

  // Refs can't be read during render (React Compiler flags it, and it'd be
  // stale on the frame the panel first mounts anyway) — measure the trigger
  // in an effect once it's open instead.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setCoords({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX });
  }, [open]);

  useEffect(() => {
    let alive = true;
    fetch("/api/footprint")
      .then((r) => r.json())
      .then((d) => alive && Array.isArray(d?.categories) && setCats(d.categories))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      // The DS Select renders its own dropdown in a separate document.body
      // portal (a sibling of this panel's portal, not a descendant) — a click
      // on a Region/Category option would otherwise look like an outside
      // click and close this panel before the Select applies the value.
      if (t instanceof Element && t.closest('[role="listbox"]')) return;
      setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const scanned = cats.find((c) => c.scanned);
  const expansion = cats.filter((c) => !c.scanned);
  const activeRegion = regions.find((r) => r.name === region) ?? null;

  const summary = useMemo(() => {
    const buLabel = businessUnit === "ALL" ? null : businessUnit;
    const geoLabel = country ?? region ?? null;
    return [buLabel, geoLabel, l1].filter(Boolean).join(" · ");
  }, [businessUnit, region, country, l1]);

  const BU_OPTIONS: { value: BusinessUnit; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "AT", label: "AT" },
    { value: "OH", label: "AOH" },
  ];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors hover:bg-[var(--sidebar-hover-bg)]"
        style={{ borderColor: "var(--border)", color: "var(--text-primary)" }}
      >
        <span>{summary}</span>
        {scanned && (
          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
            {fmtCompact(scanned.spend)}
          </span>
        )}
        <CaretDown size={12} weight="bold" style={{ color: "var(--text-secondary)" }} />
      </button>

      {open &&
        typeof document !== "undefined" &&
        ReactDOM.createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Scope filter"
            style={{
              position: "absolute",
              top: coords.top,
              left: coords.left,
              width: 320,
              zIndex: 9999,
            }}
            className="rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
          >
            <div className="flex flex-col gap-4">
              {/* Business unit */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Business unit
                </span>
                <SegmentedControl
                  aria-label="Business unit"
                  size="sm"
                  fullWidth
                  value={businessUnit}
                  onValueChange={(v) => setBusinessUnit(v as BusinessUnit)}
                  options={BU_OPTIONS}
                />
              </div>

              {/* Region / country */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Region
                </span>
                <Select
                  value={region ?? ALL_COUNTRY}
                  onValueChange={(v) => setRegion(v === ALL_COUNTRY ? null : v)}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="All regions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_COUNTRY}>All regions</SelectItem>
                    {regions.map((r) => (
                      <SelectItem key={r.name} value={r.name}>
                        <span className="flex w-full items-center justify-between gap-8">
                          <span>{r.name}</span>
                          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {fmtCompact(r.spend)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={country ?? ALL_COUNTRY}
                  onValueChange={(v) => setCountry(v === ALL_COUNTRY ? null : v)}
                  disabled={!activeRegion}
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder={activeRegion ? "All countries" : "Pick a region first"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_COUNTRY}>All countries</SelectItem>
                    {activeRegion?.countries.map((c) => (
                      <SelectItem key={c.name} value={c.name}>
                        <span className="flex w-full items-center justify-between gap-8">
                          <span>{c.name}</span>
                          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {fmtCompact(c.spend)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Plant — reserved, not real yet */}
              <div className="flex flex-col gap-1.5">
                <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Plant
                  <Tooltip content="Pending the SAP location-master feed — plant-level detail isn't in the CDM yet (same designed-for gap as vendor lead-time/fill-rate).">
                    <Info size={12} weight="bold" />
                  </Tooltip>
                </span>
                <button
                  type="button"
                  disabled
                  className="flex h-8 w-full cursor-not-allowed items-center rounded-lg border px-2.5 text-left text-sm opacity-50"
                  style={{ borderColor: "var(--border)", color: "var(--text-secondary)" }}
                >
                  All plants
                </button>
              </div>

              {/* Category (L1) */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold" style={{ color: "var(--text-secondary)" }}>
                  Category
                </span>
                <Select value={l1} onValueChange={setL1}>
                  <SelectTrigger size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MRO">
                      <span className="flex w-full items-center justify-between gap-8">
                        <span>MRO</span>
                        {scanned && (
                          <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                            {fmtCompact(scanned.spend)}
                          </span>
                        )}
                      </span>
                    </SelectItem>
                    {expansion.length > 0 && (
                      <SelectGroup>
                        <SelectLabel>Expanding to</SelectLabel>
                        {expansion.map((c) => (
                          <SelectItem key={c.name} value={c.name} disabled>
                            <span className="flex w-full items-center justify-between gap-8">
                              <span>{c.name}</span>
                              <span className="tabular-nums" style={{ color: "var(--text-secondary)" }}>
                                {fmtCompact(c.spend)}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
