"""
Parameters — seed Appendix A.2 into opp.engine_parameter, and resolve them at run time.

The engine NEVER hardcodes a threshold; it asks Params for it. Changing a value in
the seed (or, in production, in the engine_parameter table) changes behaviour on the
next run with no code edit. Each run snapshots the full resolved set into
engine_run.config_snapshot for audit/lineage.
"""
from __future__ import annotations
import datetime as dt
import json

import yaml

DEFAULT_SEED = "config/parameters_seed.yaml"


# ----------------------------- seeding -----------------------------
def load_seed(path: str = DEFAULT_SEED) -> dict:
    with open(path) as f:
        return yaml.safe_load(f)


def seed_foundation(io, path: str = DEFAULT_SEED, *, changed_by: str = "navanta-seed") -> dict:
    """Write methodology_version, methodology_agreement, and engine_parameter from the seed."""
    seed = load_seed(path)
    version = seed["methodology_version"]
    now = dt.datetime.now(dt.timezone.utc).isoformat()

    io.write("opp", "methodology_version", _frame([{
        "version": version,
        "formula_set_ref": seed.get("formula_set_ref", ""),
        "status": "active",
        "created_by": changed_by,
        "created_at": now,
        "notes": seed.get("notes", ""),
    }]))

    # client sign-off seeded as 'pending' — the plain-English dials live in Filters_and_Rules
    io.write("opp", "methodology_agreement", _frame([{
        "id": f"agr-{version}",
        "methodology_version": version,
        "client_signoff_by": None,
        "signed_at": None,
        "document_ref": "Allison_MRO_Filters_and_Rules.xlsx",
        "status": "pending",
    }]))

    rows = []
    for p in seed["params"]:
        numeric = p.get("numeric")
        jsonv = p.get("json")
        rows.append({
            "param_key": p["key"],
            "methodology_version": version,
            "value_numeric": numeric,
            "value_json": json.dumps(jsonv) if jsonv is not None else None,
            "unit": p.get("unit"),
            "display_label": p.get("label"),        # admin-facing friendly name
            "category": p.get("category"),          # admin-facing grouping
            "description": p.get("desc"),
            "last_changed_by": changed_by,
            "last_changed_at": now,
            "change_note": "seed",
        })
    io.write("opp", "engine_parameter", _frame(rows))
    return {"version": version, "n_params": len(rows)}


def _frame(rows):
    import pandas as pd
    return pd.DataFrame(rows)


# ----------------------------- resolution -----------------------------
class Params:
    """Resolved parameter set for one methodology_version (read from engine_parameter)."""

    def __init__(self, values: dict, version: str):
        self._v = values
        self.version = version

    @classmethod
    def load(cls, io, version: str) -> "Params":
        df = io.read("opp", "engine_parameter")
        df = df[df["methodology_version"] == version]
        if df.empty:
            raise ValueError(f"No parameters for methodology_version={version}")
        values = {}
        for _, r in df.iterrows():
            if r["value_json"] is not None and (isinstance(r["value_json"], str) and r["value_json"] != ""):
                values[r["param_key"]] = json.loads(r["value_json"])
            else:
                values[r["param_key"]] = _num(r["value_numeric"])
        return cls(values, version)

    # typed accessors -------------------------------------------------
    def get(self, key):
        if key not in self._v:
            raise KeyError(f"Parameter '{key}' not defined in {self.version}")
        return self._v[key]

    def num(self, key) -> float:
        return float(self.get(key))

    def int_(self, key) -> int:
        return int(self.get(key))

    def list_(self, key) -> list:
        v = self.get(key)
        return list(v) if isinstance(v, (list, tuple)) else [v]

    def rate_range(self, key) -> tuple[float, float]:
        v = self.get(key)
        return (float(v[0]), float(v[1]))

    def snapshot(self) -> dict:
        """The full resolved set — written verbatim to engine_run.config_snapshot."""
        return dict(self._v)


def _num(v):
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f
