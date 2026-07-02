"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Milestone,
  OppEvent,
  Opportunity,
  OpportunityStatus,
  OppUserInput,
} from "@/types/opportunity";
import { fmtCompact, fmtRange, pct } from "@/lib/format";
import { buildRamp } from "@/lib/ramp";
import { resolveSavings } from "@/lib/savings";
import { CURRENT_USER } from "@/lib/session";

const TODAY = "2026-06-12";
const QUALIFY_DELAY_MS = 1_600;

const FEED_STATUSES: readonly OpportunityStatus[] = ["surfaced", "qualifying", "qualified"];
const TRACKED_STATUSES: readonly OpportunityStatus[] = ["committed", "in-execution", "realized"];

export interface OpportunityStore {
  opportunities: Opportunity[];
  loading: boolean; // true until /api/opportunities has seeded the store
  feed: Opportunity[]; // status surfaced|qualifying|qualified, sorted confidencePct desc
  accepted: Opportunity[]; // status accepted — running the play in Act
  parked: Opportunity[]; // status parked — awaiting a revisit trigger
  rejected: Opportunity[];
  tracked: Opportunity[]; // committed|in-execution|realized, newest committedAt first
  surfacedCount: number; // feed.length
  acceptedCount: number; // accepted.length
  driftCount: number; // tracked with drift?.flagged
  committedMidTotal: number; // Σ (savingsLow+savingsHigh)/2 over tracked
  realizedYtdTotal: number; // Σ over tracked of Σ ramp[].realized ?? 0
  commit: (id: string, meta?: { timing?: string; basis?: string }) => void;
  undoCommit: (id: string) => void;
  accept: (id: string) => void;
  qualify: (id: string) => void;
  reject: (id: string, reason: string, note?: string) => void;
  park: (id: string, trigger: string) => void;
  unpark: (id: string) => void;
  savePlay: (id: string, patch: { approach?: string; doneTasks?: string[] }) => void;
  advanceStage: (id: string) => void;
  regressStage: (id: string) => void;
  clearDrift: (id: string, action: string) => void;
  /** DEMO-only (in-memory): simulate an SAP posting that forces a RAG level. */
  simulateSap: (id: string, level: "green" | "amber" | "red") => void;
  /** DEMO-only (in-memory): post the next quarter of on-pace actuals to all live plays. */
  postQuarterActuals: () => void;
  /** DEMO-only (in-memory): clear simulated actuals for one play (or all). */
  resetSap: (id?: string) => void;
  saveOppInput: (id: string, patch: Partial<OppUserInput>) => void;
  regenerateAnalysis: (id: string) => void;
}

const OpportunityStoreContext = createContext<OpportunityStore | null>(null);

function defaultMilestones(oppId: string, committedAt: string): Milestone[] {
  return [
    { id: `${oppId}-m1`, label: "Committed", status: "completed", date: committedAt, events: [] },
    { id: `${oppId}-m2`, label: "Category & finance validation", status: "active", events: [] },
    { id: `${oppId}-m3`, label: "RFQ", status: "pending", events: [] },
    { id: `${oppId}-m4`, label: "Award", status: "pending", events: [] },
    { id: `${oppId}-m5`, label: "Ramp & monitor", status: "pending", events: [] },
  ];
}

/** Fire-and-forget write-back to the mutable user layer (opp.opportunity_action).
 *  Optimistic: the store already updated local state; this persists it so the
 *  decision survives an engine reload. Keyed by the engine id. */
function persistAction(
  engineId: string,
  action: string,
  payload: Record<string, unknown> = {},
): void {
  void fetch("/api/opportunities/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: engineId, action, ...payload }),
  }).catch(() => {});
}

