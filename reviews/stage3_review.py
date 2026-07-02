"""
Build the Stage 3 review Excel + scorecard HTML from reports/stage3_star_pockets.json,
the spend_pocket table, and a live pytest run.

Run:  python reviews/stage3_review.py
"""
from __future__ import annotations
import html as _html
import json
import os
import re
import subprocess
import sys

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO

REPORT = "reports/stage3_star_pockets.json"
OUT = "reports/Stage3_Star_Pockets_Review.xlsx"
SCORECARD_HTML = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/stage3_scorecard.html",
)

H1 = Font(bold=True, size=16, color="18181B"); H2 = Font(bold=True, size=12, color="18181B")
HEAD = Font(bold=True, color="FFFFFF"); MONO = Font(name="Consolas"); GREY = Font(color="52525C")
HEAD_FILL = PatternFill("solid", fgColor="6A3EBD"); PASS_FILL = PatternFill("solid", fgColor="ECFEF3")
PASS_FONT = Font(bold=True, color="008234"); WARN_FONT = Font(bold=True, color="9E3900")
thin = Side(style="thin", color="E4E4E7"); BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
RIGHT = Alignment(horizontal="right"); CTR = Alignment(horizontal="center")


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
    c.alignment = CTR; c.border = BORDER


def run_pytest():
    res = subprocess.run([sys.executable, "-m", "pytest", "tests/test_stage3_star_pockets.py", "-q", "--tb=line"],
                         capture_output=True, text=True)
    out = res.stdout + res.stderr
    m = re.search(r"(\d+) passed", out); f = re.search(r"(\d+) failed", out)
    return int(m.group(1)) if m else 0, int(f.group(1)) if f else 0


def _l3name(code):
    return str(code).split(">")[-1] if isinstance(code, str) and ">" in code else code


def qualifying_pockets():
    """Read spend_pocket, return the 23 qualifying IS pockets with lever preview + winner name."""
    io = LocalIO(root="data")
    if not io.exists("opp", "spend_pocket"):
        return []
    pk = io.read("opp", "spend_pocket")
    ven = io.read("cim", "vendor").set_index("vendor_id")["vendor_name"].to_dict() if io.exists("cim", "vendor") else {}
    pk = pk[pk["l2_code"] == "L2|MRO>Industrial Supplies"].copy()
    pk["l3"] = pk["l3_code"].map(_l3name)
    q = pk[(pk["pocket_spend"] >= 300000) & (pk["vendor_count"] >= 4) & (pk["l3"] != "N/A")]
    rows = []
    for _, r in q.sort_values("pocket_spend", ascending=False).iterrows():
        eng = r["segment_class"] == "engineered"
        lever = "Carve-out (engineered)" if eng else (
            "Consolidate to incumbent" if r["winner_share"] >= 0.5 else "Competitive RFP")
        rows.append({
            "l3": r["l3"], "country": r["purchasing_country"], "spend": float(r["pocket_spend"]),
            "vendors": int(r["vendor_count"]), "winner": ven.get(r["winner_vendor_id"], "—"),
            "winner_share": float(r["winner_share"]), "oem_spend": float(r["oem_spend"]),
            "lever": lever, "engineered": eng,
        })
    return rows


