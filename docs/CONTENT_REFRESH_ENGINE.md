# Asset webpage board and Few/Grokbot boundary

Current design: [SS-124](https://app.notion.com/p/3fe038a63d5a8135be54e95ca97366db), approved 2026-10-19.
`catalog/asset-webpage-board.v1.json` is the current board definition. Read the board or its
`GET /api/graph/package` export, including definition references, before implementing in Few.
Studio is a design workspace, not the business-data service or job runner.

## Responsibilities and handoff

Few Understand owns candidate selection, page-refresh decisions, and the task dispatch,
retry/concurrency and result-tracking mechanisms that implement the upstream boundary.
Grokbot owns the nine internal research/production steps shown in the webpage writer module.
The module is navigation, not a tenth executable card. It does not start a scheduler.

The business handoff contains only:

| Field | Meaning |
| --- | --- |
| asset_id | Stable UUID for the same asset; verify the mapping to Few's actual identity system |
| action | generate for first creation, refresh for a due update |
| page_ref | Existing webpage reference; null is allowed for a confirmed first creation |

`reason` and `age_minutes` remain upstream diagnostic information on #3029; users do not
supply a separate reason, and these are not Grokbot's required inputs. Research priorities,
sources, evidence, page artifacts and self-checks are internal to Grokbot. Their card fields
explain the internal flow; they are not a list of new fields Few must provide.

Task IDs, claim credentials, attempts, concurrency baselines and execution policies belong to
Few's task/adapter implementation. Reuse its existing mechanisms; this board does not impose
`run_id`, `expected_page_ref`, `expected_updated_at`, `started_at` or `policy` as mandatory
business inputs. Any actual cross-system protocol must be documented and verified at integration.
`workflow_version` is an optional output naming the specification actually used; unknown stays null.

## Upstream requirements

#3027 selects qualified confirmed coins from warming, hottest and new-UUID boards under their
existing complete-batch and ordering rules: up to 20 per board, deduplicated by asset UUID,
not a full-registry scan. Existing candidate/refresh design calls for successful complete-board
submission, startup checks and 60-second checks. These are demand checks, separate from worker
dispatch cadence and the whole-page update interval. Continuous Few operation is not verified.

#3029 reads #1039 by candidate UUID. Only a complete successful missing-row lookup means first
creation. Existing pages become due only with a valid successful updated_at and a configured
whole-page interval. That interval remains null; do not choose daily, three-day or the retired
30-minute per-information policy. Failed/partial reads, duplicate records, unknown/malformed/future
times need review. Only first/due go to Grokbot; skip/review do not execute.

Few's upstream implementation must avoid duplicate active work, recover interrupted work, keep
retry/concurrency state separate from successful page records, and prevent late/old results from
overwriting newer success. The exact storage, APIs, credentials, retry policy and dispatch strategy
remain unbound. Every-hour, batch size two, and generate-always-first are not approved defaults.

## Nine independent writer cards

1. Identity verification: reuse #3045's identity, reference number and saved display positions.
   It remains a process card with a confirmed-output guard; an unresolved identity stops without
   composing/saving a placeholder page or modifying global identity records.
2. Inventory existing Few materials: distinguish actual usable observations, missing inputs,
   failed reads and unknown coverage; declarations do not establish collected records.
3. Determine research focus: make an initial evidence-based section plan.
4. Find sources: supplement gaps, respecting actual tools, permissions and budget.
5. Fetch and retain evidence: carry readable evidence and provenance in the same production task.
6. Resolve conflicts/staleness/unknowns: compare the same asset, metric, units and time horizon;
   use new evidence to revise the section plan where necessary.
7. Compose page: reuse Few's frontend framework, not a separate app/deployment per asset.
8. Self-check: require the actual target frontend contract/parser and necessary content checks.
9. Save and write back: only a confirmed successful save may update #1039.

Internal evidence is shared within the same production task. The evidence and page containers
are design descriptions, not deployed storage or a fixed new API. Verified usable current Few
observations can be used directly. Historical evidence does not become current merely because it
was read now. Foundational facts may be reused only when valid under an explicit freshness policy
and not invalidated by new evidence. Failed revalidation preserves audit evidence but does not
turn it into a verified current fact. Unknown source times remain unknown.

Conflict revalidation and formatting repair are each limited to one internal attempt; the board
shows non-triggering reference paths, not immediate graph execution loops or separate jobs.
Blocking identity/fact conflicts, unavailable validators or failed repairs terminate with the old
successful page intact. The same freshness rules apply in self-check. Runtime enforcement is unbound.

## Current webpage record and saving

#1039 still holds one current successful row per asset: asset_id, page_ref, updated_at.
It does not store task state, evidence, page bodies or a page-version ledger. Only a confirmed
save of the same asset after identity and self-check approval maps saved_page_ref to page_ref
and saved_at to updated_at. Queuing, fetching, failures, uncertain saves and retries must not
change the old successful location/time. An existing page alone does not prove this task succeeded.
Actual idempotent saving, concurrency validation and atomic/recoverable storage remain unimplemented.

## Implementation and evidence boundaries

The Studio migration, fields, relationships and shared details implement the board presentation.
No Few readers, jobs, Grokbot tools, production evidence storage, page renderer/parser, saver or
writeback adapter are connected or verified by that migration. The old draft page-script v2 and
C1/C3/C6/C7 paths are not established production interfaces.

The nine cards retain original trial summaries as unverified author reports. Their original
logs, screenshots, artifacts and reported 252 tests are not available in this delivery; they are
not runtime evidence. UI examples are fictional, not business records.

`asset-grokbot-flow.v1.json` is now a historical installation input, like the retired
`asset-webpage-flow.v1.json`, `content-refresh.v1.json` and `search-preparation.v1.json`.
The PR #2 drafts remain research history, not a competing current execution contract.
SS-124 transactionally adds eight cards, reuses #3045 and replaces its boundary connections.
Unexpected user edits/connections or requirements stop migration for review;
version-pinned historical reports remain unchanged and become stale for changed definitions;
failures roll back. Other card identities and positions remain intact. Startup does not reset layout.

## Verification

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_asset_webpage_board server.test_asset_grokbot_flow server.test_asset_webpage_flow server.test_asset_pages server.test_asset_page_refresh_link server.test_card_model
npx tsx --test src/assetWebpageDesign.test.ts src/featureTree.test.ts src/cardDetailModel.test.ts
npm run build
node scripts/check_card_details.mjs /absolute/path/to/graph.json
```

These checks establish design migration, field/edge consistency, module visibility and read-only
rendering. They do not establish real Few execution, source coverage, webpage success or research validity.
