# As-deployed snapshot (v1 baseline)

Self-contained HTML snapshots of the original deployed build (`claude/allison-procurement-access-kelgwt`,
commit `7499a5f` + synthetic demo data loaded per `scripts/gen_synthetic_bronze.py`), captured for
side-by-side comparison against later design iterations (e.g. `design/navanta_lens_prototype_v2.html`
on `claude/new-session-9dp23v`).

Each file is fully self-contained — CSS and images inlined, no server/DB required. Open directly in
a browser. JS is stripped since these are static design snapshots, not interactive prototypes; the
live app is interactive at runtime.

- `dashboard.html` — Command Center
- `opportunities.html` — Opportunity Feed
- `vendors.html` — Vendor Management
- `methodology.html` — Methodology & Parameters
- `tracking.html` — Value Realization

Data shown is synthetic (randomly generated) demo data, not real Allison figures.
