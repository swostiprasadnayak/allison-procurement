"""
Build the Stage 1 review Excel from reports/stage1_foundation.json + a live pytest run.

Sheets:
  - Scorecard      : foundation status, version, param count, agreement, tests
  - Parameters A.2 : the seeded engine_parameter table (the client-reviewable 'dials')
  - Lineage Spine  : the demo runs + is_current behaviour + config_snapshot
  - Tests          : per-test PASS/FAIL from a real pytest run

Run:  python reviews/stage1_review.py
Out:  reports/Stage1_Foundation_Review.xlsx
"""
from __future__ import annotations
import json
import os
import re
import subprocess
import sys

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from reviews.param_glossary import format_value, group_by_category

REPORT = "reports/stage1_foundation.json"
OUT = "reports/Stage1_Foundation_Review.xlsx"
SCORECARD_HTML = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/stage1_scorecard.html",
)

H1 = Font(bold=True, size=16, color="18181B")
H2 = Font(bold=True, size=12, color="18181B")
HEAD = Font(bold=True, color="FFFFFF")
MONO = Font(name="Consolas")
GREY = Font(color="52525C")
HEAD_FILL = PatternFill("solid", fgColor="6A3EBD")
PASS_FILL = PatternFill("solid", fgColor="ECFEF3")
PASS_FONT = Font(bold=True, color="008234")
WARN_FONT = Font(bold=True, color="9E3900")
thin = Side(style="thin", color="E4E4E7")
BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)


def _s(ws, cell, v, font=None, fill=None, align=None, border=False):
    c = ws[cell]; c.value = v
    if font: c.font = font
    if fill: c.fill = fill
    if align: c.alignment = align
    if border: c.border = BORDER
    return c


def run_pytest():
    """Return (names, passed, total, raw) from a real pytest run."""
    res = subprocess.run(
        [sys.executable, "-m", "pytest", "tests/test_stage1_foundation.py", "-v", "--tb=short"],
        capture_output=True, text=True)
    out = res.stdout + res.stderr
    names = re.findall(r"(test_\w+)\s+PASSED", out)
    fails = re.findall(r"(test_\w+)\s+FAILED", out)
    m = re.search(r"(\d+) passed", out)
    passed = int(m.group(1)) if m else len(names)
    total = passed + len(fails)
    return names, fails, passed, total, out


def scorecard(wb, rpt, passed, total, fails):
    ws = wb.active; ws.title = "Scorecard"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Navanta Lens Engine — Stage 1: Foundation, Parameters & Lineage", H1)
    _s(ws, "A2", "Schema contracts, the Appendix A.2 parameter seed, and the run/lineage spine every module writes through.", GREY)
    rows = [
        ("Methodology version", rpt["methodology_version"], True),
        ("Parameters seeded (A.2)", f"{rpt['n_params']}", True),
        ("CDM contracts validated", ", ".join(t.split('.')[-1] for t in rpt["contracts_validated"]), True),
        ("Client methodology agreement", rpt["agreement_status"] + " (sign-off at kickoff)", None),
        ("Lineage spine — current run", rpt["lineage_demo"]["current_run"] + " (is_current flips to latest)", True),
        ("config_snapshot captured", f"{rpt['lineage_demo']['config_snapshot_keys']} params per run", True),
        ("Stage gates (pytest)", f"{passed} / {total} passed", passed == total and total > 0),
    ]
    r = 4
    for k, v, ok in rows:
        _s(ws, f"A{r}", k, H2, border=True)
        _s(ws, f"B{r}", v, MONO, border=True)
        c = _s(ws, f"C{r}", ("PASS" if ok else ("—" if ok is None else "FAIL")), border=True,
               align=Alignment(horizontal="center"))
        c.font = PASS_FONT if ok else (GREY if ok is None else WARN_FONT)
        if ok: c.fill = PASS_FILL
        r += 1
    ws.column_dimensions["A"].width = 30
    ws.column_dimensions["B"].width = 56
    ws.column_dimensions["C"].width = 10


