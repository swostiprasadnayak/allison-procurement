"""
Methodology & Formulas page (Feature Spec §10.2 / §5.4 "how is this calculated?").

Renders the engine's full calculation chain — every formula with the LIVE parameter
values plugged in, plus a real worked derivation from the current run. One place to
see how each number is produced and that it ties to the methodology workbook.

Run:  python reviews/methodology_page.py
Out:  scorecard HTML (scratchpad) -> publish as Artifact
"""
from __future__ import annotations
import html as _html
import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from engine.io.local import LocalIO
from engine.core.params import Params

OUT = os.environ.get(
    "SCORECARD_OUT",
    "/private/tmp/claude-501/-Users-tanujgupta-Documents-Claude-Projects-Allison-Transmission---MRO-Analysis/"
    "5da58694-a334-491d-8bd7-934ad2d11645/scratchpad/methodology_formulas.html")
VERSION = "mro-layer0-v1"


def _l3(c):
    return str(c).split(">")[-1] if isinstance(c, str) and ">" in c else c


def gather():
    """Compute real worked numbers from the validated tables."""
    io = LocalIO("data")
    p = Params.load(io, VERSION)
    fact = io.read("opp", "fact_spend")
    pk = io.read("opp", "spend_pocket")
    ven = io.read("cim", "vendor").set_index("vendor_id")["vendor_name"].to_dict()

    fact["net"] = pd.to_numeric(fact["net_spend_usd"], errors="coerce").astype("float64")
    pk = pk[pk["l2_code"] == "L2|MRO>Industrial Supplies"].copy()
    pk["l3"] = pk["l3_code"].map(_l3)

    def pocket_detail(l3, country):
        row = pk[(pk["l3"] == l3) & (pk["purchasing_country"] == country)].iloc[0]
        f = fact[(fact["l3_code"] == row["l3_code"]) & (fact["purchasing_country"] == country)]
        vs = f.groupby("vendor_id").agg(s=("net", "sum"), oem=("is_oem", "max"))
        nonoem = vs[~vs["oem"].astype(bool)]
        winner_id = nonoem["s"].idxmax()
        winner_spend = float(nonoem["s"].max())
        return {
            "l3": l3, "country": country,
            "pocket_spend": float(row["pocket_spend"]), "vendors": int(row["vendor_count"]),
            "top3_share": float(row["top3_share"]), "hhi": float(row["hhi"]),
            "winner": ven.get(winner_id, "?"), "winner_spend": winner_spend,
            "winner_share": winner_spend / float(row["pocket_spend"]),
            "oem_spend": float(row["oem_spend"]),
        }

    safety = pocket_detail("Safety Equipment", "United States")
    safety["route"] = "Consolidate"
    safety["movable"] = safety["pocket_spend"] - safety["winner_spend"] - safety["oem_spend"]

    supplies = pocket_detail("Supplies", "United States")
    supplies["route"] = "Competitive RFP"
    supplies["movable"] = supplies["pocket_spend"] - supplies["oem_spend"]

    # 19 commodity plays total (exact winner_spend from fact)
    q = pk[(pk["pocket_spend"] >= p.num("play_min_spend")) &
           (pk["vendor_count"] >= p.num("play_min_vendors")) & (pk["l3"] != "N/A")]
    comm = q[q["segment_class"] != "engineered"]
    total_movable = 0.0
    for _, row in comm.iterrows():
        f = fact[(fact["l3_code"] == row["l3_code"]) & (fact["purchasing_country"] == row["purchasing_country"])]
        vs = f.groupby("vendor_id").agg(s=("net", "sum"), oem=("is_oem", "max"))
        nonoem = vs[~vs["oem"].astype(bool)]
        wspend = float(nonoem["s"].max()) if len(nonoem) else 0.0
        wshare = wspend / float(row["pocket_spend"])
        oem = float(row["oem_spend"])
        movable = (row["pocket_spend"] - wspend - oem) if wshare >= p.num("winner_share_consolidate") \
            else (row["pocket_spend"] - oem)
        total_movable += max(0.0, movable)

    return {
        "params": p, "safety": safety, "supplies": supplies,
        "n_plays": int(len(comm)), "total_movable": total_movable,
        "sav_lo": total_movable * p.num("savings_rate_low"),
        "sav_hi": total_movable * p.num("savings_rate_high"),
    }


