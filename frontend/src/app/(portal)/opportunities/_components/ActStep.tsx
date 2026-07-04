"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  PanelTimeline,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  useToast,
  type TimelineMilestone,
} from "@navanta-ai/design-system";
import {
  CheckCircle,
  Circle,
  ClipboardText,
  ClockCounterClockwise,
  PaperPlaneTilt,
  Path,
  PencilSimple,
  Plus,
  TrashSimple,
} from "@phosphor-icons/react";
import type { DraftVersion, Opportunity } from "@/types/opportunity";
import { resolveSavings } from "@/lib/savings";
import { fmtCompact, fmtDay, fmtRange, pct } from "@/lib/format";
import { MercerStar } from "@/components/mercer";
import { CURRENT_USER } from "@/lib/session";
import { useOpportunityStore } from "@/context/OpportunityStoreContext";
import { extractSignals, matchTasksFromUpload, upgradeRfpDraft } from "@/lib/uploadAnalysis";
import { EvidenceBlock } from "./EvidenceBlock";
import { UploadAnalyze } from "./UploadAnalyze";

type Resolved = ReturnType<typeof resolveSavings>;

// Matches the fixed demo "today" the rest of the app anchors to (see
// OpportunityStoreContext's own TODAY) — keeps version/event timestamps
// consistent with the rest of the audit trail.
const TODAY_ISO = "2026-06-12";

