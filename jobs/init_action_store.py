"""Create opp.opportunity_action — the mutable user / play-state layer.

The engine's `opp.opportunity` is rebuilt on every run (read-only Gold), so user
actions can't live there. This table is the OLTP layer: keyed by opportunity id,
it holds the user's status, chosen approach, task progress, notes, and commit
facts. The CDM loader only ever `replace`s engine Gold tables, so this survives
reloads and engine re-runs untouched.

Idempotent: CREATE TABLE IF NOT EXISTS.
"""

import os

from sqlalchemy import create_engine, text

DEFAULT_URL = "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta"

DDL = [
    "CREATE SCHEMA IF NOT EXISTS opp",
    """
    CREATE TABLE IF NOT EXISTS opp.opportunity_action (
      -- Holds the STABLE opp.opportunity.opportunity_key (natural key = hash of
      -- l3 x country), NOT the run-scoped opportunity.id — so persisted decisions
      -- survive engine re-runs (which re-mint ids). The FE keys the write-back on it.
      opportunity_id   text PRIMARY KEY,
      status           text,
      approach         text,
      done_tasks       jsonb,
      notes            text,
      park_trigger     text,
      reject_reason    text,
      committed_at     text,
      committed_timing text,
      committed_basis  text,
      committed_low    double precision,
      committed_high   double precision,
      updated_at       timestamptz DEFAULT now(),
      updated_by       text
    )
    """,
    # Act workspace: operator-edited checklist + draft version history.
    # ADD COLUMN IF NOT EXISTS keeps this idempotent against tables created
    # before these fields existed (local + already-loaded Neon databases).
    "ALTER TABLE opp.opportunity_action ADD COLUMN IF NOT EXISTS custom_tasks jsonb",
    "ALTER TABLE opp.opportunity_action ADD COLUMN IF NOT EXISTS draft_versions jsonb",
]


def main():
    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    engine = create_engine(url)
    with engine.begin() as conn:
        for stmt in DDL:
            conn.execute(text(stmt))
        n = conn.execute(text("SELECT count(*) FROM opp.opportunity_action")).scalar()
    print(f"→ opp.opportunity_action ready ({n} existing rows)")


if __name__ == "__main__":
    main()
