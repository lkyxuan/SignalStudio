# Development workflow

Develop SignalStudio directly with the user in a Codex chat. The chat carries the goal, scope changes, findings, and review handoff. This workflow is separate from the product's signal-design workflow in `PRODUCT_WORKFLOW.md`.

1. Inspect the current Git state, relevant implementation, and project decisions before editing. If another checkout has unfinished work, leave it in place and use an isolated worktree for new work.
2. Turn the user's goal into a small, reviewable outcome. Make routine implementation choices in the code; ask the user only when a necessary product decision or access is missing.
3. Run focused checks for the changed behavior. For signal work, distinguish declared crawler fields from observed records and validated signals.
4. Report the changed files, checks and results, and any remaining question in the chat. Leave merging and publishing to an explicit user request.

Hermes Kanban and its dispatcher are retired for this project. Do not create or dispatch Hermes cards unless the user explicitly asks to resume that workflow.
