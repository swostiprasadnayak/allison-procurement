"""
LocalIO — pandas + parquet backend for local validation.

Catalog layout on disk:
    data/bronze/<name>.parquet                 (Stage 0 landed sources)
    data/<layer>/<schema>/<table>.parquet      (silver/gold engine tables)

This is the backend used to reconcile against the methodology fixtures. The
production backend (DatabricksIO) implements the same interface over Delta/UC.
"""
from __future__ import annotations
import json
import os

import pandas as pd

from engine.io.base import EngineIO

# which layer each schema lives in (medallion)
_SCHEMA_LAYER = {"cim": "silver", "ref": "silver", "opp": "gold"}


class LocalIO(EngineIO):
    def __init__(self, root: str = "data"):
        self.root = root

    # ---- paths ----
    def _bronze_path(self, name: str) -> str:
        return os.path.join(self.root, "bronze", f"{name}.parquet")

    def _path(self, schema: str, table: str) -> str:
        layer = _SCHEMA_LAYER.get(schema, "gold")
        return os.path.join(self.root, layer, schema, f"{table}.parquet")

    # ---- reads ----
    def read_bronze(self, name: str) -> pd.DataFrame:
        p = self._bronze_path(name)
        if not os.path.exists(p):
            raise FileNotFoundError(f"Bronze table not found: {p} (run ingestion/step0_land.py)")
        return pd.read_parquet(p)

    def read(self, schema: str, table: str) -> pd.DataFrame:
        p = self._path(schema, table)
        if not os.path.exists(p):
            raise FileNotFoundError(f"{schema}.{table} not found at {p}")
        return pd.read_parquet(p)

    def exists(self, schema: str, table: str) -> bool:
        return os.path.exists(self._path(schema, table))

    # ---- writes ----
    def write(self, schema: str, table: str, frame: pd.DataFrame, *, mode: str = "overwrite"):
        p = self._path(schema, table)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        df = frame.copy()
        if mode == "append" and os.path.exists(p):
            df = pd.concat([pd.read_parquet(p), df], ignore_index=True)
        # JSON-serialize dict/list cells so parquet stays stable (Bronze pattern)
        for col in df.columns:
            if df[col].map(lambda v: isinstance(v, (dict, list))).any():
                df[col] = df[col].map(lambda v: json.dumps(v) if isinstance(v, (dict, list)) else v)
        df.to_parquet(p, index=False)
        return p

    def upsert_rows(self, schema: str, table: str, rows: list[dict], key: str):
        new = pd.DataFrame(rows)
        if self.exists(schema, table):
            cur = self.read(schema, table)
            cur = cur[~cur[key].isin(new[key])]
            out = pd.concat([cur, new], ignore_index=True)
        else:
            out = new
        return self.write(schema, table, out, mode="overwrite")
