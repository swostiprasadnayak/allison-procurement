"""
Apply admin parameter edits back into the engine's Gold store.

The Lens admin console (Methodology & Parameters page) saves parameter edits to
`opp.engine_parameter` in the *served* CDM (Postgres). The engine, however, reads
parameters from its *Gold* store (Delta/parquet) at run time via `Params.load`.
This job syncs the edited values Postgres -> Gold so the NEXT engine run picks
them up.

Run this before a re-run whenever parameters were edited in the console:
    python jobs/apply_param_edits.py       # Postgres -> Gold
    python jobs/stage3_star_pockets.py     # M4-M5 (pockets)
    python jobs/stage4_opportunities.py    # M6-M7 (scan + opportunities)
    python jobs/load_cdm_postgres.py       # Gold -> Postgres (serving)

In production this bridge is unnecessary — the engine reads the same parameter
store the console writes to; this only reconciles the local Postgres/parquet split.
"""
from __future__ import annotations
import os
import sys

import pandas as pd
from sqlalchemy import create_engine

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO

DEFAULT_URL = "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta"
COLUMNS = [
    "param_key", "methodology_version", "value_numeric", "value_json", "unit",
    "display_label", "category", "description", "last_changed_by", "last_changed_at",
    "change_note",
]


def main():
    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    engine = create_engine(url)
    io = LocalIO(root="data")

    df = pd.read_sql(f"SELECT {', '.join(COLUMNS)} FROM opp.engine_parameter", engine)
    # NULL value_json comes back as NaN — normalize to None so Params.load reads
    # value_numeric for single-value dials (it tests `isinstance(str)`).
    df["value_json"] = df["value_json"].where(df["value_json"].notna(), None)
    io.write("opp", "engine_parameter", df)

    edited = df[df["change_note"].fillna("seed") != "seed"]
    print(f"synced {len(df)} parameters Postgres -> Gold  ({len(edited)} edited from seed)")
    for _, r in edited.iterrows():
        v = r["value_numeric"] if pd.notna(r["value_numeric"]) else r["value_json"]
        print(f"  {r['param_key']:34s} = {v}  ({r['change_note']})")


if __name__ == "__main__":
    main()
