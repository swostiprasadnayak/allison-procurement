"""
Load the real Gold CDM into Postgres — the local stand-in for the M11 Lakebase sync.

Reads the engine's Gold output (opp.*/cim.*/ref.*) and writes it to a Postgres database, one
schema per CDM namespace, one table per contract table. This is what the Next.js API route
handlers query. In production the same tables land in Databricks Lakebase (managed Postgres) —
only the connection string changes.

  docker compose up -d
  python jobs/load_cdm_postgres.py
  # DATABASE_URL overrides the default local connection.

Idempotent: each table is dropped + recreated from the current Gold (if_exists="replace").
"""
from __future__ import annotations
import json
import os
import sys

import pandas as pd
from sqlalchemy import create_engine, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO

DEFAULT_URL = "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta"

# (schema, table) — the CDM tables the serving layer needs. Skips any not yet built.
TABLES = [
    ("opp", "opportunity"), ("opp", "opportunity_recommendation"),
    ("opp", "opportunity_evidence_factor"), ("opp", "opportunity_vendor"),
    ("opp", "opportunity_trigger"), ("opp", "scan_ranking"), ("opp", "spend_pocket"),
    ("opp", "fact_spend"), ("opp", "benchmark"), ("opp", "category_benchmark_map"),
    ("opp", "fact_spend_actual"), ("opp", "vendor_performance"),
    ("opp", "vendor_classification"), ("opp", "engine_parameter"), ("opp", "engine_run"),
    ("cim", "vendor"), ("cim", "product"), ("ref", "taxonomy"),
]


def _jsonify(df: pd.DataFrame) -> pd.DataFrame:
    """Postgres can't adapt python list/dict cells — store them as JSON text (the FE parses)."""
    df = df.copy()
    for col in df.columns:
        if df[col].dtype == object:
            df[col] = df[col].map(lambda v: json.dumps(v) if isinstance(v, (list, dict)) else v)
    return df


def main():
    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    # accept a plain postgres:// URL too
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    engine = create_engine(url)
    io = LocalIO(root="data")

    with engine.begin() as conn:
        for schema in ("cim", "opp", "ref"):
            conn.execute(text(f"CREATE SCHEMA IF NOT EXISTS {schema}"))

    loaded, skipped = [], []
    for schema, table in TABLES:
        if not io.exists(schema, table):
            skipped.append(f"{schema}.{table}")
            continue
        df = _jsonify(io.read(schema, table))
        df.to_sql(table, engine, schema=schema, if_exists="replace", index=False, chunksize=2000)
        loaded.append((f"{schema}.{table}", len(df)))

    print(f"CDM loaded into {url.rsplit('@', 1)[-1]}")
    for name, n in loaded:
        print(f"  {name:34s} {n:>7,} rows")
    if skipped:
        print(f"  (not built yet, skipped: {', '.join(skipped)})")

    # quick sanity: MRO opportunity count + total movable
    with engine.connect() as conn:
        row = conn.execute(text(
            "SELECT count(*) n, coalesce(sum(movable_value),0) mv FROM opp.opportunity "
            "WHERE l1_code = 'L1|MRO'")).one()
        print(f"\nsanity: {row.n} MRO opportunities · ${row.mv:,.0f} movable in the CDM")


if __name__ == "__main__":
    main()
