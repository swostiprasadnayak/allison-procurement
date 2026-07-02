# Navanta Lens — Console (Frontend)

The Next.js console for the Navanta Lens "Category & Opportunity Management" module, proven on
Allison Transmission's MRO spend. It reads the CDM (the engine's Gold `opp.*` / `cim.*` / `ref.*`
tables) and renders the operating surfaces + the Mercer copilot.

> **Monorepo.** This is the `frontend/` of `Navanta-AI/allison-procurement`; the analysis **engine +
> copilot core** at the repo root produces the Gold tables this app reads and hosts the copilot API.

## Pages

- **Command Center** — program roll-up (live synthesis, KPIs, estate scan).
- **Opportunity Feed** — triage queue (approve / park / reject / commit; write-back persists).
- **Vendors** — supplier roster (sourcing role, spend, AT+AOH overlap, illustrative performance).
- **Value Realization** — committed plays, RAG health, realized-% (ERP-fed).
- **Admin › Methodology & Parameters** — the engine's decision logic explained + a live, editable
  registry of `opp.engine_parameter` (numeric dials editable, save-only; structural params read-only).
- **Mercer copilot** — context-aware, cited answers on every page.

## Architecture

```
Next.js (this repo) ──/api/*──▶ Postgres CDM (local; Lakebase in prod)
                     ──/api/copilot──▶ copilot_api (Python FastAPI, engine repo) ──▶ Claude
```

- API route handlers (`src/app/api/*`) query Postgres via `src/lib/db.ts`; data access is in
  `src/lib/cdm.ts`. The browser never touches the DB or the LLM.
- The copilot panel posts a `view_context` (page + entity in view) to `/api/copilot`, which proxies to
  the Python `copilot_api` service.
- UI is built entirely on `@navanta-ai/design-system`.

## Prerequisites

The engine repo must be set up and its serving layer running:

```bash
# in the engine repo (Navanta-AI/allison-procurement):
docker compose up -d                      # local Postgres CDM
python jobs/load_cdm_postgres.py          # Gold → Postgres
python -m uvicorn services.copilot_api:app --port 8000   # copilot API
```

## Run

```bash
npm install                               # needs .npmrc for the @navanta-ai package scope
cp .env.local.example .env.local          # set DATABASE_URL (+ copilot API URL if not localhost:8000)
npm run dev                               # http://localhost:3000
npx tsc --noEmit -p tsconfig.json         # typecheck
```

`.env.local`: `DATABASE_URL` (the Postgres CDM connection). `.npmrc` authenticates the `@navanta-ai`
GitHub Packages scope via `${GITHUB_TOKEN}`. Both are gitignored.

## Confidential data — never committed

The app reads **all** real Allison figures from the Postgres CDM **at runtime** — none live in the
repo. `.gitignore` blocks `.env*.local`, `.npmrc`, and `src/data/fixtures/` (engine-generated
fixtures with real vendor names/spend). `src/data/taxonomy.ts` holds only category labels (no spend,
no vendor names). Do not add static files containing client spend or vendor names — read from the CDM.
