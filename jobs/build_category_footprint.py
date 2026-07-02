"""Build ref.category_footprint — the indirect L1 category expansion map.

Aggregates the indirect spend cube's `Consol 1` (L1) hierarchy into per-category
net spend, flags the one L1 we've scanned (MRO), and loads it to Postgres so the
FE can show the real category footprint ("MRO scanned · $X of $Y indirect") and
drive the L1 selector's expansion list from real data — no hardcoded figures.

Idempotent: drops + recreates ref.category_footprint from the current cube.
"""

import os
import re

import pandas as pd
from sqlalchemy import create_engine, text

DEFAULT_URL = "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta"
CUBE = os.path.join(os.path.dirname(__file__), "..", "data", "bronze", "indirect_cube.parquet")

# Consol 1 buckets that are not real spend categories.
_DROP = re.compile(r"(?i)^(exclude|pending|direct|nan)\b|^$")
# Casing dupes in the raw cube.
_CANON = {"CAPEX": "Capex", "CapEX": "Capex"}


def main():
    df = pd.read_parquet(CUBE)
    df["l1"] = df["Consol 1"].astype(str).str.strip().replace(_CANON)
    df["spend"] = pd.to_numeric(df["Net Spend"], errors="coerce").fillna(0.0)
    # Distinct supplier count per category (fragmentation signal) — empty/nan names dropped.
    df["vendor"] = df["Cleaned Vendor Name"].astype(str).str.strip().replace({"": pd.NA, "nan": pd.NA})
    df = df[~df["l1"].str.match(_DROP)]

    agg = (
        df.groupby("l1")
        .agg(net_spend=("spend", "sum"), line_count=("spend", "size"), vendors=("vendor", "nunique"))
        .reset_index()
        .rename(columns={"l1": "l1_name"})
        .sort_values("net_spend", ascending=False)
        .reset_index(drop=True)
    )
    agg["is_scanned"] = agg["l1_name"].eq("MRO")
    agg["rank"] = agg.index + 1

    total = agg["net_spend"].sum()
    scanned = agg.loc[agg["is_scanned"], "net_spend"].sum()
    print(f"{len(agg)} indirect L1 categories · total ${total/1e6:,.1f}M · "
          f"scanned (MRO) ${scanned/1e6:,.1f}M ({scanned/total*100:.0f}%)")
    for _, r in agg.iterrows():
        flag = " [scanned]" if r["is_scanned"] else ""
        print(f"   {int(r['rank']):>2}. {r['l1_name']:22} ${r['net_spend']/1e6:7.1f}M{flag}")

    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS ref"))
    agg.to_sql("category_footprint", engine, schema="ref", if_exists="replace", index=False)
    print("→ loaded ref.category_footprint")


if __name__ == "__main__":
    main()
