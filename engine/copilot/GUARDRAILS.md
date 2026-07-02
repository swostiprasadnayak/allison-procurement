# Mercer Copilot — Guardrails (for review)

Every safety check on the copilot's output, what it does, whether it's a **hard block** or a
**warning**, and where to read the code. Design is layered: the **prompt asks** for good behavior →
a **guardrail verifies** it after generation → the **caller decides** what to do on a violation.
There's also a deterministic grounded **fallback** so there's always a safe answer.

Code: `engine/copilot/guardrails.py` (the checks) · `engine/copilot/grounding.py` (builds the
allowed-figures set + the cited CONTEXT) · `engine/copilot/prompts.py` (the system rules) ·
tests: `tests/test_copilot.py` (13 gates).

---

## 1. No invented figures — **HARD BLOCK**
Every *significant* number in the answer must trace to a figure that appears in the grounded context.
- **Significant** = has `$`, `%`, a `M/K/bn` suffix, a decimal, or is ≥ 100. Bare small integers
  (ordinals / counts like "3 vendors", "#1") are skipped.
- **Allowed set** = *every number that appears in the grounded CONTEXT* — both structured cells
  (movable, shares, scores, savings) **and** numbers embedded in text (e.g. "HHI 1098", "top-3 50%").
  Digit fragments inside ids / citation tags (`Vcc61b2219`, `[C8]`) are **excluded** so a fabricated
  figure can't masquerade as grounded by colliding with an id.
- **Match** = within **2% relative**, **sign-agnostic** (a carve-out stored as −759,406 may be quoted
  as +$759K), with a **share↔percent** dual (0.27 ↔ 27%). So coarse narration like "$3.9M" for
  $3,933,020 passes; a made-up "$42.7M" or "35%" is blocked.
- **Violation** lists the exact ungrounded figures.

## 2. Citation integrity — **HARD BLOCK** (unknown) / **WARN** (missing)
- Any `[Cn]` the answer cites **must resolve** to a record that was actually retrieved → an unknown
  `[Cn]` is a hard violation.
- A substantive (non-refusal) answer that cites **nothing** → warning.

## 3. Staged-data honesty — **WARN**
If the opportunity in view carries a staged / provability / contestability flag **and** the answer
makes a movable/savings/$ claim, it must surface the caveat (mentions "staged", "conservative",
"part master", "floor", or "contestab"). Otherwise → warning. (Keeps the copilot from quoting a
number as hard when the engine flagged it as an upper bound / pending the part master.)

## 4. Safe refusal — **ALLOWANCE**
An honest "I don't have that in your current scope / no data" (with no citations) is recognized as a
refusal and **skips** the citation + figure checks — so refusing isn't penalized as "uncited."

## 5. Scope is never the LLM's — **ARCHITECTURAL**
The core only ever sees rows the caller already **scope-filtered** (server-side). `view_context`
*focuses attention within* the user's scope; it can never widen it. Code: `context.py` (`Scope.allows`)
+ the retrievers; the service passes `scope` on every call. The LLM is structurally incapable of
reaching out-of-scope data.

## 6. Prompt-level rules — **PREVENTIVE** (`prompts.py` SYSTEM)
The system prompt instructs: answer **only** from CONTEXT; cite `[Cn]`; **never invent, round
differently, or extrapolate** figures; say so when data is **staged**; you are **not agentic**;
drafts are drafts. Guardrails 1–3 *verify* these after the fact.

## 7. Deterministic fallback — **SAFETY NET**
`grounding.focal_summary` is a cited, grounded summary assembled in code (no LLM). It's what the
offline MockLLM returns and what the live path falls back to if the Claude call errors — so a user
never gets a blank or an ungrounded guess.

---

### Pass/fail semantics
`report.passed` = **no hard violations**. Warnings are advisory. The serving layer decides per
result: render, render-with-a-warning-badge, or suppress + log. Nothing is auto-sent (drafts are
always `is_draft=TRUE`).

### Tuning decisions made while building (transparency)
- **2% relative tolerance** (not 0.5%) — to allow natural round-number narration.
- **sign-agnostic + share/percent dual** — carve-outs and shares read naturally.
- **harvest numbers from text, exclude id/tag fragments** — catches text figures (HHI) without
  false-negatives from id collisions.
- **dropped the run_id UUID from the model context** — its hex fragments polluted the allowed set.
- **no absolute `$1` floor** — it let small fractions (0.35) collide with small grounded values (0.10).

### Verified
13 offline tests pass; live Sonnet 4.6 `/explain` on "Repairs · US": grounded coarse-rounding
(`$3.9M`, `$759K`, `27%`, `HHI 1098`) → PASS; fabricated (`$42.7M`, `35%`) → BLOCK.
