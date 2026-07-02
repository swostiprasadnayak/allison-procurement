"""
LLM adapter — pluggable so the core is testable offline and live in production.

  - MockLLM   : deterministic, no network. Returns the grounded `offline_answer` (or a
                test-supplied responder). Used by the test suite + `--offline` demo.
  - ClaudeLLM : the real path — Claude `claude-opus-4-8`, adaptive thinking. Not called in tests.

The request carries `offline_answer` (a deterministic, cited summary assembled in code) so the
mock — and the live path's fallback — always have a grounded answer to return.
"""
from __future__ import annotations
import dataclasses
from abc import ABC, abstractmethod

MODEL = "claude-opus-4-8"


@dataclasses.dataclass
class LLMRequest:
    system: str
    user: str
    offline_answer: str = ""        # deterministic grounded answer (mock returns this; live fallback)
    max_tokens: int = 1500


class LLM(ABC):
    name = "abstract"

    @abstractmethod
    def complete(self, req: LLMRequest) -> str:
        ...


class MockLLM(LLM):
    """Deterministic. Default = return the grounded offline_answer; tests pass a responder."""
    name = "mock"

    def __init__(self, responder=None):
        self._responder = responder

    def complete(self, req: LLMRequest) -> str:
        if self._responder is not None:
            return self._responder(req)
        return req.offline_answer or "I don't have grounded data for that in your current scope."


class ClaudeLLM(LLM):
    """Live path — Claude Opus 4.8, adaptive thinking. Requires ANTHROPIC_API_KEY."""
    name = "claude"

    def __init__(self, model: str = MODEL, timeout: float = 60.0):
        import os
        import anthropic
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY not set — use MockLLM offline or set the key.")
        self.client = anthropic.Anthropic()
        self.model = model
        self.timeout = timeout

    def complete(self, req: LLMRequest) -> str:
        try:
            resp = self.client.messages.create(
                model=self.model, max_tokens=req.max_tokens,
                thinking={"type": "adaptive"},
                system=req.system,
                messages=[{"role": "user", "content": req.user}],
                timeout=self.timeout,
            )
            text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
            return text or req.offline_answer
        except Exception as e:  # noqa: BLE001 — never let a copilot call crash the caller
            return (req.offline_answer or "") + f"\n\n(Live answer unavailable: {type(e).__name__}.)"
