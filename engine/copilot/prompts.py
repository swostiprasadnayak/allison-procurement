"""
Prompts — the copilot's system contract, the per-page behavior, and the user-message builder.

The SYSTEM prompt encodes the guardrails as instructions (ground every claim, cite [Cn], never
invent figures, surface staged data, stay in scope). PAGE guidance + default-draft mirror the
Design Doc §4.6 table so the copilot behaves per-page. The actual enforcement is in guardrails.py
— the prompt asks for good behavior; the guardrail verifies it.
"""
from __future__ import annotations

SYSTEM = """You are the Mercer copilot inside Navanta Lens — a procurement category & opportunity \
assistant for Allison Transmission. You explain spend opportunities, the levers behind them, and \
draft supplier outreach — grounded strictly in the records provided.

RULES (non-negotiable):
1. Answer ONLY from the CONTEXT block. If the answer isn't in it, say you don't have that data in \
the user's current scope — do not guess or use outside knowledge.
2. Cite the records you use with their [Cn] tags inline. State ONLY figures that appear in the \
CONTEXT — this includes dollar amounts, percentages, AND counts (e.g. number of vendors). Quote them \
as they appear (light rounding for readability is fine). If a number is NOT in the CONTEXT, do not \
estimate, infer, or fabricate one — describe it qualitatively instead (e.g. "the long tail of smaller \
vendors", "a small share"). Never invent or extrapolate a count, percentage, or dollar figure.
3. The CONTEXT is already limited to what this user is allowed to see. Never imply data beyond it.
4. When a record carries a staged/provability/contestability flag, say so plainly (e.g. "this is a \
conservative floor — same-spec contestability needs the part master"). Honesty over confidence.
5. Be concise and decision-useful. Lead with the answer, then the why (the score decomposition / \
lever rule), then the evidence. Use the addressable-spend logic: pocket − winner (if consolidate) − \
OEM/sole-source = addressable.
6. You are not agentic — you explain and draft; you never claim to have executed anything. Drafts \
are drafts."""

# Design Doc §4.6 — per-page suggested prompts + default draft type.
PAGE = {
    "feed":    {"prompts": ["what's new and why?", "which signals fired?"], "default_draft": None},
    "cockpit": {"prompts": ["why is this category ranked #1?", "where's my biggest addressable spend?",
                            "which categories should I prioritize?"], "default_draft": None},
    "qualify": {"prompts": ["explain the addressable math", "what's the evidence for this opportunity?",
                            "why this lever?", "who's the incumbent?"], "default_draft": None},
    "act":     {"prompts": ["draft the RFP scaffold", "draft outreach to the incumbent",
                            "what are the negotiation points?"], "default_draft": "rfp_scaffold"},
    "monitor": {"prompts": ["realized vs committed?", "what's slipping?"], "default_draft": None},
}


def page_guidance(view_context) -> str:
    pg = PAGE.get(view_context.page, {})
    prompts = pg.get("prompts", [])
    hint = f"The user is on the '{view_context.page}' page."
    if view_context.focal_kind:
        hint += (f" They have a specific {view_context.focal_kind} in view (the FOCAL entity in CONTEXT) — "
                 f"resolve 'this', 'here', 'it' to that entity.")
    if prompts:
        hint += f" Typical questions here: {', '.join(prompts)}."
    return hint


def build_user(question: str, grounding, view_context) -> str:
    return (f"{page_guidance(view_context)}\n\n"
            f"=== CONTEXT (the only facts you may use; cite [Cn]) ===\n{grounding.context_text}\n"
            f"=== END CONTEXT ===\n\n"
            f"USER QUESTION: {question}\n\n"
            f"Answer grounded in the CONTEXT, cite [Cn] tags, and flag any staged data.")


# explain-an-opportunity — bounded + structured so the model stays on the grounded figures (and cheap).
EXPLAIN_QUESTION = (
    "Explain this opportunity concisely — refer to it as 'this opportunity' (not 'a play'). "
    "About 150 words, three short labelled parts:\n"
    "1) Why it ranked — cite the Prize, Feasibility and Provability values.\n"
    "2) Why this lever — compare the winner's share to the 0.50 consolidate threshold.\n"
    "3) Addressable math — show Pocket - OEM (- Winner if consolidate) = Addressable using the exact figures.\n"
    "Use ONLY numbers present in the evidence. Do NOT introduce any vendor count, percentage, "
    "threshold, or dollar amount that isn't in the CONTEXT - describe anything else qualitatively.")

# draft generation
DRAFT_KINDS = ("outreach", "rfp_scaffold", "negotiation")
DRAFT_INSTRUCTIONS = {
    "outreach": "Draft a concise, professional supplier-outreach email opening a conversation about "
                "this category. Reference the opportunity context only from CONTEXT. Mark it a draft.",
    "rfp_scaffold": "Draft an RFP scaffold (sections: background, scope, current state, requirements, "
                    "evaluation criteria, timeline) for this opportunity, grounded in CONTEXT. Placeholders in [brackets] "
                    "where data isn't in CONTEXT.",
    "negotiation": "List negotiation talking points and leverage for this opportunity, each tied to a [Cn] record.",
}


def build_draft_user(kind: str, grounding, view_context) -> str:
    return (f"=== CONTEXT (ground the draft strictly in this; cite [Cn] where you use a figure) ===\n"
            f"{grounding.context_text}\n=== END CONTEXT ===\n\n"
            f"TASK: {DRAFT_INSTRUCTIONS[kind]}\n"
            f"Do not invent figures, supplier names, or commitments not present in CONTEXT.")
