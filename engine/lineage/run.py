"""
Run lineage — the engine_run spine.

Every engine execution:
  1. begin_run(scope, version) -> creates a run_id, snapshots the resolved params
     into engine_run.config_snapshot, writes the run row (is_current=False).
  2. modules stamp run_id on every output row.
  3. finalize_run(run_id, ok=True) -> on success, flips is_current to this run and
     OFF for any prior current run of the SAME scope (one current run per scope).
     A failed run never becomes current, so consumers keep seeing the last good run.

run_id may be supplied explicitly (deterministic tests); otherwise a uuid4 is used.
Determinism of *outputs* (CLAUDE.md) is about content given (data, params), not the
run_id — which is lineage metadata.
"""
from __future__ import annotations
import datetime as dt
import json
import uuid

from engine.core.params import Params


class RunContext:
    def __init__(self, run_id: str, scope: dict, params: Params):
        self.run_id = run_id
        self.scope = scope
        self.params = params


def _scope_key(scope: dict) -> str:
    return json.dumps(scope, sort_keys=True)


def begin_run(io, scope: dict, methodology_version: str, *, run_id: str | None = None) -> RunContext:
    run_id = run_id or str(uuid.uuid4())
    params = Params.load(io, methodology_version)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    row = {
        "run_id": run_id,
        "scope": scope,                          # JSON-serialized by the writer
        "config_snapshot": params.snapshot(),    # the exact params that produced the run
        "methodology_version": methodology_version,
        "run_date": now,
        "n_pockets": 0,
        "n_opportunities": 0,
        "is_current": False,
        "created_at": now,
    }
    io.upsert_rows("opp", "engine_run", [row], key="run_id")
    return RunContext(run_id, scope, params)


def finalize_run(io, run_id: str, *, ok: bool = True, n_pockets: int = 0, n_opportunities: int = 0):
    df = io.read("opp", "engine_run")
    # locate this run + its scope
    this = df[df["run_id"] == run_id]
    if this.empty:
        raise ValueError(f"run_id {run_id} not found")
    scope_key = _scope_key(_as_obj(this.iloc[0]["scope"]))

    if ok:
        # one current run per scope: turn off prior current runs of the same scope
        same_scope = df["scope"].map(lambda s: _scope_key(_as_obj(s)) == scope_key)
        df.loc[same_scope, "is_current"] = False
        df.loc[df["run_id"] == run_id, "is_current"] = True
        df.loc[df["run_id"] == run_id, "n_pockets"] = n_pockets
        df.loc[df["run_id"] == run_id, "n_opportunities"] = n_opportunities
    else:
        df.loc[df["run_id"] == run_id, "is_current"] = False
    io.write("opp", "engine_run", df, mode="overwrite")


def current_run(io, scope: dict | None = None):
    """Return the current run row (optionally for a given scope), or None."""
    df = io.read("opp", "engine_run")
    df = df[df["is_current"] == True]  # noqa: E712
    if scope is not None:
        key = _scope_key(scope)
        df = df[df["scope"].map(lambda s: _scope_key(_as_obj(s)) == key)]
    return None if df.empty else df.iloc[0].to_dict()


def _as_obj(v):
    return json.loads(v) if isinstance(v, str) else v
