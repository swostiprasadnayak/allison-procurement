"""
ViewContext + Scope — the two inputs that frame every copilot call.

`Scope` is the security boundary (whose rows the user may see). In production the team enforces
it server-side; here it filters the retrieved frame. `ViewContext` is *what's on screen* — the
page + the entity in view — and only ever points WITHIN scope (it focuses attention, never widens
access). Together they let the copilot answer "why is this a consolidate play?" about the
opportunity the user is actually looking at, without the user naming it.
"""
from __future__ import annotations
import dataclasses

PAGES = ("feed", "cockpit", "qualify", "act", "monitor", "vendors")


@dataclasses.dataclass(frozen=True)
class ViewContext:
    """What the user is looking at. The frontend sends this on every call (Architecture §6)."""
    page: str = "cockpit"
    opportunity_id: str | None = None
    category_code: str | None = None     # an L2 code/name (cockpit / category views)
    vendor_id: str | None = None
    run_id: str | None = None            # pins to a specific engine run; None = latest present

    def __post_init__(self):
        if self.page not in PAGES:
            raise ValueError(f"page must be one of {PAGES}, got {self.page!r}")

    @property
    def focal_kind(self) -> str | None:
        if self.opportunity_id:
            return "opportunity"
        if self.category_code:
            return "category"
        if self.vendor_id:
            return "vendor"
        return None


@dataclasses.dataclass(frozen=True)
class Scope:
    """The user's data scope. enterprise=True sees everything (CPO/exec rollup / local dev).
    Otherwise the listed dimensions are allow-lists; empty set on a dimension = no constraint
    on that dimension. Mirrors `opp.user_scope` (plant/region/BU/category/enterprise)."""
    enterprise: bool = True
    business_units: frozenset = frozenset()
    regions: frozenset = frozenset()
    l2_categories: frozenset = frozenset()      # L2 codes
    location_ids: frozenset = frozenset()

    def allows(self, row: dict) -> bool:
        if self.enterprise:
            return True
        for field, allowed in (("business_unit", self.business_units), ("region", self.regions),
                               ("l2_code", self.l2_categories), ("location_id", self.location_ids)):
            if allowed and row.get(field) not in allowed:
                return False
        return True

    @classmethod
    def enterprise_all(cls) -> "Scope":
        return cls(enterprise=True)
