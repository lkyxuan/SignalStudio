# Data Logic IDE working agreement

Read `docs/PRODUCT_WORKFLOW.md` when discussing or changing the product's signal-design experience.

- The user supplies goals, examples, posts, and judgments about what is useful. Take responsibility for field selection, joins, time windows, calculations, table design, and validation proposals. Present choices in product terms rather than asking the user to design schemas.
- Work from a concrete question or example toward candidate signals, available evidence, missing data, and a reviewable result. Clearly distinguish a hypothesis from a validated signal.
- `catalog/raw-materials.v1.json` contains declared crawler fields. It does not establish that real crawled records are available. Do not invent records or describe illustrative values as observations.
- For a future in-product assistant, load its behavior from application-owned instructions and persisted project state. `AGENTS.md` guides Codex work in this repository; it is not automatically loaded by the product's web page.

## Development board

Use the local Hermes Kanban board `datalogicide` as the development task record. See `docs/DEVELOPMENT_BOARD.md` for the workflow. Before starting a coding task, read its card and check active cards for overlapping work. A `ready` card assigned to the `datalogicide` profile authorizes the dispatcher to start that task. Work in the card's isolated Git worktree and leave code changes in `review` for human approval; do not merge or publish automatically. When discussing a new task in chat, write a concrete card before async execution and keep its status and evidence current.
