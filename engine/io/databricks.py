"""
DatabricksIO — production backend (skeleton).

The team implements these methods over Spark + Delta + Unity Catalog. The
signatures match EngineIO exactly, so engine logic ported from local needs no
change — only the backend is swapped at the entrypoint:

    io = DatabricksIO(catalog="navanta", spark=spark)   # production
    io = LocalIO(root="data")                            # local validation

Mapping notes for the implementer:
  - read_bronze(name)         -> spark.read.table(f"{catalog}.bronze.{name}")
  - read(schema, table)       -> spark.read.table(f"{catalog}.{schema}.{table}")
  - write(schema, table, df)  -> df.write.format("delta").mode(mode)
                                   .saveAsTable(f"{catalog}.{schema}.{table}")
  - upsert_rows(...)          -> DeltaTable.merge(...) on `key` (atomic)
  - is_current flip           -> a single MERGE/UPDATE in one transaction
  - heavy group-bys           -> either native Spark, or run the pandas core via
                                  df.groupBy(...).applyInPandas(core_fn, schema)
                                  so the validated logic is reused verbatim.
This file intentionally raises NotImplementedError; it is the porting contract,
not POC-critical (M11/serving is the team's scope).
"""
from __future__ import annotations
from engine.io.base import EngineIO


class DatabricksIO(EngineIO):
    def __init__(self, catalog: str, spark=None):
        self.catalog = catalog
        self.spark = spark

    def _fqn(self, schema, table):
        return f"{self.catalog}.{schema}.{table}"

    def read_bronze(self, name):
        raise NotImplementedError("Port: spark.read.table(catalog.bronze.<name>)")

    def read(self, schema, table):
        raise NotImplementedError(f"Port: spark.read.table({self._fqn(schema, table)})")

    def exists(self, schema, table):
        raise NotImplementedError("Port: spark.catalog.tableExists(fqn)")

    def write(self, schema, table, frame, *, mode="overwrite"):
        raise NotImplementedError(
            f"Port: frame.write.format('delta').mode('{mode}').saveAsTable({self._fqn(schema, table)})")

    def upsert_rows(self, schema, table, rows, key):
        raise NotImplementedError("Port: DeltaTable.merge on key (atomic upsert)")
