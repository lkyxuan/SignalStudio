# Development board workflow

This document governs Codex development tasks for this repository. It is separate from the product's signal-design workflow in `PRODUCT_WORKFLOW.md`.

## Task record and states

GitHub Issues in `lkyxuan/DataLogicIDE` are the durable task records. A GitHub Project provides the visual board. One issue describes one reviewable change and includes the desired outcome, relevant context, acceptance checks, and any dependency or known blocker. Discussion may begin in Codex chat; the agreed task is written to an issue before an asynchronous worker starts.

Use these labels as the machine-readable queue state. Exactly one of them should be present on an active task:

| Label | Meaning |
| --- | --- |
| `codex-inbox` | Captured, still needs scoping or a decision. |
| `codex-ready` | Scoped and authorized for the worker to start. |
| `codex-running` | A worker has claimed the issue. |
| `codex-review` | Implementation and validation are ready for human review. |
| `codex-blocked` | The worker needs a concrete input or external change. |

Closing an accepted issue is the final `Done` state. The Project board should show Inbox, Ready, In progress, Review, Blocked, and Done. Project status is a visual mirror; the issue labels are the execution source of truth. A Project card moving between columns alone does not dispatch work.

## Worker contract

1. On each scheduled run, query open `codex-ready` issues in this repository. Process at most one issue, oldest first. Do nothing when there is no ready issue.
2. Re-read the selected issue and open `codex-running` issues. If a task is already claimed or overlaps files with active work, leave it queued and explain the conflict on the issue only if action is needed.
3. Replace `codex-ready` with `codex-running` before editing. Include the issue number in the branch and resulting PR or review artifact. Work in an isolated checkout based on the current default branch. Keep the main checkout available for the user's local preview.
4. Implement the issue's outcome, follow `AGENTS.md`, run the relevant checks, and record commands and results. Do not invent product observations or claim a signal has been validated from contract fields alone.
5. When ready, link a PR or reviewable diff in the issue and replace `codex-running` with `codex-review`. Never merge automatically. If a missing input prevents progress, state the specific blocker and replace `codex-running` with `codex-blocked`.
6. Before claiming another issue, re-read the queue. Do not infer authorization for work from `codex-inbox` or `codex-blocked`.

The worker must avoid duplicate claims. A label change and a later read are not an atomic lock, so start with one scheduled worker. If several workers are introduced, use a GitHub-backed claim mechanism with concurrency control before allowing parallel claims.

## Rollout

1. Commit and push a reviewed repository baseline. This repository needs a default-branch commit before isolated worktrees, cloud environments, or GitHub Actions can check out its code.
2. Create the GitHub Project and labels. Add this repository's issues automatically to the Project, then verify one test issue appears.
3. Run one task manually from its issue to verify the branch, checks, review artifact, and issue updates.
4. Add one Codex desktop scheduled task for this local project using the worker contract above. It polls the `codex-ready` queue on a chosen interval and stays quiet when empty. Local scheduled tasks require this computer and the desktop app to remain running.
5. After a few successful runs, decide whether to replace polling with a GitHub Actions trigger. An event-driven Codex Action requires an OpenAI API key in repository secrets and a separately reviewed workflow.

The GitHub connector is currently available for issue and PR operations. Project creation and status edits may require the GitHub web UI or additional GitHub API access. Do not claim a Project was updated unless its resulting state was verified.
