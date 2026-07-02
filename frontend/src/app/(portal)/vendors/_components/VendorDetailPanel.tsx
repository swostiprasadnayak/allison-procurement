"use client";

import { useState, type ReactNode } from "react";
import {
  Button,
  Input,
  PanelInfoGrid,
  PanelTimeline,
  Pill,
  Select,
  Textarea,
  useToast,
  type InfoRow,
} from "@navanta-ai/design-system";
import {
  ArrowsLeftRight,
  Buildings,
  CalendarBlank,
  CircleHalf,
  GlobeHemisphereWest,
  Factory,
  Receipt,
  Tag,
  Timer,
} from "@phosphor-icons/react";
import { MercerBand, MercerStar } from "@/components/mercer";
import { useAskMercer } from "@/context/AskMercerContext";
import { ModalShell } from "@/components/ui/ModalShell";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { useVendorStore, type VendorPatch } from "@/context/VendorStoreContext";
import { fmtCompact, pct } from "@/lib/format";
import { usePanelDialog } from "@/lib/usePanelDialog";
import { adjustDeliveryForLeadTime, adjustTermsCriterion, recomputeScore } from "@/lib/score";
import { MRO_L2 } from "@/data/taxonomy";
import type { Vendor, VendorStatus } from "@/types/vendor";
import { ScoreBreakdownCard } from "./ScoreBreakdownCard";
import {
  RELIABILITY_LABELS,
  ROLE_LABELS,
  ROLE_PILL_VARIANT,
  STATUS_LABELS,
  fmtDate,
  historyMilestones,
  leadLabel,
  perfColor,
  termsLabel,
  typeLabel,
} from "./vendorMeta";

const TERMS_PRESETS = [30, 45, 60, 90] as const;

interface Draft {
  leadTime: string; // raw input text; "" = no data (null)
  terms: string; // "30" | "45" | … | "none"
  status: VendorStatus;
  subcategory: string;
  notes: string;
}

function draftFrom(vendor: Vendor): Draft {
  return {
    leadTime: vendor.leadTimeDays === null ? "" : String(vendor.leadTimeDays),
    terms: vendor.paymentTermsDays === null ? "none" : String(vendor.paymentTermsDays),
    status: vendor.status,
    subcategory: vendor.subcategory ?? "",
    notes: vendor.notes ?? "",
  };
}

/** Mirrors the DS Input label so labelled Selects sit flush with Inputs. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="px-0.5 text-xs font-normal text-[var(--muted-foreground)]">{label}</span>
      {children}
    </div>
  );
}

interface VendorDetailPanelProps {
  vendor: Vendor | null;
  open: boolean;
  onClose: () => void;
}

/** A compact labelled figure for the supplier-summary stat row. */
function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex flex-col">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-neutral)" }}>
        {label}
      </span>
      <span className="text-[13px] font-semibold" style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
        {value}
      </span>
    </span>
  );
}

/** Plain-language supplier summary — who they are, their sourcing role, the
 *  savings they touch, and their (illustrative) performance. */
function vendorSummary(v: Vendor): string {
  const type = typeLabel(v.type);
  const who = `${v.name} is ${type !== "—" ? `a ${type.toLowerCase()}` : "a supplier"} serving ${
    v.entity === "Both" ? "both AT and AOH" : v.entity
  }, with ${fmtCompact(v.annualSpend)} of annual MRO spend.`;
  const n = v.opportunities.length;
  const opps = n === 1 ? "opportunity" : "opportunities";
  const addr = fmtCompact(v.opportunities.reduce((s, o) => s + o.addressable, 0));
  let role: string;
  switch (v.role) {
    case "winner":
      role = ` It's the consolidation incumbent across ${n} ${opps}, anchoring ${addr} of addressable spend.`;
      break;
    case "oem":
      role = ` Classified OEM / sole-source; appears in ${n} ${opps} (${addr} addressable), carved out of competitive sourcing.`;
      break;
    case "tail":
      role = ` A tail supplier across ${n} ${opps} — part of ${addr} of consolidatable spend.`;
      break;
    case "consolidate":
      role = ` A fold-in candidate across ${n} ${opps} (${addr} addressable).`;
      break;
    case "leverage":
      role = ` A negotiation-leverage supplier in ${n} ${opps} (${addr} addressable).`;
      break;
    case "strategic":
      role = ` A strategic / broad-line supplier in ${n} ${opps} (${addr} addressable).`;
      break;
    default:
      role = " Not currently in a surfaced opportunity.";
  }
  return `${who}${role} Illustrative performance ${v.performance.score}/100.`;
}

