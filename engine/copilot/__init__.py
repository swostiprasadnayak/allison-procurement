"""
Mercer copilot CORE (Navanta deliverable — Architecture §6, v0.2).

A scoped, context-aware RAG + generation layer over the Gold `opp.*` evidence the engine
produces. This package is the *core*: retrieval seam, grounding, the LLM adapter, guardrails,
Q&A / explain-a-play, and draft generation. The client team owns the *serving* (Lakebase,
server-side `user_scope` enforcement, hosting, chat UI, draft write-back).

Design invariants:
  - The LLM is NEVER the scope boundary. The core only ever sees rows already scope-filtered
    by the caller; `view_context` focuses attention *within* that set, never widens it.
  - Every answer is grounded in retrieved rows and cites them; the core never invents figures.
  - When data is staged (provability flag, needs-part-master), the copilot says so.
  - Built + validated against local Gold via the `ScopedRetriever` seam, then pointed at Lakebase.
"""
from engine.copilot.context import ViewContext, Scope
from engine.copilot.copilot import Copilot, Answer

__all__ = ["ViewContext", "Scope", "Copilot", "Answer"]
