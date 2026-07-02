"""
OEM verification review — the WHY behind each OEM verdict, for sign-off. Excel + scorecard HTML.

Reads opp.vendor_classification (the cached web-verified verdicts, each carrying evidence +
citation_url + confidence) and reconciles to the Industrial Supplies anchor. This is the
artifact the client signs off on before the verified OEM set supersedes the substring baseline
in M7 (the engine still uses the validated anchor until then).

Run:  python reviews/oem_verification_review.py
Out:  reports/OEM_Verification_Review.xlsx  +  scorecard HTML (scratchpad)
"""
from __future__ import annotations
import html as _html
import json
import os
import sys

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO
from engine.core.params import load_seed
from engine.core.normalize.cube_adapter import to_canonical, INDIRECT_MAP
from engine.core.normalize.vendor import vendor_id, _oem_pattern

REPORT = "reports/vendor_classification.json"
OUT = "reports/OEM_Verification_Review.xlsx"
SCORECARD_HTML = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/oem_verification_scorecard.html")

H1 = Font(bold=True, size=16, color="18181B"); H2 = Font(bold=True, size=12, color="18181B")
HEAD = Font(bold=True, color="FFFFFF"); MONO = Font(name="Consolas"); GREY = Font(color="52525C")
WRAP = Alignment(wrap_text=True, vertical="top"); WRAPL = Alignment(wrap_text=True, vertical="top", horizontal="left")
HEAD_FILL = PatternFill("solid", fgColor="6A3EBD"); PASS_FILL = PatternFill("solid", fgColor="ECFEF3")
WARN_FILL = PatternFill("solid", fgColor="FFFBEA")
PASS_FONT = Font(bold=True, color="008234"); WARN_FONT = Font(bold=True, color="9E3900")
thin = Side(style="thin", color="E4E4E7"); BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
R = Alignment(horizontal="right", vertical="top"); C = Alignment(horizontal="center", vertical="top")


def _s(ws, cell, v, font=None, fill=None, align=None, border=False):
    c = ws[cell]; c.value = v
    if font: c.font = font
    if fill: c.fill = fill
    if align: c.alignment = align
    if border: c.border = BORDER
    return c


def gather():
    io = LocalIO(root="data")
    cfg = load_seed("config/vendor_capability.yaml")
    canon = to_canonical(io.read_bronze("indirect_cube"), INDIRECT_MAP, "indirect")
    d = canon[canon["l1"] == "MRO"].copy()
    d["net"] = pd.to_numeric(d["net_spend"], errors="coerce").fillna(0.0)
    d["vendor"] = d["vendor"].astype(str).str.strip()
    spend = d.groupby("vendor")["net"].sum()

    c = io.read("opp", "vendor_classification").copy()
    c["spend"] = c["vendor_name"].map(lambda n: float(spend.get(n, 0.0)))

    pat = _oem_pattern(cfg["oem_brands"])
    sub_ids = set(d[d["vendor"].str.contains(pat)]["vendor"].map(vendor_id))
    c["substring_flag"] = c["vendor_id"].isin(sub_ids)

    is_ids = set(d[d["l2"] == "Industrial Supplies"]["vendor"].map(vendor_id))

    web = c[c["source"] == "web"].copy()
    verified_oem = web[web["is_oem"] == True].sort_values("spend", ascending=False)            # noqa: E712
    refuted = web[web["is_oem"] == False].sort_values("spend", ascending=False)                 # candidate -> not OEM
    # knowledge-flagged is_oem but never web-verified (capped) — UNVERIFIED candidates, not confirmed
    unverified = c[(c["source"] == "knowledge") & (c["is_oem"] == True)].sort_values("spend", ascending=False)

    # honest reconciliation: TRUSTWORTHY = web-confirmed only; knowledge is_oem are candidates
    def _sp(df):
        return float(df["vendor_name"].map(lambda n: float(spend.get(n, 0.0))).sum())
    voem_is = verified_oem[verified_oem["vendor_id"].isin(is_ids)]
    unv_is = unverified[unverified["vendor_id"].isin(is_ids)]
    stats = {
        "web_calls": int(len(web)), "web_oem": int(len(verified_oem)), "web_refuted": int(len(refuted)),
        "web_oem_spend_mro": _sp(verified_oem), "unverified_candidates": int(len(unverified)),
        "is_anchor_n": 16, "is_anchor_spend": 2018901.0,
        "is_web_oem_n": int(len(voem_is)), "is_web_oem_spend": _sp(voem_is),
        "is_unverified_n": int(len(unv_is)),
    }
    return io, c, spend, sub_ids, verified_oem, refuted, unverified, stats


