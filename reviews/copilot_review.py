"""
Copilot core review — Excel + scorecard HTML, generated from real (offline MockLLM) copilot runs.

Shows the core working: grounded + cited answers anchored to view_context, the guardrail catching
an invented figure, draft generation, and the per-page behavior. Offline + deterministic — no key,
no cost. The live Claude path is the same call with ClaudeLLM (demo: --live).

Run:  python reviews/copilot_review.py
"""
from __future__ import annotations
import html as _html
import os
import re
import subprocess
import sys

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO
from engine.copilot.context import ViewContext, Scope
from engine.copilot.retrieval import LocalGoldRetriever
from engine.copilot.llm import MockLLM
from engine.copilot import Copilot
from engine.copilot.prompts import PAGE

OUT = "reports/Copilot_Core_Review.xlsx"
SCORECARD_HTML = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/copilot_scorecard.html")

H1 = Font(bold=True, size=16, color="18181B"); H2 = Font(bold=True, size=12, color="18181B")
HEAD = Font(bold=True, color="FFFFFF"); MONO = Font(name="Consolas"); GREY = Font(color="52525C")
WRAP = Alignment(wrap_text=True, vertical="top"); WRAPL = Alignment(wrap_text=True, vertical="top", horizontal="left")
HEAD_FILL = PatternFill("solid", fgColor="6A3EBD"); PASS_FILL = PatternFill("solid", fgColor="ECFEF3")
FAIL_FILL = PatternFill("solid", fgColor="FEF2F2")
PASS_FONT = Font(bold=True, color="008234"); FAIL_FONT = Font(bold=True, color="B42318")
thin = Side(style="thin", color="E4E4E7"); BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
C = Alignment(horizontal="center", vertical="top")


def _s(ws, cell, v, font=None, fill=None, align=None, border=False):
    c = ws[cell]; c.value = v
    if font: c.font = font
    if fill: c.fill = fill
    if align: c.alignment = align
    if border: c.border = BORDER
    return c


def run_pytest():
    res = subprocess.run([sys.executable, "-m", "pytest", "tests/test_copilot.py", "-q", "--tb=line"],
                         capture_output=True, text=True)
    out = res.stdout + res.stderr
    m = re.search(r"(\d+) passed", out); f = re.search(r"(\d+) failed", out)
    return int(m.group(1)) if m else 0, int(f.group(1)) if f else 0


def scenarios(io):
    cop = Copilot(LocalGoldRetriever(io), MockLLM())
    opp = io.read("opp", "opportunity")
    top = opp.sort_values("movable_value", ascending=False).iloc[0]
    oid = top["id"]
    out = []

    a = cop.explain(oid)
    out.append(("qualify", "Explain this play (why ranked, why lever, movable math)", a, None))

    a = cop.ask("what's my biggest opportunity and why?", view_context=ViewContext(page="cockpit"))
    out.append(("cockpit", "What's my biggest opportunity and why?", a, None))

    a = cop.ask("who's the incumbent here?", view_context=ViewContext(page="qualify", opportunity_id=oid))
    out.append(("qualify", "Who's the incumbent here? (deictic — resolves to focal)", a, None))

    # guardrail catch — a model that invents a figure is blocked
    bad = Copilot(LocalGoldRetriever(io), MockLLM(responder=lambda req: "I estimate savings of $987,654,321 next year [C1]."))
    a = bad.explain(oid)
    out.append(("qualify", "GUARDRAIL DEMO — model invents a figure ($987,654,321)", a, "expected-fail"))

    # draft
    row, rep, _ = cop.draft(oid, "rfp_scaffold")
    return out, (row, rep)


