"""
Stage 0 — Land raw source files into Bronze parquet.

Bronze = raw, no transforms (medallion principle). We only:
  - locate the real header row by sentinel column names,
  - read rows with POSITIONAL alignment to the header (xlsb rows are sparse —
    empty cells are skipped, so collapsing blanks would misalign columns),
  - write typed parquet to data/bronze/,
  - emit a reconciliation report (row counts + spend totals vs documented).

Run:  python ingestion/step0_land.py [--only indirect_cube]
Output: data/bronze/*.parquet  and  reports/stage0_landing_reconciliation.json
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from ingestion.source_manifest import (
    SOURCES, SOURCE_DIR, BRONZE_DIR, INDUSTRIAL_SUPPLIES_CHECK,
)

REPORTS_DIR = "reports"


def _find_header_row_xlsb(sheet, sentinels, scan_limit=30):
    """Return (header_row_index, {col_index: name}) for the first row containing all sentinels."""
    sentinels_lower = {s.lower() for s in sentinels}
    for i, row in enumerate(sheet.rows()):
        names = {c.c: ("" if c.v is None else str(c.v).strip()) for c in row}
        present = {v.lower() for v in names.values() if v}
        if sentinels_lower.issubset(present):
            # dense header: fill positions 0..max_col
            max_c = max(names) if names else -1
            header = [names.get(c, "") for c in range(max_c + 1)]
            return i, header
        if i >= scan_limit:
            break
    raise ValueError(f"Header row with sentinels {sentinels} not found in first {scan_limit} rows")


def read_xlsb(path, sheet_name, sentinels):
    from pyxlsb import open_workbook
    with open_workbook(path) as wb:
        with wb.get_sheet(sheet_name) as sheet:
            header_idx, header = _find_header_row_xlsb(sheet, sentinels)
            ncols = len(header)
        # re-open the sheet to iterate data rows (generator already consumed)
        with wb.get_sheet(sheet_name) as sheet:
            data = []
            for i, row in enumerate(sheet.rows()):
                if i <= header_idx:
                    continue
                dense = [None] * ncols
                for c in row:
                    if c.c < ncols:
                        dense[c.c] = c.v
                # skip fully-empty rows
                if any(v is not None and v != "" for v in dense):
                    data.append(dense)
    df = pd.DataFrame(data, columns=_dedupe(header))
    # drop columns with empty names (artifacts) only if entirely empty
    df = df.loc[:, [c for c in df.columns if str(c).strip() != ""]]
    return df


def read_csv(path, sentinels):
    # Locate header line by scanning for sentinels (Cognos export has a preamble).
    header_line = None
    with open(path, encoding="utf-8-sig") as f:
        import csv
        for i, row in enumerate(csv.reader(f)):
            present = {str(v).strip().lower() for v in row if str(v).strip()}
            if {s.lower() for s in sentinels}.issubset(present):
                header_line = i
                break
            if i > 40:
                break
    if header_line is None:
        raise ValueError(f"Header line with sentinels {sentinels} not found")
    df = pd.read_csv(path, skiprows=header_line, header=0, dtype=str, low_memory=False)
    # drop fully-unnamed/all-empty leading columns from the Cognos layout
    df = df.loc[:, [c for c in df.columns if not str(c).startswith("Unnamed")]]
    return df


def _dedupe(names):
    """Make duplicate / blank column names unique and stable."""
    seen, out = {}, []
    for n in names:
        n = str(n).strip()
        if n == "":
            n = "_blank"
        if n in seen:
            seen[n] += 1
            out.append(f"{n}__{seen[n]}")
        else:
            seen[n] = 0
            out.append(n)
    return out


def _to_num(series):
    return pd.to_numeric(series, errors="coerce")


def _to_string_frame(df):
    """Bronze is raw text. xlsb yields mixed float/str/None per column, which
    pyarrow rejects. Cast every column to pandas 'string' dtype (NA-aware) so
    parquet is stable and lossless for text; numeric reconciliation re-coerces."""
    df = df.where(pd.notnull(df), pd.NA)
    return df.astype("string")


def land_one(key, cfg):
    path = os.path.join(SOURCE_DIR, cfg["file"])
    t0 = time.time()
    print(f"\n[{key}] reading {cfg['kind']}: {cfg['file']}")
    if cfg["kind"] == "xlsb":
        df = read_xlsb(path, cfg["sheet"], cfg["header_sentinels"])
    else:
        df = read_csv(path, cfg["header_sentinels"])
    df = _to_string_frame(df)
    n = len(df)
    os.makedirs(BRONZE_DIR, exist_ok=True)
    out = os.path.join(BRONZE_DIR, f"{key}.parquet")
    df.to_parquet(out, index=False)
    secs = round(time.time() - t0, 1)
    print(f"[{key}] {n:,} rows x {df.shape[1]} cols -> {out}  ({secs}s)")

    rec = {
        "source": key, "file": cfg["file"], "role": cfg["role"],
        "rows": n, "cols": df.shape[1], "bronze": out, "seconds": secs,
        "expected_rows": cfg.get("expected_rows"),
        "columns": list(df.columns),
    }
    if cfg.get("expected_rows") is not None:
        rec["rows_match"] = (n == cfg["expected_rows"])
    # spend total reconciliation
    sc = cfg.get("expected_spend_col")
    if sc and sc in df.columns:
        total = float(_to_num(df[sc]).sum())
        rec["spend_total"] = round(total, 2)
        if cfg.get("expected_spend_total") is not None:
            tol = cfg.get("spend_tol", 1.0)
            rec["expected_spend_total"] = round(cfg["expected_spend_total"], 2)
            rec["spend_match"] = abs(total - cfg["expected_spend_total"]) <= tol
    return df, rec


def industrial_supplies_check(indirect_df):
    c = INDUSTRIAL_SUPPLIES_CHECK
    d = indirect_df
    mask = (d[c["l1_col"]].astype(str).str.strip() == c["l1_value"]) & \
           (d[c["l2_col"]].astype(str).str.strip() == c["l2_value"])
    sub = d[mask]
    rows = int(len(sub))
    spend = round(float(_to_num(sub[c["spend_col"]]).sum()), 2)
    vendors = int(sub[c["vendor_col"]].astype(str).str.strip().nunique())
    return {
        "filter": f"{c['l1_col']}='{c['l1_value']}' AND {c['l2_col']}='{c['l2_value']}'",
        "rows": rows, "expected_rows": c["expected_rows"], "rows_match": rows == c["expected_rows"],
        "spend": spend, "expected_spend": c["expected_spend"],
        "spend_match": abs(spend - c["expected_spend"]) <= 1.0,
        "vendors": vendors, "expected_vendors": c["expected_vendors"],
        "vendors_match": vendors == c["expected_vendors"],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="land only this source key")
    args = ap.parse_args()

    keys = [args.only] if args.only else list(SOURCES)
    report = {"stage": "0 - landing", "sources": [], "industrial_supplies_check": None}
    frames = {}
    for k in keys:
        df, rec = land_one(k, SOURCES[k])
        frames[k] = df
        report["sources"].append(rec)

    if "indirect_cube" in frames:
        report["industrial_supplies_check"] = industrial_supplies_check(frames["indirect_cube"])

    os.makedirs(REPORTS_DIR, exist_ok=True)
    rpt_path = os.path.join(REPORTS_DIR, "stage0_landing_reconciliation.json")
    with open(rpt_path, "w") as f:
        json.dump(report, f, indent=2)

    # console summary
    print("\n" + "=" * 64 + "\nSTAGE 0 RECONCILIATION\n" + "=" * 64)
    for r in report["sources"]:
        rm = r.get("rows_match")
        flag = "" if rm is None else ("  PASS" if rm else "  FAIL")
        exp = r.get("expected_rows")
        print(f"  {r['source']:14} rows={r['rows']:>8,}"
              f"{('  (exp ' + format(exp, ',') + ')') if exp else '':>16}{flag}")
        if "spend_total" in r:
            sm = r.get("spend_match")
            sflag = "" if sm is None else ("  PASS" if sm else "  FAIL")
            print(f"  {'':14} spend=${r['spend_total']:,.2f}"
                  f"{(' (exp $' + format(r['expected_spend_total'], ',.2f') + ')') if 'expected_spend_total' in r else ''}{sflag}")
    isc = report["industrial_supplies_check"]
    if isc:
        print("\n  Industrial Supplies sanity (Stage-2 anchor preview):")
        print(f"    rows    {isc['rows']:>8,}  (exp {isc['expected_rows']:,})   {'PASS' if isc['rows_match'] else 'FAIL'}")
        print(f"    spend   ${isc['spend']:,.2f}  (exp ${isc['expected_spend']:,.2f})   {'PASS' if isc['spend_match'] else 'FAIL'}")
        print(f"    vendors {isc['vendors']:>8,}  (exp {isc['expected_vendors']:,})   {'PASS' if isc['vendors_match'] else 'FAIL'}")
    print(f"\n  report -> {rpt_path}")


if __name__ == "__main__":
    main()
