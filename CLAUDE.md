# CLAUDE.md — SignalStudio repository guide

This is a **frontend-centered React/Vite workspace for _designing_ signals**, backed by a small Python service that provides persistence and APIs for the design. The React app (`src/`, `@xyflow/react` graph) is where the work happens; `server/app.py` stores the model in SQLite and serves it over `/api`.

This repository organizes the **design** of signals: signal definitions, the input data they need, field mappings, calculations and trigger rules, output contracts, and validation plans. It does **not** execute or implement signals. Running crawlers, computing metrics, evaluating triggers, and producing validated results belong to a separate implementation repository (e.g. Few Understand). Nothing here proves a signal has run.

## What to care about when changing the frontend

- Preserve information hierarchy: field cards near the top of a node panel, design ideas after the field list.
- Keep the graph, table, and detail views consistent — they read the same persisted model and must agree.
- Favor readability and clear interactions over visual novelty.
- Do **not** casually rearrange the UI, and do **not** present design plans as validated results. A hypothesis is not a validated signal.

## Design vs. reality — keep these distinct

- The app-owned contract `catalog/source-contracts.v1.json` declares **desired upstream fields**. A declared field, sample path, or test fixture is a contract lower bound, **not** proof that a crawler emitted that record.
- Real collected records and validated signal results come only from execution lineage (observation/message IDs, run/version, topic/offset, generated result IDs) reported by the implementing platform. Never invent records or describe illustrative values as observations.
- Label upstream API samples as such; keep design plans, upstream examples, crawler observations, and validated signals distinct in both code and UI.

## Authoritative signal-design documents

Read these before signal-design changes; link to them by path rather than restating them:

- `docs/PRODUCT_WORKFLOW.md` — the product specification for the signal-design experience.
- `docs/SIGNAL_EXECUTION_CONTRACT.md` — the versioned, machine-readable signal package (required behavior vs. preferred implementation).
- `docs/ASSET_MODEL.md` — proposed business data model (design proposal, not deployed tables).
- `docs/SOURCE_FIELD_AUDIT.md`, `docs/SOURCE_INPUT_AUDIT.md` — per-upstream field and input-parameter audits.
- `docs/FEWUNDERSTAND_INTEGRATION.md` — how the implementing crawler consumes the contract and reports evidence back.
- `docs/IMPLEMENTATION_PLAN.md` — architectural decisions and staged plan.
- `AGENTS.md` — repository working agreement.

## Development and verification commands

```bash
npm install
npm run dev      # Vite + python3 server/app.py (API on :8787, UI on :5173)
npm run build    # production build
npm run preview  # single-server build via python3 server/app.py

# checks
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s server -p 'test_*.py'
npm run test:layout
npm run build
```

Requires Node.js 22+ and Python 3.9+. Report any check you could not run and why.

## Boundaries

- Touch only the files needed for the accepted task. Do not rearrange or refactor unrelated code, docs, or config.
- Work inside this assigned worktree only. Do not edit other worktrees or absorb another checkout's unfinished changes.
- Do not add secrets. Model access keys (e.g. `OPENAI_API_KEY`) stay in the server environment, never in the repository.