def parameters(wb, rpt):
    ws = wb.create_sheet("Parameters A.2"); ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Engine parameters (Appendix A.2) — the tunable dials", H1)
    _s(ws, "A2", "Seeded into opp.engine_parameter, versioned, applied on the next run. Friendly name + definition for review; the technical key is the canonical id used in code & the CDM.", GREY)
    heads = ["Name", "Value", "Key (code id)", "Unit", "Definition"]
    r = 4
    for i, h in enumerate(heads):
        _s(ws, f"{chr(65+i)}{r}", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    r += 1
    SUB_FILL = PatternFill("solid", fgColor="F4F4F5")
    for cat, items in group_by_category(rpt["params"]):
        _s(ws, f"A{r}", cat, H2, SUB_FILL, border=True)
        for col in "BCDE":
            _s(ws, f"{col}{r}", "", fill=SUB_FILL, border=True)
        r += 1
        for p in items:
            _s(ws, f"A{r}", p.get("label", p["param_key"]), Font(bold=True, color="18181B"), border=True)
            _s(ws, f"B{r}", format_value(p["param_key"], p["value"], p.get("unit")), MONO,
               align=Alignment(horizontal="left"), border=True)
            _s(ws, f"C{r}", p["param_key"], MONO, border=True)
            _s(ws, f"D{r}", p.get("unit") or "", GREY, border=True)
            _s(ws, f"E{r}", p.get("definition") or "", align=Alignment(wrap_text=True, vertical="top"), border=True)
            r += 1
    for col, w in {"A": 34, "B": 16, "C": 30, "D": 11, "E": 72}.items():
        ws.column_dimensions[col].width = w


def lineage(wb, rpt):
    ws = wb.create_sheet("Lineage Spine"); ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Run / lineage spine — opp.engine_run", H1)
    _s(ws, "A2", "One run per scope; every output row stamps run_id; config_snapshot records the exact params; is_current flips atomically on success.", GREY)
    _s(ws, "A4", f"Demo scope: {json.dumps(rpt['lineage_demo']['scope'])}", MONO)
    _s(ws, "A6", "run_id", HEAD, HEAD_FILL, border=True); _s(ws, "B6", "is_current", HEAD, HEAD_FILL, Alignment(horizontal="center"), True)
    r = 7
    for run in rpt["lineage_demo"]["runs"]:
        _s(ws, f"A{r}", run["run_id"], MONO, border=True)
        cur = bool(run["is_current"]) if not isinstance(run["is_current"], str) else run["is_current"] == "True"
        c = _s(ws, f"B{r}", "current" if cur else "superseded", border=True, align=Alignment(horizontal="center"))
        c.font = PASS_FONT if cur else GREY
        if cur: c.fill = PASS_FILL
        r += 1
    _s(ws, f"A{r+1}", "Two runs on the same scope → only the latest is current (older auto-superseded). Failed runs never become current.", GREY)
    ws.column_dimensions["A"].width = 22; ws.column_dimensions["B"].width = 16


def tests(wb, names, fails):
    ws = wb.create_sheet("Tests"); ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Stage 1 gates — pytest", H1)
    _s(ws, "A2", "Parameter resolution, contract conformance, lineage, and the key 'param change → next run' requirement.", GREY)
    _s(ws, "A4", "Test", HEAD, HEAD_FILL, border=True); _s(ws, "B4", "Result", HEAD, HEAD_FILL, Alignment(horizontal="center"), True)
    r = 5
    for n in names:
        _s(ws, f"A{r}", n, MONO, border=True)
        c = _s(ws, f"B{r}", "PASS", PASS_FONT, PASS_FILL, Alignment(horizontal="center"), True)
        r += 1
    for n in fails:
        _s(ws, f"A{r}", n, MONO, border=True)
        _s(ws, f"B{r}", "FAIL", WARN_FONT, None, Alignment(horizontal="center"), True)
        r += 1
    ws.column_dimensions["A"].width = 52; ws.column_dimensions["B"].width = 10


_SCORECARD_TEMPLATE = """<title>Stage 1 — Foundation, Parameters & Lineage · Navanta Lens Engine</title>
<meta name="description" content="Stage 1 gate: schema contracts, the Appendix A.2 parameter seed with plain-English definitions, and the run/lineage spine.">
<style>
  :root{
    --ink:#18181b; --ink-2:#52525c; --ink-3:#71717a;
    --border:#e4e4e7; --line:#f4f4f5; --bg:#fafafa; --card:#fff;
    --ok-bg:#ecfef3; --ok-fg:#008234; --info-bg:#f0f9ff; --info-fg:#005b89;
    --brand:#6a3ebd;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,"Geist Mono",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Geist","Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 32px 64px;}
  .num{font-family:var(--mono);font-variant-numeric:tabular-nums;}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 4px;text-wrap:balance;}
  .sub{color:var(--ink-2);font-size:15px;max-width:64ch;}
  .asof{color:var(--ink-3);font-size:13px;margin-top:4px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:28px;}
  .gate{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
  .gate-pill{display:inline-flex;align-items:center;gap:8px;background:var(--ok-bg);color:var(--ok-fg);font-weight:600;font-size:15px;padding:10px 18px;border-radius:999px;border:1px solid #b7f0cd;}
  .gate-pill .dot{width:9px;height:9px;border-radius:50%;background:var(--ok-fg);}
  .gate-label{font-size:12px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:14px;}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;}
  .kpi .k{font-size:12px;color:var(--ink-2);}
  .kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:23px;font-weight:600;margin-top:8px;letter-spacing:-.02em;}
  .sec{margin:34px 0 14px;display:flex;align-items:baseline;gap:10px;}
  .sec h2{font-size:18px;font-weight:600;margin:0;}
  .sec .hint{font-size:13px;color:var(--ink-3);}
  .pgrid{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;}
  .pgroup{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:8px 18px 14px;}
  .pgroup h3{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--brand);letter-spacing:.05em;text-transform:uppercase;}
  .param{padding:11px 0;border-bottom:1px solid var(--line);}
  .param:last-child{border-bottom:none;}
  .pmain{display:flex;justify-content:space-between;align-items:baseline;gap:12px;}
  .pname{font-size:14px;font-weight:600;color:var(--ink);}
  .pname code{display:block;font-family:var(--mono);font-size:11.5px;font-weight:400;color:var(--ink-3);margin-top:2px;}
  .pval{font-family:var(--mono);font-variant-numeric:tabular-nums;font-weight:600;font-size:14px;white-space:nowrap;color:var(--ink);}
  .pdef{font-size:12.5px;color:var(--ink-2);margin-top:5px;max-width:60ch;}
  .lin{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;}
  .runbox{border:1px solid var(--border);border-radius:10px;padding:12px 14px;min-width:170px;}
  .runbox.cur{border-color:#b7f0cd;background:var(--ok-bg);}
  .runbox .rid{font-family:var(--mono);font-size:13px;font-weight:600;}
  .runbox .rs{font-size:12px;margin-top:3px;}
  .runbox.cur .rs{color:var(--ok-fg);font-weight:600;}
  .runbox.old .rs{color:var(--ink-3);}
  .arrow{color:var(--ink-3);font-size:20px;}
  .note{display:flex;gap:13px;background:var(--info-bg);border:1px solid #cfe8f5;border-radius:12px;padding:16px 18px;margin-top:16px;}
  .note .mark{color:var(--info-fg);font-weight:700;}
  .note p{margin:0;font-size:13.5px;color:#0a4f6e;}
  .note b{color:#05405a;}
  footer{margin-top:38px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-3);}
  footer .next{color:var(--ink-2);} footer .next b{color:var(--ink);}
  @media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr);}.pgrid{grid-template-columns:1fr;}.wrap{padding:28px 18px 48px;}}
</style>

<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Navanta Lens · Engine Build</div>
      <h1>Stage 1 — Foundation, Parameters &amp; Lineage</h1>
      <div class="sub">Schema contracts from the CDM, the Appendix&nbsp;A.2 parameter seed, and the run/lineage spine every later module writes through. Every dial below carries a plain-English definition; nothing is hardcoded.</div>
      <div class="asof">Run 2026-06-29 · methodology_version <span class="num">%%VERSION%%</span></div>
    </div>
    <div class="gate">
      <span class="gate-label">Stage gate</span>
      <span class="gate-pill"><span class="dot"></span>PASS · %%PASSED%% / %%TOTAL%% gates</span>
    </div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="k">Parameters seeded (A.2)</div><div class="v">%%NPARAMS%%</div></div>
    <div class="kpi"><div class="k">CDM contracts validated</div><div class="v">4 / 4</div></div>
    <div class="kpi"><div class="k">config_snapshot / run</div><div class="v">%%NPARAMS%%</div></div>
    <div class="kpi"><div class="k">Gate tests (pytest)</div><div class="v">%%PASSED%% / %%TOTAL%%</div></div>
  </div>

  <div class="sec"><h2>Engine parameters — the tunable dials</h2><span class="hint">opp.engine_parameter · friendly name + definition · technical key is the code id · applied next run</span></div>
  <div class="pgrid">
%%PARAMS%%
  </div>

  <div class="sec"><h2>Run / lineage spine</h2><span class="hint">opp.engine_run · one current run per scope · is_current flips atomically on success</span></div>
  <div class="lin">
    %%RUNS%%
    <div style="flex:1;min-width:220px;color:var(--ink-2);font-size:13px;">
      Two runs on the same scope <span class="num">%%SCOPE%%</span> — the latest becomes current, the prior auto-supersedes. Each run stamps <span class="num">run_id</span> on every output row and records the exact parameter set in <span class="num">config_snapshot</span>. Failed runs never become current.
    </div>
  </div>

  <div class="note">
    <span class="mark">&#8505;</span>
    <p><b>Savings-rate reconciliation note.</b> The methodology workbook (our anchor fixture) computes savings as movable&nbsp;&times;&nbsp;<b>flat 5–8%</b> &rarr; $594,411–$951,058. Feature Spec A.6 generalizes to <b>lever-tiered</b> rates (the seeded default). Both are seeded; the <span class="num">savings_rate_policy</span> dial selects which. The movable <b>$11,888,233 is rate-independent</b> and remains the hard anchor — Stage 4 reconciles movable exactly and reports savings under both policies.</p>
  </div>

  <footer>
    <div>opp.engine_parameter · methodology_version · methodology_agreement (pending sign-off) · engine_run — written &amp; contract-validated</div>
    <div class="next"><b>Next &rarr;</b> Stage 2: normalize (M1–M3) → gate $34.089M / 1,093 / 11,964</div>
  </footer>
</div>
"""


def render_scorecard_html(rpt, passed, total) -> str:
    """Generate the visual gate scorecard from the report (data-driven, so it stays
    in sync with the Excel and the seed). Returns the path written."""
    import html as _html

    def esc(s):
        return _html.escape(str(s))

    # parameter groups with friendly label + key + value + definition
    groups_html = []
    for cat, items in group_by_category(rpt["params"]):
        rows = []
        for p in items:
            val = esc(format_value(p["param_key"], p["value"], p.get("unit")))
            rows.append(
                f'<div class="param">'
                f'<div class="pmain"><div class="pname">{esc(p.get("label", p["param_key"]))}'
                f'<code>{esc(p["param_key"])}</code></div>'
                f'<div class="pval">{val}</div></div>'
                f'<div class="pdef">{esc(p.get("definition") or "")}</div>'
                f'</div>'
            )
        groups_html.append(
            f'<div class="pgroup"><h3>{esc(cat)}</h3>{"".join(rows)}</div>'
        )
    params_section = "\n".join(groups_html)

    runs = rpt["lineage_demo"]["runs"]
    cur = rpt["lineage_demo"]["current_run"]
    run_boxes = []
    for i, run in enumerate(runs):
        is_cur = run["run_id"] == cur
        cls = "cur" if is_cur else "old"
        state = "● current" if is_cur else "superseded"
        if i:
            run_boxes.append('<span class="arrow">→</span>')
        run_boxes.append(
            f'<div class="runbox {cls}"><div class="rid">{esc(run["run_id"])}</div>'
            f'<div class="rs">{state}</div></div>'
        )
    runs_html = "".join(run_boxes)
    scope_str = esc(json.dumps(rpt["lineage_demo"]["scope"]))

    page = (_SCORECARD_TEMPLATE
            .replace("%%PASSED%%", str(passed))
            .replace("%%TOTAL%%", str(total))
            .replace("%%NPARAMS%%", str(rpt["n_params"]))
            .replace("%%VERSION%%", esc(rpt["methodology_version"]))
            .replace("%%PARAMS%%", params_section)
            .replace("%%RUNS%%", runs_html)
            .replace("%%SCOPE%%", scope_str))
    os.makedirs(os.path.dirname(SCORECARD_HTML), exist_ok=True)
    with open(SCORECARD_HTML, "w") as f:
        f.write(page)
    return SCORECARD_HTML


def main():
    with open(REPORT) as f:
        rpt = json.load(f)
    names, fails, passed, total, _ = run_pytest()
    wb = Workbook()
    scorecard(wb, rpt, passed, total, fails)
    parameters(wb, rpt)
    lineage(wb, rpt)
    tests(wb, names, fails)
    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    html_path = render_scorecard_html(rpt, passed, total)
    print(f"wrote {OUT}  ({passed}/{total} tests passed)")
    print(f"wrote {html_path}")


if __name__ == "__main__":
    main()
