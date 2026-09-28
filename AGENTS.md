# SignalStudio development agent

Work with the user directly in Codex. Treat discussion as discussion; when the user asks for a change, implement it without adding process steps. Make routine technical decisions and keep changes small.

- Read only the code and documents relevant to the task. For signal-design behavior, use the relevant parts of `docs/PRODUCT_WORKFLOW.md` and affected contracts.
- Keep proposals, upstream examples, real crawler observations, and validated signals distinct. Declared fields in `catalog/raw-materials.v1.json` are not evidence of collected records.
- Run checks relevant to the change and report what changed, what passed, and what remains uncertain.
- Leave unrelated work intact. Do not push, merge, or publish unless the user asks.
- A future in-product assistant must use application-owned instructions and saved project state; this file only guides Codex.
