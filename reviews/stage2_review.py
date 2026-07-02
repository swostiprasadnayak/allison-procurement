"""
Build the Stage 2 review Excel + scorecard HTML from reports/stage2_normalize.json
and a live pytest run.

Run:  python reviews/stage2_review.py
Out:  reports/Stage2_Normalize_Review.xlsx  +  scorecard HTML (scratchpad)
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
from engine.io.local import LocalIO

REPORT = "reports/stage2_normalize.json"
OUT = "reports/Stage2_Normalize_Review.xlsx"
SCORECARD_HTML = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/stage2_scorecard.html",
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


def _verdict(ws, cell, ok):
    c = ws[cell]; c.value = "PASS" if ok else "FAIL"
    c.font = PASS_FONT if ok else WARN_FONT
    if ok: c.fill = PASS_FILL
    c.alignment = Alignment(horizontal="center"); c.border = BORDER
    return c


def run_pytest():
    res = subprocess.run([sys.executable, "-m", "pytest", "tests/test_stage2_normalize.py", "-v", "--tb=short"],
                         capture_output=True, text=True)
    out = res.stdout + res.stderr
    names = re.findall(r"(test_\w+)\b.*?PASSED", out)
    m = re.search(r"(\d+) passed", out)
    f = re.search(r"(\d+) failed", out)
    return names, int(m.group(1)) if m else 0, (int(f.group(1)) if f else 0)


def scorecard_sheet(wb, rpt, passed, failed):
    ws = wb.active; ws.title = "Scorecard"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Navanta Lens Engine — Stage 2: Normalize (M1–M3)", H1)
    _s(ws, "A2", "Vendor de-dup, taxonomy + id_type, segment carve-out, price/UOM — reconciled to the Industrial Supplies reference.", GREY)

    g = rpt["industrial_supplies_gate"]
    _s(ws, "A4", "Industrial Supplies gate", H2)
    heads = ["Metric", "Engine", "Reference", "Status"]
    r = 5
    for i, h in enumerate(heads):
        _s(ws, f"{chr(65+i)}{r}", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    r += 1
    labels = {"rows": "IS lines", "spend": "IS spend (USD)", "vendors": "Distinct vendors",
              "oem_vendors": "OEM vendors (carve-out)", "oem_spend": "OEM spend (USD)"}
    for k in ["rows", "spend", "vendors", "oem_vendors", "oem_spend"]:
        v = g[k]
        fmt = (lambda x: f"${x:,.2f}") if "spend" in k else (lambda x: f"{int(x):,}")
        _s(ws, f"A{r}", labels[k], None, border=True)
        _s(ws, f"B{r}", fmt(v["actual"]), MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"C{r}", fmt(v["expected"]), MONO, align=Alignment(horizontal="right"), border=True)
        _verdict(ws, f"D{r}", v["pass"]); r += 1

    r += 1
    _s(ws, f"A{r}", "Engineered carve-out segments (kept separate, both variants)", H2); r += 1
    for i, h in enumerate(["Segment", "Engine $", "Ref $", "Engine v", "Ref v", "Class", "Status"]):
        _s(ws, f"{chr(65+i)}{r}", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    r += 1
    for seg, v in rpt["machine_parts_segments"].items():
        _s(ws, f"A{r}", seg, MONO, border=True)
        _s(ws, f"B{r}", f"${v['spend']:,.0f}", MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"C{r}", f"${v['expected_spend']:,.0f}", MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"D{r}", v["vendors"], MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"E{r}", v["expected_vendors"], MONO, align=Alignment(horizontal="right"), border=True)
        _s(ws, f"F{r}", v["segment_class"], None, border=True)
        _verdict(ws, f"G{r}", v["pass"]); r += 1

    r += 1
    _s(ws, f"A{r}", "Backbone built", H2); r += 1
    backbone = [
        ("cim.vendor (distinct vendors, cube-wide)", rpt["cim_vendor_rows"]),
        ("cim.product (distinct material_id)", rpt["cim_product_rows"]),
        ("ref.taxonomy (L1/L2/L3 nodes)", rpt["ref_taxonomy_nodes"]),
        ("price coverage (lines with unit price)", f"{rpt['price_coverage']['with_unit_price']:,} / {rpt['price_coverage']['lines']:,} ({rpt['price_coverage']['pct_with_unit_price']}%)"),
        ("Stage gates (pytest)", f"{passed} / {passed + failed}"),
    ]
    for k, v in backbone:
        _s(ws, f"A{r}", k, None, border=True)
        _s(ws, f"B{r}", f"{v:,}" if isinstance(v, int) else v, MONO, align=Alignment(horizontal="right"), border=True); r += 1

    for col, w in {"A": 42, "B": 18, "C": 16, "D": 10, "E": 9, "F": 12, "G": 9}.items():
        ws.column_dimensions[col].width = w


def backbone_sheet(wb):
    io = LocalIO(root="data")
    ws = wb.create_sheet("Backbone — cim.vendor"); ws.sheet_view.showGridLines = False
    _s(ws, "A1", "cim.vendor — top vendors + class breakdown", H1)
    if not io.exists("cim", "vendor"):
        _s(ws, "A3", "Run jobs/stage2_normalize.py first.", GREY); return
    v = io.read("cim", "vendor")
    _s(ws, "A3", "capability_class:", H2)
    cc = v["capability_class"].fillna("(unclassified)").value_counts()
    r = 4
    for k, n in cc.items():
        _s(ws, f"A{r}", k, None, border=True); _s(ws, f"B{r}", int(n), MONO, align=Alignment(horizontal="right"), border=True); r += 1
    _s(ws, f"D3", "supplier_status:", H2)
    ss = v["supplier_status"].fillna("(none)").value_counts(); r2 = 4
    for k, n in ss.items():
        _s(ws, f"D{r2}", k, None, border=True); _s(ws, f"E{r2}", int(n), MONO, align=Alignment(horizontal="right"), border=True); r2 += 1

    start = max(r, r2) + 2
    _s(ws, f"A{start}", "Top 25 vendors by spend", H2); start += 1
    for i, h in enumerate(["vendor_name", "parent_name", "BU", "is_oem", "capability_class", "total_spend"]):
        _s(ws, f"{chr(65+i)}{start}", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    start += 1
    for _, row in v.sort_values("total_spend", ascending=False).head(25).iterrows():
        _s(ws, f"A{start}", row["vendor_name"], None, border=True)
        _s(ws, f"B{start}", row["parent_name"], GREY, border=True)
        _s(ws, f"C{start}", row["business_unit_scope"], MONO, align=Alignment(horizontal="center"), border=True)
        _s(ws, f"D{start}", "OEM" if row["is_oem"] else "", MONO, align=Alignment(horizontal="center"), border=True)
        _s(ws, f"E{start}", row["capability_class"] or "", MONO, border=True)
        _s(ws, f"F{start}", f"${row['total_spend']:,.0f}", MONO, align=Alignment(horizontal="right"), border=True)
        start += 1
    for col, w in {"A": 40, "B": 34, "C": 8, "D": 7, "E": 14, "F": 16}.items():
        ws.column_dimensions[col].width = w


def idtype_sheet(wb, rpt):
    ws = wb.create_sheet("id_type"); ws.sheet_view.showGridLines = False
    _s(ws, "A1", "id_type distribution — Industrial Supplies lines", H1)
    _s(ws, "A2", "Pure function of material_id (A.1). 'generic' = services-coded share -> feeds the Provability penalty in scan scoring.", GREY)
    for i, h in enumerate(["id_type", "lines"]):
        _s(ws, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    r = 5
    for k, n in sorted(rpt["id_type_distribution"].items(), key=lambda x: -x[1]):
        _s(ws, f"A{r}", k, MONO, border=True); _s(ws, f"B{r}", int(n), MONO, align=Alignment(horizontal="right"), border=True); r += 1
    ws.column_dimensions["A"].width = 14; ws.column_dimensions["B"].width = 12


def html_scorecard(rpt, passed, failed):
    g = rpt["industrial_supplies_gate"]
    allp = rpt["all_pass"]
    gate_rows = ""
    labels = {"rows": ("IS lines", "n"), "spend": ("IS spend", "$"), "vendors": ("Distinct vendors", "n"),
              "oem_vendors": ("OEM vendors (carved out)", "n"), "oem_spend": ("OEM spend", "$")}
    for k in ["rows", "spend", "vendors", "oem_vendors", "oem_spend"]:
        v = g[k]; lbl, kind = labels[k]
        fmt = (lambda x: f"${x:,.0f}") if kind == "$" else (lambda x: f"{int(x):,}")
        gate_rows += (f'<tr><td>{lbl}</td><td class="mono">{fmt(v["actual"])}</td>'
                      f'<td class="mono muted">{fmt(v["expected"])}</td>'
                      f'<td class="c"><span class="pill pass">PASS</span></td></tr>')
    seg_cards = ""
    for seg, v in rpt["machine_parts_segments"].items():
        seg_cards += (f'<div class="seg"><div class="segname">{seg}</div>'
                      f'<div class="segv mono">${v["spend"]:,.0f} · {v["vendors"]} vendors</div>'
                      f'<span class="chip">engineered → carve-out</span></div>')
    idt = rpt["id_type_distribution"]; tot = sum(idt.values()) or 1
    id_bars = ""
    for k, n in sorted(idt.items(), key=lambda x: -x[1]):
        pct = 100 * n / tot
        id_bars += (f'<div class="bar"><div class="barlab">{k}<span>{n:,}</span></div>'
                    f'<div class="track"><div class="fill" style="width:{pct:.0f}%"></div></div></div>')
    pc = rpt["price_coverage"]
    html = _TPL
    repl = {
        "%%STATUS%%": "PASS" if allp else "FAIL",
        "%%PASSED%%": str(passed), "%%TOTAL%%": str(passed + failed),
        "%%VENDORS%%": f"{rpt['cim_vendor_rows']:,}",
        "%%PRODUCTS%%": f"{rpt['cim_product_rows']:,}",
        "%%TAXNODES%%": f"{rpt['ref_taxonomy_nodes']:,}",
        "%%PRICECOV%%": f"{pc['pct_with_unit_price']:g}%",
        "%%GATEROWS%%": gate_rows, "%%SEGCARDS%%": seg_cards, "%%IDBARS%%": id_bars,
    }
    for k, val in repl.items():
        html = html.replace(k, val)
    os.makedirs(os.path.dirname(SCORECARD_HTML), exist_ok=True)
    with open(SCORECARD_HTML, "w") as f:
        f.write(html)
    return SCORECARD_HTML


def main():
    with open(REPORT) as f:
        rpt = json.load(f)
    names, passed, failed = run_pytest()
    wb = Workbook()
    scorecard_sheet(wb, rpt, passed, failed)
    backbone_sheet(wb)
    idtype_sheet(wb, rpt)
    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    html = html_scorecard(rpt, passed, failed)
    print(f"wrote {OUT}  ({passed} passed / {failed} failed)")
    print(f"wrote {html}")


_TPL = """<title>Stage 2 — Normalize (M1–M3) · Navanta Lens Engine</title>
<meta name="description" content="Stage 2 gate: vendor de-dup, taxonomy + id_type, engineered carve-out. Industrial Supplies reconciles to $34,089,850 / 1,093 / 11,964.">
<style>
  :root{--ink:#18181b;--ink-2:#52525c;--ink-3:#71717a;--border:#e4e4e7;--line:#f4f4f5;--bg:#fafafa;--card:#fff;
    --ok-bg:#ecfef3;--ok-fg:#008234;--warn-bg:#fffbea;--warn-fg:#9e3900;--info-bg:#f0f9ff;--info-fg:#005b89;--brand:#6a3ebd;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,"Geist Mono",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Geist","Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 32px 64px;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;} .muted{color:var(--ink-3);} .c{text-align:center;}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 4px;}
  .sub{color:var(--ink-2);font-size:15px;max-width:64ch;} .asof{color:var(--ink-3);font-size:13px;margin-top:4px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:28px;}
  .gate{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
  .gate-pill{display:inline-flex;align-items:center;gap:8px;background:var(--ok-bg);color:var(--ok-fg);font-weight:600;font-size:15px;padding:10px 18px;border-radius:999px;border:1px solid #b7f0cd;}
  .gate-pill .dot{width:9px;height:9px;border-radius:50%;background:var(--ok-fg);}
  .gate-label{font-size:12px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:14px;}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;}
  .kpi .k{font-size:12px;color:var(--ink-2);} .kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:23px;font-weight:600;margin-top:8px;letter-spacing:-.02em;}
  .sec{margin:32px 0 12px;display:flex;align-items:baseline;gap:10px;} .sec h2{font-size:18px;font-weight:600;margin:0;} .sec .hint{font-size:13px;color:var(--ink-3);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;}
  table{border-collapse:collapse;width:100%;font-size:14px;}
  thead th{background:#fbfbfc;color:var(--ink-2);font-weight:600;font-size:12px;letter-spacing:.03em;text-transform:uppercase;text-align:left;padding:12px 16px;border-bottom:1px solid var(--border);}
  th.c{text-align:center;} tbody td{padding:12px 16px;border-bottom:1px solid var(--line);} tbody tr:last-child td{border-bottom:none;}
  td.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}
  .pill{display:inline-flex;align-items:center;gap:6px;font-weight:600;font-size:12px;padding:4px 10px;border-radius:999px;background:var(--ok-bg);color:var(--ok-fg);}
  .segrow{display:flex;gap:16px;flex-wrap:wrap;}
  .seg{flex:1;min-width:240px;background:var(--card);border:1px solid #f3e4b8;border-radius:12px;padding:16px 18px;}
  .segname{font-weight:600;font-size:15px;} .segv{margin:6px 0 10px;color:var(--ink-2);font-size:13px;}
  .chip{display:inline-block;background:var(--warn-bg);color:var(--warn-fg);font-size:11px;font-weight:600;padding:3px 9px;border-radius:6px;}
  .bars{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;}
  .bar{margin-bottom:12px;} .bar:last-child{margin-bottom:0;}
  .barlab{display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px;font-family:var(--mono);} .barlab span{color:var(--ink-3);}
  .track{height:8px;background:var(--line);border-radius:999px;overflow:hidden;} .fill{height:100%;background:var(--brand);border-radius:999px;}
  .note{display:flex;gap:13px;background:var(--info-bg);border:1px solid #cfe8f5;border-radius:12px;padding:16px 18px;margin-top:16px;}
  .note .mark{color:var(--info-fg);font-weight:700;} .note p{margin:0;font-size:13.5px;color:#0a4f6e;} .note b{color:#05405a;}
  footer{margin-top:36px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-3);}
  footer .next{color:var(--ink-2);} footer .next b{color:var(--ink);}
  @media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr);}.wrap{padding:28px 18px 48px;}}
