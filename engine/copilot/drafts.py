"""
Draft artifacts — the copilot's generation output, shaped to `opp.play_artifact`.

Drafts are always `is_draft=TRUE` and never sent. `citations` records the evidence the draft is
grounded on (JSON list of {ref, table, id}) — the same "how is this calculated?" trail as answers.
`deterministic_draft` is the grounded offline fallback (and the MockLLM's draft body).
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json

from engine.schema import contracts

ARTIFACT_TYPES = ("outreach", "rfp_scaffold", "negotiation")


def _aid(*parts):
    return "PA" + hashlib.sha1("|".join(str(p) for p in parts).encode()).hexdigest()[:16]


def deterministic_draft(kind: str, grounding, focal: dict | None) -> str:
    """Grounded, no-LLM fallback. Short but real — cites the focal records."""
    title = (focal or {}).get("title", "this category")
    cref = next((c["ref"] for c in grounding.citations if c["table"] == "opp.opportunity"), None)
    tag = f" [{cref}]" if cref else ""
    if kind == "outreach":
        return (f"Subject: Partnership discussion — {title}\n\n"
                f"Hi [supplier contact],\n\nWe're reviewing our sourcing approach for {title}{tag} and would "
                f"like to discuss how we work together going forward. Could we set up a short call?\n\n"
                f"Best regards,\n[Commodity Manager]\n\n[DRAFT — review before sending]")
    if kind == "rfp_scaffold":
        return (f"RFP SCAFFOLD — {title}{tag}\n\n1. Background\n2. Scope of supply\n3. Current state "
                f"[incumbent + current spend from evidence]\n4. Requirements\n5. Evaluation criteria "
                f"(price, lead time, quality)\n6. Timeline\n\n[DRAFT — placeholders in brackets need input]")
    return (f"NEGOTIATION POINTS — {title}{tag}\n- Consolidation/competitive leverage per the play evidence\n"
            f"- Reference the addressable-spend basis\n- Payment-terms alignment\n\n[DRAFT]")


def build_play_artifact(*, opportunity_id, kind, title, body, citations, run_id, model, created_at):
    if kind not in ARTIFACT_TYPES:
        raise ValueError(f"artifact_type must be one of {ARTIFACT_TYPES}")
    row = {
        "id": _aid(opportunity_id, kind, run_id, created_at),
        "opportunity_id": opportunity_id,
        "artifact_type": kind,
        "title": title,
        "body": body,
        "is_draft": True,
        "citations": json.dumps(citations),
        "generated_by": "mercer-copilot",
        "model": model,
        "run_id": run_id,
        "created_at": created_at,
    }
    # validate against the registered contract (presence of all columns)
    import pandas as pd
    contracts.validate(pd.DataFrame([row]), "opp", "play_artifact")
    return row