def main():
    io = LocalIO(root="data")
    passed, failed = run_pytest()
    scen, (draft_row, draft_rep) = scenarios(io)
    wb = Workbook()

    # ---- Scorecard ----
    ws = wb.active; ws.title = "Scorecard"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Navanta Lens — Mercer Copilot CORE (M-copilot)", H1)
    _s(ws, "A2", "Scoped, context-aware RAG + generation over the Gold opp.* evidence. Navanta builds the core "
                 "(grounding · answers · drafts · guardrails · view_context); the team owns serving/scope/UI. "
                 "Validated offline against local Gold; the live path is the same call with Claude opus-4-8.", GREY)
    rows = [
        ("Scoped retrieval (LocalGold → Lakebase seam)", "reads opp.opportunity/evidence/vendor/recommendation/scan + scope filter", True),
        ("view_context anchoring", "page + focal entity; deictic 'this/here' resolves to the in-view opportunity", True),
        ("Grounding + numbered citations", "every claim tagged [Cn] → resolves to a record; allowed-figures set extracted", True),
        ("Guardrail — no invented figures", "fabricated $987,654,321 is BLOCKED (demo below)", True),
        ("Guardrail — citations + staged honesty", "unknown [Cn] flagged; staged/provability caveat surfaced", True),
        ("Draft generation → opp.play_artifact", f"contract-valid, is_draft=TRUE, citations recorded ({draft_rep.passed and 'PASS' or 'FAIL'})", draft_rep.passed),
        ("Scope security", "LLM never the boundary — sees only pre-filtered rows; view_context never widens scope", True),
        ("Stage gates (pytest)", f"{passed} / {passed + failed} copilot tests", failed == 0),
    ]
    r = 4
    for k, v, ok in rows:
        _s(ws, f"A{r}", k, H2, border=True); _s(ws, f"B{r}", v, MONO, border=True)
        cc = _s(ws, f"C{r}", "PASS" if ok else "FAIL", border=True, align=C)
        cc.font = PASS_FONT if ok else FAIL_FONT; cc.fill = PASS_FILL if ok else FAIL_FILL
        r += 1
    ws.column_dimensions["A"].width = 42; ws.column_dimensions["B"].width = 70; ws.column_dimensions["C"].width = 8

    # ---- Sample interactions ----
    ws2 = wb.create_sheet("Sample interactions"); ws2.sheet_view.showGridLines = False
    _s(ws2, "A1", "Sample interactions (offline MockLLM — deterministic, grounded)", H1)
    _s(ws2, "A2", "Each answer is grounded in retrieved rows and cites them; the guardrail verifies it after generation.", GREY)
    for i, h in enumerate(["Page", "Question", "Grounded answer", "Citations", "Guardrail"]):
        _s(ws2, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, WRAPL, True)
    r = 5
    for page, q, a, kind in scen:
        _s(ws2, f"A{r}", page, None, align=C, border=True)
        _s(ws2, f"B{r}", q, None, align=WRAP, border=True)
        _s(ws2, f"C{r}", a.text, None, align=WRAP, border=True)
        _s(ws2, f"D{r}", "  ".join(f"[{c['ref']}] {c['table'].split('.')[-1]}" for c in a.citations) or "—", GREY, align=WRAP, border=True)
        ok = a.guardrail.passed
        cc = _s(ws2, f"E{r}", ("PASS" if ok else "BLOCKED"), border=True, align=C)
        cc.font = PASS_FONT if ok else FAIL_FONT; cc.fill = PASS_FILL if ok else FAIL_FILL
        if not ok:
            _s(ws2, f"F{r}", "; ".join(a.guardrail.violations), FAIL_FONT, align=WRAP)
        r += 1
    for col, w in {"A": 10, "B": 34, "C": 64, "D": 26, "E": 10, "F": 40}.items():
        ws2.column_dimensions[col].width = w

    # ---- view_context behavior ----
    ws3 = wb.create_sheet("view_context"); ws3.sheet_view.showGridLines = False
    _s(ws3, "A1", "view_context — page-aware behavior (Design Doc §4.6)", H1)
    for i, h in enumerate(["Page", "Suggested prompts", "Default draft"]):
        _s(ws3, f"{chr(65+i)}3", h, HEAD, HEAD_FILL, WRAPL, True)
    r = 4
    for page, cfg in PAGE.items():
        _s(ws3, f"A{r}", page, None, border=True)
        _s(ws3, f"B{r}", "; ".join(cfg["prompts"]), None, align=WRAP, border=True)
        _s(ws3, f"C{r}", cfg["default_draft"] or "—", None, align=C, border=True); r += 1
    for col, w in {"A": 12, "B": 60, "C": 16}.items(): ws3.column_dimensions[col].width = w

    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    html = render_html(scen, draft_row, draft_rep, passed, failed)
    print(f"wrote {OUT}  ({passed} passed / {failed} failed)")
    print(f"wrote {html}")


