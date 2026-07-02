"use client";

import { ArrowsClockwise, NotePencil } from "@phosphor-icons/react";
import { Button, Textarea } from "@navanta-ai/design-system";
import type { Opportunity, OppUserInput } from "@/types/opportunity";
import { EvidenceBlock } from "./EvidenceBlock";

/** Free-text context state — the figure overrides live in the summary
 *  override band, so this card is qualitative only. */
export interface InputDraft {
  context: string;
  marketIntel: string;
  vendorNotes: string;
}

export function inputDraftFrom(opp: Opportunity): InputDraft {
  const ui = opp.userInput;
  return {
    context: ui?.context ?? "",
    marketIntel: ui?.marketIntel ?? "",
    vendorNotes: ui?.vendorNotes ?? "",
  };
}

/** Just the text fields this card owns — merged into userInput on save so it
 *  never clobbers the figure overrides set in the summary. */
export function buildTextInput(draft: InputDraft): Partial<OppUserInput> {
  return {
    context: draft.context.trim() || undefined,
    marketIntel: draft.marketIntel.trim() || undefined,
    vendorNotes: draft.vendorNotes.trim() || undefined,
  };
}

function norm(s?: string | null): string {
  return (s ?? "").trim();
}

/** Dirty = the text draft differs from what's saved on the opportunity. */
export function isInputDirty(draft: InputDraft, saved?: OppUserInput): boolean {
  return (
    norm(draft.context) !== norm(saved?.context) ||
    norm(draft.marketIntel) !== norm(saved?.marketIntel) ||
    norm(draft.vendorNotes) !== norm(saved?.vendorNotes)
  );
}

export function hasSavedInput(opp: Opportunity): boolean {
  const ui = opp.userInput;
  if (!ui) return false;
  return Boolean(
    norm(ui.context) ||
      norm(ui.marketIntel) ||
      norm(ui.vendorNotes) ||
      ui.overrideAddressable != null ||
      ui.overrideSavingsPct != null,
  );
}

interface YourInputCardProps {
  draft: InputDraft;
  onChange: (next: InputDraft) => void;
  anchorVendorName?: string;
  dirty: boolean;
  savedAt?: string;
  hasSaved: boolean;
  regenerating: boolean;
  onSave: () => void;
  onRegenerate: () => void;
}

/**
 * "Your Input" — the qualitative context the Mercer summary can't have:
 * supplier/contract knowledge, market intel, and anchor-vendor notes. The
 * figure overrides live in the summary's Override band; this card holds the
 * narrative the regenerate pass feeds on. Save persists the text; Regenerate
 * asks Mercer to re-issue the recommendation against everything saved.
 */
export function YourInputCard({
  draft,
  onChange,
  anchorVendorName,
  dirty,
  savedAt,
  hasSaved,
  regenerating,
  onSave,
  onRegenerate,
}: YourInputCardProps) {
  const unsavedChip = dirty ? (
    <span
      className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-medium"
      style={{ background: "var(--pill-warning-bg)", color: "var(--pill-warning-fg)" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "var(--warning)" }} />
      Unsaved changes
    </span>
  ) : null;

  const statusText = dirty
    ? "Save your notes, then Regenerate to have Mercer re-run with them."
    : hasSaved
      ? `Saved${savedAt ? ` · ${savedAt}` : ""}`
      : "No input yet — add what the sweep can't see.";

  return (
    <EvidenceBlock
      icon={NotePencil}
      title="Your Input"
      headerRight={unsavedChip}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
            {statusText}
          </span>
          <Button
            variant="christy"
            size="sm"
            onClick={onRegenerate}
            disabled={dirty || !hasSaved || regenerating}
            aria-busy={regenerating}
            iconLeft={<ArrowsClockwise size={14} weight="bold" />}
            title={dirty ? "Save your input first" : undefined}
          >
            {regenerating ? "Regenerating…" : "Regenerate analysis"}
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={!dirty}>
            Save
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-secondary)" }}>
          Context Mercer doesn&apos;t have. Mercer folds this into the analysis when you regenerate.
        </p>

        <Textarea
          label="Your context"
          helperText="Supplier relationships, contract knowledge, category insight"
          rows={3}
          value={draft.context}
          onChange={(e) => onChange({ ...draft, context: e.target.value })}
          placeholder="What do you know about these suppliers, contracts or this category that the sweep can't see?"
        />

        <Textarea
          label="Market intel / pricing data"
          helperText="Quotes, supplier conversations, benchmark data, contract terms"
          rows={3}
          value={draft.marketIntel}
          onChange={(e) => onChange({ ...draft, marketIntel: e.target.value })}
          placeholder="Live quotes, recent conversations, benchmark rates, current contract terms…"
        />

        <Textarea
          label={anchorVendorName ? `Vendor notes · ${anchorVendorName} (anchor)` : "Vendor-specific notes"}
          helperText={
            anchorVendorName ? `Notes specific to ${anchorVendorName}` : "Notes specific to the anchor vendor"
          }
          rows={2}
          value={draft.vendorNotes}
          onChange={(e) => onChange({ ...draft, vendorNotes: e.target.value })}
          placeholder="Relationship, rate cards, switching constraints, prior commitments…"
        />
      </div>
    </EvidenceBlock>
  );
}
