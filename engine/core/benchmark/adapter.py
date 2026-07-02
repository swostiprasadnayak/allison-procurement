"""
M8 — benchmark_adapter  (Appendix A.7).

A pluggable BenchmarkSource so providers swap with no engine change:
  - BLSProvider — free PPI series, wired for the POC. Reads an offline fixture so it's
    testable without the live API; the live BLS REST pull drops into fetch() unchanged.
  - (Beroe / S&P / aPriori implement the same interface in production.)

Outputs:
  - opp.benchmark            — external price series (provider/series_id/period/value) +
                               the INTERNAL payment-terms working-capital benchmark (computable now).
  - opp.category_benchmark_map — category -> series, so the engine joins a category to its index.

Payment-terms WC (computable now): wc_value = annual_spend x (best_days - current_days)/365 x cost_of_capital.
Index should-cost (per-standard-unit) is STAGED — needs clean UOM / the part master.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import os
import re
from abc import ABC, abstractmethod

import pandas as pd
import yaml

_TRUE_ADVANCE = ("cash-in-advance", "in advance", "payable immediately", "immediately")


def parse_payment_terms_days(text) -> int | None:
    """Cube payment-terms string -> days (DPO). None if unparseable."""
    t = str(text).strip().lower()
    if not t or t in ("nan", "unknown", "none"):
        return None
    if any(k in t for k in _TRUE_ADVANCE):
        return 0
    if "2nd day of 2nd month" in t:
        return 60  # ~2 months after receipt — documented approximation
    m = re.search(r"net\s+(\d+)", t) or re.search(r"(\d+)\s*days", t) or re.fullmatch(r"(\d+)", t)
    return int(m.group(1)) if m else None


class BenchmarkSource(ABC):
    name = "abstract"

    @abstractmethod
    def fetch(self, series_id: str) -> list[dict]:
        """Return [{period, value}] for a series."""


class BLSProvider(BenchmarkSource):
    name = "BLS"

    def __init__(self, fixture_path="config/bls_ppi_fixture.json", live=False):
        self.fixture_path = fixture_path
        self.live = live  # production: pull from the BLS REST API here (same return shape)

    def fetch(self, series_id: str) -> list[dict]:
        if self.live:
            raise NotImplementedError("Live BLS REST pull plugs in here (same {period,value} shape).")
        with open(self.fixture_path) as f:
            data = json.load(f)
        s = data.get(series_id)
        return s["observations"] if s else []

    def unit(self, series_id):
        with open(self.fixture_path) as f:
            data = json.load(f)
        return (data.get(series_id) or {}).get("unit", "index")


def _bid(*parts):
    return "B" + hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def _best_demonstrated_dpo(g: pd.DataFrame, min_share: float) -> float:
    """Longest payment term demonstrated on at least `min_share` of this group's spend.

    Guards against thin outliers (e.g. a 150-day term on 6 invoices): a term only counts as
    best-in-class if >= min_share of spend already runs at that term OR longer. min_share=0
    reverts to the raw max.
    """
    by = g.groupby("days")["net"].sum().sort_index(ascending=False)  # longest terms first
    if min_share <= 0:
        return float(by.index.max())
    above = by.cumsum()                              # above[d] = spend at terms >= d
    ok = above[above >= min_share * float(by.sum())]
    return float(ok.index.max()) if len(ok) else float(by.index.min())


def payment_terms_benchmark(canon: pd.DataFrame, *, cost_of_capital: float,
                            best_min_share: float = 0.05, scope_l1="MRO") -> list[dict]:
    """Per sub-category (L2) working-capital value of moving to best-in-class terms. Computable now.

    target_dpo = max(best_demonstrated_at_scale, current_weighted) so wc_value is never negative
    (a category already above class scores 0, not a penalty). best_min_share parameterizes how much
    spend a term must cover to qualify as the target (see opp.engine_parameter.payment_terms_best_min_share).
    """
    d = canon[canon["l1"] == scope_l1].copy()
    d["net"] = pd.to_numeric(d["net_spend"], errors="coerce").astype("float64").fillna(0.0)
    d["days"] = d["pay_terms"].map(parse_payment_terms_days)
    d = d[d["days"].notna() & (d["net"] > 0)]
    rows = []
    for l2, g in d.groupby("l2"):
        spend = float(g["net"].sum())
        if spend <= 0:
            continue
        cur = float((g["net"] * g["days"]).sum() / spend)          # spend-weighted current DPO
        best = _best_demonstrated_dpo(g, best_min_share)           # demonstrated-at-scale terms
        target = max(best, cur)                                    # never below current -> wc >= 0
        wc = spend * (target - cur) / 365.0 * cost_of_capital
        rows.append({"category": l2, "current_dpo": round(cur, 1), "best_dpo": round(target, 1),
                     "annual_spend": round(spend, 2), "wc_value": round(wc, 2)})
    return rows


def build_benchmark(io, params, *, map_path="config/category_benchmark_map.yaml",
                    fixture_path="config/bls_ppi_fixture.json", run_id):
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    with open(map_path) as f:
        mappings = yaml.safe_load(f)["mappings"]

    # category -> series map
    map_rows = [{"category": m["category"], "provider": m["provider"], "series_id": m["series_id"],
                 "note": m.get("note", "")} for m in mappings]

    # external series (BLS, offline fixture)
    bls = BLSProvider(fixture_path=fixture_path)
    brows = []
    for m in mappings:
        if m["provider"] != "BLS":
            continue
        for obs in bls.fetch(m["series_id"]):
            brows.append({"id": _bid(m["provider"], m["series_id"], obs["period"]),
                          "provider": m["provider"], "series_id": m["series_id"],
                          "period": obs["period"], "value": float(obs["value"]),
                          "unit": bls.unit(m["series_id"]), "retrieved_at": now})

    # internal payment-terms working-capital benchmark (computable now)
    from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    pt = payment_terms_benchmark(canon, cost_of_capital=params.num("cost_of_capital"),
                                 best_min_share=params.num("payment_terms_best_min_share"))
    for r in pt:
        brows.append({"id": _bid("internal", "payment_terms_wc", r["category"]),
                      "provider": "internal-payment-terms", "series_id": f"payment_terms_wc:{r['category']}",
                      "period": "2025", "value": r["wc_value"], "unit": "usd_wc", "retrieved_at": now})

    return pd.DataFrame(brows), pd.DataFrame(map_rows), pt