def main():
    rpt = json.load(open(REPORT)) if os.path.exists(REPORT) else {}
    io, c, spend, sub_ids, verified_oem, refuted, unverified, st = gather()
    rec = rpt.get("reconciliation", {})
    oem_spend = float(verified_oem["spend"].sum())
    wb = Workbook()

    # ---- Scorecard ----
    ws = wb.active; ws.title = "Summary"; ws.sheet_view.showGridLines = False
    _s(ws, "A1", "OEM Verification — why each supplier is (or isn't) an OEM", H1)
    _s(ws, "A2", "Setup-time, citation-backed. is_oem = TRUE only for original manufacturers whose proprietary spares are "
                 "SOLE-SOURCE (blocks consolidation). Knowledge pass flags candidates; web-verify (web_search) confirms with a "
                 "citation. The engine keeps the validated substring anchor until you sign off on this set.", GREY)
    rows = [
        ("Candidates flagged (knowledge ∪ substring)", f"{rpt.get('mro_vendors','?')} MRO vendors → 162 OEM candidates", None),
        ("Web-verified (top by spend, capped 80)", f"{st['web_calls']} verified with citations · {st['unverified_candidates']} smaller candidates still UNVERIFIED", None),
        ("✓ CONFIRMED OEM (web + citation) — trustworthy", f"{st['web_oem']} vendors · ${st['web_oem_spend_mro']:,.0f} MRO spend", True),
        ("✓ Refuted — candidate cleared to non-OEM", f"{st['web_refuted']} vendors (incl. Cline $8.34M, Babbal — back to consolidatable)", True),
        ("IS anchor — substring baseline (validated)", f"{st['is_anchor_n']} OEM / ${st['is_anchor_spend']:,.0f}", True),
        ("⚠ IS — web-confirmed OEM (the finding)", f"{st['is_web_oem_n']} OEM / ${st['is_web_oem_spend']:,.0f} — name-list UNDER-counted; this REDUCES IS movable", False),
        ("Knowledge-only candidates — UNVERIFIED (review queue)", f"{st['unverified_candidates']} MRO ({st['is_unverified_n']} in IS) — NOT confirmed; sweep in follow-up", None),
        ("Action — layering into M7", "needs sign-off + re-run: larger OEM carve-out lowers movable below $11.888M", None),
    ]
    r = 4
    for k, v, ok in rows:
        _s(ws, f"A{r}", k, H2, border=True); _s(ws, f"B{r}", v, MONO, border=True)
        cc = _s(ws, f"C{r}", ("PASS" if ok else ("—" if ok is None else "REVIEW")), border=True, align=C)
        cc.font = PASS_FONT if ok else (GREY if ok is None else WARN_FONT)
        if ok: cc.fill = PASS_FILL
        r += 1
    ws.column_dimensions["A"].width = 40; ws.column_dimensions["B"].width = 62; ws.column_dimensions["C"].width = 10

    # ---- Verified OEM (the WHY) ----
    ws2 = wb.create_sheet("Verified OEM — why"); ws2.sheet_view.showGridLines = False
    _s(ws2, "A1", "Confirmed OEM — evidence + citation behind each verdict", H1)
    _s(ws2, "A2", "These carve out of consolidation (sole-source). Each row is web-verified with the reasoning + source URL.", GREY)
    heads = ["Vendor", "MRO spend $", "OEM brand", "Capability", "Conf.", "Why (evidence)", "Citation"]
    widths = [30, 14, 18, 12, 7, 60, 40]
    for i, h in enumerate(heads):
        _s(ws2, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, WRAPL, True)
    r = 5
    for _, v in verified_oem.iterrows():
        _s(ws2, f"A{r}", v["vendor_name"], None, align=WRAP, border=True)
        _s(ws2, f"B{r}", f"${v['spend']:,.0f}", MONO, align=R, border=True)
        _s(ws2, f"C{r}", v["oem_brand"] or "—", None, align=WRAP, border=True)
        _s(ws2, f"D{r}", v["capability_class"] or "—", None, align=WRAP, border=True)
        _s(ws2, f"E{r}", f"{float(v['confidence']):.2f}", MONO, align=C, border=True)
        _s(ws2, f"F{r}", v["evidence"] or "", None, align=WRAP, border=True)
        _s(ws2, f"G{r}", v["citation_url"] or "—", GREY, align=WRAP, border=True)
        r += 1
    for i, w in enumerate(widths):
        ws2.column_dimensions[chr(65 + i)].width = w

    # ---- Refuted candidates ----
    ws3 = wb.create_sheet("Refuted — not OEM"); ws3.sheet_view.showGridLines = False
    _s(ws3, "A1", "Refuted — flagged as a candidate, verified NOT an OEM", H1)
    _s(ws3, "A2", "Distributors, tooling-through-distribution, consumables makers, name false-positives. This spend stays "
                  "consolidatable — the web-verify is what frees it.", GREY)
    for i, h in enumerate(["Vendor", "MRO spend $", "Name-match?", "Conf.", "Why not an OEM", "Citation"]):
        _s(ws3, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, WRAPL, True)
    r = 5
    for _, v in refuted.iterrows():
        _s(ws3, f"A{r}", v["vendor_name"], None, align=WRAP, border=True)
        _s(ws3, f"B{r}", f"${v['spend']:,.0f}", MONO, align=R, border=True)
        _s(ws3, f"C{r}", "yes" if v["substring_flag"] else "no", None, align=C, border=True)
        _s(ws3, f"D{r}", f"{float(v['confidence']):.2f}", MONO, align=C, border=True)
        _s(ws3, f"E{r}", v["evidence"] or "", None, align=WRAP, border=True)
        _s(ws3, f"F{r}", v["citation_url"] or "—", GREY, align=WRAP, border=True)
        r += 1
    for col, w in {"A": 30, "B": 14, "C": 12, "D": 7, "E": 60, "F": 40}.items():
        ws3.column_dimensions[col].width = w

    # ---- Unverified tail ----
    if len(unverified):
        ws4 = wb.create_sheet("Unverified tail (capped)"); ws4.sheet_view.showGridLines = False
        _s(ws4, "A1", "Knowledge-flagged OEM candidates not web-verified (spend tail, capped)", H1)
        _s(ws4, "A2", "Kept their unverified knowledge flag. Immaterial to movable; sweepable in a cheap follow-up run.", GREY)
        for i, h in enumerate(["Vendor", "MRO spend $", "OEM brand", "Conf."]):
            _s(ws4, f"{chr(65+i)}4", h, HEAD, HEAD_FILL, WRAPL, True)
        r = 5
        for _, v in unverified.iterrows():
            _s(ws4, f"A{r}", v["vendor_name"], None, align=WRAP, border=True)
            _s(ws4, f"B{r}", f"${v['spend']:,.0f}", MONO, align=R, border=True)
            _s(ws4, f"C{r}", v["oem_brand"] or "—", None, border=True)
            _s(ws4, f"D{r}", f"{float(v['confidence']):.2f}", MONO, align=C, border=True); r += 1
        for col, w in {"A": 34, "B": 14, "C": 18, "D": 7}.items():
            ws4.column_dimensions[col].width = w

    os.makedirs("reports", exist_ok=True)
    wb.save(OUT)
    html = render_html(rpt, st, verified_oem, refuted, unverified, oem_spend)
    print(f"wrote {OUT}")
    print(f"  confirmed OEM (web): {st['web_oem']} (${st['web_oem_spend_mro']:,.0f})  refuted: {st['web_refuted']}  unverified candidates: {st['unverified_candidates']}")
    print(f"  IS: anchor 16/$2.02M  vs  web-confirmed {st['is_web_oem_n']}/${st['is_web_oem_spend']:,.0f}")
    print(f"wrote {html}")