/**
 * Vendor detail modal (ModalShell): supplier summary (role + savings + performance),
 * the illustrative performance scorecard with its calculation, data coverage,
 * profile grid, the "Update vendor" edit form, and the audit timeline.
 */
export function VendorDetailPanel({ vendor, open, onClose }: VendorDetailPanelProps) {
  const { updateVendor } = useVendorStore();
  const { feed } = useOpportunityStore();
  const { addToast } = useToast();
  const { openMercer } = useAskMercer();

  // Escape-to-close, focus management and dialog semantics for the portaled shell.
  usePanelDialog(open && vendor !== null, onClose, vendor ? `${vendor.name} details` : undefined);

  // Draft state, re-seeded synchronously whenever a different vendor opens OR
  // the panel re-opens (React "adjust state during render" pattern — no flash
  // of stale form). Re-seeding on the open transition discards unsaved edits
  // from a previous session, so a reopened panel never silently restores a
  // dirty draft with Save already armed. The draft is intentionally NOT
  // cleared on close — the exit slide still needs its content.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && vendor) {
      setDraftId(vendor.id);
      setDraft(draftFrom(vendor));
    }
  } else if (vendor && draftId !== vendor.id) {
    setDraftId(vendor.id);
    setDraft(draftFrom(vendor));
  }
  const activeDraft = vendor && draftId === vendor.id ? draft : null;

  // ── Mercer context: anchor-candidate band, or roster chip ────────────────
  const anchorOpp = vendor
    ? feed.find((o) => o.consolidatedSide.anchorVendorId === vendor.id)
    : undefined;
  const rosterOpp =
    vendor && !anchorOpp ? feed.find((o) => o.vendorIds.includes(vendor.id)) : undefined;

  // ── Edit-form derived state ──────────────────────────────────────────────
  const leadText = activeDraft?.leadTime.trim() ?? "";
  const leadValid =
    leadText === "" || (Number.isFinite(Number(leadText)) && Number(leadText) >= 0);
  const newLead = leadText === "" ? null : Math.round(Number(leadText));
  const newTerms =
    activeDraft === null || activeDraft.terms === "none" ? null : Number(activeDraft.terms);

  const leadChanged = Boolean(vendor && activeDraft && leadValid && newLead !== vendor.leadTimeDays);
  const termsChanged = Boolean(vendor && activeDraft && newTerms !== vendor.paymentTermsDays);
  const statusChanged = Boolean(vendor && activeDraft && activeDraft.status !== vendor.status);
  const subcategoryChanged = Boolean(
    vendor && activeDraft && activeDraft.subcategory !== (vendor.subcategory ?? ""),
  );
  const notesChanged = Boolean(vendor && activeDraft && activeDraft.notes !== (vendor.notes ?? ""));
  const dirty = leadChanged || termsChanged || statusChanged || subcategoryChanged || notesChanged;

  const handleSave = () => {
    if (!vendor || !activeDraft || !dirty || !leadValid) return;

    const patch: VendorPatch = {};
    if (leadChanged) patch.leadTimeDays = newLead;
    if (termsChanged) patch.paymentTermsDays = newTerms;
    if (statusChanged) patch.status = activeDraft.status;
    if (subcategoryChanged) patch.subcategory = activeDraft.subcategory;
    if (notesChanged) patch.notes = activeDraft.notes;

    // Project the new composite exactly the way the store recomputes it
    // (lead adjustment first, then terms), so the toast can cite the number.
    let breakdown = vendor.scoreBreakdown;
    if (leadChanged) breakdown = adjustDeliveryForLeadTime(breakdown, vendor.leadTimeDays, newLead);
    if (termsChanged) breakdown = adjustTermsCriterion(breakdown, newTerms);
    const newScore = recomputeScore(breakdown);

    const parts: string[] = [];
    if (leadChanged) {
      parts.push(`Lead time updated ${leadLabel(vendor.leadTimeDays)} → ${leadLabel(newLead)}`);
    } else if (termsChanged) {
      parts.push(
        `Payment terms updated ${termsLabel(vendor.paymentTermsDays)} → ${termsLabel(newTerms)}`,
      );
    } else if (statusChanged) {
      parts.push(`Status updated ${STATUS_LABELS[vendor.status]} → ${STATUS_LABELS[activeDraft.status]}`);
    } else if (subcategoryChanged) {
      parts.push(
        `Sub-category updated ${vendor.subcategory ?? "—"} → ${activeDraft.subcategory}`,
      );
    } else {
      parts.push("Notes updated");
    }
    if (newScore !== vendor.score) parts.push(`data confidence ${vendor.score} → ${newScore}`);
    const extra =
      [leadChanged, termsChanged, statusChanged, subcategoryChanged, notesChanged].filter(Boolean)
        .length - 1;
    if (extra > 0) parts.push(`${extra} more field${extra === 1 ? "" : "s"} updated`);

    updateVendor(vendor.id, patch);
    addToast(parts.join(" · "), "success");
  };

  // ── Terms select options: presets + the current non-preset value ─────────
  const termsOptions: { value: string; label: string }[] = (() => {
    const days: number[] = [...TERMS_PRESETS];
    if (
      vendor &&
      vendor.paymentTermsDays !== null &&
      !days.includes(vendor.paymentTermsDays)
    ) {
      days.push(vendor.paymentTermsDays);
      days.sort((a, b) => a - b);
    }
    return [
      ...days.map((d) => ({ value: String(d), label: `Net ${d}` })),
      { value: "none", label: "No data" },
    ];
  })();

  // ── Sub-category options: the MRO L2 list + the vendor's current (possibly
  // non-standard) value, so changing it is never a one-way door.
  const subcategoryOptions: string[] = vendor
    ? Array.from(new Set<string>([...(vendor.subcategory ? [vendor.subcategory] : []), ...MRO_L2]))
    : [...MRO_L2];

  const profileRows: InfoRow[] = vendor
    ? [
        { label: "Entity", value: vendor.entity, icon: Buildings },
        { label: "Type", value: typeLabel(vendor.type), icon: Tag },
        {
          label: "Country / Region",
          value: `${vendor.country} · ${vendor.region}`,
          icon: GlobeHemisphereWest,
        },
        { label: "Payment terms", value: termsLabel(vendor.paymentTermsDays), icon: Receipt },
        {
          label: "Lead time",
          value:
            vendor.leadTimeDays === null
              ? "—"
              : vendor.leadTimeTrend === "stable"
                ? leadLabel(vendor.leadTimeDays)
                : `${leadLabel(vendor.leadTimeDays)} · ${vendor.leadTimeTrend}`,
          icon: Timer,
        },
        {
          label: "Data reliability",
          value: RELIABILITY_LABELS[vendor.dataReliability],
          icon: CircleHalf,
        },
        {
          label: "Contract expiry",
          value: vendor.contractExpiry ? fmtDate(vendor.contractExpiry) : "—",
          icon: CalendarBlank,
        },
        {
          label: "Overlap",
          value: vendor.overlap ? "Serves both entities" : "Single entity",
          icon: ArrowsLeftRight,
        },
      ]
    : [];

  return (
    <ModalShell
      open={open && vendor !== null}
      onClose={onClose}
      title={vendor?.name ?? ""}
      subtitle={
        vendor
          ? `${vendor.subcategory ?? vendor.category} · ${fmtCompact(vendor.annualSpend)} · ${vendor.entity}`
          : undefined
      }
      icon={Factory}
      size="wide"
      footer={
        vendor && activeDraft ? (
          <div className="flex justify-end">
            <Button variant="primary" disabled={!dirty || !leadValid} onClick={handleSave}>
              Save changes
            </Button>
          </div>
        ) : undefined
      }
    >
      {vendor && activeDraft && (
        <>
          {/* a. Mercer context */}
          {anchorOpp && (
            <MercerBand
              caption="Mercer · anchor candidate"
              headline={`Consolidation winner candidate for ${anchorOpp.id}`}
              bullets={[anchorOpp.title, `Confidence ${pct(anchorOpp.confidencePct)}`]}
            />
          )}
          {rosterOpp && (
            <div
              className="flex items-center gap-1.5 rounded-lg px-3 py-2"
              style={{ background: "linear-gradient(to right, #EBDFFF 72%, #F3ECFE 100%)" }}
            >
              <MercerStar size={12} />
              <span className="truncate text-xs font-medium" style={{ color: "#59349C" }}>
                Appears in {rosterOpp.id} · {rosterOpp.title}
              </span>
            </div>
          )}

          {/* b. Supplier summary — who they are, their role, the savings they touch, performance */}
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium text-[var(--text-primary)]">Supplier summary</span>
            <div className="flex flex-col gap-3 rounded-xl border p-4" style={{ borderColor: "var(--border-default)" }}>
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                {vendorSummary(vendor)}
              </p>
              <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
                <Pill variant={ROLE_PILL_VARIANT[vendor.role]} size="sm">
                  {ROLE_LABELS[vendor.role]}
                </Pill>
                <SummaryStat label="Opportunities" value={String(vendor.opportunities.length)} />
                <SummaryStat
                  label="Addressable in scope"
                  value={fmtCompact(vendor.opportunities.reduce((s, o) => s + o.addressable, 0))}
                />
                <SummaryStat label="Performance" value={`${vendor.performance.score}/100`} />
                <div className="ml-auto">
                  <Button
                    variant="christy"
                    size="sm"
                    iconLeft={<MercerStar size={14} />}
                    onClick={() => openMercer({ page: "vendors", vendorId: vendor.id, vendorLabel: vendor.name })}
                  >
                    Ask Mercer
                  </Button>
                </div>
              </div>
              {vendor.opportunities.length > 0 && (
                <ul className="flex flex-col divide-y" style={{ borderColor: "var(--border-light)" }}>
                  {vendor.opportunities.slice(0, 6).map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-[13px]">
                      <span className="truncate" style={{ color: "var(--text-primary)" }}>
                        {o.title}
                      </span>
                      <span className="shrink-0 text-[11px]" style={{ color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                        {fmtCompact(o.addressable)} ·{" "}
                        <span style={{ color: o.isWinner ? "var(--success)" : "var(--text-neutral)" }}>
                          {o.isWinner ? "Incumbent" : o.isOem ? "OEM" : "In roster"}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* c. Performance — how it's calculated (weight × score); real where data exists */}
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium text-[var(--text-primary)]">Performance · how it&apos;s calculated</span>
            <div className="flex flex-col rounded-xl border p-4" style={{ borderColor: "var(--border-default)" }}>
              <div className="flex items-baseline justify-between border-b pb-3" style={{ borderColor: "var(--border-light)" }}>
                <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>Composite = Σ (weight × score)</span>
                <span className="flex items-baseline gap-1">
                  <span
                    className="text-[20px] font-semibold leading-none"
                    style={{ color: perfColor(vendor.performance.score), fontVariantNumeric: "tabular-nums" }}
                  >
                    {vendor.performance.score}
                  </span>
                  <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>/ 100</span>
                </span>
              </div>
              <div
                className="flex items-center gap-3 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide"
                style={{ color: "var(--text-neutral)" }}
              >
                <span className="w-[136px] shrink-0">Dimension</span>
                <span className="w-[42px] shrink-0 text-right">Weight</span>
                <span className="min-w-0 flex-1">Basis</span>
                <span className="w-8 shrink-0 text-right">Score</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {vendor.performance.dimensions.map((d) => (
                  <div key={d.key} className="flex items-start gap-3">
                    <div className="flex w-[136px] shrink-0 flex-col">
                      <span className="text-[12px] leading-snug" style={{ color: "var(--text-primary)" }}>{d.label}</span>
                      <span className="text-[10px]" style={{ color: d.live ? "var(--success)" : "var(--text-neutral)" }}>
                        {d.live ? "Live" : "Illustrative"}
                      </span>
                    </div>
                    <span className="w-[42px] shrink-0 text-right text-[12px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                      ×{d.weight.toFixed(2)}
                    </span>
                    <span className="min-w-0 flex-1 text-[11px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                      {d.basis}
                    </span>
                    <span className="w-8 shrink-0 text-right text-[12px] font-semibold tabular-nums" style={{ color: perfColor(d.score) }}>
                      {d.score}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 border-t pt-2 text-[10px] leading-relaxed" style={{ borderColor: "var(--border-light)", color: "var(--text-neutral)" }}>
                Transaction-level detail — which deliveries slipped and by how much — lands with the ERP integration.
              </p>
            </div>
          </div>

          {/* d. Data coverage (secondary, real) — how complete our data on the vendor is */}
          <ScoreBreakdownCard breakdown={vendor.scoreBreakdown} composite={vendor.score} />

          {/* d. Profile */}
          <PanelInfoGrid title="Profile" rows={profileRows} />

          {/* e. Update vendor — the page's signature action */}
          <div className="flex flex-col gap-2">
            <span className="text-[14px] font-medium text-[var(--text-primary)]">
              Update vendor
            </span>
            <div
              className="flex flex-col gap-3 rounded-xl border p-4"
              style={{ borderColor: "var(--border-default)" }}
            >
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="Lead time (days)"
                  type="number"
                  min={0}
                  step={1}
                  value={activeDraft.leadTime}
                  onChange={(e) => setDraft({ ...activeDraft, leadTime: e.target.value })}
                  placeholder="No data"
                  error={leadValid ? undefined : "Enter a non-negative number"}
                />
                <Field label="Payment terms">
                  <Select
                    value={activeDraft.terms}
                    onValueChange={(v) => setDraft({ ...activeDraft, terms: v })}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select terms" />
                    </Select.Trigger>
                    <Select.Content>
                      {termsOptions.map((o) => (
                        <Select.Item key={o.value} value={o.value}>
                          {o.label}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <Select
                    value={activeDraft.status}
                    onValueChange={(v) => setDraft({ ...activeDraft, status: v as VendorStatus })}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select status" />
                    </Select.Trigger>
                    <Select.Content>
                      {(Object.keys(STATUS_LABELS) as VendorStatus[]).map((s) => (
                        <Select.Item key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Field>
                <Field label="Sub-category">
                  <Select
                    value={activeDraft.subcategory}
                    onValueChange={(v) => setDraft({ ...activeDraft, subcategory: v })}
                  >
                    <Select.Trigger>
                      <Select.Value placeholder="Select sub-category" />
                    </Select.Trigger>
                    <Select.Content>
                      {subcategoryOptions.map((c) => (
                        <Select.Item key={c} value={c}>
                          {c}
                        </Select.Item>
                      ))}
                    </Select.Content>
                  </Select>
                </Field>
              </div>

              <Textarea
                label="Notes"
                rows={3}
                value={activeDraft.notes}
                onChange={(e) => setDraft({ ...activeDraft, notes: e.target.value })}
                placeholder="Sourcing notes, contract context, plant constraints…"
              />
            </div>
          </div>

          {/* f. Audit history */}
          {vendor.events.length > 0 && (
            <PanelTimeline
              title="History"
              idPrefix={vendor.id}
              milestones={historyMilestones(vendor)}
            />
          )}
        </>
      )}
    </ModalShell>
  );
}
