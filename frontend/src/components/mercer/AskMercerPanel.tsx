"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button, Input } from "@navanta-ai/design-system";
import { Eye, PaperPlaneRight, Warning, X } from "@phosphor-icons/react";
import { useAskMercer } from "@/context/AskMercerContext";
import { MercerStar } from "./MercerStar";
import { MercerMarkdown } from "./MercerMarkdown";

// ── Copilot response contract (mirrors /api/copilot) ────────────────────────
interface Citation {
  ref: string;
  table: string;
  id: string;
  summary: string;
}
interface Guardrail {
  passed: boolean;
  violations: string[];
  warnings: string[];
}
interface CopilotResponse {
  text: string;
  citations: Citation[];
  staged_notes: string[];
  guardrail: Guardrail;
  model?: string;
}

/** One exchange in the panel thread. The opening "explain" turn has no question. */
interface ThreadEntry {
  id: number;
  question?: string;
  answer: CopilotResponse;
  isDraft?: boolean;
  draftTitle?: string;
}

// Suggested prompts per page (default to cockpit). Entity prompts (qualify) show
// whenever an opportunity is in scope, regardless of page.
const SUGGESTED_PROMPTS: Record<string, string[]> = {
  cockpit: ["Where's the biggest opportunity?", "Committed vs realized so far?", "What's at risk?"],
  feed: ["What should I triage first?", "Which are consolidate vs RFP?", "Explain the top opportunity"],
  qualify: ["Explain this opportunity", "Why this lever?", "Who's the incumbent?", "Draft outreach", "Draft RFP scaffold"],
  act: ["Draft RFP scaffold", "Draft outreach", "Negotiation points"],
  monitor: ["What's at risk?", "How much have we realized?", "Which plays are behind pace?"],
  vendors: ["Who are our biggest suppliers?", "Which vendors serve both AT and AOH?", "Who are the consolidation incumbents?"],
};

// When a specific supplier is in scope (opened from a vendor).
const VENDOR_FOCAL_PROMPTS = ["Summarize this supplier", "How is this supplier performing?", "Which opportunities is it in?"];

// Plain-language label of what Mercer can currently see — shown so users know the context.
const PAGE_LABELS: Record<string, string> = {
  cockpit: "the Command Center",
  feed: "the Opportunities feed",
  qualify: "this opportunity",
  act: "this opportunity",
  monitor: "Value Realization",
  vendors: "the Suppliers page",
};

// Page-specific intro line — speaks to what's on the page (no jargon).
const PAGE_INTROS: Record<string, string> = {
  cockpit: "Ask about the program — the biggest opportunities, what's committed, and what's at risk.",
  feed: "Ask about the opportunities — what to triage first, the levers, or the top plays.",
  vendors: "Ask about the suppliers — who's biggest, who serves both divisions, or a specific supplier.",
  monitor: "Ask about value realization — what's on track, behind pace, or at risk.",
  qualify: "Ask Mercer to explain this opportunity, walk the evidence, or draft the next step.",
  act: "Ask Mercer to draft the next step, walk the evidence, or check the numbers.",
};

function introFor(vc: { page: string; opportunityId?: string; vendorId?: string }): string {
  if (vc.opportunityId) return PAGE_INTROS.qualify;
  if (vc.vendorId) return "Ask about this supplier — a summary, how it's performing, or which opportunities it's in.";
  return PAGE_INTROS[vc.page] ?? PAGE_INTROS.cockpit;
}

// Prompts that map to a specific copilot mode (explain / structured draft). Anything not listed
// here is sent as a free-text question (mode "ask"). Draft prompts need an opportunity in scope.
const PROMPT_ACTIONS: Record<string, { mode: "explain" | "draft"; kind?: string }> = {
  "Explain this opportunity": { mode: "explain" },
  "Draft outreach": { mode: "draft", kind: "outreach" },
  "Draft RFP scaffold": { mode: "draft", kind: "rfp_scaffold" },
  "Negotiation points": { mode: "draft", kind: "negotiation" },
};

