"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Vendor, VendorEvent } from "@/types/vendor";
import { adjustDeliveryForLeadTime, adjustTermsCriterion, recomputeScore } from "@/lib/score";

const TODAY = "2026-06-12";

export type VendorPatch = Partial<
  Pick<
    Vendor,
    | "leadTimeDays"
    | "paymentTermsDays"
    | "status"
    | "category"
    | "subcategory"
    | "notes"
    | "contractExpiry"
    | "leadTimeTrend"
  >
>;

export interface VendorStore {
  vendors: Vendor[];
  loading: boolean; // true until /api/vendors has seeded the store
  updateVendor: (id: string, patch: VendorPatch) => void;
  totalSpend: number;
  avgScore: number;
  overlapCount: number;
  missingTermsCount: number;
  missingTermsSpend: number;
}

const VendorStoreContext = createContext<VendorStore | null>(null);

function days(value: number | null): string {
  return value === null ? "—" : `${value}d`;
}

function terms(value: number | null): string {
  return value === null ? "— no data" : `Net ${value}`;
}

function text(value: string | null | undefined): string {
  return value === null || value === undefined || value === "" ? "—" : value;
}

export function VendorStoreProvider({ children }: { children: ReactNode }) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

  // Seed the store from the CDM-backed API on mount. updateVendor() then
  // mutates this fetched state exactly as it did on the mock array.
  useEffect(() => {
    fetch("/api/vendors")
      .then((r) => r.json())
      .then((data: Vendor[]) => {
        setVendors(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  /**
   * Every mutation is an immutable map-over that pairs each field change with
   * its VendorEvent append (and a score-recomputed event when the composite
   * moves), so the audit log can never drift from state.
   */
  const updateVendor = useCallback((id: string, patch: VendorPatch) => {
    setVendors((prev) =>
      prev.map((vendor) => {
        if (vendor.id !== id) return vendor;

        const newEvents: VendorEvent[] = [];
        let breakdown = vendor.scoreBreakdown;
        let leadChanged = false;
        let termsChanged = false;

        const next: Vendor = { ...vendor };

        if (patch.leadTimeDays !== undefined && patch.leadTimeDays !== vendor.leadTimeDays) {
          newEvents.push({
            kind: "lead-time-updated",
            actor: "Maria Vance",
            at: TODAY,
            note: `Lead time updated ${days(vendor.leadTimeDays)} → ${days(patch.leadTimeDays)}`,
            change: {
              field: "leadTimeDays",
              from: days(vendor.leadTimeDays),
              to: days(patch.leadTimeDays),
            },
          });
          breakdown = adjustDeliveryForLeadTime(breakdown, vendor.leadTimeDays, patch.leadTimeDays);
          next.leadTimeDays = patch.leadTimeDays;
          leadChanged = true;
        }

        if (patch.leadTimeTrend !== undefined && patch.leadTimeTrend !== vendor.leadTimeTrend) {
          newEvents.push({
            kind: "lead-time-updated",
            actor: "Maria Vance",
            at: TODAY,
            note: `Lead-time trend updated ${vendor.leadTimeTrend} → ${patch.leadTimeTrend}`,
            change: { field: "leadTimeTrend", from: vendor.leadTimeTrend, to: patch.leadTimeTrend },
          });
          next.leadTimeTrend = patch.leadTimeTrend;
        }

        if (
          patch.paymentTermsDays !== undefined &&
          patch.paymentTermsDays !== vendor.paymentTermsDays
        ) {
          newEvents.push({
            kind: "terms-updated",
            actor: "Maria Vance",
            at: TODAY,
            note: `Payment terms updated ${terms(vendor.paymentTermsDays)} → ${terms(patch.paymentTermsDays)}`,
            change: {
              field: "paymentTermsDays",
              from: terms(vendor.paymentTermsDays),
              to: terms(patch.paymentTermsDays),
            },
          });
          breakdown = adjustTermsCriterion(breakdown, patch.paymentTermsDays);
          next.paymentTermsDays = patch.paymentTermsDays;
          termsChanged = true;
        }

        if (patch.status !== undefined && patch.status !== vendor.status) {
          newEvents.push({
            kind: "status-changed",
            actor: "Maria Vance",
            at: TODAY,
            note: `Status changed ${vendor.status} → ${patch.status}`,
            change: { field: "status", from: vendor.status, to: patch.status },
          });
          next.status = patch.status;
        }

        if (patch.category !== undefined && patch.category !== vendor.category) {
          newEvents.push({
            kind: "category-changed",
            actor: "Maria Vance",
            at: TODAY,
            note: `Category changed ${vendor.category} → ${patch.category}`,
            change: { field: "category", from: vendor.category, to: patch.category },
          });
          next.category = patch.category;
        }

        if (patch.subcategory !== undefined && patch.subcategory !== vendor.subcategory) {
          newEvents.push({
            kind: "category-changed",
            actor: "Maria Vance",
            at: TODAY,
            note: `Sub-category changed ${text(vendor.subcategory)} → ${text(patch.subcategory)}`,
            change: {
              field: "subcategory",
              from: text(vendor.subcategory),
              to: text(patch.subcategory),
            },
          });
          next.subcategory = patch.subcategory;
        }

        if (patch.notes !== undefined && patch.notes !== vendor.notes) {
          newEvents.push({
            kind: "note",
            actor: "Maria Vance",
            at: TODAY,
            note: "Notes updated",
            change: { field: "notes", from: text(vendor.notes), to: text(patch.notes) },
          });
          next.notes = patch.notes;
        }

        if (patch.contractExpiry !== undefined && patch.contractExpiry !== vendor.contractExpiry) {
          newEvents.push({
            kind: "note",
            actor: "Maria Vance",
            at: TODAY,
            note: `Contract expiry updated ${text(vendor.contractExpiry)} → ${text(patch.contractExpiry)}`,
            change: {
              field: "contractExpiry",
              from: text(vendor.contractExpiry),
              to: text(patch.contractExpiry),
            },
          });
          next.contractExpiry = patch.contractExpiry;
        }

        if (newEvents.length === 0) return vendor;

        const newScore = recomputeScore(breakdown);
        if (newScore !== vendor.score) {
          const adjusted: string[] = [];
          if (leadChanged) adjusted.push("delivery criterion adjusted");
          if (termsChanged) adjusted.push("terms criterion adjusted");
          newEvents.push({
            kind: "score-recomputed",
            actor: "Mercer",
            at: TODAY,
            note: `Score ${vendor.score} → ${newScore} · ${adjusted.join(" · ") || "criteria adjusted"}`,
          });
        }

        return {
          ...next,
          scoreBreakdown: breakdown,
          score: newScore,
          events: [...vendor.events, ...newEvents],
        };
      }),
    );
  }, []);

  const totalSpend = useMemo(() => vendors.reduce((sum, v) => sum + v.annualSpend, 0), [vendors]);

  const avgScore = useMemo(
    () => (vendors.length === 0 ? 0 : Math.round(vendors.reduce((sum, v) => sum + v.score, 0) / vendors.length)),
    [vendors],
  );

  const overlapCount = useMemo(() => vendors.filter((v) => v.overlap).length, [vendors]);

  const missingTermsCount = useMemo(
    () => vendors.filter((v) => v.paymentTermsDays === null).length,
    [vendors],
  );

  const missingTermsSpend = useMemo(
    () =>
      vendors
        .filter((v) => v.paymentTermsDays === null)
        .reduce((sum, v) => sum + v.annualSpend, 0),
    [vendors],
  );

  const value = useMemo<VendorStore>(
    () => ({
      vendors,
      loading,
      updateVendor,
      totalSpend,
      avgScore,
      overlapCount,
      missingTermsCount,
      missingTermsSpend,
    }),
    [vendors, loading, updateVendor, totalSpend, avgScore, overlapCount, missingTermsCount, missingTermsSpend],
  );

  return <VendorStoreContext.Provider value={value}>{children}</VendorStoreContext.Provider>;
}

export function useVendorStore(): VendorStore {
  const ctx = useContext(VendorStoreContext);
  if (!ctx) {
    throw new Error("useVendorStore must be used within a VendorStoreProvider");
  }
  return ctx;
}
