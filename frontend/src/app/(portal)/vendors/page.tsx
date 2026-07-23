"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Flask } from "@phosphor-icons/react";
import { useVendorStore } from "@/context/VendorStoreContext";
import { VendorKpis } from "./_components/VendorKpis";
import { VendorTable } from "./_components/VendorTable";
import { VendorDetailPanel } from "./_components/VendorDetailPanel";
import { VendorCompareModal } from "./_components/VendorCompareModal";

/**
 * /vendors — Supplier Management. Real backbone: the combined AT + AOH roster,
 * spend, entity overlap, and each vendor's role across the plays (from
 * opp.opportunity_vendor). Layered with an illustrative vendor-performance
 * module (future) — real where operational data exists, illustrative otherwise.
 */
export default function VendorsPage() {
  // useSearchParams() (read by VendorsPageBody, for the ?compare= deep link)
  // requires a Suspense boundary — Next.js opts the page out of static
  // rendering otherwise.
  return (
    <Suspense fallback={null}>
      <VendorsPageBody />
    </Suspense>
  );
}

function VendorsPageBody() {
  const { vendors } = useVendorStore();
  const searchParams = useSearchParams();

  // Panel selection: keep the id after close so the slide-out animation
  // retains its content while the modal closes (ModalShell unmounts on close).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const selected = useMemo(
    () => vendors.find((v) => v.id === selectedId) ?? null,
    [vendors, selectedId],
  );

  // Compare selection — checkboxes in the table, OR a deep link from an
  // opportunity's vendor roster ("Compare vendors" -> /vendors?compare=id1,id2).
  // Seeded once from the URL via a lazy initializer (searchParams is available
  // synchronously) — the table's own checkboxes own the selection from here,
  // so this doesn't need to react to further URL changes.
  const [compareIds, setCompareIds] = useState<Set<string>>(() => {
    const param = searchParams.get("compare");
    return param ? new Set(param.split(",").filter(Boolean)) : new Set();
  });
  const [compareOpen, setCompareOpen] = useState(() => Boolean(searchParams.get("compare")));

  const compareVendors = useMemo(
    () => vendors.filter((v) => compareIds.has(v.id)),
    [vendors, compareIds],
  );

  return (
    <>
      {/* Single, page-level note that the performance layer is a future module. */}
      <div
        className="flex items-center gap-2 rounded-[10px] border border-dashed px-3 py-2"
        style={{ borderColor: "var(--border-default)", background: "var(--surface-raised)" }}
      >
        <Flask size={14} weight="duotone" style={{ color: "var(--text-neutral)" }} />
        <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
          Roster, spend, overlap and <strong style={{ color: "var(--text-primary)" }}>sourcing role</strong> are live.{" "}
          <strong style={{ color: "var(--text-primary)" }}>Performance</strong> is an illustrative future module —
          real where operational data exists (delivery, transaction volume), illustrative elsewhere.
        </span>
      </div>

      <VendorKpis />

      <VendorTable
        onSelect={(id) => {
          setSelectedId(id);
          setPanelOpen(true);
        }}
        compareIds={compareIds}
        onCompareIdsChange={setCompareIds}
        onOpenCompare={() => setCompareOpen(true)}
      />

      <VendorDetailPanel
        vendor={selected}
        open={panelOpen && selected !== null}
        onClose={() => setPanelOpen(false)}
      />

      <VendorCompareModal
        vendors={compareVendors}
        open={compareOpen && compareVendors.length > 0}
        onClose={() => setCompareOpen(false)}
      />
    </>
  );
}
