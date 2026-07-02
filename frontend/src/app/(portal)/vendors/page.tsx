"use client";

import { useMemo, useState } from "react";
import { Flask } from "@phosphor-icons/react";
import { useVendorStore } from "@/context/VendorStoreContext";
import { VendorKpis } from "./_components/VendorKpis";
import { VendorTable } from "./_components/VendorTable";
import { VendorDetailPanel } from "./_components/VendorDetailPanel";

/**
 * /vendors — Supplier Management. Real backbone: the combined AT + AOH roster,
 * spend, entity overlap, and each vendor's role across the plays (from
 * opp.opportunity_vendor). Layered with an illustrative vendor-performance
 * module (future) — real where operational data exists, illustrative otherwise.
 */
export default function VendorsPage() {
  const { vendors } = useVendorStore();

  // Panel selection: keep the id after close so the slide-out animation
  // retains its content while the modal closes (ModalShell unmounts on close).
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const selected = useMemo(
    () => vendors.find((v) => v.id === selectedId) ?? null,
    [vendors, selectedId],
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
      />

      <VendorDetailPanel
        vendor={selected}
        open={panelOpen && selected !== null}
        onClose={() => setPanelOpen(false)}
      />
    </>
  );
}