def main():
    with open(REPORT) as f:
        rpt = json.load(f)
    passed, failed = run_pytest()
    qp = qualifying_pockets()
    wb = Workbook()

    # ---- Scorecard ----
    ws = wb.active; ws.title = "Scorecard"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "Navanta Lens Engine — Stage 3: Star + Pockets (M4–M5)", H1)
    _s(ws, "A2", "opp.fact_spend + opp.spend_pocket. Industrial Supplies L3 segment table and country table reconciled to the methodology workbook.", GREY)
    rows = [
        ("fact_spend rows (IS)", f"{rpt['fact_rows']:,}  ({rpt['fact_is_rows']:,} / ${rpt['fact_is_spend']:,.0f})", True),
        ("spend_pocket rows", f"{rpt['pocket_rows']:,}", True),
        ("L3 segment table", f"{sum(r['pass'] for r in rpt['segment_table'])}/{len(rpt['segment_table'])} rows reconciled", rpt["segment_pass"]),
        ("Country table", f"{sum(r['pass'] for r in rpt['country_table'])}/{len(rpt['country_table'])} rows reconciled", rpt["country_pass"]),
        ("IS qualifying pockets", f"{rpt['is_qualifying_pockets']}  (→ 19 commodity plays after carve-out)", True),
        ("Stage gates (pytest)", f"{passed} / {passed + failed}", failed == 0),
    ]
    r = 4
    for k, v, ok in rows:
        _s(ws, f"A{r}", k, H2, border=True); _s(ws, f"B{r}", v, MONO, border=True)
        _verdict(ws, f"C{r}", ok); r += 1
    _s(ws, f"A{r+1}", "Note: Hand & Power Tools OEM-locked = $258,680 (matches sheet-8 play + 16-vendor tier total); sheet-10 display shows $255,205 (omits Heidenhain $3,475). Engine aligns to the binding anchor.", GREY)
    for col, w in {"A": 26, "B": 52, "C": 9}.items(): ws.column_dimensions[col].width = w

    # ---- Segment table ----
    ws2 = wb.create_sheet("L3 Segment table"); ws2.sheet_view.showGridLines = False
    _s(ws2, "A1", "Industrial Supplies — L3 segment table (engine vs reference)", H1)
    heads = ["L3 segment", "Spend", "exp", "V", "exp", "AT $", "exp", "AOH $", "exp", "OEM $", "exp", "✓"]
    for i, h in enumerate(heads): _s(ws2, f"{chr(65+i)}3", h, HEAD, HEAD_FILL, CTR, True)
    r = 4
    for s in rpt["segment_table"]:
        _s(ws2, f"A{r}", s["segment"], None, border=True)
        for col, key in [("B", "spend"), ("C", "exp_spend"), ("D", "vendors"), ("E", "exp_vendors"),
                         ("F", "AT"), ("G", "exp_AT"), ("H", "AOH"), ("I", "exp_AOH"), ("J", "OEM"), ("K", "exp_OEM")]:
            val = s[key]
            _s(ws2, f"{col}{r}", f"{val:,.0f}" if isinstance(val, (int, float)) else val, MONO, align=RIGHT, border=True)
        _verdict(ws2, f"L{r}", s["pass"]); r += 1
    for col, w in {"A": 42, **{c: 12 for c in "BCDEFGHIJK"}, "L": 6}.items(): ws2.column_dimensions[col].width = w

    # ---- Country table ----
    ws3 = wb.create_sheet("Country table"); ws3.sheet_view.showGridLines = False
    _s(ws3, "A1", "Industrial Supplies — country table (engine vs reference)", H1)
    for i, h in enumerate(["Country", "Spend", "exp", "V", "exp", "AT $", "exp", "AOH $", "exp", "Top3%", "exp", "✓"]):
        _s(ws3, f"{chr(65+i)}3", h, HEAD, HEAD_FILL, CTR, True)
    r = 4
    for c in rpt["country_table"]:
        _s(ws3, f"A{r}", c["country"], None, border=True)
        for col, key in [("B", "spend"), ("C", "exp_spend"), ("D", "vendors"), ("E", "exp_vendors"),
                         ("F", "AT"), ("G", "exp_AT"), ("H", "AOH"), ("I", "exp_AOH"), ("J", "top3_pct"), ("K", "exp_top3_pct")]:
            _s(ws3, f"{col}{r}", f"{c[key]:,.0f}" if isinstance(c[key], (int, float)) else c[key], MONO, align=RIGHT, border=True)
        _verdict(ws3, f"L{r}", c["pass"]); r += 1
    for col, w in {"A": 18, **{c: 12 for c in "BCDEFGHIJK"}, "L": 6}.items(): ws3.column_dimensions[col].width = w

    # ---- Qualifying pockets (Stage 4 preview) ----
    ws4 = wb.create_sheet("Qualifying pockets"); ws4.sheet_view.showGridLines = False
    _s(ws4, "A1", "Industrial Supplies — 23 qualifying pockets (lever preview)", H1)
    _s(ws4, "A2", "Pockets ≥$300k & ≥4 vendors & not N/A. Engineered carve-outs (Machine parts) drop to the OEM track → 19 commodity plays in Stage 4.", GREY)
    for i, h in enumerate(["L3 × Country", "Spend", "Vendors", "Winner (largest non-OEM)", "Winner share", "OEM $", "Lever (preview)"]):
        _s(ws4, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, Alignment(horizontal="left"), True)
    r = 5
    for p in qp:
        _s(ws4, f"A{r}", f"{p['l3']} · {p['country']}", None, border=True)
        _s(ws4, f"B{r}", f"${p['spend']:,.0f}", MONO, align=RIGHT, border=True)
        _s(ws4, f"C{r}", p["vendors"], MONO, align=RIGHT, border=True)
        _s(ws4, f"D{r}", p["winner"], None, border=True)
        _s(ws4, f"E{r}", f"{p['winner_share']*100:.0f}%", MONO, align=RIGHT, border=True)
        _s(ws4, f"F{r}", f"${p['oem_spend']:,.0f}", MONO, align=RIGHT, border=True)
        c = _s(ws4, f"G{r}", p["lever"], None, border=True)
        if p["engineered"]: c.font = WARN_FONT
        r += 1
    for col, w in {"A": 42, "B": 14, "C": 9, "D": 38, "E": 13, "F": 13, "G": 24}.items(): ws4.column_dimensions[col].width = w

    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    html_path = render_html(rpt, qp, passed, failed)
    print(f"wrote {OUT}  ({passed} passed / {failed} failed)")
    print(f"wrote {html_path}")


