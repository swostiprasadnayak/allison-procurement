"""
Source manifest for Stage 0 landing.

One entry per landed file. Header detection is by SENTINEL column names
(the first row that contains all sentinels is the header row) so we never
hardcode a brittle row index. Documented row counts / spend totals come from
Allison_MRO_Methodology_Spec.xlsx (Data Lineage) and the cube total cell.
"""

# Resolved relative to the repo root's parent (the project folder that holds "Source Data/")
SOURCE_DIR = "../Source Data"
BRONZE_DIR = "data/bronze"

SOURCES = {
    "indirect_cube": {
        "file": "Draft - ALSN Combination - Indirect Procurement Spend Cube (Shared) 04.02.26.xlsb",
        "kind": "xlsb",
        "sheet": "C-Indirect Spend Cube",
        "header_sentinels": ["Net Spend", "Consol 1", "Cleaned Vendor Name"],
        "expected_rows": 104150,
        "expected_spend_col": "Net Spend",
        "expected_spend_total": 956701783.0174195,  # cube total cell (r4)
        "spend_tol": 5000.0,
        "role": "PRIMARY analysis source (acceptance anchor runs here)",
    },
    "po_spr010": {
        "file": "Indirect PO Spend 2025 s-pr-010.xlsb",
        "kind": "xlsb",
        "sheet": "PO Invoices 2025",
        "header_sentinels": ["Porg", "Vendor Name", "Purch.Doc."],
        "expected_rows": 63156,
        "expected_spend_col": None,
        "role": "PO lines (realization: price & qty)",
    },
    "nonpo_fbl1n": {
        "file": "Indirect Non-PO Spend 2025 fbl1n.xlsb",
        "kind": "xlsb",
        "sheet": "Non-PO Spend 2025",
        "header_sentinels": ["Company Code", "Vendor Name", "Account"],
        "expected_rows": 14724,
        "expected_spend_col": None,
        "role": "Non-PO / AP (tail/maverick realization)",
    },
    "direct_cube": {
        "file": "Draft - ALSN Combination - Direct Procurement Spend Cube (Shared) 4.02.26.csv",
        "kind": "csv",
        "header_sentinels": ["RecordID", "Cleaned Supplier Name", "Total Value (USD)"],
        "expected_rows": None,  # not documented; report what we get
        "expected_spend_col": "Total Value (USD)",
        "role": "Combined-foundation source (fluids/chemicals cross-cube) — landed but combine deferred to Stage 6",
    },
}

# Stage-0 bonus sanity check: the Industrial Supplies subset of the indirect cube.
# This is really a Stage-2 gate, but it's cheap and high-signal to confirm the
# column mapping is right and that we will hit the anchor.
INDUSTRIAL_SUPPLIES_CHECK = {
    "l1_col": "Consol 1",
    "l2_col": "Consol 2",
    "l1_value": "MRO",
    "l2_value": "Industrial Supplies",
    "vendor_col": "Cleaned Vendor Name",
    "spend_col": "Net Spend",
    "expected_rows": 11964,
    "expected_spend": 34089850.0,
    "expected_vendors": 1093,
}
