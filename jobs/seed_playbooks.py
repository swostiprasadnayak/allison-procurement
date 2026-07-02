"""Seed ref.playbook — the execution-approach templates the Act module renders.

These are curated procurement playbooks (not cube-derived): each lever family has
a label, a one-line descriptor, an ordered task checklist, and the engine
`play_route`(s) it's recommended for. Storing them server-side (vs hardcoded in
the FE) makes them admin-adjustable per client with no code change — the
"parameterize everything" principle applied to execution guidance.

Idempotent: drops + recreates ref.playbook.
"""

import json
import os

import pandas as pd
from sqlalchemy import create_engine, text

DEFAULT_URL = "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta"

PLAYBOOKS = [
    {
        "playbook_id": "consolidate",
        "label": "Consolidate",
        "sub": "tail → incumbent",
        "recommended_routes": ["consolidate"],
        "tasks": [
            "Confirm scope & OEM / sole-source carve-outs",
            "Validate the incumbent's capacity, service & terms",
            "Model the consolidated volume & target price",
            "Draft the consolidation proposal (Mercer)",
            "Align plants / sites on the transition",
            "Negotiate & sign consolidated terms",
            "Plan phased migration; set cutover dates",
            "Award & capture committed savings",
        ],
    },
    {
        "playbook_id": "rfp",
        "label": "Competitive RFP",
        "sub": "aggregate demand · score on total cost",
        "recommended_routes": ["rfp"],
        "tasks": [
            "Confirm scope & SKUs against the part master",
            "Confirm sites & delivery points in scope",
            "Finalize the qualified supplier shortlist",
            "Set evaluation criteria & weights",
            "Issue the RFP (Mercer draft)",
            "Collect & score bids on total cost",
            "Select supplier(s); negotiate terms",
            "Award & capture committed savings",
        ],
    },
    {
        "playbook_id": "negotiate",
        "label": "Negotiate / Benchmark",
        "sub": "terms & price",
        "recommended_routes": ["carve-out"],
        "tasks": [
            "Pull current terms, price & payment terms",
            "Benchmark vs market / should-cost",
            "Identify negotiation levers & targets",
            "Prepare talking points (Mercer)",
            "Run the supplier conversation(s)",
            "Agree & document revised terms",
            "Capture committed savings",
        ],
    },
    {
        "playbook_id": "transition",
        "label": "Supplier transition",
        "sub": "move volume to a better-fit supplier",
        "recommended_routes": [],
        "tasks": [
            "Qualify the target supplier's capability",
            "Confirm scope, specs & quality requirements",
            "Plan the volume migration",
            "Run a dual-source pilot",
            "Validate quality, lead time & service",
            "Ramp volume; award",
            "Capture committed volume & savings",
        ],
    },
    {
        "playbook_id": "services",
        "label": "Services rate-card",
        "sub": "labor / repair rate panel",
        "recommended_routes": [],
        "tasks": [
            "Define SOW & rate-card scope",
            "Collect current labor / repair rates",
            "Benchmark rates & set targets",
            "Negotiate the rate-card panel",
            "Agree SLAs & coverage",
            "Award & capture committed rates",
        ],
    },
]


def main():
    rows = [
        {
            "playbook_id": p["playbook_id"],
            "label": p["label"],
            "sub": p["sub"],
            "tasks": json.dumps(p["tasks"]),
            "recommended_routes": json.dumps(p["recommended_routes"]),
            "sort_order": i + 1,
        }
        for i, p in enumerate(PLAYBOOKS)
    ]
    df = pd.DataFrame(rows)

    url = os.environ.get("DATABASE_URL", DEFAULT_URL)
    if url.startswith("postgres://"):
        url = url.replace("postgres://", "postgresql+psycopg2://", 1)
    engine = create_engine(url)
    with engine.begin() as conn:
        conn.execute(text("CREATE SCHEMA IF NOT EXISTS ref"))
    df.to_sql("playbook", engine, schema="ref", if_exists="replace", index=False)
    print(f"→ loaded {len(df)} rows into ref.playbook")
    for p in PLAYBOOKS:
        rec = ", ".join(p["recommended_routes"]) or "—"
        print(f"   {p['playbook_id']:12} {p['label']:22} rec: {rec}")


if __name__ == "__main__":
    main()