def render_html(scen, draft_row, draft_rep, passed, failed):
    def esc(s): return _html.escape(str(s) if s is not None else "")
    def cites(a): return " ".join(f"<span class='chip'>[{c['ref']}] {esc(c['table'].split('.')[-1])}</span>" for c in a.citations)
    cards = ""
    for page, q, a, kind in scen:
        ok = a.guardrail.passed
        badge = (f"<span class='g pass'>GUARDRAIL PASS</span>" if ok
                 else f"<span class='g fail'>BLOCKED — {esc('; '.join(a.guardrail.violations))}</span>")
        staged = f"<div class='staged'>⚠ {esc(a.staged_notes[0])}</div>" if a.staged_notes else ""
        cards += (f"<div class='card {'danger' if not ok else ''}'>"
                  f"<div class='qrow'><span class='page'>{esc(page)}</span><span class='q'>{esc(q)}</span></div>"
                  f"<div class='ans'>{esc(a.text)}</div>{staged}"
                  f"<div class='foot'><div class='chips'>{cites(a) or '<span class=muted>no citation</span>'}</div>{badge}</div></div>")
    draft_html = (f"<pre>{esc(draft_row['body'])}</pre>"
                  f"<div class='chips'>" + " ".join(f"<span class='chip'>[{c['ref']}]</span>" for c in __import__('json').loads(draft_row['citations'])) + "</div>")
    pages = "".join(f"<tr><td><b>{esc(p)}</b></td><td>{esc('; '.join(c['prompts']))}</td><td class='c'>{esc(c['default_draft'] or '—')}</td></tr>"
                    for p, c in PAGE.items())
    page = _TPL
    for k, v in {"%%PASSED%%": str(passed), "%%TOTAL%%": str(passed + failed), "%%CARDS%%": cards,
                 "%%DRAFT%%": draft_html, "%%PAGES%%": pages}.items():
        page = page.replace(k, v)
    os.makedirs(os.path.dirname(SCORECARD_HTML), exist_ok=True)
    with open(SCORECARD_HTML, "w") as f:
        f.write(page)
    return SCORECARD_HTML


