"""
Vendor classifier — verify OEM status + capability at SETUP time, cache the verdict.

Per the design decision: an OEM claim must be *verified*, not asserted from a static
list. This runs once at setup (and incrementally for new vendors); verdicts are cached
to opp.vendor_classification, and the deterministic engine reads the cache at analysis
time — so per-run reproducibility is preserved.

Classifiers (pluggable, same interface):
  - SubstringClassifier   : the deterministic baseline (config OEM list). No network.
                            Used offline, as the anchor cross-check, and as the fallback.
  - HybridClaudeClassifier: pass 1 = Claude knowledge (batched, no tools); pass 2 = web
                            search (web_search_20260209) ONLY on OEM-flagged or low-confidence
                            vendors → citation-backed verdict. Needs ANTHROPIC_API_KEY.
  - MockClassifier        : canned verdicts for tests (no network).

The engine never calls these at analysis time — only the setup job (jobs/classify_vendors.py)
does. Anchor safety: the verified OEM set must still reconcile to 16 OEM / $2,018,901 in
Industrial Supplies before it supersedes the substring baseline (review gate in the job).
"""
from __future__ import annotations
import dataclasses
import datetime as dt
import json
import os
import re
from abc import ABC, abstractmethod

MODEL = "claude-opus-4-8"


@dataclasses.dataclass
class VendorContext:
    """What the classifier is told about a vendor."""
    vendor_name: str
    vendor_id: str
    total_spend: float = 0.0
    sample_categories: tuple = ()       # a few L3 labels the vendor sells into
    sample_descriptions: tuple = ()     # a few material descriptions (disambiguation)


@dataclasses.dataclass
class Verdict:
    vendor_id: str
    vendor_name: str
    is_oem: bool
    oem_brand: str | None = None
    capability_class: str | None = None     # broad-line | specialist | oem
    confidence: float = 0.0                 # 0..1
    evidence: str = ""
    citation_url: str | None = None
    source: str = ""                        # substring | knowledge | web | mock
    model: str | None = None

    def row(self, methodology_version: str) -> dict:
        return {
            "vendor_id": self.vendor_id,
            "vendor_name": self.vendor_name,
            "is_oem": bool(self.is_oem),
            "oem_brand": self.oem_brand,
            "capability_class": self.capability_class,
            "confidence": round(float(self.confidence), 3),
            "evidence": self.evidence,
            "citation_url": self.citation_url,
            "source": self.source,
            "model": self.model,
            "methodology_version": methodology_version,
            "verified_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }


class Classifier(ABC):
    @abstractmethod
    def classify(self, vendors: list[VendorContext]) -> list[Verdict]:
        ...


# --------------------------------------------------------------------------------------
# Deterministic baseline — the config OEM list (no network). Anchor cross-check + fallback.
# --------------------------------------------------------------------------------------
class SubstringClassifier(Classifier):
    def __init__(self, cfg: dict):
        self.oem_brands = cfg.get("oem_brands", [])
        self._pat = re.compile("|".join(re.escape(b) for b in self.oem_brands), re.I)
        self._caps = [(re.compile(re.escape(c["match"]), re.I), c) for c in cfg.get("capabilities", [])]

    def _cap(self, name):
        for pat, c in self._caps:
            if pat.search(name):
                return c.get("class")
        return None

    def classify(self, vendors: list[VendorContext]) -> list[Verdict]:
        out = []
        for v in vendors:
            m = self._pat.search(v.vendor_name)
            oem = bool(m)
            out.append(Verdict(
                vendor_id=v.vendor_id, vendor_name=v.vendor_name, is_oem=oem,
                oem_brand=(m.group(0) if m else None),
                capability_class=("oem" if oem else self._cap(v.vendor_name)),
                confidence=1.0 if oem else 0.5,
                evidence="name contains a known OEM brand" if oem else "no OEM brand in name (list match)",
                source="substring", model=None,
            ))
        return out


# --------------------------------------------------------------------------------------
# Mock — canned verdicts for tests (no network).
# --------------------------------------------------------------------------------------
class MockClassifier(Classifier):
    def __init__(self, verdict_fn):
        self._fn = verdict_fn  # (VendorContext) -> dict of Verdict fields

    def classify(self, vendors):
        out = []
        for v in vendors:
            d = self._fn(v)
            out.append(Verdict(vendor_id=v.vendor_id, vendor_name=v.vendor_name,
                               source="mock", model="mock", **d))
        return out


# --------------------------------------------------------------------------------------
# Hybrid Claude classifier — knowledge pass, then web-verify the flagged subset.
# --------------------------------------------------------------------------------------
_KNOWLEDGE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["vendors"],
    "properties": {"vendors": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["vendor_name", "is_oem", "capability_class", "confidence"],
        "properties": {
            "vendor_name": {"type": "string"},
            "is_oem": {"type": "boolean"},
            "oem_brand": {"type": "string"},
            "capability_class": {"type": "string", "enum": ["broad-line", "specialist", "oem", "unknown"]},
            "confidence": {"type": "number"},
        }}}}}


