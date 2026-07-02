"""
Copilot — the orchestrator. retrieve → ground → LLM → guardrail → Answer.

Entry points (all take `scope` + `view_context`, never widening scope):
  - ask(question)            : general scoped, context-aware Q&A
  - explain(opportunity_id)  : explain-a-play (canonical question against the focal opportunity)
  - draft(opportunity_id, kind) : generate a play_artifact draft

The Answer carries the text, the resolved citations, and the guardrail report — so the serving
layer can render chips, show "how is this calculated?", and surface any guardrail warning.
"""
from __future__ import annotations
import dataclasses
import datetime as dt

from engine.copilot.context import ViewContext, Scope
from engine.copilot.retrieval import ScopedRetriever
from engine.copilot.grounding import ground
from engine.copilot.llm import LLM, LLMRequest
from engine.copilot import prompts, guardrails, drafts


@dataclasses.dataclass
class Answer:
    text: str
    citations: list                 # resolved records actually cited
    guardrail: guardrails.GuardrailReport
    run_id: str | None
    methodology_version: str | None
    staged_notes: list
    notes: list                     # retrieval notes (e.g. scope exclusions)
    page: str

    @property
    def ok(self) -> bool:
        return self.guardrail.passed


class Copilot:
    def __init__(self, retriever: ScopedRetriever, llm: LLM):
        self.retriever = retriever
        self.llm = llm

    # ---- general Q&A ----
    def ask(self, question: str, *, scope: Scope | None = None,
            view_context: ViewContext | None = None) -> Answer:
        scope = scope or Scope.enterprise_all()
        vc = view_context or ViewContext()
        result = self.retriever.retrieve(question, scope=scope, view_context=vc)
        g = ground(result)

        if g.context_text and not result.is_empty():
            offline = self._offline_answer(result, g)
            req = LLMRequest(system=prompts.SYSTEM, user=prompts.build_user(question, g, vc),
                             offline_answer=offline)
            text = self.llm.complete(req)
        else:
            text = "I don't have any data for that in your current scope."

        report = guardrails.check(text, g)
        cited = [c for c in g.citations if c["ref"] in report.cited_refs]
        return Answer(text=text, citations=cited, guardrail=report, run_id=result.run_id,
                      methodology_version=result.methodology_version, staged_notes=g.staged_flags,
                      notes=result.notes, page=vc.page)

    # ---- explain-a-play ----
    def explain(self, opportunity_id: str, *, scope: Scope | None = None, run_id: str | None = None) -> Answer:
        vc = ViewContext(page="qualify", opportunity_id=opportunity_id, run_id=run_id)
        return self.ask(prompts.EXPLAIN_QUESTION, scope=scope, view_context=vc)

    # ---- draft generation ----
    def draft(self, opportunity_id: str, kind: str, *, scope: Scope | None = None,
              run_id: str | None = None) -> tuple[dict | None, guardrails.GuardrailReport, Answer | None]:
        scope = scope or Scope.enterprise_all()
        vc = ViewContext(page="act", opportunity_id=opportunity_id, run_id=run_id)
        result = self.retriever.retrieve(kind, scope=scope, view_context=vc)
        if not (result.focal and result.focal_kind == "opportunity"):
            return None, guardrails.GuardrailReport(False, ["opportunity not in scope / not found"], [], []), None
        g = ground(result)
        offline = drafts.deterministic_draft(kind, g, result.focal)
        req = LLMRequest(system=prompts.SYSTEM, user=prompts.build_draft_user(kind, g, vc),
                         offline_answer=offline, max_tokens=2000)
        body = self.llm.complete(req)
        report = guardrails.check(body, g)
        created = dt.datetime.now(dt.timezone.utc).isoformat()
        cited = [{"ref": c["ref"], "table": c["table"], "id": c["id"]}
                 for c in g.citations if c["ref"] in report.cited_refs] or \
                [{"ref": c["ref"], "table": c["table"], "id": c["id"]} for c in g.citations[:3]]
        row = drafts.build_play_artifact(
            opportunity_id=opportunity_id, kind=kind,
            title=f"{kind.replace('_', ' ').title()} — {result.focal.get('title')}",
            body=body, citations=cited, run_id=result.run_id, model=self.llm.name, created_at=created)
        return row, report, None

    # ---- grounded offline answer (mock + live fallback) ----
    @staticmethod
    def _offline_answer(result, g) -> str:
        if g.focal_summary:
            return g.focal_summary
        # no focal: summarize the single most relevant opportunity, cited
        if result.opportunities:
            top = result.opportunities[0]
            ref = next((c["ref"] for c in g.citations
                        if c["table"] == "opp.opportunity" and c["id"] == str(top["id"])), None)
            tag = f" [{ref}]" if ref else ""
            mv = top.get("movable_value")
            mv_s = f"${float(mv):,.0f}" if mv not in (None, "") else "n/a"
            return (f"The most relevant opportunity in your scope is {top.get('title')} — a "
                    f"{top.get('primary_lever')} play with addressable spend {mv_s}{tag}.")
        if result.scan_rows:
            s = result.scan_rows[0]
            ref = next((c["ref"] for c in g.citations if c["table"] == "opp.scan_ranking" and c["id"] == str(s.get("id"))), None)
            return f"Top-ranked category is {s.get('sub_category')} (score {s.get('score')})" + (f" [{ref}]." if ref else ".")
        return "I don't have grounded data for that in your current scope."
