"""
Generate synthetic bronze data (indirect_cube, po_spr010, nonpo_fbl1n) so the
engine pipeline + frontend can be exercised end-to-end without the real Allison
source files. NOT real data — for local demo/design-review only.

Run: python scripts/gen_synthetic_bronze.py
"""
from __future__ import annotations
import datetime as dt
import os
import random

import pandas as pd

random.seed(42)
os.makedirs("data/bronze", exist_ok=True)

OEM_VENDORS = ["Fanuc India Private Limited", "The Gleason Works", "Okuma America Corp",
               "Mazak Corporation", "Siemens Industry Inc", "DMG Mori Seiki",
               "Haas Automation Inc", "Abb Inc", "Fronius USA LLC", "Heidenhain Corp", "Kuka Robotics"]
BROAD_VENDORS = ["Cline Tool And Service Company", "Hp Products Corp", "Motion Industries Inc",
                  "Kirby Risk Corporation", "R L Guimont Company", "United Tool Supply",
                  "Rubix Group Europe", "Instant Procurement Services Private", "Moglix India",
                  "Procmart Solutions", "Bulkmro Marketplace"]
TAIL_VENDORS = [f"Supplier {n}" for n in [
    "Ace Industrial", "Midwest Fasteners", "Precision Bearing Co", "Delta Safety Supply",
    "Northline Abrasives", "Summit Lubricants", "Crown Welding Supply", "Vertex Metrology",
    "Ironclad Tooling", "Apex Chemical Distributors", "Blue Ridge Paint Co", "Regal Hydraulics",
    "Titan Machine Parts", "Coastal Quality Instruments", "Grandview Consumables",
    "Pioneer Cages Mfg", "Sterling Weld Wire", "Redwood Lab Supplies", "Falcon Seals Inc",
    "Harbor Industrial Gas",
]]

L2_INDUSTRIAL_SEGMENTS = [
    "Machine parts", "Machine Parts", "Consumable Supplies", "Supplies", "Quality",
    "Safety Equipment", "Seals - Mechanical and Oil", "Hand and Power Tools", "Abrasives",
    "Paint", "Lab Supplies and Testing Consumables", "Hydraulics", "Cages",
    "Weld Wire and Consumables", "N/A",
]
OTHER_MRO_L2 = {
    "First Fill Oils (Lubricants)": ["Lubricants"],
    "Industrial Gas": ["Gas"],
    "Chemicals": ["Chemicals"],
    "Welding Supplies": ["Welding"],
}
COUNTRIES = [("United States", "North America"), ("India", "APAC"), ("Germany", "Europe"),
             ("Mexico", "North America")]
PAY_TERMS = ["NET30", "NET45", "NET60", "NET15"]
COMPANIES = ["AT", "OH"]
OTHER_L1 = ["Capex", "Direct"]


def excel_serial(d: dt.date) -> int:
    return (d - dt.date(1899, 12, 30)).days


def rand_material_id(kind):
    if kind == "unspsc":
        return str(random.randint(10000000, 99999999))
    if kind == "numcat":
        return str(random.randint(100000, 999999))
    if kind == "partlike":
        return "S" + str(random.randint(100000000, 999999999))
    return random.choice(["MACH REP", "GEN", "SVC"])


def gen_indirect_cube(n=3000):
    rows = []
    for i in range(n):
        l1 = "MRO" if random.random() < 0.75 else random.choice(OTHER_L1)
        if l1 == "MRO":
            if random.random() < 0.6:
                l2 = "Industrial Supplies"
                l3 = random.choice(L2_INDUSTRIAL_SEGMENTS)
            else:
                l2 = random.choice(list(OTHER_MRO_L2))
                l3 = random.choice(OTHER_MRO_L2[l2])
        else:
            l2, l3 = "Other", "Other"

        roll = random.random()
        if roll < 0.15:
            vendor = random.choice(OEM_VENDORS)
        elif roll < 0.55:
            vendor = random.choice(BROAD_VENDORS)
        else:
            vendor = random.choice(TAIL_VENDORS)

        country, region = random.choice(COUNTRIES)
        spend = round(random.lognormvariate(7.5, 1.4), 2)
        qty = round(random.uniform(1, 500), 1)
        id_kind = random.choice(["unspsc", "numcat", "partlike", "generic"])

        rows.append({
            "Company": random.choice(COMPANIES),
            "Parent Name": vendor,
            "Cleaned Vendor Name": vendor,
            "Consol 1": l1,
            "Consol 2": l2,
            "Consol 3": l3,
            "Net Spend": spend,
            "Invoice Quantity": qty,
            "Cleaned Purchasing Country": country,
            "Cleaned Purchasing Region": region,
            "Material ID": rand_material_id(id_kind),
            "Material Description": f"{l3} item {i}",
            "Controlled Spend": random.choice(["Y", "N"]),
            "Customer Directed": random.choice(["Y", "N"]),
            "Payment Terms": random.choice(PAY_TERMS),
        })
    df = pd.DataFrame(rows)
    df.to_parquet("data/bronze/indirect_cube.parquet", index=False)
    print(f"indirect_cube: {len(df):,} rows -> data/bronze/indirect_cube.parquet")
    return df


def gen_po(indirect_vendors, n=1500):
    rows = []
    start = dt.date(2025, 1, 1)
    for i in range(n):
        vendor = random.choice(indirect_vendors)
        created = start + dt.timedelta(days=random.randint(0, 300))
        posted = created + dt.timedelta(days=random.randint(1, 30))
        rows.append({
            "Porg": "P100",
            "Vendor Name": vendor,
            "Purch.Doc.": f"PO{100000 + i}",
            "Amount in USD": round(random.lognormvariate(7.2, 1.2), 2),
            "Invoice qty": round(random.uniform(1, 200), 1),
            "Plnt": random.choice(["PL01", "PL02", "PL03"]),
            "Pstg Date": excel_serial(posted),
            "Created Dt": excel_serial(created),
        })
    df = pd.DataFrame(rows)
    df.to_parquet("data/bronze/po_spr010.parquet", index=False)
    print(f"po_spr010: {len(df):,} rows -> data/bronze/po_spr010.parquet")


def gen_nonpo(indirect_vendors, n=500):
    rows = []
    start = dt.date(2025, 1, 1)
    for i in range(n):
        vendor = random.choice(indirect_vendors)
        posted = start + dt.timedelta(days=random.randint(0, 330))
        rows.append({
            "Company Code": random.choice(COMPANIES),
            "Vendor Name": vendor,
            "Account": f"ACC{random.randint(1000,9999)}",
            "Amount in USD": round(random.lognormvariate(6.5, 1.1), 2),
            "Posting Date": excel_serial(posted),
        })
    df = pd.DataFrame(rows)
    df.to_parquet("data/bronze/nonpo_fbl1n.parquet", index=False)
    print(f"nonpo_fbl1n: {len(df):,} rows -> data/bronze/nonpo_fbl1n.parquet")


if __name__ == "__main__":
    cube = gen_indirect_cube()
    vendors = cube["Cleaned Vendor Name"].unique().tolist()
    gen_po(vendors)
    gen_nonpo(vendors)
    print("\nSynthetic bronze data generated. This is NOT real Allison data — demo/design-review only.")
