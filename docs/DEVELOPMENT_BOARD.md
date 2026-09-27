# Development board workflow

Hermes Kanban is the task queue for development work in this repository. GitHub stores code and review artifacts; GitHub Issues and Projects do not dispatch tasks. This workflow is separate from the product's signal-design workflow in `PRODUCT_WORKFLOW.md`.

## Local board

- Board: `datalogicide` in Hermes, displayed as **Data Logic IDE**.
- Worker profile: `datalogicide`, configured for the Codex app-server runtime.
- Project directory: `/Users/lkyx/Documents/DataLogicIDE`.
- Each coding card runs in a preserved Git worktree. The current checkout may contain other unfinished work; a worker must not edit it.
- The Hermes gateway hosts the dispatcher. The dashboard's Kanban tab shows queue state and worker logs.

Create one card per reviewable outcome. Record the goal, useful context, acceptance checks, and dependencies. Assign it to `datalogicide`. A card in `ready` can be claimed by the dispatcher. `triage` and `todo` are for ideas and dependency-gated work; `blocked` needs a specific input or external change. A worker reports implementation in `review` with its worktree path or branch, changed files, and checks run. Human review decides whether to complete the card. Do not merge or publish automatically.

The worker should read the card and the board before editing, follow `AGENTS.md`, check for overlapping active work, implement in its worktree, and record validation results. For signal work, declared crawler fields are not evidence of real records or a validated signal.

Useful commands:

```bash
hermes kanban --board datalogicide list
hermes kanban --board datalogicide show <task-id>
hermes kanban --board datalogicide create "Task title" --assignee datalogicide --body-file <spec-file>
hermes kanban --board datalogicide dispatch
hermes dashboard
```

The gateway must be running for automatic dispatch. The board and its task history are local to this machine. Worktrees keep changes visible locally; approved changes can be brought into the main checkout or pushed to GitHub separately.
