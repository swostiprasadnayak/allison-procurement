"""
Mercer copilot service — the live endpoint the Next.js /api/copilot route proxies to.

Reuses the copilot CORE (grounding + guardrails) over the served CDM (PostgresRetriever) and
answers with Claude Sonnet 4.6 (cheaper than Opus; grounded narration doesn't need Opus). Lean
grounding keeps token cost down. Never the scope boundary — the caller passes scope.

Run:
  set -a; . ./.env.local; set +a            # ANTHROPIC_API_KEY (not printed)
  uvicorn services.copilot_api:app --port 8000
Endpoints (POST, JSON):
  /explain  {opportunity_id}
  /ask      {question, page?, opportunity_id?, category_code?, vendor_id?}
  /draft    {opportunity_id, kind}
"""
from __future__ import annotations
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy import create_engine

from engine.copilot.context import ViewContext, Scope
from engine.copilot.retrieval import PostgresRetriever
from engine.copilot.llm import ClaudeLLM, MockLLM
from engine.copilot import Copilot

DB_URL = os.environ.get("DATABASE_URL", "postgresql+psycopg2://navanta:navanta@localhost:5432/navanta")
if DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql+psycopg2://", 1)
MODEL = os.environ.get("COPILOT_MODEL", "claude-sonnet-4-6")   # Sonnet by default (cost)

app = FastAPI(title="Navanta Mercer Copilot")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000"],
                   allow_methods=["*"], allow_headers=["*"])

_engine = create_engine(DB_URL, pool_pre_ping=True)


def _llm():
    # live Claude when a key is present; deterministic Mock otherwise (offline/dev)
    try:
        return ClaudeLLM(model=MODEL)
    except RuntimeError:
        return MockLLM()


def _copilot():
    return Copilot(PostgresRetriever(_engine), _llm())


def _serialize(a):
    return {
        "text": a.text,
        "citations": a.citations,
        "staged_notes": a.staged_notes,
        "guardrail": {"passed": a.guardrail.passed, "violations": a.guardrail.violations,
                      "warnings": a.guardrail.warnings, "cited_refs": a.guardrail.cited_refs},
        "run_id": a.run_id, "methodology_version": a.methodology_version,
        "notes": a.notes, "page": a.page, "model": MODEL,
    }


class ExplainReq(BaseModel):
    opportunity_id: str


class AskReq(BaseModel):
    question: str
    page: str = "cockpit"
    opportunity_id: str | None = None
    category_code: str | None = None
    vendor_id: str | None = None
    run_id: str | None = None


class DraftReq(BaseModel):
    opportunity_id: str
    kind: str = "rfp_scaffold"


@app.get("/health")
def health():
    return {"ok": True, "model": MODEL}


@app.post("/explain")
def explain(req: ExplainReq):
    return _serialize(_copilot().explain(req.opportunity_id, scope=Scope.enterprise_all()))


@app.post("/ask")
def ask(req: AskReq):
    vc = ViewContext(page=req.page, opportunity_id=req.opportunity_id,
                     category_code=req.category_code, vendor_id=req.vendor_id, run_id=req.run_id)
    return _serialize(_copilot().ask(req.question, scope=Scope.enterprise_all(), view_context=vc))


@app.post("/draft")
def draft(req: DraftReq):
    row, report, _ = _copilot().draft(req.opportunity_id, req.kind, scope=Scope.enterprise_all())
    return {"artifact": row, "guardrail": {"passed": report.passed, "violations": report.violations,
                                           "warnings": report.warnings}}