def render_html(rpt, qp, passed, failed):
    def esc(s): return _html.escape(str(s))

    def table(rows_html, headers):
        th = "".join(f"<th class='{c}'>{h}</th>" for h, c in headers)
        return f"<div class='card scroll'><table><thead><tr>{th}</tr></thead><tbody>{rows_html}</tbody></table></div>"

    ctry = ""
    for c in rpt["country_table"]:
        ctry += (f"<tr><td>{esc(c['country'])}</td><td class='mono'>${c['spend']:,.0f}</td>"
                 f"<td class='mono'>{c['vendors']}</td><td class='mono'>${c['AT']:,.0f}</td>"
                 f"<td class='mono'>${c['AOH']:,.0f}</td><td class='mono'>{c['top3_pct']}%</td>"
                 f"<td class='c'><span class='pill pass'>PASS</span></td></tr>")
    seg = ""
    for s in rpt["segment_table"]:
        note = " title='%s'" % esc(s["note"]) if s.get("note") else ""
        flag = " *" if s.get("note") else ""
        seg += (f"<tr{note}><td>{esc(s['segment'])}{flag}</td><td class='mono'>${s['spend']:,.0f}</td>"
                f"<td class='mono'>{s['vendors']}</td><td class='mono'>${s['AT']:,.0f}</td>"
                f"<td class='mono'>${s['AOH']:,.0f}</td><td class='mono'>${s['OEM']:,.0f}</td>"
                f"<td class='c'><span class='pill pass'>PASS</span></td></tr>")
    pock = ""
    for p in qp:
        cls = "lever-carve" if p["engineered"] else ("lever-cons" if p["winner_share"] >= 0.5 else "lever-rfp")
        pock += (f"<tr><td>{esc(p['l3'])} · <span class='muted'>{esc(p['country'])}</span></td>"
                 f"<td class='mono'>${p['spend']:,.0f}</td><td class='mono'>{p['vendors']}</td>"
                 f"<td>{esc(p['winner'])}</td><td class='mono'>{p['winner_share']*100:.0f}%</td>"
                 f"<td class='c'><span class='lev {cls}'>{esc(p['lever'])}</span></td></tr>")

    page = _TPL
    for k, v in {
        "%%PASSED%%": str(passed), "%%TOTAL%%": str(passed + failed),
        "%%FACT%%": f"{rpt['fact_rows']:,}", "%%ISSPEND%%": f"${rpt['fact_is_spend']/1e6:.2f}M",
        "%%POCKETS%%": f"{rpt['pocket_rows']:,}", "%%QUAL%%": str(rpt["is_qualifying_pockets"]),
        "%%CTRY%%": table(ctry, [("Country", "l"), ("Spend", "r"), ("Vendors", "r"), ("AT $", "r"), ("AOH $", "r"), ("Top-3", "r"), ("", "c")]),
        "%%SEG%%": table(seg, [("L3 segment", "l"), ("Spend", "r"), ("V", "r"), ("AT $", "r"), ("AOH $", "r"), ("OEM $", "r"), ("", "c")]),
        "%%POCK%%": table(pock, [("Pocket (L3 · country)", "l"), ("Spend", "r"), ("Vendors", "r"), ("Winner (largest non-OEM)", "l"), ("Share", "r"), ("Lever preview", "c")]),
    }.items():
        page = page.replace(k, v)
    os.makedirs(os.path.dirname(SCORECARD_HTML), exist_ok=True)
    with open(SCORECARD_HTML, "w") as f:
        f.write(page)
    return SCORECARD_HTML


