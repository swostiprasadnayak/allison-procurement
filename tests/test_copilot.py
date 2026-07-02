"""
Copilot core gates — offline (MockLLM), no network.

Proves the plumbing + the guardrails that make the copilot safe to ship: grounding produces
citations + an allowed-figures set; answers resolve the in-view entity; the guardrail catches
invented figures and unknown citations; scope excludes out-of-scope rows; drafts conform to the
play_artifact contract. The live Claude path is exercised only by the demo (--live), never here.

Run:  python -m pytest tests/test_copilot.py -q
"""
from __future__ import annotations
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.copilot.context import ViewContext, Scope
from engine.copilot.retrieval import LocalGoldRetriever
from engine.copilot.grounding import ground
from engine.copilot.llm import MockLLM, LLMRequest
from engine.copilot import guardrails
from engine.copilot import Copilot

def _io():
    return LocalIO(root="data")


HAS_GOLD = _io().exists("opp", "opportunity")


def _top_opp(io):
    opp = io.read("opp", "opportunity")
    return opp.sort_values("movable_value", ascending=False).iloc[0]


def _copilot(llm=None):
    return Copilot(LocalGoldRetriever(_io()), llm or MockLLM())


# ---- context ----
def test_view_context_rejects_bad_page():
    with pytest.raises(ValueError):
        ViewContext(page="dashboard")


def test_view_context_focal_kind():
    assert ViewContext(page="qualify", opportunity_id="x").focal_kind == "opportunity"
    assert ViewContext(page="cockpit").focal_kind is None


@pytest.mark.skipif(not HAS_GOLD, reason="Gold not built")
class TestAgainstGold:
    def test_retrieval_anchors_focal(self):
        io = _io(); oid = _top_opp(io)["id"]
        r = LocalGoldRetriever(io).retrieve("explain", scope=Scope.enterprise_all(),
                                            view_context=ViewContext(page="qualify", opportunity_id=oid))
        assert r.focal_kind == "opportunity" and r.focal and r.focal["id"] == oid
        assert r.focal_evidence, "focal opportunity should carry ordered evidence factors"

    def test_grounding_citations_and_allowed_figures(self):
        io = _io(); top = _top_opp(io)
        r = LocalGoldRetriever(io).retrieve("explain", scope=Scope.enterprise_all(),
                                            view_context=ViewContext(page="qualify", opportunity_id=top["id"]))
        g = ground(r)
        assert g.citations and any(c["table"] == "opp.opportunity" for c in g.citations)
        assert round(float(top["movable_value"]), 4) in g.allowed_values   # movable is a grounded figure
        assert "[C1]" in g.context_text

    def test_explain_grounded_cited_and_passes(self):
        io = _io(); oid = _top_opp(io)["id"]
        a = _copilot().explain(oid)
        assert a.citations and a.ok and not a.guardrail.violations
        assert any(ref in a.text for ref in [c["ref"] for c in a.citations])

    def test_guardrail_catches_invented_figure(self):
        io = _io(); oid = _top_opp(io)["id"]
        bad = MockLLM(responder=lambda req: "The movable spend here is $987,654,321 [C1].")
        a = _copilot(bad).explain(oid)
        assert not a.ok and any("not grounded" in v for v in a.guardrail.violations)

    def test_guardrail_flags_unknown_citation(self):
        io = _io(); oid = _top_opp(io)["id"]
        bad = MockLLM(responder=lambda req: "See the record [C99] for details.")
        a = _copilot(bad).explain(oid)
        assert not a.ok and any("unknown record" in v for v in a.guardrail.violations)

    def test_refusal_is_allowed(self):
        io = _io(); oid = _top_opp(io)["id"]
        refuse = MockLLM(responder=lambda req: "I don't have that data in your current scope.")
        a = _copilot(refuse).explain(oid)
        assert a.ok and not a.citations    # refusal needs no citations and isn't a violation

    def test_staged_caveat_surfaces(self):
        # the deterministic offline answer appends the staged note when the focal has one
        io = _io(); opp = io.read("opp", "opportunity")
        flagged = opp[opp["contestability_note"].astype(str).str.len() > 3]
        if flagged.empty:
            pytest.skip("no contestability-flagged opportunity in this run")
        a = _copilot().explain(flagged.sort_values("movable_value", ascending=False).iloc[0]["id"])
        assert a.staged_notes, "a flagged opportunity should expose staged notes"

    def test_scope_excludes_out_of_scope_opportunity(self):
        io = _io(); oid = _top_opp(io)["id"]
        a = _copilot().explain(oid, scope=Scope(enterprise=False, l2_categories=frozenset({"L2|MRO>__none__"})))
        assert "scope" in " ".join(a.notes).lower()
        assert oid not in [c["id"] for c in a.citations]   # not surfaced

    def test_view_context_resolves_deictic(self):
        # MockLLM echoes the grounded focal summary -> "this play" answered about the focal entity
        io = _io(); top = _top_opp(io)
        a = _copilot().ask("why is this a good play?",
                           view_context=ViewContext(page="qualify", opportunity_id=top["id"]))
        assert str(top["title"]) in a.text and a.ok

    def test_draft_conforms_to_contract(self):
        io = _io(); oid = _top_opp(io)["id"]
        row, rep, _ = _copilot().draft(oid, "rfp_scaffold")
        assert row and row["is_draft"] is True and row["artifact_type"] == "rfp_scaffold"
        assert json.loads(row["citations"]), "draft records its grounding citations"
        from engine.schema import contracts
        import pandas as pd
        contracts.validate(pd.DataFrame([row]), "opp", "play_artifact")  # raises if non-conforming

    def test_draft_out_of_scope_returns_none(self):
        io = _io(); oid = _top_opp(io)["id"]
        row, rep, _ = _copilot().draft(oid, "outreach",
                                       scope=Scope(enterprise=False, l2_categories=frozenset({"L2|MRO>__none__"})))
        assert row is None and not rep.passed
