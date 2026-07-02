"""
Parameter glossary helpers shared by the review builders (Excel + scorecard HTML),
so the friendly name + definition + formatted value stay identical everywhere.
"""
from __future__ import annotations


def format_value(key: str, value, unit) -> str:
    """Human-readable value for display (presentation only)."""
    if value is None:
        return "—"
    if unit == "usd":
        return f"${int(round(float(value))):,}"
    if unit == "rate":           # single flat rate, e.g. 0.05 -> 5%
        return f"{float(value) * 100:g}%"
    if unit == "rate_range":     # [lo, hi] -> "4–7%"
        lo, hi = value
        return f"{float(lo) * 100:g}–{float(hi) * 100:g}%"
    if unit == "list":
        return ", ".join(str(v) for v in value)
    if unit == "count":
        return f"{int(value)}"
    # share / factor / weight / exponent / enum -> as-is
    if isinstance(value, float):
        return f"{value:g}"
    return str(value)


def group_by_category(params: list[dict]) -> list[tuple[str, list[dict]]]:
    """Preserve first-seen category order; return [(category, [param, ...]), ...]."""
    order, groups = [], {}
    for p in params:
        cat = p.get("category") or "Other"
        if cat not in groups:
            groups[cat] = []
            order.append(cat)
        groups[cat].append(p)
    return [(c, groups[c]) for c in order]