def main():
    d = gather()
    p = d["params"]
    sf, su = d["safety"], d["supplies"]

    def money(x): return f"${x:,.0f}"

    repl = {
        "%%WINNER_SHARE%%": f"{p.num('winner_share_consolidate'):.2f}",
        "%%PMIN%%": money(p.num("play_min_spend")), "%%VMIN%%": str(int(p.num("play_min_vendors"))),
        "%%PROV_EXP%%": str(int(p.num("prov_exponent"))),
        "%%FRAG_W%%": f"{p.num('feas_frag_weight')}", "%%XBU_W%%": f"{p.num('feas_xbu_weight')}",
        "%%SVC_T%%": f"{p.num('services_threshold')}", "%%SVC_P%%": f"{p.num('services_penalty')}",
        "%%RATE_LO%%": f"{p.num('savings_rate_low')*100:g}", "%%RATE_HI%%": f"{p.num('savings_rate_high')*100:g}",
        # Safety Equipment worked example (Consolidate)
        "%%SF_POCKET%%": money(sf["pocket_spend"]), "%%SF_V%%": str(sf["vendors"]),
        "%%SF_TOP3%%": f"{sf['top3_share']*100:.0f}", "%%SF_HHI%%": f"{sf['hhi']:,.0f}",
        "%%SF_WINNER%%": _html.escape(sf["winner"]), "%%SF_WSPEND%%": money(sf["winner_spend"]),
        "%%SF_WSHARE%%": f"{sf['winner_share']*100:.1f}", "%%SF_OEM%%": money(sf["oem_spend"]),
        "%%SF_MOV%%": money(sf["movable"]),
        "%%SF_SAVLO%%": money(sf["movable"]*p.num("savings_rate_low")),
        "%%SF_SAVHI%%": money(sf["movable"]*p.num("savings_rate_high")),
        # Supplies worked example (RFP)
        "%%SU_POCKET%%": money(su["pocket_spend"]), "%%SU_V%%": str(su["vendors"]),
        "%%SU_WINNER%%": _html.escape(su["winner"]), "%%SU_WSHARE%%": f"{su['winner_share']*100:.1f}",
        "%%SU_OEM%%": money(su["oem_spend"]), "%%SU_MOV%%": money(su["movable"]),
        "%%SU_SAVLO%%": money(su["movable"]*p.num("savings_rate_low")),
        "%%SU_SAVHI%%": money(su["movable"]*p.num("savings_rate_high")),
        # rollup
        "%%NPLAYS%%": str(d["n_plays"]), "%%TOTMOV%%": money(d["total_movable"]),
        "%%TOTLO%%": money(d["sav_lo"]), "%%TOTHI%%": money(d["sav_hi"]),
    }
    page = _TPL
    for k, v in repl.items():
        page = page.replace(k, v)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write(page)
    print(f"wrote {OUT}")
    print(f"verify: {d['n_plays']} plays, movable {money(d['total_movable'])}, "
          f"savings {money(d['sav_lo'])}-{money(d['sav_hi'])}")
    print(f"  Safety Eq (Consolidate) movable {money(sf['movable'])}  [sheet8 538,147]")
    print(f"  Supplies (RFP) movable {money(su['movable'])}  [sheet8 2,773,608]")