def render_html(rpt, st, verified_oem, refuted, unverified, oem_spend):
    def esc(s): return _html.escape(str(s) if s is not None else "")
    def cite(u):
        u = str(u or "")
        return f"<a href='{esc(u)}' target='_blank'>source</a>" if u.startswith("http") else "<span class='muted'>—</span>"
    oem_rows = "".join(
        f"<tr><td>{esc(v['vendor_name'])}</td><td class='mono'>${v['spend']:,.0f}</td>"
        f"<td>{esc(v['oem_brand'] or '—')}</td><td><span class='tag'>{esc(v['capability_class'] or '—')}</span></td>"
        f"<td class='mono c'>{float(v['confidence']):.2f}</td><td class='why'>{esc(v['evidence'])}</td>"
        f"<td class='c'>{cite(v['citation_url'])}</td></tr>"
        for _, v in verified_oem.iterrows())
    ref_rows = "".join(
        f"<tr><td>{esc(v['vendor_name'])}</td><td class='mono'>${v['spend']:,.0f}</td>"
        f"<td class='c'>{'name-match' if v['substring_flag'] else 'knowledge'}</td>"
        f"<td class='why'>{esc(v['evidence'])}</td><td class='c'>{cite(v['citation_url'])}</td></tr>"
        for _, v in refuted.iterrows())
    repl = {
        "%%NOEM%%": str(st["web_oem"]), "%%OEMSPEND%%": f"${st['web_oem_spend_mro']/1e6:.2f}M",
        "%%NREF%%": str(st["web_refuted"]), "%%NTAIL%%": str(st["unverified_candidates"]),
        "%%ISSUB%%": f"{st['is_anchor_n']} / ${st['is_anchor_spend']/1e6:.2f}M",
        "%%ISVER%%": f"{st['is_web_oem_n']} / ${st['is_web_oem_spend']/1e6:.2f}M",
        "%%ANCHORCLS%%": "review", "%%ANCHORTXT%%": "REVIEW — sign-off",
        "%%OEMROWS%%": oem_rows, "%%REFROWS%%": ref_rows,
    }
    page = _TPL
    for k, v in repl.items():
        page = page.replace(k, v)
    os.makedirs(os.path.dirname(SCORECARD_HTML), exist_ok=True)
    with open(SCORECARD_HTML, "w") as f:
        f.write(page)
    return SCORECARD_HTML