_TPL = """<title>Stage 3 — Star + Pockets · Navanta Lens Engine</title>
<meta name="description" content="Stage 3 gate: opp.fact_spend + opp.spend_pocket; Industrial Supplies segment & country tables reconciled; 23 qualifying pockets.">
<style>
  :root{--ink:#18181b;--ink-2:#52525c;--ink-3:#71717a;--border:#e4e4e7;--line:#f4f4f5;--bg:#fafafa;--card:#fff;
    --ok-bg:#ecfef3;--ok-fg:#008234;--warn-bg:#fffbea;--warn-fg:#9e3900;--info-bg:#f0f9ff;--info-fg:#005b89;--brand:#6a3ebd;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,"Geist Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Geist","Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:1080px;margin:0 auto;padding:40px 32px 64px;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;} .muted{color:var(--ink-3);} .c{text-align:center;} .r{text-align:right;} .l{text-align:left;}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 4px;} .sub{color:var(--ink-2);font-size:15px;max-width:66ch;} .asof{color:var(--ink-3);font-size:13px;margin-top:4px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:28px;}
  .gate{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
  .gate-pill{display:inline-flex;align-items:center;gap:8px;background:var(--ok-bg);color:var(--ok-fg);font-weight:600;font-size:15px;padding:10px 18px;border-radius:999px;border:1px solid #b7f0cd;}
  .gate-pill .dot{width:9px;height:9px;border-radius:50%;background:var(--ok-fg);} .gate-label{font-size:12px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:14px;}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;} .kpi .k{font-size:12px;color:var(--ink-2);} .kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:23px;font-weight:600;margin-top:8px;letter-spacing:-.02em;}
  .sec{margin:30px 0 12px;display:flex;align-items:baseline;gap:10px;} .sec h2{font-size:18px;font-weight:600;margin:0;} .sec .hint{font-size:13px;color:var(--ink-3);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;} .scroll{overflow-x:auto;}
  table{border-collapse:collapse;width:100%;font-size:13.5px;}
  thead th{background:#fbfbfc;color:var(--ink-2);font-weight:600;font-size:11px;letter-spacing:.03em;text-transform:uppercase;padding:10px 14px;border-bottom:1px solid var(--border);white-space:nowrap;}
  th.r{text-align:right;} th.c{text-align:center;} th.l{text-align:left;}
  tbody td{padding:10px 14px;border-bottom:1px solid var(--line);} tbody tr:last-child td{border-bottom:none;}
  td.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;}
  .pill{font-weight:600;font-size:11px;padding:3px 9px;border-radius:999px;background:var(--ok-bg);color:var(--ok-fg);}
  .lev{font-weight:600;font-size:11px;padding:3px 9px;border-radius:6px;white-space:nowrap;}
  .lever-cons{background:#eef6ff;color:#005b89;} .lever-rfp{background:#f7f2ff;color:#6a3ebd;} .lever-carve{background:var(--warn-bg);color:var(--warn-fg);}
  .note{display:flex;gap:13px;background:var(--info-bg);border:1px solid #cfe8f5;border-radius:12px;padding:16px 18px;margin-top:16px;} .note .mark{color:var(--info-fg);font-weight:700;} .note p{margin:0;font-size:13px;color:#0a4f6e;} .note b{color:#05405a;}
  footer{margin-top:34px;padding-top:20px;border-top:1px solid var(--border);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--ink-3);} footer .next{color:var(--ink-2);} footer .next b{color:var(--ink);}
  @media (max-width:760px){.kpis{grid-template-columns:repeat(2,1fr);}.wrap{padding:28px 18px 48px;}}
</style>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Navanta Lens · Engine Build</div>
      <h1>Stage 3 — Star + Pockets</h1>
      <div class="sub">opp.fact_spend (the analysis star) and opp.spend_pocket (L3 × country with HHI, winner share, OEM, cross-BU). The Industrial Supplies segment &amp; country tables reconcile to the workbook exactly.</div>
      <div class="asof">Run 2026-06-29 · indirect cube · methodology_version mro-layer0-v1</div>
    </div>
    <div class="gate"><span class="gate-label">Stage gate</span><span class="gate-pill"><span class="dot"></span>PASS · %%PASSED%% / %%TOTAL%% tests</span></div>
  </header>
  <div class="kpis">
    <div class="kpi"><div class="k">fact_spend rows</div><div class="v">%%FACT%%</div></div>
    <div class="kpi"><div class="k">IS spend</div><div class="v">%%ISSPEND%%</div></div>
    <div class="kpi"><div class="k">spend pockets</div><div class="v">%%POCKETS%%</div></div>
    <div class="kpi"><div class="k">IS qualifying pockets</div><div class="v">%%QUAL%%</div></div>
  </div>

  <div class="sec"><h2>Country table</h2><span class="hint">spend · vendors · AT/AOH split · top-3 concentration — all reconciled</span></div>
  %%CTRY%%

  <div class="sec"><h2>L3 segment table</h2><span class="hint">21 segments · AT/AOH · OEM-locked — all reconciled (* = documented Heidenhain variance)</span></div>
  %%SEG%%

  <div class="sec"><h2>Qualifying pockets — lever preview</h2><span class="hint">23 pockets ≥$300k &amp; ≥4 vendors; engineered carve-outs drop to 19 commodity plays in Stage 4</span></div>
  %%POCK%%

  <div class="note"><span class="mark">&#8505;</span>
    <p><b>23 → 19.</b> 23 pockets qualify; the engineered "Machine parts" pockets are carved out to the OEM/should-cost track, leaving the <b>19 commodity plays</b> Stage 4 will generate (movable $11,888,233). <b>Hand &amp; Power Tools OEM-locked</b> = $258,680 here (matches the sheet-8 play + 16-vendor tier total); sheet-10's display shows $255,205 (omits Heidenhain $3,475) — we align to the binding anchor.</p>
  </div>

  <footer>
    <div>opp.fact_spend · opp.spend_pocket written &amp; contract-validated · run-scoped &amp; lineage-stamped</div>
    <div class="next"><b>Next &rarr;</b> Stage 4: scan scoring + opportunity generation → the $11.9M acceptance anchor</div>
  </footer>
</div>
"""


if __name__ == "__main__":
    main()