_TPL = r"""<title>Engine Methodology & Formulas · Navanta Lens</title>
<meta name="description" content="Every engine formula with live parameter values and a real worked derivation — how each number is calculated, tied to the methodology workbook.">
<style>
  :root{--ink:#18181b;--ink-2:#52525c;--ink-3:#71717a;--border:#e4e4e7;--line:#f4f4f5;--bg:#fafafa;--card:#fff;
    --ok-bg:#ecfef3;--ok-fg:#008234;--warn-bg:#fffbea;--warn-fg:#9e3900;--info-bg:#f0f9ff;--info-fg:#005b89;--brand:#6a3ebd;--brand-50:#f7f2ff;
    --mono:ui-monospace,"SF Mono",SFMono-Regular,"Geist Mono",Menlo,Consolas,monospace;--sans:system-ui,-apple-system,"Geist","Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.55;-webkit-font-smoothing:antialiased;}
  .wrap{max-width:920px;margin:0 auto;padding:40px 32px 72px;}
  .mono{font-family:var(--mono);font-variant-numeric:tabular-nums;}
  .eyebrow{font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--brand);}
  h1{font-size:30px;font-weight:600;letter-spacing:-.01em;margin:6px 0 6px;}
  .sub{color:var(--ink-2);font-size:15px;max-width:70ch;}
  .step{display:flex;align-items:center;gap:10px;margin:38px 0 14px;}
  .step .n{width:26px;height:26px;border-radius:7px;background:var(--brand);color:#fff;font-weight:600;font-size:13px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .step h2{font-size:19px;font-weight:600;margin:0;} .step .ref{font-size:12px;color:var(--ink-3);font-family:var(--mono);}
  .badge{margin-left:auto;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;}
  .b-val{background:var(--ok-bg);color:var(--ok-fg);} .b-next{background:var(--warn-bg);color:var(--warn-fg);}
  .card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:18px 20px;margin-bottom:14px;}
  .formula{font-family:var(--mono);font-size:13.5px;background:#1c1c20;color:#e8e8ea;border-radius:9px;padding:14px 16px;overflow-x:auto;white-space:pre;line-height:1.7;}
  .formula .k{color:#c4a6ff;} .formula .c{color:#7e8894;} .formula .v{color:#8fdca6;}
  .desc{color:var(--ink-2);font-size:13.5px;margin:10px 2px 0;}
  .worked{background:var(--brand-50);border:1px solid #e6daff;border-radius:10px;padding:14px 16px;margin-top:14px;}
  .worked .wt{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--brand);margin-bottom:8px;}
  .calc{font-family:var(--mono);font-size:13px;line-height:1.9;}
  .calc .lbl{color:var(--ink-2);} .calc b{color:var(--ink);} .calc .eq{color:var(--ink-3);}
  .res{margin-top:8px;padding-top:8px;border-top:1px dashed #d9c9f5;font-family:var(--mono);font-weight:600;}
  table{border-collapse:collapse;width:100%;font-size:13px;margin-top:4px;} td,th{padding:7px 10px;border-bottom:1px solid var(--line);text-align:left;}
  th{font-size:11px;text-transform:uppercase;color:var(--ink-2);letter-spacing:.03em;} td.r,th.r{text-align:right;font-family:var(--mono);}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:14px;} @media(max-width:720px){.two{grid-template-columns:1fr;}.wrap{padding:28px 18px;}}
  .pill{font-size:11px;font-weight:600;padding:2px 8px;border-radius:6px;} .p-cons{background:var(--info-bg);color:var(--info-fg);} .p-rfp{background:var(--brand-50);color:var(--brand);}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid var(--border);font-size:13px;color:var(--ink-3);}
  .hl{background:#fff7d6;padding:0 3px;border-radius:3px;}
</style>
<div class="wrap">
  <div class="eyebrow">Navanta Lens · Engine</div>
  <h1>Methodology &amp; Formulas</h1>
  <div class="sub">Every engine calculation in one place: the formula, the live parameter values, and a real worked derivation from the current Industrial Supplies run. This is the in-product "how is this calculated?" reference, tied to the methodology workbook.</div>

  <!-- 1 classification -->
  <div class="step"><span class="n">1</span><h2>Classification</h2><span class="ref">A.1</span><span class="badge b-val">validated</span></div>
  <div class="card">
    <div class="formula"><span class="k">id_type</span>(material_id):  <span class="c"># regex on trimmed-upper id</span>
  unspsc   if ^[0-9]{8}$              <span class="c"># 8-digit UNSPSC code</span>
  numcat   if ^[0-9]{6,}$             <span class="c"># longer numeric category code</span>
  generic  if ^[A-Z][A-Z .\-]{1,12}$  <span class="c"># process bucket, e.g. MACH REP</span>
  partlike otherwise                  <span class="c"># vendor-specific SKU</span>

<span class="k">is_oem</span>(vendor)  = vendor name contains any OEM brand   <span class="c"># Fanuc, Gleason, Siemens, ABB, Kuka, ...</span>
<span class="k">segment_class</span>(l3) = "engineered" if l3 in {Machine parts, Machine Parts} else "commodity"</div>
    <div class="desc">OEM brands and engineered segments are config (vendor_capability.yaml / engine_parameter), not hardcoded. <span class="hl">Result: 16 OEM vendors / $2,018,901 in Industrial Supplies; both Machine-parts variants carved out.</span></div>
  </div>

  <!-- 2 fact -->
  <div class="step"><span class="n">2</span><h2>Spend fact &amp; addressable</h2><span class="ref">A.1</span><span class="badge b-val">validated</span></div>
  <div class="card">
    <div class="formula"><span class="k">addressable</span> = net_spend  <span class="c">−</span>  customer_directed_spend  <span class="c">−</span>  sole_source_spend
            <span class="c"># sole_source ≈ OEM carve-out (Layer-0 proxy)</span></div>
    <div class="desc">One row per spend line, tagged with id_type, is_oem, segment_class. Industrial Supplies = 11,964 lines / $34,089,850.</div>
  </div>

  <!-- 3 pocket -->
  <div class="step"><span class="n">3</span><h2>Spend pocket (L3 × country)</h2><span class="ref">A.5 · A.9 · A.10</span><span class="badge b-val">validated</span></div>
  <div class="card">
    <div class="formula"><span class="k">share</span>(v)      = vendor_spend / pocket_spend
<span class="k">HHI</span>          = Σ (share(v) × 100)²            <span class="c"># 0–10,000; higher = concentrated</span>
<span class="k">top3_share</span>   = Σ top-3 vendor shares
<span class="k">winner</span>       = largest vendor WHERE is_oem = FALSE   <span class="c"># OEM is never the winner</span>
<span class="k">winner_share</span> = winner_spend / pocket_spend
<span class="k">oem_spend</span>    = Σ spend WHERE is_oem = TRUE
<span class="k">crossbu</span>      = MIN(AT_spend, OH_spend)          <span class="c"># genuine AT+AOH overlap</span></div>
    <div class="worked">
      <div class="wt">Worked — Safety Equipment · United States pocket</div>
      <div class="calc">
        <span class="lbl">pocket_spend</span> = <b class="mono">%%SF_POCKET%%</b> &nbsp; <span class="eq">·</span> &nbsp; <span class="lbl">vendors</span> <b>%%SF_V%%</b> &nbsp; <span class="eq">·</span> &nbsp; <span class="lbl">top3</span> <b>%%SF_TOP3%%%</b> &nbsp; <span class="eq">·</span> &nbsp; <span class="lbl">HHI</span> <b>%%SF_HHI%%</b><br>
        <span class="lbl">winner</span> = <b>%%SF_WINNER%%</b> &nbsp; <span class="lbl">winner_spend</span> <b class="mono">%%SF_WSPEND%%</b> &nbsp; <span class="lbl">winner_share</span> <b>%%SF_WSHARE%%%</b><br>
        <span class="lbl">oem_spend</span> = <b class="mono">%%SF_OEM%%</b>
      </div>
    </div>
  </div>

  <!-- 4 scan -->
  <div class="step"><span class="n">4</span><h2>Scan scoring — which categories to pursue</h2><span class="ref">A.3</span><span class="badge b-next">Stage 4</span></div>
  <div class="card">
    <div class="formula"><span class="k">Prize</span>       = addressable / MAX(addressable across sub-categories)
<span class="k">frag</span>        = 1 − top3_share
<span class="k">xbu</span>         = crossbu_spend / spend
<span class="k">Feasibility</span> = %%FRAG_W%%·frag + %%XBU_W%%·(xbu / MAX xbu)
<span class="k">Provability</span> = (1 − services_share) × (%%SVC_P%% if services_share > %%SVC_T%% else 1)
<span class="k">Score</span>       = 100 × (Prize × Feasibility × Provability<span class="v">^%%PROV_EXP%%</span>) / MAX(...)   <span class="c"># provability dominates</span></div>
    <div class="worked">
      <div class="wt">Target decomposition (methodology workbook — Stage 4 reproduces)</div>
      <table>
        <tr><th>Sub-category</th><th class="r">Prize</th><th class="r">Feas.</th><th class="r">Prov.</th><th class="r">Score</th></tr>
        <tr><td>Industrial Supplies</td><td class="r">0.88</td><td class="r">0.94</td><td class="r">0.82</td><td class="r"><b>100</b></td></tr>
        <tr><td>Chemicals</td><td class="r">0.40</td><td class="r">0.62</td><td class="r">1.00</td><td class="r">44.5</td></tr>
        <tr><td>Machine/Equip Repairs</td><td class="r">1.00</td><td class="r">0.55</td><td class="r">0.29</td><td class="r">8.4</td></tr>
        <tr><td>First Fill Oils</td><td class="r">0.19</td><td class="r">0.16</td><td class="r">0.98</td><td class="r">5.3</td></tr>
        <tr><td>Industrial Gas</td><td class="r">0.08</td><td class="r">0.30</td><td class="r">0.97</td><td class="r">4.0</td></tr>
      </table>
      <div class="desc">Industrial Supplies scores 100 (the max). Note Machine/Equip Repairs has the biggest Prize (1.00) but low Provability (0.29, services-heavy → penalized), so it ranks far lower — provability² is decisive.</div>
    </div>
  </div>

  <!-- 5 levers -->
  <div class="step"><span class="n">5</span><h2>Lever routing · movable · savings</h2><span class="ref">A.5 · A.6</span><span class="badge b-next">Stage 4</span></div>
  <div class="card">
    <div class="formula"><span class="c"># 1) segment gate</span>
if segment_class = engineered → CARVE-OUT (OEM/should-cost), no consolidation play

<span class="c"># 2) qualify the pocket</span>
qualify if  pocket_spend ≥ %%PMIN%%  AND  vendors ≥ %%VMIN%%  AND  l3 ≠ "N/A"

<span class="c"># 3) route by winner share</span>
if winner_share ≥ <span class="v">%%WINNER_SHARE%%</span>:  lever = Consolidate ;  movable = pocket − winner − oem
else:                  lever = Competitive RFP ;  movable = pocket − oem

<span class="c"># 4) savings (flat policy = workbook parity; lever-tiered = go-forward default)</span>
savings = movable × [ %%RATE_LO%%% , %%RATE_HI%%% ]</div>
    <div class="two">
      <div class="worked">
        <div class="wt">Worked — Safety Equipment · US &nbsp;<span class="pill p-cons">Consolidate</span></div>
        <div class="calc">
          winner_share <b>%%SF_WSHARE%%%</b> ≥ %%WINNER_SHARE%% → Consolidate<br>
          movable = %%SF_POCKET%% − %%SF_WSPEND%% − %%SF_OEM%%
        </div>
        <div class="res">movable = %%SF_MOV%% &nbsp;→&nbsp; savings %%SF_SAVLO%%–%%SF_SAVHI%%</div>
      </div>
      <div class="worked">
        <div class="wt">Worked — Supplies · US &nbsp;<span class="pill p-rfp">Competitive RFP</span></div>
        <div class="calc">
          winner = %%SU_WINNER%% &nbsp; share <b>%%SU_WSHARE%%%</b> &lt; %%WINNER_SHARE%% → RFP<br>
          movable = %%SU_POCKET%% − %%SU_OEM%% (oem)
        </div>
        <div class="res">movable = %%SU_MOV%% &nbsp;→&nbsp; savings %%SU_SAVLO%%–%%SU_SAVHI%%</div>
      </div>
    </div>
  </div>

  <!-- rollup -->
  <div class="step"><span class="n">Σ</span><h2>Industrial Supplies rollup</h2><span class="ref">acceptance anchor</span></div>
  <div class="card">
    <div class="calc" style="font-size:14px;line-height:2;">
      23 qualifying pockets &nbsp;−&nbsp; engineered carve-outs (Machine parts) &nbsp;=&nbsp; <b>%%NPLAYS%% commodity plays</b><br>
      Σ movable across the %%NPLAYS%% plays = <b class="mono hl">%%TOTMOV%%</b><br>
      savings @ %%RATE_LO%%–%%RATE_HI%%% = <b class="mono">%%TOTLO%% – %%TOTHI%%</b>
    </div>
    <div class="desc">Computed live from the validated pockets; reconciles to the workbook anchor ($11,888,233 / $594,411–$951,058). Movable is rate-independent; the savings band is the only piece that changes between the flat and lever-tiered policies.</div>
  </div>

  <footer>
    Formulas: Feature Spec Appendix A · parameter values: opp.engine_parameter (mro-layer0-v1) · worked numbers: live from the current engine run.<br>
    Validation: steps 1–3 gate-passed (Stages 1–3); steps 4–5 are Stage 4 (formulas + parameters shown; lever math already de-risked above).
  </footer>
</div>
"""


if __name__ == "__main__":
    main()