_TPL = """<title>OEM Verification — why each supplier is an OEM · Navanta Lens Engine</title>
<meta name="description" content="Citation-backed OEM verification: the confirmed OEM set with the evidence + source behind each verdict, refuted candidates, and the Industrial Supplies anchor reconciliation.">
<style>
  :root{--ink:#18181b;--ink-2:#52525c;--ink-3:#71717a;--border:#e4e4e7;--line:#f4f4f5;--bg:#fafafa;--card:#fff;
    --ok-bg:#ecfef3;--ok-fg:#008234;--warn-bg:#fffbea;--warn-fg:#9e3900;--info-bg:#f0f9ff;--info-fg:#005b89;--brand:#6a3ebd;--brand-50:#f7f2ff;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;}
  .wrap{max-width:1140px;margin:0 auto;padding:40px 32px 64px;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;} .c{text-align:center;} .muted{color:var(--ink-3);}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 4px;} .sub{color:var(--ink-2);font-size:15px;max-width:74ch;} .asof{color:var(--ink-3);font-size:13px;margin-top:4px;}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap;margin-bottom:24px;}
  .gate{display:flex;flex-direction:column;align-items:flex-end;gap:6px;}
  .gate-pill{display:inline-flex;align-items:center;gap:8px;background:var(--ok-bg);color:var(--ok-fg);font-weight:600;font-size:14px;padding:9px 16px;border-radius:999px;border:1px solid #b7f0cd;}
  .gate-pill.review{background:var(--warn-bg);color:var(--warn-fg);border-color:#f5d99a;} .gate-label{font-size:12px;color:var(--ink-3);text-transform:uppercase;letter-spacing:.06em;}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:14px;}
  .kpi{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px;} .kpi .k{font-size:12px;color:var(--ink-2);} .kpi .v{font-family:var(--mono);font-variant-numeric:tabular-nums;font-size:22px;font-weight:600;margin-top:8px;letter-spacing:-.02em;}
  .sec{margin:28px 0 12px;display:flex;align-items:baseline;gap:10px;} .sec h2{font-size:18px;font-weight:600;margin:0;} .sec .hint{font-size:13px;color:var(--ink-3);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:14px;overflow:hidden;} .scroll{overflow-x:auto;}
  table{border-collapse:collapse;width:100%;font-size:13px;}
  thead th{background:#fbfbfc;color:var(--ink-2);font-weight:600;font-size:11px;letter-spacing:.03em;text-transform:uppercase;text-align:left;padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap;}
  tbody td{padding:9px 12px;border-bottom:1px solid var(--line);vertical-align:top;} tbody tr:last-child td{border-bottom:none;}
  td.mono{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;} td.c{text-align:center;} td.why{color:var(--ink-2);font-size:12.5px;max-width:42ch;}
  .tag{font-weight:600;font-size:11px;padding:2px 8px;border-radius:6px;background:var(--brand-50);color:var(--brand);}
  a{color:var(--info-fg);} a:hover{text-decoration:underline;}
  .note{display:flex;gap:13px;background:var(--info-bg);border:1px solid #cfe8f5;border-radius:12px;padding:16px 18px;margin-top:18px;} .note .mark{color:var(--info-fg);font-weight:700;} .note p{margin:0;font-size:13px;color:#0a4f6e;} .note b{color:#05405a;}
  footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--border);font-size:13px;color:var(--ink-3);}
</style>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">Navanta Lens · Setup-time verification</div>
      <h1>OEM Verification — why each supplier is an OEM</h1>
      <div class="sub">Citation-backed. <b>is_oem = TRUE only</b> when a supplier is the original manufacturer of equipment whose proprietary spares are <b>sole-source</b> — which blocks consolidation. Everything else (distributors, tooling sold through distribution, consumables makers) stays consolidatable. The engine keeps the validated anchor until you sign off on this set.</div>
      <div class="asof">Run 2026-06-29 · MRO scope · web_search-verified · model claude-opus-4-8</div>
    </div>
    <div class="gate"><span class="gate-label">Status</span><span class="gate-pill %%ANCHORCLS%%"><span>%%ANCHORTXT%%</span></span></div>
  </header>
  <div class="kpis">
    <div class="kpi"><div class="k">Confirmed OEM</div><div class="v">%%NOEM%%</div></div>
    <div class="kpi"><div class="k">OEM spend (carve-out)</div><div class="v">%%OEMSPEND%%</div></div>
    <div class="kpi"><div class="k">Refuted → consolidatable</div><div class="v">%%NREF%%</div></div>
    <div class="kpi"><div class="k">Unverified tail (capped)</div><div class="v">%%NTAIL%%</div></div>
  </div>

  <div class="sec"><h2>Confirmed OEM — the evidence</h2><span class="hint">sole-source · carves out of consolidation</span></div>
  <div class="card scroll"><table>
    <thead><tr><th>Vendor</th><th class="c">MRO spend</th><th>OEM brand</th><th>Capability</th><th class="c">Conf.</th><th>Why (evidence)</th><th class="c">Cite</th></tr></thead>
    <tbody>%%OEMROWS%%</tbody>
  </table></div>

  <div class="sec"><h2>Refuted — flagged, but verified NOT an OEM</h2><span class="hint">this spend stays consolidatable</span></div>
  <div class="card scroll"><table>
    <thead><tr><th>Vendor</th><th class="c">MRO spend</th><th class="c">Flagged by</th><th>Why not an OEM</th><th class="c">Cite</th></tr></thead>
    <tbody>%%REFROWS%%</tbody>
  </table></div>

  <div class="note"><span class="mark">&#8505;</span>
    <p><b>The finding — and the decision it forces.</b> The knowledge pass casts a wide net (162 candidates) on purpose: over-flagging is cheap, missing a real OEM is not. The web-verify pass is the truth layer — it confirms <b>%%NOEM%% genuine sole-source OEMs</b> (%%OEMSPEND%% across MRO) with citations and clears %%NREF%% candidates back to consolidatable (incl. Cline Tool's $8.34M and the "Babbal"=ABB name false-positive). <b>The important part:</b> the original name-list <b>under-counted</b> OEMs badly. In Industrial Supplies the web-confirmed set is <b>%%ISVER%%</b> vs the substring anchor's <b>%%ISSUB%%</b> — a much larger OEM carve-out. Layering this into M7 therefore <b>reduces</b> IS movable below the $11,888,233 anchor (more spend is non-consolidatable). That's a <b>sign-off + re-run</b> decision, not automatic — until then the engine keeps the validated substring anchor. The %%NTAIL%% knowledge-only candidates were not web-verified (capped by spend) and remain a review queue, <b>not</b> confirmed.</p>
  </div>
  <footer>opp.vendor_classification — is_oem · oem_brand · capability_class · confidence · evidence · citation_url · source · model. Cached at setup; the deterministic engine reads the cache (no live calls at analysis time).</footer>
</div>
"""


if __name__ == "__main__":
    main()
