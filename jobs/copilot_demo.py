"""
Copilot demo — ask the Mercer copilot core a question against the local Gold.

Offline by default (MockLLM = deterministic grounded answers; no key, no cost). Pass --live to
use Claude (claude-opus-4-8) — needs ANTHROPIC_API_KEY (source .env.local first).

Examples:
  python jobs/copilot_demo.py --explain top
  python jobs/copilot_demo.py --page cockpit --question "what's my biggest opportunity?"
  python jobs/copilot_demo.py --explain top --draft rfp_scaffold
  python jobs/copilot_demo.py --explain top --live     # real Claude answer
"""
from __future__ import annotations
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.io.local import LocalIO
from engine.copilot.context import ViewContext, Scope
from engine.copilot.retrieval import LocalGoldRetriever
from engine.copilot.llm import MockLLM
from engine.copilot import Copilot


def _resolve_opp(io, ref):
    opp = io.read("opp", "opportunity")
    if ref == "top":
        return opp.sort_values("movable_value", ascending=False).iloc[0]["id"]
    return ref


def _print_answer(a):
    print("\n" + "=" * 78)
    print(f"PAGE: {a.page}   run={a.run_id}   methodology={a.methodology_version}")
    print("-" * 78)
    print(a.text)
    print("-" * 78)
    if a.citations:
        print("CITATIONS:")
        for c in a.citations:
            print(f"  [{c['ref']}] {c['table']} · {c['id']}  — {c['summary']}")
    g = a.guardrail
    print(f"GUARDRAIL: {'PASS' if g.passed else 'FAIL'}"
          + (f"  violations={g.violations}" if g.violations else "")
          + (f"  warnings={g.warnings}" if g.warnings else ""))
    if a.staged_notes:
        print(f"STAGED/CAVEAT: {a.staged_notes}")
    if a.notes:
        print(f"NOTES: {a.notes}")
    print("=" * 78)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--question", default=None)
    ap.add_argument("--explain", default=None, help="opportunity id or 'top' — explain-a-play")
    ap.add_argument("--draft", default=None, choices=["outreach", "rfp_scaffold", "negotiation"])
    ap.add_argument("--page", default="cockpit")
    ap.add_argument("--opportunity", default=None, help="focal opportunity id (or 'top') for --question")
    ap.add_argument("--live", action="store_true", help="use Claude instead of the offline MockLLM")
    args = ap.parse_args()

    io = LocalIO(root="data")
    if args.live:
        from engine.copilot.llm import ClaudeLLM
        llm = ClaudeLLM()
        print("LLM: Claude (claude-opus-4-8, live)")
    else:
        llm = MockLLM()
        print("LLM: MockLLM (offline, deterministic grounded answers)")
    cop = Copilot(LocalGoldRetriever(io), llm)
    scope = Scope.enterprise_all()

    if args.explain:
        oid = _resolve_opp(io, args.explain)
        _print_answer(cop.explain(oid, scope=scope))
        if args.draft:
            row, rep, _ = cop.draft(oid, args.draft, scope=scope)
            print(f"\nDRAFT ({args.draft}) — guardrail {'PASS' if rep.passed else 'FAIL'}  title: {row['title']}")
            print("-" * 78); print(row["body"]); print("-" * 78)
    elif args.question:
        oid = _resolve_opp(io, args.opportunity) if args.opportunity else None
        vc = ViewContext(page=args.page, opportunity_id=oid)
        _print_answer(cop.ask(args.question, scope=scope, view_context=vc))
    else:
        # default tour
        oid = _resolve_opp(io, "top")
        print("\n# explain-a-play (qualify):")
        _print_answer(cop.explain(oid, scope=scope))
        print("\n# cockpit Q&A:")
        _print_answer(cop.ask("what's my biggest opportunity and why?", scope=scope, view_context=ViewContext(page="cockpit")))


if __name__ == "__main__":
    main()
