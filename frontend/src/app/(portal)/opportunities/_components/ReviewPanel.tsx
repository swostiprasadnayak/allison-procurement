"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  DataTable,
  PanelAlert,
  Pill,
  useToast,
  type DataTableColumn,
} from "@navanta-ai/design-system";
import {
  ArrowSquareOut,
  Briefcase,
  Check,
  CheckCircle,
  Factory,
  NotePencil,
  SlidersHorizontal,
  Target,
} from "@phosphor-icons/react";
import type { Opportunity } from "@/types/opportunity";
import type { Vendor } from "@/types/vendor";
import { useVendorStore } from "@/context/VendorStoreContext";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useAskMercer } from "@/context/AskMercerContext";
import { ConfidenceMeter, MercerBand, MercerStar } from "@/components/mercer";
import { ModalShell } from "@/components/ui/ModalShell";
import { fmtCompact, fmtDate, fmtRange, pct } from "@/lib/format";
import { parseOverrideDraft, resolveSavings, resolveSavingsValues } from "@/lib/savings";
import { usePanelDialog } from "@/lib/usePanelDialog";
import { BAR_GRADIENT, EvidenceBlock } from "./EvidenceBlock";
import { SavingsWaterfallCard } from "./SavingsWaterfallCard";
import { FunctionalFitCard } from "./FunctionalFitCard";
import { SummaryOverrideBand } from "./SummaryOverrideBand";
import { ChangeTimeline } from "./ChangeTimeline";
import {
  YourInputCard,
  buildTextInput,
  hasSavedInput,
  inputDraftFrom,
  isInputDirty,
  type InputDraft,
} from "./YourInputCard";
import { statusLabel } from "./labels";

const TRACKED_STATUSES: ReadonlySet<Opportunity["status"]> = new Set([
  "committed",
  "in-execution",
  "realized",
]);

const MAX_ROSTER_ROWS = 8;

/** Read-only green band for plays already living in Value Realization. */
function StaticCommittedBand({ opp }: { opp: Opportunity }) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg p-3"
      style={{
        background: "linear-gradient(to right, #D6F5E2 0%, #F3FAF6 100%)",
        borderTop: "1px solid #CCCCFF",
      }}
    >
      <CheckCircle size={22} weight="duotone" color="#008234" className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm font-medium leading-snug" style={{ color: "#181A1B" }}>
          Committed · in Value Realization
        </p>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {fmtRange(opp.savingsLow, opp.savingsHigh)} target · {statusLabel(opp.status)}
          {opp.owner ? ` · owner ${opp.owner}` : ""}
        </p>
      </div>
    </div>
  );
}

// ─── Summary metrics row (IRIS SummaryMetricsRow chrome) ───────────────────
// White tiles with a 1px Iris-300 border inside the lavender summary card.
//   Label    — 12px regular   Value — 14px semibold   Sublabel — 11px regular

interface SummaryTile {
  label: string;
  value: string;
  sublabel: string;
}