class HybridClaudeClassifier(Classifier):
    """Pass 1: Claude knowledge (batched, structured output, no tools).
       Pass 2: web search ONLY on is_oem or confidence < conf_threshold → citation-backed verdict.
    Requires ANTHROPIC_API_KEY. Deterministic-enough at setup; results are cached and reviewed."""

    def __init__(self, *, batch_size: int = 25, conf_threshold: float = 0.7, effort: str = "low",
                 web_verify_min_spend: float = 25000.0, web_verify_mode: str = "oem_candidates",
                 force_web_ids: set | None = None, web_cap: int | None = 250, web_timeout: float = 120.0):
        import anthropic
        if not os.environ.get("ANTHROPIC_API_KEY"):
            raise RuntimeError("ANTHROPIC_API_KEY not set — hybrid classifier needs an API key. "
                               "Use SubstringClassifier offline, or set the key.")
        self.client = anthropic.Anthropic()
        self.batch_size = batch_size
        self.conf_threshold = conf_threshold
        self.effort = effort
        self.web_timeout = web_timeout   # per web-verify call (s); stuck call degrades, never hangs the job
        self.web_verify_min_spend = web_verify_min_spend
        # which vendors get the (costly) web-verify pass:
        #   "oem_candidates" — only vendors flagged OEM by knowledge OR in force_web_ids (the
        #                      carve-out set; the light, on-target default).
        #   "material"       — OEM-flagged + low-confidence vendors >= web_verify_min_spend (broad).
        self.web_verify_mode = web_verify_mode
        self.force_web_ids = force_web_ids or set()
        self.web_cap = web_cap   # hard safety ceiling on web calls (no silent overrun)

    # ---- pass 1: knowledge ----
    def _knowledge_batch(self, vendors: list[VendorContext]) -> dict[str, Verdict]:
        listing = "\n".join(
            f"- {v.vendor_name}"
            + (f"  [sells: {', '.join(v.sample_categories)}]" if v.sample_categories else "")
            for v in vendors)
        prompt = (
            "Classify each MRO/industrial supplier below as is_oem true/false.\n"
            "is_oem = TRUE *only* if the supplier is the original manufacturer of machinery/equipment "
            "whose proprietary spare parts are SOLE-SOURCE — parts you can buy only from them, which "
            "blocks competitive consolidation. Examples: Fanuc, Gleason, Okuma, Mazak, Siemens, DMG Mori, "
            "Haas, ABB, Fronius, Heidenhain, Kuka.\n"
            "is_oem = FALSE for everyone else, including: distributors and catalog resellers (Fastenal, "
            "Grainger, MSC, Kirby Risk), broad-line industrial suppliers, cutting-tool/tooling makers sold "
            "through distribution (e.g. Cline Tool), and manufacturers of lubricants, chemicals, gases, "
            "fasteners, abrasives, or consumables (e.g. Fuchs, PPG), and service providers. A company can "
            "MANUFACTURE things and still NOT be an OEM here — what matters is whether its parts are "
            "sole-source equipment spares that prevent consolidation.\n"
            "Default to is_oem=false unless you are confident it is a sole-source equipment OEM. "
            "Return oem_brand if applicable, capability_class (broad-line | specialist | oem | unknown), "
            "and confidence 0..1. Use only the supplier name and category hints.\n\n"
            f"{listing}")
        resp = self.client.messages.create(
            model=MODEL, max_tokens=8000,
            output_config={"effort": self.effort, "format": {"type": "json_schema", "schema": _KNOWLEDGE_SCHEMA}},
            messages=[{"role": "user", "content": prompt}],
            timeout=self.web_timeout,
        )
        text = next((b.text for b in resp.content if b.type == "text"), "{}")
        parsed = json.loads(text).get("vendors", [])
        by_name = {v.vendor_name: v for v in vendors}
        out = {}
        for r in parsed:
            ctx = by_name.get(r["vendor_name"])
            if not ctx:
                continue
            out[ctx.vendor_id] = Verdict(
                vendor_id=ctx.vendor_id, vendor_name=ctx.vendor_name,
                is_oem=bool(r["is_oem"]), oem_brand=r.get("oem_brand"),
                capability_class=r.get("capability_class"), confidence=float(r["confidence"]),
                evidence="model knowledge", source="knowledge", model=MODEL)
        return out

    # ---- pass 2: web verify a single vendor ----
    def _web_verify(self, ctx: VendorContext, prior: Verdict) -> Verdict:
        prompt = (
            f"Verify whether the supplier '{ctx.vendor_name}' is an OEM (original equipment "
            "manufacturer of machinery/proprietary spares) versus a distributor/reseller. "
            "Search the web for the company. Then respond with ONLY a JSON object: "
            '{"is_oem": bool, "oem_brand": string|null, "capability_class": '
            '"broad-line"|"specialist"|"oem"|"unknown", "confidence": number, '
            '"evidence": string, "citation_url": string|null}. No prose outside the JSON.')
        try:
            # per-call timeout so a stuck web call can't hang the whole job; on failure we
            # keep the prior (knowledge) verdict and move on, marked so it's visible in review.
            resp = self.client.messages.create(
                model=MODEL, max_tokens=4000,
                output_config={"effort": "medium"},
                tools=[{"type": "web_search_20260209", "name": "web_search"}],
                messages=[{"role": "user", "content": prompt}],
                timeout=self.web_timeout,
            )
        except Exception as e:  # noqa: BLE001 — any API/timeout error: degrade gracefully
            return dataclasses.replace(prior, source="web",
                                       evidence=f"web-verify failed ({type(e).__name__}); kept knowledge verdict")
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        try:
            j = json.loads(text[text.index("{"): text.rindex("}") + 1])
        except Exception:
            return dataclasses.replace(prior, source="web", evidence="web-verify parse failed; kept knowledge verdict")
        return Verdict(
            vendor_id=ctx.vendor_id, vendor_name=ctx.vendor_name,
            is_oem=bool(j.get("is_oem", prior.is_oem)), oem_brand=j.get("oem_brand"),
            capability_class=j.get("capability_class", prior.capability_class),
            confidence=float(j.get("confidence", prior.confidence)),
            evidence=j.get("evidence", ""), citation_url=j.get("citation_url"),
            source="web", model=MODEL)

    def classify(self, vendors: list[VendorContext]) -> list[Verdict]:
        import sys as _sys
        n = len(vendors)
        # pass 1 — knowledge (batched)
        verdicts: dict[str, Verdict] = {}
        nb = (n + self.batch_size - 1) // self.batch_size
        for bi, i in enumerate(range(0, n, self.batch_size), 1):
            verdicts.update(self._knowledge_batch(vendors[i:i + self.batch_size]))
            print(f"[pass1 knowledge] batch {bi}/{nb}", flush=True)
        for v in vendors:   # vendors the model didn't return -> low-confidence (web-verified if material)
            verdicts.setdefault(v.vendor_id, Verdict(
                vendor_id=v.vendor_id, vendor_name=v.vendor_name, is_oem=False,
                capability_class="unknown", confidence=0.0, evidence="not returned in pass 1",
                source="knowledge", model=MODEL))

        # pass 2 — web-verify only the consequential subset (mode-dependent)
        ctx_by_id = {v.vendor_id: v for v in vendors}
        if self.web_verify_mode == "oem_candidates":
            targets = [vid for vid, vd in verdicts.items() if vd.is_oem or vid in self.force_web_ids]
            desc = "OEM candidates (knowledge-OEM + substring-OEM)"
        else:  # "material"
            targets = [vid for vid, vd in verdicts.items()
                       if vd.is_oem or (vd.confidence < self.conf_threshold
                                        and ctx_by_id[vid].total_spend >= self.web_verify_min_spend)]
            desc = f"OEM-flagged + low-conf >= ${self.web_verify_min_spend:,.0f}"
        targets.sort(key=lambda vid: -ctx_by_id[vid].total_spend)   # biggest first
        skipped = 0
        if self.web_cap and len(targets) > self.web_cap:
            skipped = len(targets) - self.web_cap
            targets = targets[:self.web_cap]
        print(f"[pass2 web-verify] {len(targets)} of {n} vendors — {desc}"
              + (f"; CAPPED at {self.web_cap}, skipped {skipped} smaller (logged, not silent)" if skipped else ""),
              flush=True)
        for k, vid in enumerate(targets, 1):
            verdicts[vid] = self._web_verify(ctx_by_id[vid], verdicts[vid])
            if k % 10 == 0 or k == len(targets):
                print(f"[pass2 web-verify] {k}/{len(targets)}", flush=True)
        return list(verdicts.values())