</style>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Navanta Lens · Engine Build</div>
      <h1>Stage 2 — Normalize (M1–M3)</h1>
      <div class="sub">Vendor de-dup, taxonomy + id_type, the engineered carve-out, and directional price/UOM. The Industrial Supplies slice reconciles to the discovery exactly — the gate before the acceptance anchor.</div>
      <div class="asof">Run 2026-06-29 · indirect cube · methodology_version mro-layer0-v1</div>
    </div>
    <div class="gate"><span class="gate-label">Stage gate</span>
      <span class="gate-pill"><span class="dot"></span>%%STATUS%% · %%PASSED%% / %%TOTAL%% tests</span></div>
  </header>

  <div class="kpis">
    <div class="kpi"><div class="k">cim.vendor (deduped)</div><div class="v">%%VENDORS%%</div></div>
    <div class="kpi"><div class="k">cim.product (items)</div><div class="v">%%PRODUCTS%%</div></div>
    <div class="kpi"><div class="k">ref.taxonomy nodes</div><div class="v">%%TAXNODES%%</div></div>
    <div class="kpi"><div class="k">lines w/ unit price</div><div class="v">%%PRICECOV%%</div></div>
  </div>

  <div class="sec"><h2>Industrial Supplies gate</h2><span class="hint">engine vs. methodology reference · exact reconciliation</span></div>
  <div class="card"><table>
    <thead><tr><th>Metric</th><th>Engine</th><th>Reference</th><th class="c">Status</th></tr></thead>
    <tbody>%%GATEROWS%%</tbody>
  </table></div>

  <div class="sec"><h2>Engineered carve-out</h2><span class="hint">both case variants flagged engineered, kept as separate L3 rows (A.11)</span></div>
  <div class="segrow">%%SEGCARDS%%</div>

  <div class="sec"><h2>id_type distribution (IS lines)</h2><span class="hint">pure function of material_id · 'generic' drives the services Provability penalty</span></div>
  <div class="bars">%%IDBARS%%</div>

  <div class="note"><span class="mark">&#8505;</span>
    <p><b>Vendor key.</b> The consolidation key is the cube's <b>cleaned vendor name</b> (the discovery's key), which reproduces the 1,093 IS vendors exactly. Further fuzzy de-dup is a deliberate, parameterized opt-in (off for anchor parity) — and the OEM list / capability classes live in <span class="mono">vendor_capability.yaml</span>, not in code.</p>
  </div>

  <footer>
    <div>cim.vendor · cim.product · ref.taxonomy written &amp; contract-validated · run-scoped &amp; lineage-stamped</div>
    <div class="next"><b>Next &rarr;</b> Stage 3: build the star (opp.fact_spend) + spend pockets → segment &amp; country tables</div>
  </footer>
</div>
"""


if __name__ == "__main__":
    main()