function SummaryMetricsRow({ tiles }: { tiles: SummaryTile[] }) {
  return (
    <div className="mt-2 flex w-full flex-wrap gap-2">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="flex min-w-[104px] flex-1 flex-col gap-1 rounded-[8px] p-2"
          style={{ background: "transparent", border: "1px solid #E3D2FF" }}
        >
          <span className="whitespace-nowrap text-[12px] leading-[18px]" style={{ color: "#1E1E1E" }}>
            {t.label}
          </span>
          <span
            className="whitespace-nowrap text-[14px] font-medium leading-[22px]"
            style={{ color: "#181A1B", fontVariantNumeric: "tabular-nums" }}
          >
            {t.value}
          </span>
          <span
            className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] leading-[16px]"
            style={{ color: "#1E1E1E" }}
          >
            {t.sublabel}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The Mercer summary card — IRIS DemandDeck SummaryCard chrome: flat lavender
 * #F5EFFF card with the star header, the narrative paragraph, the metrics
 * row, and the swappable action band at the bottom. The band itself is
 * supplied by the caller (recommendation / override editor / committed / etc.)
 * so the summary owns layout, not decision state.
 */
function MercerSummaryCard({ opp, band }: { opp: Opportunity; band: ReactNode }) {
  // Savings reflects the operator's saved overrides, so the tile, the waterfall
  // and the committed figure always agree.
  const resolved = resolveSavings(opp);
  // Plain-language read of the confidence score — no formula, no derived metric.
  const confidenceWord =
    opp.confidencePct >= 70 ? "well-evidenced" : opp.confidencePct >= 40 ? "moderate" : "directional";
  // The savings rate applied to the addressable base (e.g. 5–8% for an RFP) —
  // shown so the range's derivation is transparent.
  const mov = opp.movableValue ?? 0;
  const rateLo = mov > 0 ? Math.round((resolved.low / mov) * 100) : 0;
  const rateHi = mov > 0 ? Math.round((resolved.high / mov) * 100) : 0;
  const tiles: SummaryTile[] = [
    { label: "Total spend", value: fmtCompact(opp.pocketSpend ?? 0), sublabel: "in this pocket" },
    { label: "Addressable", value: fmtCompact(opp.movableValue ?? 0), sublabel: "contestable spend" },
    {
      label: "Savings Potential",
      value: fmtRange(resolved.low, resolved.high),
      sublabel: rateHi > 0 ? `${rateLo}–${rateHi}% of addressable` : "estimated",
    },
    { label: "Confidence", value: pct(opp.confidencePct), sublabel: confidenceWord },
  ];

  return (
    <div
      className="flex w-full flex-col overflow-hidden rounded-[12px]"
      style={{ background: "#F5EFFF" }}
    >
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <MercerStar size={16} />
          <span className="text-[14px] font-medium" style={{ color: "#181A1B" }}>
            Mercer Summary
          </span>
        </div>

        <p className="text-[14px] font-normal leading-relaxed" style={{ color: "#18181B" }}>
          {opp.mercerSummary}
        </p>

        <SummaryMetricsRow tiles={tiles} />
      </div>

      {/* Recommendation band as a full-width footer (Figma node 22:299): the
          flush MercerBand fills edge-to-edge; the other swappable states render
          inside their own padding (see bandNode). */}
      {band}
    </div>
  );
}

// ─── Evidence tables — real DS DataTable, share bars as cell renderers ──────

/** Top-5 / share-of-addressable bar — the IRIS weight-bar, used as a DataTable
 *  cell renderer (DataTable supports arbitrary cell content). */
function ShareBar({ share }: { share: number }) {
  const clamped = Math.min(100, Math.max(0, share));
  return (
    <div className="flex items-center gap-2">
      <div
        className="relative shrink-0 overflow-hidden rounded-full"
        style={{ width: 60, height: 4, background: "var(--muted)" }}
      >
        <div
          className="absolute bottom-0 left-0 top-0 rounded-full"
          style={{ width: `${clamped}%`, background: BAR_GRADIENT }}
        />
      </div>
      <span className="text-[13px]" style={{ color: "#181A1B", fontVariantNumeric: "tabular-nums" }}>
        {pct(Math.round(clamped))}
      </span>
    </div>
  );
}

/** Vendor roster — a DS DataTable with share-of-addressable bars. */
type RosterEntry = NonNullable<Opportunity["vendorRoster"]>[number];

function RosterTable({ roster }: { roster: RosterEntry[] }) {
  const router = useRouter();
  // Default to the top-N preview; expand to the full roster on demand.
  const [expanded, setExpanded] = useState(false);
  if (roster.length === 0) return null;
  const canExpand = roster.length > MAX_ROSTER_ROWS;
  const shown = expanded ? roster : roster.slice(0, MAX_ROSTER_ROWS);
  // Compare tops out at 4 vendors for a readable side-by-side table — the
  // pocket's biggest names (already sorted by share) plus the anchor if it's
  // outside that top slice.
  const compareTargets = roster.slice(0, 4);

  const columns: DataTableColumn<RosterEntry>[] = [
    {
      key: "vendor",
      label: "Vendor",
      minWidth: 180,
      cell: (v) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
            {v.name}
          </span>
          {v.isWinner && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-[4px] px-2 py-0.5"
              style={{ background: "#F5EFFF", color: "#59349C" }}
            >
              <MercerStar size={10} />
              <span className="text-[11px] font-medium">Anchor</span>
            </span>
          )}
        </span>
      ),
    },
    {
      key: "spend",
      label: "Spend",
      align: "right",
      cellLayout: "end",
      width: 88,
      cell: (v) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtCompact(v.spend)}</span>
      ),
    },
    {
      key: "at",
      label: "AT",
      align: "right",
      cellLayout: "end",
      width: 76,
      cell: (v) => (
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
          {v.at ? fmtCompact(v.at) : "—"}
        </span>
      ),
    },
    {
      key: "aoh",
      label: "AOH",
      align: "right",
      cellLayout: "end",
      width: 76,
      cell: (v) => (
        <span style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
          {v.aoh ? fmtCompact(v.aoh) : "—"}
        </span>
      ),
    },
    {
      key: "share",
      label: "Share of pocket",
      minWidth: 150,
      // Real per-pocket share from opp.opportunity_vendor — sums to ~100%.
      cell: (v) => <ShareBar share={v.share * 100} />,
    },
    {
      key: "type",
      label: "Capability",
      minWidth: 110,
      // Engine per-pocket capability_class (broad-line / specialist); "—" if unset.
      cell: (v) => (
        <span className="truncate text-xs capitalize" style={{ color: "var(--text-secondary)" }}>
          {v.capabilityClass ?? "—"}
        </span>
      ),
    },
  ];

  return (
    <EvidenceBlock
      icon={Factory}
      title="Vendor roster · addressable base"
      headerRight={
        <Button
          variant="outline"
          size="sm"
          iconLeft={<ArrowSquareOut size={13} weight="bold" />}
          onClick={() => router.push(`/vendors?compare=${compareTargets.map((v) => v.id).join(",")}`)}
        >
          Compare vendors
        </Button>
      }
      footnote={
        canExpand ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-medium"
            style={{ color: "#59349C" }}
          >
            {expanded
              ? "Show fewer"
              : `Show all ${roster.length.toLocaleString("en-US")} vendors`}
          </button>
        ) : undefined
      }
    >
      {/* Bleed out of EvidenceBlock's px-3/pb-3 — the DataTable pads its own
          cells, so the wrapper padding just doubled the inset. */}
      <div className="-mx-3 -mb-3">
        <DataTable<RosterEntry> columns={columns} data={shown} rowKey={(v) => v.name} />
      </div>
    </EvidenceBlock>
  );
}

