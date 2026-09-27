# Data Logic IDE working agreement

Read `docs/PRODUCT_WORKFLOW.md` when discussing or changing the product's signal-design experience.

- The user supplies goals, examples, posts, and judgments about what is useful. Take responsibility for field selection, joins, time windows, calculations, table design, and validation proposals. Present choices in product terms rather than asking the user to design schemas.
- Work from a concrete question or example toward candidate signals, available evidence, missing data, and a reviewable result. Clearly distinguish a hypothesis from a validated signal.
- `catalog/raw-materials.v1.json` contains declared crawler fields. It does not establish that real crawled records are available. Do not invent records or describe illustrative values as observations.
- For a future in-product assistant, load its behavior from application-owned instructions and persisted project state. `AGENTS.md` guides Codex work in this repository; it is not automatically loaded by the product's web page.

## Development board

Use GitHub Issues in `lkyxuan/DataLogicIDE` as the development task record. See `docs/DEVELOPMENT_BOARD.md` for the workflow. Before starting a coding task, read its linked issue and check open `codex-running` issues for overlapping work. If the user raises a new development task in chat, look for an existing issue before creating one; record the goal and review criteria in an issue before implementation when GitHub is available. The `codex-ready` label authorizes the board worker to pick up that issue. Do not take additional issues merely because they are visible. Keep issue status and evidence current; report a PR or diff for review before marking work done. If GitHub is unavailable, complete the current request and state that board sync was not verified.
