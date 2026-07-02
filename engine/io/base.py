"""
EngineIO — the storage abstraction.

ALL engine logic reads/writes through this interface, so the same logic runs:
  - locally on pandas + parquet (LocalIO) for validation against the fixtures, and
  - on Databricks with Spark + Delta + Unity Catalog (DatabricksIO) in production.

Tables are addressed as (schema, table) — e.g. ("opp", "engine_run") — matching the
CDM. Bronze landed files are addressed via read_bronze(name).
"""
from __future__ import annotations
from abc import ABC, abstractmethod


class EngineIO(ABC):
    # --- Bronze (landed source) ---
    @abstractmethod
    def read_bronze(self, name: str):
        """Return the landed Bronze table `name` as a frame."""

    # --- Gold / Silver tables, addressed by (schema, table) ---
    @abstractmethod
    def read(self, schema: str, table: str):
        """Return (schema.table) as a frame. Raises if it does not exist."""

    @abstractmethod
    def exists(self, schema: str, table: str) -> bool:
        ...

    @abstractmethod
    def write(self, schema: str, table: str, frame, *, mode: str = "overwrite"):
        """Write a frame to (schema.table). mode in {'overwrite','append'}.

        Run-scoped outputs stamp run_id on every row (the caller's responsibility).
        The contract for column names/order is engine/schema/contracts.py.
        """

    # --- convenience for read-modify-write of small control tables ---
    def upsert_rows(self, schema: str, table: str, rows: list[dict], key: str):
        """Insert/replace rows by `key`. Default impl via read+write; backends
        may override with a native MERGE."""
        raise NotImplementedError