/**
 * A credible RFP bidder shortlist, derived from the roster: broad-line suppliers
 * (can serve the full consolidated scope) anchor it, topped up with the largest
 * incumbents by share for competitive tension. OEM / sole-source excluded (can't
 * be competed). Capped so it's a real shortlist, not the whole fragmented base.
 */
/** Minimum pocket share to be a credible bidder — excludes the long tail. Tuned
 *  on the data: at 5% the shortlist runs ~5 bidders/pocket and no pocket is left
 *  empty (10% is thin, 20% leaves several pockets with zero). */
const MIN_BIDDER_SHARE = 0.05;

function rfpShortlist(roster: RosterEntry[]): RosterEntry[] {
  const eligible = [...roster]
    .filter((v) => !v.isOem && v.share >= MIN_BIDDER_SHARE)
    .sort((a, b) => b.share - a.share);
  const broadline = eligible.filter((v) => v.capabilityClass === "broad-line");
  const picked: RosterEntry[] = [];
  const seen = new Set<string>();
  for (const v of [...broadline, ...eligible]) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    picked.push(v);
    if (picked.length >= 5) break;
  }
  return picked.sort((a, b) => b.share - a.share);
}

function RecommendedBidders({ roster }: { roster: RosterEntry[] }) {
  const shortlist = rfpShortlist(roster);
  if (shortlist.length === 0) return null;
  const anchors = shortlist.filter((v) => v.capabilityClass === "broad-line");
  const covered = shortlist.reduce((s, v) => s + v.share, 0);
  return (
    <EvidenceBlock icon={Target} title="Recommended bidders">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-1.5">
          {shortlist.map((v) => (
            <span
              key={v.name}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12px]"
              style={{ background: "#F5EFFF", color: "#181A1B" }}
            >
              <span className="font-medium">{v.name}</span>
              <span style={{ color: "var(--text-secondary)" }}>{Math.round(v.share * 100)}%</span>
              {v.capabilityClass === "broad-line" && (
                <span className="text-[10px] font-medium" style={{ color: "#59349C" }}>
                  broad-line
                </span>
              )}
            </span>
          ))}
        </div>
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          {anchors.length > 0
            ? `Broad-line suppliers can anchor the full consolidated scope; the rest are top incumbents for competitive tension`
            : `Top incumbents by share — no broad-line supplier in this pocket, so confirm full-scope coverage before issuing`}{" "}
          (~{Math.round(covered * 100)}% of the pocket). OEM / sole-source excluded.
        </p>
      </div>
    </EvidenceBlock>
  );
}