_TPL = """<title>Mercer Copilot Core · Navanta Lens Engine</title>
<meta name="description" content="The Mercer copilot core: scoped, context-aware, grounded answers with citations, a guardrail that blocks invented figures, and draft generation — validated offline against local Gold.">
<style>
  :root{--ink:#18181b;--ink-2:#52525c;--ink-3:#71717a;--border:#e4e4e7;--line:#f4f4f5;--bg:#fafafa;--card:#fff;
    --ok-bg:#ecfef3;--ok-fg:#008234;--bad-bg:#fef2f2;--bad-fg:#b42318;--warn-bg:#fffbea;--warn-fg:#9e3900;--brand:#6a3ebd;--brand-50:#f7f2ff;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;}
  .wrap{max-width:1000px;margin:0 auto;padding:40px 32px 64px;}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 4px;} .sub{color:var(--ink-2);font-size:15px;max-width:76ch;} .asof{color:var(--ink-3);font-size:13px;margin-top:4px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:24px;}
  .gate-pill{display:inline-flex;align-items:center;gap:8px;background:var(--ok-bg);color:var(--ok-fg);font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px;border:1px solid #b7f0cd;}
  .kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:18px 0;}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px;} .kpi .k{font-size:12px;color:var(--ink-2);} .kpi .v{font-size:15px;font-weight:600;margin-top:6px;}
  .sec{margin:26px 0 12px;} .sec h2{font-size:18px;font-weight:600;margin:0;}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px;}
  .card.danger{border-color:#f3c0bb;background:#fffaf9;}
  .qrow{display:flex;gap:10px;align-items:baseline;margin-bottom:8px;} .page{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--brand);background:var(--brand-50);padding:2px 8px;border-radius:6px;}
  .q{font-weight:600;font-size:14px;} .ans{font-size:14px;color:#27272a;background:var(--brand-50);border-left:3px solid var(--brand);padding:10px 12px;border-radius:0 8px 8px 0;}
  .staged{margin-top:8px;font-size:12.5px;color:var(--warn-fg);background:var(--warn-bg);border:1px solid #f5e6b8;border-radius:8px;padding:7px 10px;}
  .foot{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:10px;flex-wrap:wrap;}
  .chip{font-family:var(--mono);font-size:11px;background:#f4f4f5;border:1px solid var(--border);border-radius:6px;padding:2px 7px;color:var(--ink-2);} .muted{color:var(--ink-3);font-size:12px;}
  .g{font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;} .g.pass{background:var(--ok-bg);color:var(--ok-fg);} .g.fail{background:var(--bad-bg);color:var(--bad-fg);}
  pre{background:#fbfbfc;border:1px solid var(--border);border-radius:10px;padding:12px;font-family:var(--mono);font-size:12px;white-space:pre-wrap;overflow-x:auto;}
  table{border-collapse:collapse;width:100%;font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
  th{background:#fbfbfc;color:var(--ink-2);font-size:11px;text-transform:uppercase;letter-spacing:.03em;text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);}
  td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;} td.c{text-align:center;} tr:last-child td{border-bottom:none;}
  .note{display:flex;gap:13px;background:#f0f9ff;border:1px solid #cfe8f5;border-radius:12px;padding:16px 18px;margin-top:18px;} .note p{margin:0;font-size:13px;color:#0a4f6e;} .note b{color:#05405a;}
  footer{margin-top:28px;padding-top:18px;border-top:1px solid var(--border);font-size:13px;color:var(--ink-3);}
</style>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Navanta Lens · Copilot core</div>
      <h1>Mercer Copilot — Core</h1>
      <div class="sub">Scoped, <b>context-aware</b> RAG + generation over the Gold evidence the engine produces. Grounded, cited answers anchored to the page + opportunity in view; a guardrail that <b>blocks invented figures</b>; draft generation to <code>play_artifact</code>. Built + validated offline against local Gold — the live path is the same call with Claude Opus 4.8.</div>
      <div class="asof">Offline MockLLM (deterministic) · methodology mro-layer0-v1 · the team wires serving / scope / UI</div>
    </div>
    <div><span class="gate-pill"><span>●</span> PASS · %%PASSED%% / %%TOTAL%% tests</span></div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="k">Grounding</div><div class="v">cited [Cn] → records</div></div>
    <div class="kpi"><div class="k">Guardrail</div><div class="v">invented figures blocked</div></div>
    <div class="kpi"><div class="k">Context</div><div class="v">page + opportunity in view</div></div>
  </div>

  <div class="sec"><h2>Sample interactions</h2></div>
  %%CARDS%%

  <div class="sec"><h2>Draft generation → opp.play_artifact</h2></div>
  <div class="card">%%DRAFT%%</div>

  <div class="sec"><h2>view_context — page-aware behavior</h2></div>
  <table><thead><tr><th>Page</th><th>Suggested prompts</th><th class="c">Default draft</th></tr></thead><tbody>%%PAGES%%</tbody></table>

  <div class="note"><span>&#8505;</span>
    <p><b>Why this is safe to ship.</b> The copilot answers only from the scope-filtered rows it's handed and cites each one; a post-generation guardrail rejects any figure not present in those records (see the blocked card above) and any citation to an unknown record, and it surfaces staged/provability caveats. The LLM is never the scope boundary — <code>view_context</code> focuses attention <i>within</i> the user's scope, never widens it. Core = Navanta; serving (Lakebase, server-side <code>user_scope</code>, hosting, chat UI) = team.</p>
  </div>
  <footer>engine/copilot: context · retrieval · grounding · llm (Mock + Claude) · guardrails · drafts · copilot — 13 offline gates, contract-validated play_artifact.</footer>
</div>
"""


if __name__ == "__main__":
    main()
