"""
Guardrails — verify the LLM answer against the grounding, after generation.

The prompt asks for good behavior; this enforces it. Checks:
  - invented figures: every *significant* number in the answer must trace to a grounded value
    (the no-invented-figures rule). Bare small integers (ordinals/counts) are allowed.
  - citations: substantive answers cite ≥1 valid [Cn]; any [Cn] not in the index is a violation.
  - staged honesty: if the focal carries a staged/provability flag and the answer makes a
    movable/savings claim, it should say so (warning, not hard fail).
A safe refusal ("I don't have that in your scope") is allowed to skip the citation/figure checks.
"""
from __future__ import annotations
import dataclasses
import re

# How close a quoted figure must be to a grounded value to count as "the same number".
# It exists so the model can narrate in round numbers ($1.2M for $1,228,156, $3.9M for $3,933,020)
# without being flagged. 3% covers 2-significant-figure rounding (e.g. 1.228→1.2 is itself ~2.3%
# off); a fabricated/materially-wrong figure is almost always off by far more (or matches nothing),
# so it's still caught. The one knob to tune: lower = stricter, higher = more lenient to rounding.
FIGURE_MATCH_TOLERANCE = 0.03

# Below this, a bare integer is treated as an ordinal/count ("3 vendors", "#1") and not checked.
SIGNIFICANT_MIN = 100

_CITE = re.compile(r"\[(C\d+)\]")
# a number, optionally $-prefixed, with optional , grouping, optional decimal, optional %/M/K/bn suffix
_NUM = re.compile(r"\$?\s?(\d[\d,]*(?:\.\d+)?)\s*(%|M\b|K\b|bn\b|billion|million|thousand)?", re.I)
_REFUSAL = re.compile(r"don'?t have|do not have|not in (your |the )?(current )?scope|no (grounded |relevant )?data|"
                      r"can'?t answer|outside (your |the )?scope|insufficient data", re.I)
_CLAIM = re.compile(r"movable|saving|addressable|\$", re.I)
_STAGED = re.compile(r"stag|conservativ|part master|provab|floor|contestab|caveat|needs ", re.I)


@dataclasses.dataclass
class GuardrailReport:
    passed: bool
    violations: list
    warnings: list
    cited_refs: list

    def as_dict(self):
        return dataclasses.asdict(self)


def _scale(suffix):
    s = (suffix or "").lower()
    return {"k": 1e3, "thousand": 1e3, "m": 1e6, "million": 1e6,
            "bn": 1e9, "billion": 1e9}.get(s, 1.0)


def _matches_allowed(val: float, allowed: set) -> bool:
    # match val, its sign-flip (carve-outs stored negative, quoted positive), and the
    # share<->percent representations (0.27 vs 27), within tolerance
    for cand in (val, -val, val / 100.0, val * 100.0):
        for a in allowed:
            if abs(a) < 1e-9:
                if abs(cand) < 1e-6:
                    return True
                continue
            # Pure relative tolerance, sign-agnostic. No absolute floor — a floor would let small
            # fractions (0.35) collide with small grounded values (0.10).
            if abs(abs(cand) - abs(a)) <= FIGURE_MATCH_TOLERANCE * abs(a):
                return True
    return False


def _significant(raw: str, suffix: str, val: float) -> bool:
    """Worth checking? $ / % / suffixed / decimal / >= SIGNIFICANT_MIN. Bare small ints are counts."""
    if "$" in raw or suffix:
        return True
    if "." in raw:
        return True
    return val >= SIGNIFICANT_MIN


def check(answer: str, grounding) -> GuardrailReport:
    violations, warnings = [], []
    text = answer or ""

    cited = _CITE.findall(text)
    valid_refs = {c["ref"] for c in grounding.citations}
    bad_refs = [c for c in cited if c not in valid_refs]
    if bad_refs:
        violations.append(f"cites unknown record(s): {', '.join(sorted(set(bad_refs)))}")

    is_refusal = bool(_REFUSAL.search(text)) and not cited

    # strip citation tags before scanning numbers (the n in [Cn] is not a figure)
    scan_text = _CITE.sub(" ", text)
    invented = []
    for m in _NUM.finditer(scan_text):
        raw, suffix = m.group(0), m.group(2)
        num = float(m.group(1).replace(",", "")) * _scale(suffix)
        if suffix == "%":
            num = float(m.group(1).replace(",", ""))
        if not _significant(raw, suffix, num):
            continue
        if not _matches_allowed(num, grounding.allowed_values):
            invented.append(raw.strip())
    if invented:
        violations.append(f"figure(s) not grounded in any record: {', '.join(invented[:6])}")

    if not is_refusal:
        if grounding.has_focal and not cited:
            warnings.append("substantive answer with no citation")
        if grounding.staged_flags and _CLAIM.search(text) and not _STAGED.search(text):
            warnings.append("makes a movable/savings claim without surfacing the staged/provability caveat")

    return GuardrailReport(passed=not violations, violations=violations, warnings=warnings,
                           cited_refs=sorted(set(cited)))