function newVersionId(): string {
  return `dv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Next N fiscal quarters from the current one — the commit-timing options. */
function upcomingQuarters(count = 8): string[] {
  const now = new Date();
  let q = Math.floor(now.getMonth() / 3) + 1; // 1–4
  let y = now.getFullYear();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(`Q${q} ${y}`);
    if (++q > 4) {
      q = 1;
      y += 1;
    }
  }
  return out;
}

/** What the committed value is grounded in — the commit-basis options. */
const COMMIT_BASES = [
  "Signed contract",
  "RFP awarded",
  "Terms agreed with supplier",
  "Budget-approved plan",
  "Verbal / in principle",
] as const;

/**
 * Fast, deterministic drafts filled with the play's real data (category, country,
 * addressable, savings, and the actual supplier roster). Instant — no live model
 * call. The client's own template format drops in here later.
 */
function outreachDraft(opp: Opportunity, resolved: Resolved, anchorName?: string): string {
  const lead = anchorName ?? "[supplier contact]";
  const count = opp.vendorCount ?? opp.vendorRoster?.length ?? 0;
  return `Subject: ${opp.l2} — ${opp.country} supply review

Hi ${lead},

As part of the Allison (AT + AOH) combination, we're reviewing our ${opp.l2} spend in ${opp.country} — roughly ${fmtCompact(resolved.addressable)} addressable across ${count} suppliers. Your program is well positioned to anchor this scope.

We're targeting ${fmtRange(resolved.low, resolved.high)} in savings and would like to align on scope and terms. Could we set up a 30-minute call this week?

Best regards,
${CURRENT_USER.name} · Commodity Manager, MRO

[Template — review & customize before sending]`;
}

function rfpDraft(opp: Opportunity, resolved: Resolved): string {
  const roster = opp.vendorRoster ?? [];
  const table = roster.length
    ? [
        "| Supplier | Annual spend | Share |",
        "|---|---|---|",
        ...roster.map((v) => `| ${v.name} | ${fmtCompact(v.spend)} | ${(v.share * 100).toFixed(1)}% |`),
      ].join("\n")
    : "[supplier list — confirm from the spend cube]";
  const top3 = roster.slice(0, 3).reduce((s, v) => s + v.share, 0);
  return `RFP Scaffold — ${opp.l2} (${opp.country})
[DRAFT — internal review before issue]

1. Background
Allison (AT + AOH) is running a competitive sourcing event for ${opp.l2} spend in ${opp.country}, part of the MRO optimization program.

2. Scope
- Category: ${opp.l2}
- Geography: ${opp.country}
- Estimated spend in scope: ~${fmtCompact(resolved.addressable)} (upper estimate — confirm against the part master)
- Delivery points: [list Allison ${opp.country} sites]
- Excluded: OEM / sole-source items

3. Current state (${roster.length} active suppliers${top3 ? `; top 3 hold ${(top3 * 100).toFixed(0)}%` : ""})
${table}

4. Requirements
- Itemized pricing against the Allison SKU list
- Payment terms (state net days; target per benchmark)
- Delivery lead times & service SLAs to each site
- Quality / compliance certifications
- Incumbent transition plan

5. Evaluation criteria (weighted)
- Total cost / pricing competitiveness
- Service & operational capability
- Quality & compliance
- Commercial terms (incl. payment terms)

6. Timeline
- RFP issued: [date]   - Bids due: [date]   - Award: [date]

Target savings (internal only): ${fmtRange(resolved.low, resolved.high)} — provisional pending part-master confirmation. Do not quote to suppliers.

[Template — customize / replace with the client's RFP format]`;
}

/** Execution-approach template — served from ref.playbook via /api/playbooks
 *  (admin-adjustable per client), keyed to the engine lever it's recommended for. */
interface Playbook {
  id: string;
  label: string;
  sub: string;
  tasks: string[];
  recommendedRoutes: string[];
}

interface ActStepProps {
  opp: Opportunity;
  anchorVendorName?: string;
  /** Commit inputs — owned by RunPlayModal so the footer's Commit button can read them. */
  timing: string;
  basis: string;
  onTimingChange: (v: string) => void;
  onBasisChange: (v: string) => void;
}

/**
 * Run-the-play step (Act). Reached from Qualify via Approve. Lightweight POC:
 * the playbook pick + task checks are in-session working state; the drafts are
 * generated by the Mercer copilot (`/api/copilot` draft — grounded + cited), and
 * the value commitment is captured via the footer's "Commit value" (timing +
 * basis flow into the commit event). The full play-instance data model is
 * deferred to the lifecycle remodel.
 */
export function ActStep({
  opp,
  anchorVendorName,
  timing,
  basis,
  onTimingChange,
  onBasisChange,
}: ActStepProps) {
  const { savePlay } = useOpportunityStore();
  const { addToast } = useToast();
  const resolved = resolveSavings(opp);
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  // Restore the persisted approach + task checks so progress survives reopen/reload.
  const [playbookId, setPlaybookId] = useState<string | null>(opp.approach ?? null);
  const [done, setDone] = useState<Set<string>>(new Set(opp.doneTasks ?? []));

  // Task list: mirrors the selected playbook until the operator edits it (add/
  // rename/remove), at which point `customized` locks it in as their own list
  // — matches Opportunity.customTasks's documented "undefined until edited,
  // then source of truth over playbook.tasks" contract.
  const [customized, setCustomized] = useState(Boolean(opp.customTasks?.length));
  const [taskList, setTaskList] = useState<string[]>(opp.customTasks ?? []);
  const [newTaskText, setNewTaskText] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");

  const [draftKind, setDraftKind] = useState<"outreach" | "rfp" | null>(null);
  const [draftText, setDraftText] = useState("");
  const [versions, setVersions] = useState<DraftVersion[]>(opp.draftVersions ?? []);

  useEffect(() => {
    let alive = true;
    fetch("/api/playbooks")
      .then((r) => r.json())
      .then((d) => {
        if (alive && Array.isArray(d)) setPlaybooks(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Mercer recommends the approach whose config lists this opportunity's lever.
  const recommendedId = useMemo(() => {
    const route = opp.playRoute ?? "";
    return (
      playbooks.find((p) => p.recommendedRoutes.includes(route))?.id ??
      playbooks[0]?.id ??
      null
    );
  }, [playbooks, opp.playRoute]);

  const selectedId = playbookId ?? recommendedId;
  const playbook = playbooks.find((p) => p.id === selectedId) ?? null;
  const quarters = useMemo(() => upcomingQuarters(), []);

  // Track changes — the Act workspace's own activity trail (checklist edits,
  // upload-driven auto-marks, draft versions), newest first.
  const activityMilestones: TimelineMilestone[] = useMemo(
    () =>
      opp.events
        .filter((e) => e.kind === "note")
        .slice()
        .reverse()
        .map((e, i) => ({
          id: `act-activity-${i}`,
          label: `${e.actor}: ${e.note ?? ""}`,
          status: "completed" as const,
          date: fmtDay(e.at),
          events: [],
        })),
    [opp.events],
  );

  // Not customized yet → mirror whichever playbook is selected; once the
  // operator edits (add/rename/remove), `taskList` becomes the source of
  // truth and stops following playbook switches. Derived, not effect-synced,
  // so switching the approach re-renders the list for free.
  const effectiveTasks = customized ? taskList : (playbook?.tasks ?? []);

  const handleSave = () => {
    savePlay(opp.id, { approach: selectedId ?? undefined, doneTasks: [...done], customTasks: effectiveTasks });
    addToast("Progress saved", "success");
  };

  const toggleTask = (task: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      return next;
    });

  const addTask = () => {
    const label = newTaskText.trim();
    if (!label) return;
    setTaskList([...effectiveTasks, label]);
    setCustomized(true);
    setNewTaskText("");
  };

  const startEditTask = (i: number) => {
    setEditingIndex(i);
    setEditingText(effectiveTasks[i]);
  };

  const commitEditTask = () => {
    if (editingIndex === null) return;
    const label = editingText.trim();
    const old = effectiveTasks[editingIndex];
    if (label) {
      setTaskList(effectiveTasks.map((t, i) => (i === editingIndex ? label : t)));
      setCustomized(true);
    }
    // Renamed tasks lose their done-state (done is keyed by label) — acceptable
    // for this lightweight POC; re-check it after renaming if still relevant.
    if (label && label !== old) {
      setDone((prev) => {
        if (!prev.has(old)) return prev;
        const next = new Set(prev);
        next.delete(old);
        return next;
      });
    }
    setEditingIndex(null);
  };

  const removeTask = (i: number) => {
    const removed = effectiveTasks[i];
    setTaskList(effectiveTasks.filter((_, idx) => idx !== i));
    setCustomized(true);
    setDone((prev) => {
      if (!prev.has(removed)) return prev;
      const next = new Set(prev);
      next.delete(removed);
      return next;
    });
  };

  /** "Update from upload" for the checklist — Mercer matches the upload's
   *  content against open tasks (word-overlap heuristic, see @/lib/uploadAnalysis)
   *  and auto-marks the ones it evidences as done, logging what it did. */
  const handleTaskUpload = (text: string) => {
    const signals = extractSignals(text);
    const openTasks = effectiveTasks.filter((t) => !done.has(t));
    const matches = matchTasksFromUpload(openTasks, signals);
    if (matches.length === 0) {
      addToast("No matching tasks found in that upload", "info");
      return;
    }
    const nextDone = new Set(done);
    matches.forEach((m) => nextDone.add(m.task));
    setDone(nextDone);
    const note = `Mercer marked ${matches.length} task${matches.length > 1 ? "s" : ""} done from an upload: ${matches
      .map((m) => `"${m.task}"`)
      .join(", ")}`;
    savePlay(opp.id, {
      approach: selectedId ?? undefined,
      doneTasks: [...nextDone],
      customTasks: effectiveTasks,
      note,
      actor: "Mercer",
    });
    addToast(`Marked ${matches.length} task${matches.length > 1 ? "s" : ""} done from your upload`, "success");
  };

  // Drafts are generated instantly from a template filled with the play's real
  // data (category, country, addressable, savings, supplier roster).
  const openDraft = (kind: "outreach" | "rfp") => {
    setDraftKind(kind);
    const existing = versions.filter((v) => v.kind === kind);
    const latest = existing[existing.length - 1];
    if (latest) {
      setDraftText(latest.text);
      return;
    }
    const text = kind === "outreach" ? outreachDraft(opp, resolved, anchorVendorName) : rfpDraft(opp, resolved);
    setDraftText(text);
    const version: DraftVersion = { id: newVersionId(), kind, at: TODAY_ISO, label: "Template", source: "template", text };
    const nextVersions = [...versions, version];
    setVersions(nextVersions);
    savePlay(opp.id, { draftVersions: nextVersions });
  };

  const saveDraftVersion = () => {
    if (!draftKind || !draftText.trim()) return;
    const version: DraftVersion = {
      id: newVersionId(),
      kind: draftKind,
      at: TODAY_ISO,
      label: "Manual edit",
      source: "manual-edit",
      text: draftText,
    };
    const nextVersions = [...versions, version];
    setVersions(nextVersions);
    savePlay(opp.id, {
      draftVersions: nextVersions,
      note: `Saved a new ${draftKind === "rfp" ? "RFP scaffold" : "outreach draft"} version`,
    });
    addToast("Version saved", "success");
  };

  const restoreVersion = (v: DraftVersion) => {
    setDraftKind(v.kind);
    setDraftText(v.text);
  };

  /** "Update from upload" for the RFP scaffold — Mercer extracts requirements/
   *  terms/deadlines from the upload and folds them into the current draft as
   *  a new version (see @/lib/uploadAnalysis; heuristic extraction, not a live
   *  model call). */
  const handleDraftUpload = (text: string) => {
    if (!draftKind) return;
    const signals = extractSignals(text);
    const upgraded = upgradeRfpDraft(draftText, signals);
    setDraftText(upgraded);
    const version: DraftVersion = {
      id: newVersionId(),
      kind: draftKind,
      at: TODAY_ISO,
      label: "Upgraded from attachment",
      source: "upload-analysis",
      text: upgraded,
    };
    const nextVersions = [...versions, version];
    setVersions(nextVersions);
    savePlay(opp.id, {
      draftVersions: nextVersions,
      note: `Mercer upgraded the ${draftKind === "rfp" ? "RFP scaffold" : "outreach draft"} from an uploaded attachment`,
      actor: "Mercer",
    });
    addToast("Draft upgraded from your upload", "success");
  };

  return (
    <>
      {/* Shared context recap — what she's acting on, carried from Qualify. */}
      <div className="flex flex-col gap-2 rounded-[12px] p-3" style={{ background: "#F5EFFF" }}>
        <div className="flex items-center gap-1.5">
          <MercerStar size={14} />
          <span className="text-[12px] font-semibold" style={{ color: "#59349C" }}>
            Executing · Confidence {pct(opp.confidencePct)}
          </span>
        </div>
        <p className="text-[14px] font-medium leading-snug" style={{ color: "#181A1B" }}>
          {opp.recommendedAction}
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px]" style={{ color: "#1E1E1E" }}>
          <span>
            Addressable{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtCompact(resolved.addressable)}</span>
          </span>
          <span>
            Target savings{" "}
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtRange(resolved.low, resolved.high)}</span>
          </span>
          {anchorVendorName && <span>Lead · {anchorVendorName}</span>}
        </div>
      </div>

      {/* 1 · Approach picker — prefilled to the approach Mercer recommends (the lever). */}
      <EvidenceBlock icon={Path} title="Choose an approach">
        <div className="flex flex-wrap gap-2">
          {playbooks.map((p) => {
            const active = p.id === selectedId;
            const recommended = p.id === recommendedId;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlaybookId(p.id)}
                className="flex min-w-[160px] flex-1 flex-col items-start gap-1 rounded-[8px] px-3 py-2 text-left transition-colors"
                style={{
                  background: active ? "#F5EFFF" : "#FFFFFF",
                  border: `1px solid ${active ? "#8C5DE1" : "#E2E8F0"}`,
                }}
              >
                {/* Label left, Recommended badge pinned top-right so a two-line
                    label never wraps around the badge. */}
                <div className="flex w-full items-start justify-between gap-1.5">
                  <span className="text-[13px] font-medium leading-snug" style={{ color: "#181A1B" }}>
                    {p.label}
                  </span>
                  {recommended && (
                    <span
                      className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-medium"
                      style={{ background: "#EDE6FB", color: "#59349C" }}
                    >
                      Recommended
                    </span>
                  )}
                </div>
                <span className="text-[11px] leading-snug" style={{ color: "#71717A" }}>
                  {p.sub}
                </span>
              </button>
            );
          })}
        </div>
      </EvidenceBlock>

      {/* 2 · Task checklist — editable (add/rename/remove), in-session for the
          POC, plus an upload that Mercer scans to auto-mark evidenced tasks done. */}
      <EvidenceBlock
        icon={ClipboardText}
        title="Task checklist"
        headerRight={
          <div className="flex items-center gap-2">
            <span className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
              {done.size}/{effectiveTasks.length} done
            </span>
            <Button variant="outline" size="sm" onClick={handleSave}>
              Save progress
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col">
            {effectiveTasks.map((task, i) => {
              const isDone = done.has(task);
              const isEditing = editingIndex === i;
              return (
                <div
                  key={`task-${i}`}
                  className="group flex items-center gap-2.5 py-2"
                  style={{ borderTop: i > 0 ? "1px solid var(--border-light)" : undefined }}
                >
                  <button
                    type="button"
                    onClick={() => toggleTask(task)}
                    className="shrink-0"
                    aria-label={isDone ? "Mark not done" : "Mark done"}
                  >
                    {isDone ? (
                      <CheckCircle size={18} weight="fill" color="#008234" />
                    ) : (
                      <Circle size={18} weight="bold" color="#94A3B8" />
                    )}
                  </button>
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      onBlur={commitEditTask}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitEditTask();
                        if (e.key === "Escape") setEditingIndex(null);
                      }}
                      className="flex-1 rounded-[4px] border px-1.5 py-0.5 text-[13px]"
                      style={{ borderColor: "var(--border)" }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleTask(task)}
                      className="flex-1 text-left text-[13px]"
                      style={{
                        color: isDone ? "var(--text-secondary)" : "var(--text-primary)",
                        textDecoration: isDone ? "line-through" : undefined,
                      }}
                    >
                      {task}
                    </button>
                  )}
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => startEditTask(i)}
                      aria-label="Edit task"
                      className="flex size-6 items-center justify-center rounded-[4px] hover:bg-[var(--sidebar-hover-bg)]"
                    >
                      <PencilSimple size={13} style={{ color: "var(--text-secondary)" }} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTask(i)}
                      aria-label="Remove task"
                      className="flex size-6 items-center justify-center rounded-[4px] hover:bg-[var(--sidebar-hover-bg)]"
                    >
                      <TrashSimple size={13} style={{ color: "var(--text-secondary)" }} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex items-center gap-2" style={{ borderTop: "1px solid var(--border-light)", paddingTop: 10 }}>
            <input
              value={newTaskText}
              onChange={(e) => setNewTaskText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addTask()}
              placeholder="Add a task…"
              className="flex-1 rounded-[6px] border px-2.5 py-1.5 text-[13px]"
              style={{ borderColor: "var(--border)" }}
            />
            <Button variant="outline" size="sm" iconLeft={<Plus size={13} weight="bold" />} onClick={addTask}>
              Add
            </Button>
          </div>

          <UploadAnalyze
            label="Update from upload"
            placeholder="Paste a status update, email thread, or call notes — Mercer scans it for evidence that open tasks are done."
            onAnalyze={handleTaskUpload}
          />
        </div>
      </EvidenceBlock>

      {/* 3 · Drafts — instant templates filled with the play's real data, editable,
          never auto-sent, versioned. Client's own template format drops in here later. */}
      <EvidenceBlock icon={PaperPlaneTilt} title="Draft with Mercer">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant={draftKind === "outreach" ? "primary" : "outline"}
              size="sm"
              iconLeft={<MercerStar size={12} />}
              onClick={() => openDraft("outreach")}
            >
              Supplier outreach
            </Button>
            <Button
              variant={draftKind === "rfp" ? "primary" : "outline"}
              size="sm"
              iconLeft={<MercerStar size={12} />}
              onClick={() => openDraft("rfp")}
            >
              RFP scaffold
            </Button>
          </div>
          {draftKind && draftText && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <span
                  className="inline-flex w-fit items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
                  style={{ background: "var(--pill-warning-bg, #FFFBEA)", color: "var(--pill-warning-fg, #9E3900)" }}
                >
                  Template — customize before sending
                </span>
                <Button variant="outline" size="sm" onClick={saveDraftVersion}>
                  Save as version
                </Button>
              </div>
              <Textarea
                rows={draftKind === "rfp" ? 14 : 8}
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
              />

              {draftKind === "rfp" && (
                <UploadAnalyze
                  label="Upload details to improve this scaffold"
                  placeholder="Paste supplier requirements, payment terms, compliance needs, or a timeline — Mercer extracts them and folds them into the RFP."
                  onAnalyze={handleDraftUpload}
                />
              )}

              {versions.filter((v) => v.kind === draftKind).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <span className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                    <ClockCounterClockwise size={13} />
                    Version history
                  </span>
                  <div className="flex flex-col gap-1">
                    {versions
                      .filter((v) => v.kind === draftKind)
                      .slice()
                      .reverse()
                      .map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => restoreVersion(v)}
                          className="flex items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left text-[12px] hover:bg-[var(--sidebar-hover-bg)]"
                          style={{
                            border: v.text === draftText ? "1px solid #8C5DE1" : "1px solid transparent",
                            color: "var(--text-primary)",
                          }}
                        >
                          <span>{v.label}</span>
                          <span style={{ color: "var(--text-secondary)" }}>{v.at}</span>
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </EvidenceBlock>

      {/* 4 · Commit value recap — the actual commit is the footer's "Commit value"
          (timing + basis flow into the commit event and show in Tracking). */}
      <EvidenceBlock icon={CheckCircle} title="Commit the value">
        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px]" style={{ color: "var(--text-secondary)" }}>
              Committing target
            </span>
            <span
              className="text-[15px] font-semibold"
              style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
            >
              {fmtRange(resolved.low, resolved.high)}
            </span>
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                Expected timing
              </span>
              <Select value={timing || undefined} onValueChange={onTimingChange}>
                <SelectTrigger size="md">
                  <SelectValue placeholder="Select a quarter" />
                </SelectTrigger>
                <SelectContent>
                  {quarters.map((q) => (
                    <SelectItem key={q} value={q}>
                      {q}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex min-w-[180px] flex-1 flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
                Commitment basis
              </span>
              <Select value={basis || undefined} onValueChange={onBasisChange}>
                <SelectTrigger size="md">
                  <SelectValue placeholder="What it's based on" />
                </SelectTrigger>
                <SelectContent>
                  {COMMIT_BASES.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
            Use “Commit value” below to book this into Value Realization — the realized figure then
            tracks against the ERP as the contract executes.
          </p>
        </div>
      </EvidenceBlock>

      {/* 5 · Track changes — every edit made in this workspace (checklist
          updates, upload-driven auto-marks, draft versions saved), newest first. */}
      {activityMilestones.length > 0 && (
        <EvidenceBlock icon={ClockCounterClockwise} title="Track changes">
          <PanelTimeline title="" idPrefix="act-activity" milestones={activityMilestones} />
        </EvidenceBlock>
      )}
    </>
  );
}