function promptsFor(vc: { page: string; opportunityId?: string; vendorId?: string }): string[] {
  // Entity prompts anchor on the in-view entity; otherwise page-level prompts
  // (free-text asks the copilot answers from the CDM without a specific entity).
  if (vc.opportunityId) return SUGGESTED_PROMPTS.qualify;
  if (vc.vendorId) return VENDOR_FOCAL_PROMPTS;
  return SUGGESTED_PROMPTS[vc.page] ?? SUGGESTED_PROMPTS.cockpit;
}

/** Strip the schema prefix from a citation table name ("opp.evidence_factor" → "evidence_factor"). */
function tableLabel(table: string): string {
  const parts = table.split(".");
  return parts[parts.length - 1] || table;
}

interface NormalizedAnswer {
  answer: CopilotResponse;
  isDraft: boolean;
  draftTitle?: string;
}

async function postCopilot(body: Record<string, unknown>): Promise<NormalizedAnswer> {
  const res = await fetch("/api/copilot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const raw = (await res.json()) as Record<string, unknown>;

  // /draft returns { artifact, guardrail }; explain/ask return the CopilotResponse directly.
  if (raw && typeof raw === "object" && "artifact" in raw) {
    const a = (raw.artifact ?? {}) as Record<string, unknown>;
    let citations: Citation[] = [];
    try {
      citations = (JSON.parse((a.citations as string) || "[]") as Array<Record<string, string>>).map((c) => ({
        ref: c.ref,
        table: c.table,
        id: c.id,
        summary: "",
      }));
    } catch {
      citations = [];
    }
    return {
      answer: {
        text: (a.body as string) ?? "",
        citations,
        staged_notes: [],
        guardrail: (raw.guardrail as Guardrail) ?? { passed: true, violations: [], warnings: [] },
        model: a.model as string | undefined,
      },
      isDraft: true,
      draftTitle: a.title as string | undefined,
    };
  }
  // happy path + 503 service-down body both render directly
  return { answer: raw as unknown as CopilotResponse, isDraft: false };
}

// ── Answer rendering ────────────────────────────────────────────────────────

// Compact source legend: the inline [Cn] tags in the answer already do the tracing, so this is
// just a tidy row of [Cn] pills — table + summary on hover — instead of a wall of full table names.
function CitationChips({ citations }: { citations: Citation[] }) {
  if (!citations.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span
        className="mr-0.5 text-[10px] font-medium uppercase tracking-wide"
        style={{ color: "var(--text-secondary)" }}
      >
        Sources
      </span>
      {citations.map((c) => (
        <span
          key={`${c.ref}-${c.id}`}
          title={`${tableLabel(c.table)} — ${c.summary}`}
          className="inline-flex cursor-default items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
          style={{ background: "#F5EFFF", border: "1px solid #E3D2FF", color: "#59349C" }}
        >
          {c.ref}
        </span>
      ))}
    </div>
  );
}

function StagedNotesCallout({ notes }: { notes: string[] }) {
  if (!notes.length) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-lg p-2.5"
      style={{ background: "var(--color-yellow-50, #FEFCE8)", border: "1px solid var(--color-yellow-200, #FEF08A)" }}
    >
      <Warning size={15} weight="fill" className="mt-0.5 shrink-0" style={{ color: "#A16207" }} />
      <ul className="flex flex-col gap-1 text-[12px] leading-relaxed" style={{ color: "#854D0E" }}>
        {notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </div>
  );
}

function AnswerBlock({ entry }: { entry: ThreadEntry }) {
  const { answer } = entry;
  const ungrounded = answer.guardrail && answer.guardrail.passed === false;
  return (
    <div className="flex flex-col gap-2.5">
      {entry.question && (
        <div className="flex justify-end">
          <div
            className="max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-[13px] leading-relaxed"
            style={{ background: "var(--muted)", color: "var(--text-primary)" }}
          >
            {entry.question}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-1.5">
          <MercerStar size={14} />
          <span className="text-[12px] font-semibold" style={{ color: "#59349C" }}>
            Mercer
          </span>
        </div>

        {entry.isDraft && (
          <div
            className="flex w-fit items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold"
            style={{ background: "#F5EFFF", border: "1px solid #E3D2FF", color: "#59349C" }}
          >
            ✎ AI draft — review before sending{entry.draftTitle ? ` · ${entry.draftTitle}` : ""}
          </div>
        )}

        <MercerMarkdown text={answer.text} />

        <CitationChips citations={answer.citations ?? []} />
        <StagedNotesCallout notes={answer.staged_notes ?? []} />

        {/* Drafts carry the "AI draft — review before sending" badge already; the figure-grounding
            flag only matters for factual answers (explain / Q&A), so suppress it on drafts. */}
        {ungrounded && !entry.isDraft && (
          <span
            className="inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
            style={{ background: "var(--muted)", color: "var(--text-secondary)" }}
            title={
              answer.guardrail.violations?.length
                ? answer.guardrail.violations.join(" · ")
                : "Answer did not pass grounding checks."
            }
          >
            unverified — may contain an ungrounded figure
          </span>
        )}
      </div>
    </div>
  );
}

// ── The panel ───────────────────────────────────────────────────────────────

export function AskMercerPanel() {
  const { open, viewContext, close } = useAskMercer();

  const [thread, setThread] = useState<ThreadEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const nextId = useRef(0);

  const scrollRef = useRef<HTMLDivElement>(null);

  const runAsk = useCallback(
    async (body: Record<string, unknown>, displayQuestion?: string) => {
      setLoading(true);
      try {
        const { answer, isDraft, draftTitle } = await postCopilot(body);
        setThread((prev) => [
          ...prev,
          { id: nextId.current++, question: displayQuestion, answer, isDraft, draftTitle },
        ]);
      } catch (e) {
        setThread((prev) => [
          ...prev,
          {
            id: nextId.current++,
            question: displayQuestion,
            answer: {
              text: "Sorry — I couldn't reach the copilot. Please try again in a moment.",
              citations: [],
              staged_notes: [],
              guardrail: { passed: false, violations: [String(e)], warnings: [] },
            },
          },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // On open: just reset the thread. We do NOT auto-call the model — the user
  // drives (pick a prompt or type a question), so opening the panel costs
  // nothing and isn't a wall of text. "Explain this opportunity" is one click
  // away in Suggested.
  useEffect(() => {
    if (!open) return;
    setThread([]);
    setQuestion("");
  }, [open, viewContext.opportunityId]);

  // Keep the latest answer in view as the thread grows / loading toggles.
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread, loading, open]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submitQuestion = useCallback(
    (q: string) => {
      const text = q.trim();
      if (!text || loading) return;
      setQuestion("");
      void runAsk(
        {
          mode: "ask",
          question: text,
          page: viewContext.page,
          opportunity_id: viewContext.opportunityId,
          vendor_id: viewContext.vendorId,
          category_code: viewContext.categoryCode,
        },
        text,
      );
    },
    [loading, runAsk, viewContext.page, viewContext.opportunityId, viewContext.vendorId, viewContext.categoryCode],
  );

  // Suggested-prompt clicks. Prompts in PROMPT_ACTIONS use a structured mode
  // (explain / draft) when an opportunity is in scope; everything else is a
  // normal free-text question.
  const runPrompt = useCallback(
    (p: string) => {
      if (loading) return;
      const action = PROMPT_ACTIONS[p];
      if (action && viewContext.opportunityId) {
        if (action.mode === "explain") {
          void runAsk({ mode: "explain", opportunity_id: viewContext.opportunityId });
        } else {
          void runAsk(
            { mode: "draft", kind: action.kind, opportunity_id: viewContext.opportunityId },
            p,
          );
        }
      } else {
        submitQuestion(p);
      }
    },
    [loading, runAsk, submitQuestion, viewContext.opportunityId],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      submitQuestion(question);
    },
    [submitQuestion, question],
  );

  // SSR-safe portal mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !open) return null;

  const prompts = promptsFor(viewContext);
  const showPrompts = !loading;
  // What Mercer can currently see — page + the in-view entity (opp / vendor / category).
  const focalLabel =
    viewContext.opportunityTitle || viewContext.vendorLabel || viewContext.categoryLabel;
  const contextLabel = `${PAGE_LABELS[viewContext.page] ?? "this page"}${focalLabel ? ` · ${focalLabel}` : ""}`;

  // Docked mode: opened in-context of an opportunity (the ReviewPanel is behind).
  // We drop the dimming backdrop and let clicks pass through to the opp so it
  // stays fully bright and usable; the panel itself re-enables pointer events.
  // Opened globally (no opportunity), keep the standard dimmed modal backdrop.
  const docked = Boolean(viewContext.opportunityId);

  return createPortal(
    <div
      className={`fixed inset-0 z-[110] flex justify-end ${docked ? "pointer-events-none" : ""}`}
      style={{ background: docked ? "transparent" : "rgba(15, 16, 35, 0.45)" }}
      onClick={docked ? undefined : close}
    >
      <aside
        role="dialog"
        aria-modal={docked ? undefined : "true"}
        aria-label="Ask Mercer"
        className="pointer-events-auto relative flex h-full w-full max-w-[420px] flex-col rounded-l-2xl"
        style={{
          background: "var(--surface-base, #ffffff)",
          boxShadow: "var(--shadow-modal, -8px 0 40px rgba(0,0,0,0.18))",
          animation: "mercer-slide-in 0.22s ease-out both",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header
          className="flex shrink-0 items-start justify-between gap-2 border-b px-4 py-3.5"
          style={{ borderColor: "var(--border-light)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <MercerStar size={20} />
            <div className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold" style={{ color: "var(--text-primary)" }}>
                Ask Mercer
              </span>
              {viewContext.opportunityTitle && (
                <span className="truncate text-[12px]" style={{ color: "var(--text-secondary)" }}>
                  · {viewContext.opportunityTitle}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close Ask Mercer"
            className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-white transition-colors hover:bg-[var(--surface-hover)]"
            style={{ border: "1px solid var(--border-light)" }}
          >
            <X size={16} weight="bold" style={{ color: "var(--text-primary)" }} />
          </button>
        </header>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          <div className="flex flex-col gap-5">
            {/* Context transparency — tell the user what Mercer is grounded on. */}
            <div
              className="flex items-center gap-1.5 rounded-[8px] px-2.5 py-1.5"
              style={{ background: "var(--surface-raised)" }}
            >
              <Eye size={13} weight="duotone" style={{ color: "var(--text-neutral)" }} />
              <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                Mercer can see <strong style={{ color: "var(--text-primary)" }}>{contextLabel}</strong> · every answer cites its sources
              </span>
            </div>
            {thread.length === 0 && !loading && (
              <p className="text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {introFor(viewContext)} Every answer is grounded in the underlying data and cites its
                sources.
              </p>
            )}

            {thread.map((entry) => (
              <AnswerBlock key={entry.id} entry={entry} />
            ))}

            {loading && (
              <div className="flex items-center gap-2 text-[13px]" style={{ color: "var(--text-secondary)" }}>
                <MercerStar size={14} className="mercer-pulse" />
                Mercer is reviewing the evidence…
              </div>
            )}

            {showPrompts && (
              <div className="flex flex-col gap-2 pt-1">
                <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-secondary)" }}>
                  Suggested
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {prompts.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => runPrompt(p)}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-medium transition-colors hover:brightness-[0.98]"
                      style={{ background: "#F5EFFF", border: "1px solid #E3D2FF", color: "#59349C" }}
                    >
                      <MercerStar size={11} />
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — text input + send */}
        <form
          onSubmit={onSubmit}
          className="flex shrink-0 items-center gap-2 border-t px-4 py-3"
          style={{ borderColor: "var(--border-light)", background: "var(--surface-sunken, #f8fafc)" }}
        >
          <div className="min-w-0 flex-1">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask about this play, lever, or vendor…"
              aria-label="Ask Mercer a question"
              disabled={loading}
            />
          </div>
          <Button
            type="submit"
            variant="christy"
            size="icon"
            disabled={loading || !question.trim()}
            aria-label="Send"
            title="Send"
          >
            <PaperPlaneRight size={16} weight="fill" />
          </Button>
        </form>
      </aside>
    </div>,
    document.body,
  );
}