export function OpportunityStoreProvider({ children }: { children: ReactNode }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);

  // Latest opps for id→key resolution in the write-back actions (the store uses
  // friendly "OPP-NNN" ids; the CDM write-back keys on the STABLE opportunity_key
  // — the natural key that survives engine re-runs, unlike the run-scoped engineId).
  const oppsRef = useRef<Opportunity[]>([]);
  useEffect(() => {
    oppsRef.current = opportunities;
  }, [opportunities]);
  const keyOf = (id: string) => {
    const o = oppsRef.current.find((x) => x.id === id);
    return o?.opportunityKey ?? o?.engineId ?? id;
  };

  // Seed the store from the CDM-backed API on mount. The mutation actions
  // below operate on this fetched state exactly as they did on the mock array.
  useEffect(() => {
    fetch("/api/opportunities")
      .then((r) => r.json())
      .then((data: Opportunity[]) => {
        setOpportunities(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // In-flight qualify timers, keyed by opportunity id; cleared on unmount.
  const qualifyTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Per-field record of what commit() generated (milestones and/or ramp) plus
  // the workbook figures it baked over, so undoCommit strips ONLY generated
  // data and restores the pre-commit addressable/savings exactly.
  const commitGenerated = useRef<
    Map<
      string,
      {
        milestones: boolean;
        ramp: boolean;
        prevFigures: { addressableSpend: number; savingsLow: number; savingsHigh: number };
      }
    >
  >(new Map());

  useEffect(() => {
    const timers = qualifyTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const commit = useCallback((id: string, meta?: { timing?: string; basis?: string }) => {
    // A pending qualify must not overwrite the commit.
    const pending = qualifyTimers.current.get(id);
    if (pending) {
      clearTimeout(pending);
      qualifyTimers.current.delete(id);
    }
    setOpportunities((prev) =>
      prev.map((opp) => {
        // Commit from the feed (legacy) or from Act (status "accepted").
        if (opp.id !== id || (!FEED_STATUSES.includes(opp.status) && opp.status !== "accepted"))
          return opp;
        // Resolve the operator's input so the committed figures, the ramp and
        // the audit entry all trace to what they entered, not the workbook.
        const resolved = resolveSavings(opp);
        commitGenerated.current.set(opp.id, {
          milestones: !opp.milestones,
          ramp: !opp.ramp,
          prevFigures: {
            addressableSpend: opp.addressableSpend,
            savingsLow: opp.savingsLow,
            savingsHigh: opp.savingsHigh,
          },
        });
        let milestones = opp.milestones;
        let ramp = opp.ramp;
        if (!milestones) milestones = defaultMilestones(opp.id, TODAY);
        if (!ramp) {
          const mid = Math.round((resolved.low + resolved.high) / 2);
          // Quarterly ramp from the committed timing — never before the play starts.
          ramp = buildRamp(mid, meta?.timing?.trim(), TODAY);
        }
        const figuresFrom = resolved.basis === "override" ? "your input" : "workbook baseline";
        const timing = meta?.timing?.trim() || undefined;
        const basis = meta?.basis?.trim() || undefined;
        const noteParts = [
          `Committed · ${fmtRange(resolved.low, resolved.high)} target`,
          `figures from ${figuresFrom}`,
        ];
        if (basis) noteParts.push(`basis: ${basis}`);
        if (timing) noteParts.push(`expected ${timing}`);
        noteParts.push(CURRENT_USER.name);
        const event: OppEvent = {
          kind: "committed",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: noteParts.join(" · "),
        };
        return {
          ...opp,
          status: "committed",
          // Bake the resolved figures in so Value Realization tracks the number
          // the operator committed to.
          addressableSpend: resolved.addressable,
          savingsLow: resolved.low,
          savingsHigh: resolved.high,
          committedAt: TODAY,
          committedTiming: timing,
          committedBasis: basis,
          owner: CURRENT_USER.name,
          milestones,
          ramp,
          events: [...opp.events, event],
        };
      }),
    );
    // Persist the commit to the CDM (survives reload).
    const target = oppsRef.current.find((o) => o.id === id);
    if (target) {
      const r = resolveSavings(target);
      persistAction(keyOf(id), "commit", {
        committedAt: TODAY,
        timing: meta?.timing?.trim() || null,
        basis: meta?.basis?.trim() || null,
        low: r.low,
        high: r.high,
      });
    }
  }, []);

  const undoCommit = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || opp.status !== "committed") return opp;
        const wasQualified = opp.events.some((e) => e.kind === "qualified");
        const generated = commitGenerated.current.get(opp.id);
        commitGenerated.current.delete(opp.id);
        const event: OppEvent = {
          kind: "note",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Commit undone · returned to feed as ${wasQualified ? "qualified" : "surfaced"}`,
        };
        return {
          ...opp,
          status: wasQualified ? "qualified" : "surfaced",
          // Restore the workbook figures commit() baked over.
          addressableSpend: generated?.prevFigures.addressableSpend ?? opp.addressableSpend,
          savingsLow: generated?.prevFigures.savingsLow ?? opp.savingsLow,
          savingsHigh: generated?.prevFigures.savingsHigh ?? opp.savingsHigh,
          committedAt: undefined,
          owner: undefined,
          milestones: generated?.milestones ? undefined : opp.milestones,
          ramp: generated?.ramp ? undefined : opp.ramp,
          events: [...opp.events, event],
        };
      }),
    );
  }, []);

  const accept = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        // Only a live (feed) opp can be accepted into Act.
        if (opp.id !== id || !FEED_STATUSES.includes(opp.status)) return opp;
        const event: OppEvent = {
          kind: "note",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Accepted · moved to Act · ${CURRENT_USER.name}`,
        };
        return { ...opp, status: "accepted", events: [...opp.events, event] };
      }),
    );
    // A pending qualify must not overwrite the accept.
    const pending = qualifyTimers.current.get(id);
    if (pending) {
      clearTimeout(pending);
      qualifyTimers.current.delete(id);
    }
    persistAction(keyOf(id), "approve");
  }, []);

  const qualify = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        // Only surfaced opps qualify — re-qualifying a qualified opp would
        // stack confidence bumps on every call.
        if (opp.id !== id || opp.status !== "surfaced") return opp;
        const event: OppEvent = {
          kind: "note",
          actor: "Mercer",
          at: TODAY,
          note: "Assembling evidence pack…",
        };
        return { ...opp, status: "qualifying", events: [...opp.events, event] };
      }),
    );
    const existing = qualifyTimers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      qualifyTimers.current.delete(id);
      setOpportunities((prev) =>
        prev.map((opp) => {
          if (opp.id !== id || opp.status !== "qualifying") return opp;
          // Confidence is the engine's evidence strength — qualifying does NOT nudge it. (The old
          // +5/-4 prototype bump made the panel disagree with the engine's real number.)
          const event: OppEvent = {
            kind: "qualified",
            actor: "Mercer",
            at: TODAY,
            note: `Evidence pack assembled · confidence ${pct(opp.confidencePct)} (engine evidence strength)`,
          };
          return {
            ...opp,
            status: "qualified",
            events: [...opp.events, event],
          };
        }),
      );
    }, QUALIFY_DELAY_MS);
    qualifyTimers.current.set(id, timer);
  }, []);

  const reject = useCallback((id: string, reason: string, note?: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || !FEED_STATUSES.includes(opp.status)) return opp;
        const event: OppEvent = {
          kind: "rejected",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: note ? `${reason} · ${note}` : `${reason} · logged for sweep calibration`,
        };
        return { ...opp, status: "rejected", rejectReason: reason, events: [...opp.events, event] };
      }),
    );
    persistAction(keyOf(id), "reject", { reason });
  }, []);

  const park = useCallback((id: string, trigger: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || !FEED_STATUSES.includes(opp.status)) return opp;
        const event: OppEvent = {
          kind: "parked",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Revisit: ${trigger}`,
        };
        return { ...opp, status: "parked", parkTrigger: trigger, events: [...opp.events, event] };
      }),
    );
    persistAction(keyOf(id), "park", { trigger });
  }, []);

  // Un-park: bring a parked opp back to the feed as `qualified` (it was already
  // triaged before parking) and clear its revisit trigger.
  const unpark = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || opp.status !== "parked") return opp;
        const event: OppEvent = {
          kind: "note",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: "Returned to feed from Parked",
        };
        return { ...opp, status: "qualified", parkTrigger: undefined, events: [...opp.events, event] };
      }),
    );
    persistAction(keyOf(id), "unpark");
  }, []);

  // Save Act progress (chosen approach + completed tasks) — persists to the CDM
  // so the operator can leave and return, tracking progress before commit.
  const savePlay = useCallback(
    (id: string, patch: { approach?: string; doneTasks?: string[] }) => {
      setOpportunities((prev) =>
        prev.map((opp) =>
          opp.id === id
            ? {
                ...opp,
                approach: patch.approach ?? opp.approach,
                doneTasks: patch.doneTasks ?? opp.doneTasks,
              }
            : opp,
        ),
      );
      persistAction(keyOf(id), "save", {
        approach: patch.approach ?? null,
        doneTasks: patch.doneTasks ?? [],
      });
    },
    [],
  );

  const advanceStage = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id) return opp;
        const nextStatus: OpportunityStatus | null =
          opp.status === "committed" ? "in-execution" : opp.status === "in-execution" ? "realized" : null;
        if (!nextStatus) return opp;
        let milestones = opp.milestones;
        if (milestones) {
          if (nextStatus === "realized") {
            // Terminal stage: every remaining milestone completes, mirroring
            // the realized seed (OPP-103) — no active/pending leftovers.
            milestones = milestones.map((m) =>
              m.status === "completed"
                ? m
                : { ...m, status: "completed" as const, date: m.date ?? TODAY },
            );
          } else {
            const activeIdx = milestones.findIndex((m) => m.status === "active");
            if (activeIdx >= 0) {
              milestones = milestones.map((m, i) => {
                if (i === activeIdx) return { ...m, status: "completed" as const, date: m.date ?? TODAY };
                return m;
              });
              const nextPendingIdx = milestones.findIndex((m, i) => i > activeIdx && m.status === "pending");
              if (nextPendingIdx >= 0) {
                milestones = milestones.map((m, i) =>
                  i === nextPendingIdx ? { ...m, status: "active" as const } : m,
                );
              }
            }
          }
        }
        const event: OppEvent = {
          kind: "stage-advanced",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Stage advanced · ${opp.status} → ${nextStatus}`,
        };
        return { ...opp, status: nextStatus, milestones, events: [...opp.events, event] };
      }),
    );
    const cur = oppsRef.current.find((o) => o.id === id);
    const ns =
      cur?.status === "committed"
        ? "in-execution"
        : cur?.status === "in-execution"
          ? "realized"
          : null;
    if (ns) persistAction(keyOf(id), "stage", { status: ns });
  }, []);

  // Move a tracked opportunity's realization stage back a step (realized →
  // in-execution → committed). Persisted like advance.
  const regressStage = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id) return opp;
        const prevStatus: OpportunityStatus | null =
          opp.status === "realized"
            ? "in-execution"
            : opp.status === "in-execution"
              ? "committed"
              : null;
        if (!prevStatus) return opp;
        const event: OppEvent = {
          kind: "stage-advanced",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Stage moved back · ${opp.status} → ${prevStatus}`,
        };
        return { ...opp, status: prevStatus, events: [...opp.events, event] };
      }),
    );
    const cur = oppsRef.current.find((o) => o.id === id);
    const ps =
      cur?.status === "realized"
        ? "in-execution"
        : cur?.status === "in-execution"
          ? "committed"
          : null;
    if (ps) persistAction(keyOf(id), "stage", { status: ps });
  }, []);

  const saveOppInput = useCallback((id: string, patch: Partial<OppUserInput>) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        // Input is only editable while the play is live in the feed. The patch
        // merges into the existing input so the summary override band and the
        // Your Input card each persist only the fields they own.
        if (opp.id !== id || !FEED_STATUSES.includes(opp.status)) return opp;
        const merged: OppUserInput = { ...opp.userInput, ...patch, savedAt: TODAY };
        const resolved = resolveSavings({ ...opp, userInput: merged });
        // Describe only what this patch touched, so the audit note is honest.
        const parts: string[] = [];
        if ("overrideAddressable" in patch || "overrideSavingsPct" in patch) {
          parts.push(
            resolved.basis === "override"
              ? `figures → ${fmtCompact(resolved.addressable)} at ${pct(resolved.lowPct)}`
              : "figures → workbook baseline",
          );
        }
        if ("context" in patch && patch.context) parts.push("context");
        if ("marketIntel" in patch && patch.marketIntel) parts.push("market intel");
        if ("vendorNotes" in patch && patch.vendorNotes) parts.push("vendor notes");
        const event: OppEvent = {
          kind: "note",
          actor: CURRENT_USER.name,
          at: TODAY,
          note: `Your input saved · ${parts.length ? parts.join(" · ") : "cleared"}`,
        };
        return { ...opp, userInput: merged, events: [...opp.events, event] };
      }),
    );
  }, []);

  const regenerateAnalysis = useCallback((id: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || !FEED_STATUSES.includes(opp.status)) return opp;
        const resolved = resolveSavings(opp);
        const ui = opp.userInput;
        const note =
          resolved.basis === "override"
            ? `Re-ran with your inputs · ${fmtCompact(resolved.addressable)} addressable at ${pct(resolved.lowPct)}–${pct(resolved.highPct)} · savings ${fmtRange(resolved.low, resolved.high)}`
            : ui?.context || ui?.marketIntel
              ? `Re-ran with your context · no figure overrides · savings holds at ${fmtRange(resolved.low, resolved.high)}`
              : `Re-ran the sweep · savings ${fmtRange(resolved.low, resolved.high)}`;
        const event: OppEvent = { kind: "note", actor: "Mercer", at: TODAY, note };
        return { ...opp, events: [...opp.events, event] };
      }),
    );
  }, []);

  const clearDrift = useCallback((id: string, action: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || !opp.drift?.flagged) return opp;
        const event: OppEvent = { kind: "drift-cleared", actor: "Mercer", at: TODAY, note: action };
        return { ...opp, drift: { ...opp.drift, flagged: false }, events: [...opp.events, event] };
      }),
    );
  }, []);

  // ── DEMO: simulated SAP actuals (in-memory only, never persisted) ──────────
  // Fill the ramp's realized values so realization + RAG + "$ at risk" all light
  // up as they will once real SAP actuals flow. `demoRisk` forces the RAG color.
  const simulateSap = useCallback((id: string, level: "green" | "amber" | "red") => {
    const pctOfTarget = level === "green" ? 0.9 : level === "amber" ? 0.55 : 0.25;
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (opp.id !== id || !TRACKED_STATUSES.includes(opp.status)) return opp;
        let remaining = Math.round(((opp.savingsLow + opp.savingsHigh) / 2) * pctOfTarget);
        const ramp = (opp.ramp ?? []).map((p) => {
          const take = Math.max(0, Math.min(p.projected, remaining));
          remaining -= take;
          return { ...p, realized: Math.round(take) };
        });
        const word = level === "green" ? "on track" : level === "amber" ? "behind pace" : "at risk";
        const event: OppEvent = {
          kind: "note",
          actor: "Mercer",
          at: TODAY,
          note: `Simulated SAP actuals posted — ${word}`,
        };
        return { ...opp, ramp, demoRisk: level, events: [...opp.events, event] };
      }),
    );
  }, []);

  const postQuarterActuals = useCallback(() => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if (!TRACKED_STATUSES.includes(opp.status) || !opp.ramp) return opp;
        const idx = opp.ramp.findIndex((p) => !p.realized);
        if (idx < 0) return opp; // fully posted
        const ramp = opp.ramp.map((p, i) => (i === idx ? { ...p, realized: p.projected } : p));
        return { ...opp, ramp, demoRisk: opp.demoRisk ?? "green" };
      }),
    );
  }, []);

  const resetSap = useCallback((id?: string) => {
    setOpportunities((prev) =>
      prev.map((opp) => {
        if ((id && opp.id !== id) || !TRACKED_STATUSES.includes(opp.status)) return opp;
        return {
          ...opp,
          demoRisk: undefined,
          ramp: opp.ramp?.map((p) => ({ ...p, realized: undefined })),
        };
      }),
    );
  }, []);

  const feed = useMemo(
    () =>
      opportunities
        .filter((o) => FEED_STATUSES.includes(o.status))
        .sort((a, b) => b.confidencePct - a.confidencePct || a.id.localeCompare(b.id)),
    [opportunities],
  );

  const accepted = useMemo(
    () =>
      opportunities
        .filter((o) => o.status === "accepted")
        .sort((a, b) => b.confidencePct - a.confidencePct || a.id.localeCompare(b.id)),
    [opportunities],
  );

  const parked = useMemo(
    () => opportunities.filter((o) => o.status === "parked"),
    [opportunities],
  );

  const rejected = useMemo(
    () => opportunities.filter((o) => o.status === "rejected"),
    [opportunities],
  );

  const tracked = useMemo(
    () =>
      opportunities
        .filter((o) => TRACKED_STATUSES.includes(o.status))
        .sort((a, b) => (b.committedAt ?? "").localeCompare(a.committedAt ?? "") || a.id.localeCompare(b.id)),
    [opportunities],
  );

  const driftCount = useMemo(() => tracked.filter((o) => o.drift?.flagged).length, [tracked]);

  const committedMidTotal = useMemo(
    () => tracked.reduce((sum, o) => sum + (o.savingsLow + o.savingsHigh) / 2, 0),
    [tracked],
  );

  const realizedYtdTotal = useMemo(
    () =>
      tracked.reduce(
        (sum, o) => sum + (o.ramp ?? []).reduce((acc, r) => acc + (r.realized ?? 0), 0),
        0,
      ),
    [tracked],
  );

  const value = useMemo<OpportunityStore>(
    () => ({
      opportunities,
      loading,
      feed,
      accepted,
      parked,
      rejected,
      tracked,
      surfacedCount: feed.length,
      acceptedCount: accepted.length,
      driftCount,
      committedMidTotal,
      realizedYtdTotal,
      commit,
      undoCommit,
      accept,
      qualify,
      reject,
      park,
      unpark,
      savePlay,
      advanceStage,
      regressStage,
      clearDrift,
      simulateSap,
      postQuarterActuals,
      resetSap,
      saveOppInput,
      regenerateAnalysis,
    }),
    [
      opportunities,
      loading,
      feed,
      accepted,
      parked,
      rejected,
      tracked,
      driftCount,
      committedMidTotal,
      realizedYtdTotal,
      commit,
      undoCommit,
      accept,
      qualify,
      reject,
      park,
      unpark,
      savePlay,
      advanceStage,
      regressStage,
      clearDrift,
      simulateSap,
      postQuarterActuals,
      resetSap,
      saveOppInput,
      regenerateAnalysis,
    ],
  );

  return <OpportunityStoreContext.Provider value={value}>{children}</OpportunityStoreContext.Provider>;
}

export function useOpportunityStore(): OpportunityStore {
  const ctx = useContext(OpportunityStoreContext);
  if (!ctx) {
    throw new Error("useOpportunityStore must be used within an OpportunityStoreProvider");
  }
  return ctx;
}