interface ReviewPanelProps {
  opp: Opportunity | null;
  open: boolean;
  onClose: () => void;
  /** Accept → navigate to the Act page for this opportunity (commit happens there). */
  onAccept: () => void;
  onRejectRequest: () => void;
  onParkRequest: () => void;
  /** Return a parked opp to the feed (Parked tab only). */
  onUnpark?: () => void;
}

/**
 * The review modal — IRIS demand-deck UI style with Allison content. The
 * lavender Mercer Summary card leads (narrative → 5 metric tiles → action
 * band), followed by caveats and the evidence tables (entity comparison,
 * vendor roster), exclusions and the history timeline. The footer carries
 * the Reject / Park / Approve decision, swapping to Done after the
 * commit micro-sequence.
 */
export function ReviewPanel({
  opp,
  open,
  onClose,
  onAccept,
  onRejectRequest,
  onParkRequest,
  onUnpark,
}: ReviewPanelProps) {
  const router = useRouter();
  const { vendors } = useVendorStore();
  const { saveOppInput, regenerateAnalysis } = useOpportunityStore();
  const { openMercer, open: mercerOpen } = useAskMercer();
  const { addToast } = useToast();

  // Escape-to-close, focus management and dialog semantics for the portaled shell.
  usePanelDialog(open && Boolean(opp), onClose, opp ? `Review ${opp.id}` : undefined);

  // Freeze the rendered opp while the modal is closed so a re-open mid-store-
  // update never flickers during the exit slide. While open, content is live.
  const [snapshot, setSnapshot] = useState<Opportunity | null>(null);
  if (open && opp && snapshot !== opp) {
    setSnapshot(opp);
  }
  const view = open ? opp : (snapshot ?? opp);

  const anchorVendor = useMemo<Vendor | undefined>(() => {
    const anchorId = view?.consolidatedSide.anchorVendorId;
    return anchorId ? vendors.find((v) => v.id === anchorId) : undefined;
  }, [view, vendors]);

  // ── Your Input draft ──────────────────────────────────────────────────────
  // Re-seeded synchronously whenever a different opp opens OR the panel
  // re-opens (the "adjust state during render" pattern, mirroring the vendor
  // edit form): a reopened panel never restores a stale dirty draft. NOT
  // cleared on close — the exit slide still needs its content.
  const [draft, setDraft] = useState<InputDraft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  // Summary override editor — open state + the two figure fields as raw text.
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideDraft, setOverrideDraft] = useState({ addressable: "", savingsPct: "" });
  // "Add context" editor (Your Input) — surfaced from the recommendation band,
  // alongside Override figures, so both ways to improve Mercer's number live in
  // one place instead of scattered down the modal.
  const [inputOpen, setInputOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && view) {
      setDraftId(view.id);
      setDraft(inputDraftFrom(view));
      setOverrideOpen(false);
      setInputOpen(false);
    }
  } else if (view && draftId !== view.id) {
    setDraftId(view.id);
    setDraft(inputDraftFrom(view));
    setOverrideOpen(false);
    setInputOpen(false);
  }
  const activeDraft = view && draftId === view.id ? draft : null;

  const inputDirty = Boolean(view && activeDraft && isInputDirty(activeDraft, view.userInput));

  // ── Regenerate (Mercer re-run) — local spinner, store append on completion ──
  const [regenerating, setRegenerating] = useState(false);
  const regenTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (regenTimer.current !== null) window.clearTimeout(regenTimer.current);
    },
    [],
  );

  const handleSaveInput = useCallback(() => {
    if (!view || !activeDraft) return;
    saveOppInput(view.id, buildTextInput(activeDraft));
    addToast("Your input saved", "success");
  }, [view, activeDraft, saveOppInput, addToast]);

  // Open the copilot scoped to this play. The copilot keys off the engine
  // surrogate (`engineId`), not the friendly "OPP-NNN"; the FE Opportunity type
  // doesn't declare it, so read it defensively (it rides through /api/opportunities).
  const handleAskMercer = useCallback(() => {
    if (!view) return;
    const engineId = (view as Opportunity & { engineId?: string }).engineId ?? view.id;
    openMercer({ page: "qualify", opportunityId: engineId, opportunityTitle: view.title });
  }, [view, openMercer]);

  const handleRegenerate = useCallback(() => {
    if (!view || regenerating) return;
    const id = view.id;
    setRegenerating(true);
    addToast("Mercer is re-running the analysis…", "info");
    if (regenTimer.current !== null) window.clearTimeout(regenTimer.current);
    regenTimer.current = window.setTimeout(() => {
      regenTimer.current = null;
      regenerateAnalysis(id);
      setRegenerating(false);
      addToast("Analysis regenerated with your input", "success");
    }, 1200);
  }, [view, regenerating, regenerateAnalysis, addToast]);

  // ── Summary override editor handlers ──────────────────────────────────────
  const openOverride = useCallback(() => {
    if (!view) return;
    setInputOpen(false);
    setOverrideDraft({
      addressable: view.userInput?.overrideAddressable != null ? String(view.userInput.overrideAddressable) : "",
      savingsPct: view.userInput?.overrideSavingsPct != null ? String(view.userInput.overrideSavingsPct) : "",
    });
    setOverrideOpen(true);
  }, [view]);

  // "Add context" toggles the Your Input editor open right under the summary;
  // it's mutually exclusive with the override editor so only one is open.
  const toggleInput = useCallback(() => {
    setOverrideOpen(false);
    setInputOpen((v) => !v);
  }, []);

  const overrideParsed = parseOverrideDraft(overrideDraft.addressable, overrideDraft.savingsPct);
  const overridePreview = view
    ? resolveSavingsValues(
        view.movableValue ?? view.addressableSpend,
        view.savingsLow,
        view.savingsHigh,
        overrideParsed.overrideAddressable,
        overrideParsed.overrideSavingsPct,
      )
    : null;
  const overrideChanged = Boolean(
    view &&
      ((overrideParsed.overrideAddressable ?? null) !== (view.userInput?.overrideAddressable ?? null) ||
        (overrideParsed.overrideSavingsPct ?? null) !== (view.userInput?.overrideSavingsPct ?? null)),
  );

  const handleApplyOverride = useCallback(() => {
    if (!view) return;
    const parsed = parseOverrideDraft(overrideDraft.addressable, overrideDraft.savingsPct);
    if (!parsed.addressableValid || !parsed.savingsPctValid) return;
    saveOppInput(view.id, {
      overrideAddressable: parsed.overrideAddressable,
      overrideSavingsPct: parsed.overrideSavingsPct,
    });
    setOverrideOpen(false);
    addToast(
      parsed.overrideAddressable != null || parsed.overrideSavingsPct != null
        ? "Figures overridden · savings re-derived"
        : "Override cleared · back to workbook",
      "success",
    );
  }, [view, overrideDraft, saveOppInput, addToast]);

  const isTracked = view ? TRACKED_STATUSES.has(view.status) : false;
  const isRejected = view?.status === "rejected";
  const isParked = view?.status === "parked";
  // Editable (Add context / Override / Approve) only while the play is live in
  // the feed — committed/rejected/parked opps re-open read-only.
  const isEditable = Boolean(view) && !isTracked && !isRejected && !isParked;

  // ── Swappable summary band (IRIS "only the band below changes") ───────────
  // Recommendation by default — with an "Override figures" affordance — and the
  // override editor, committed band, static tracked band, rejection notice or
  // parked notice swap in as state dictates.
  let bandNode: ReactNode = null;
  if (view) {
    if (isTracked) {
      bandNode = (
        <div className="px-3 pb-3">
          <StaticCommittedBand opp={view} />
        </div>
      );
    } else if (isRejected) {
      bandNode = (
        <div className="px-3 pb-3">
          <PanelAlert
            type="cancelled"
            title={`Rejected · ${view.rejectReason ?? "screened out"}`}
            description="Logged for sweep calibration — the bucket stays visible under Rejected."
          />
        </div>
      );
    } else if (isParked) {
      bandNode = (
        <div className="px-3 pb-3">
          <PanelAlert
            type="info"
            title={`Parked · revisit: ${view.parkTrigger ?? "later"}`}
            description="Held for later — resurfaces when its revisit trigger fires."
          />
        </div>
      );
    } else if (overrideOpen && overridePreview) {
      bandNode = (
        <div className="px-3 pb-3">
          <SummaryOverrideBand
            addressable={overrideDraft.addressable}
            savingsPct={overrideDraft.savingsPct}
            onAddressableChange={(v) => setOverrideDraft((d) => ({ ...d, addressable: v }))}
            onSavingsPctChange={(v) => setOverrideDraft((d) => ({ ...d, savingsPct: v }))}
            baseAddressable={overridePreview.baseAddressable}
            baseLowPct={overridePreview.baseLowPct}
            baseHighPct={overridePreview.baseHighPct}
            preview={overridePreview}
            addressableValid={overrideParsed.addressableValid}
            savingsPctValid={overrideParsed.savingsPctValid}
            applyDisabled={
              !overrideParsed.addressableValid || !overrideParsed.savingsPctValid || !overrideChanged
            }
            onCancel={() => setOverrideOpen(false)}
            onApply={handleApplyOverride}
          />
        </div>
      );
    } else {
      bandNode = (
        <MercerBand
          caption={`Mercer recommends · Confidence ${pct(view.confidencePct)}`}
          headline={view.recommendedAction}
          bullets={view.rationale}
          collapsibleBullets
          horizontal
          flush
          actions={
            isEditable ? (
              <>
                <Button
                  variant="christy"
                  size="sm"
                  iconLeft={<MercerStar size={14} />}
                  onClick={handleAskMercer}
                >
                  Ask Mercer about this
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  iconLeft={<NotePencil size={14} weight="bold" />}
                  onClick={toggleInput}
                >
                  {inputOpen ? "Hide context" : "Add context"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  iconLeft={<SlidersHorizontal size={14} weight="bold" />}
                  onClick={openOverride}
                >
                  Override figures
                </Button>
                {/* Approve also lives in the band (co-located with the
                    recommendation); the same action sits in the footer. */}
                <Button
                  variant="christy"
                  size="sm"
                  onClick={onAccept}
                  disabled={inputDirty || overrideOpen}
                  iconLeft={<Check size={14} weight="bold" />}
                  title={
                    overrideOpen
                      ? "Apply or cancel your override before continuing"
                      : inputDirty
                        ? "Save or discard your input before continuing"
                        : undefined
                  }
                >
                  Approve
                </Button>
              </>
            ) : undefined
          }
        />
      );
    }
  }

  let footer: ReactNode = null;
  if (view) {
    if (isTracked) {
      footer = (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="christy"
            iconLeft={<MercerStar size={14} />}
            onClick={handleAskMercer}
          >
            Ask Mercer about this
          </Button>
          <Button
            variant="outline"
            iconRight={<ArrowSquareOut size={14} />}
            onClick={() => router.push("/tracking")}
          >
            View in Value Realization
          </Button>
        </div>
      );
    } else if (isRejected || isParked) {
      footer = (
        <div className="flex items-center justify-between gap-2">
          <Button
            variant="christy"
            iconLeft={<MercerStar size={14} />}
            onClick={handleAskMercer}
          >
            Ask Mercer about this
          </Button>
          <div className="flex items-center gap-2">
            {isParked && onUnpark && (
              <Button variant="primary" onClick={onUnpark}>
                Return to feed
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      );
    } else {
      footer = (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onRejectRequest}>
            Reject
          </Button>
          <Button variant="outline" onClick={onParkRequest}>
            Park
          </Button>
          {/* Approve moves the opportunity into Act (commit happens there).
              Blocked while the override editor is open or Your Input has unsaved
              edits so the figures she's approving are settled first. */}
          <Button
            variant="christy"
            onClick={onAccept}
            disabled={inputDirty || overrideOpen}
            iconLeft={<Check size={14} weight="bold" />}
            title={
              overrideOpen
                ? "Apply or cancel your override before continuing"
                : inputDirty
                  ? "Save or discard your input before continuing"
                  : undefined
            }
          >
            Approve
          </Button>
        </div>
      );
    }
  }

  return (
    <ModalShell
      open={open && !!opp}
      onClose={onClose}
      title={view?.id ?? ""}
      subtitle={view?.title}
      icon={Briefcase}
      size="deck"
      // Shift left so the docked Ask Mercer panel (max-w-[420px]) doesn't overlap.
      reservedRight={mercerOpen ? 440 : 0}
      headerMeta={
        view ? (
          <>
            <span
              className="rounded-[4px] px-2 py-0.5 text-[12px]"
              style={{ background: "var(--muted)", color: "var(--text-primary)" }}
            >
              {view.l2} · {view.country}
            </span>
            <ConfidenceMeter pct={view.confidencePct} size="md" />
          </>
        ) : undefined
      }
      footer={footer}
    >
      {view ? (
        <>
          <MercerSummaryCard opp={view} band={bandNode} />

          {/* Your Input editor — opened from the recommendation band's "Add
              context" button, so the qualitative context Mercer can't see sits
              right under the play it informs (was buried at the modal bottom). */}
          {isEditable && inputOpen && activeDraft && (
            <YourInputCard
              draft={activeDraft}
              onChange={setDraft}
              anchorVendorName={anchorVendor?.name}
              dirty={inputDirty}
              savedAt={view.userInput?.savedAt ? fmtDate(view.userInput.savedAt) : undefined}
              hasSaved={hasSavedInput(view)}
              regenerating={regenerating}
              onSave={handleSaveInput}
              onRegenerate={handleRegenerate}
            />
          )}

          {/* Sub-classify opps lead with a plain-English definition of the lever so
              "Sub-classify" is never a bare, unexplained term. */}
          {view.playRoute === "sub-classify" && (
            <PanelAlert
              type="info"
              title="What “Sub-classify” means"
              description="This category has no sub-commodity (L3) breakdown in the source data, so the pocket bundles unlike items under one heading. It isn't a single sourcing event yet — it must first be split into coherent sub-categories (which the part / spec master enables). The figures below are directional at the category level."
            />
          )}

          {view.caveats?.map((caveat) => (
            <PanelAlert
              key={caveat}
              type="warning"
              title={view.playRoute === "sub-classify" ? "Why it isn’t sourcing-ready" : "Data caveat"}
              description={caveat}
            />
          ))}

          {/* Vendor roster first — the supplier landscape grounds the fit +
              savings read that follow. */}
          <RosterTable roster={view.vendorRoster ?? []} />

          {/* For a competitive RFP, name the credible bidder shortlist (who to run
              it with) — not the whole fragmented base. */}
          {view.playRoute === "rfp" && <RecommendedBidders roster={view.vendorRoster ?? []} />}

          {/* Functional fit — feasibility read, every row DERIVED from real engine signals
              (cross-BU, OEM share, geography, lever) in cdm.ts. Renders nothing if absent. */}
          <FunctionalFitCard opp={view} />

          {/* The savings derivation behind the summary tile's range — the engine's
              pocket → carve-outs → movable, then the conservative/stretch
              outcomes (which reflect saved overrides). Hidden once tracked:
              commit bakes the figures in, so the baseline is no longer the right
              comparison. */}
          {!isTracked && (
            <SavingsWaterfallCard
              pocket={view.pocketSpend ?? 0}
              exclusions={view.exclusions ?? []}
              movable={view.movableValue ?? 0}
              resolved={resolveSavings(view)}
            />
          )}

          <ChangeTimeline events={view.events} />
        </>
      ) : null}
    </ModalShell>
  );
}
