# Asset information content refresh · v1

Approved 2026-10-10: [plan and implementation record](https://app.notion.com/p/3f4038a63d5a8170b017f6615cf4af45).
The authoritative portable contract is [`catalog/content-refresh.v1.json`](../catalog/content-refresh.v1.json).

## Delivered scope

The approved 2026-10-10 refinement splits the engine into four processing cards:

| Stage | Responsibility | Inputs | Output |
| --- | --- | --- | --- |
| Candidate selection | Per-board valid top N, then stable-ID union | Five board tables | Candidate `asset_id` values |
| Refresh decision | Per-type first/due/fresh/backoff/active checks | Candidates and content/state table | Decisions; only first/due proceed |
| Fetch and generate | Recheck eligibility and atomically claim before calling existing capabilities | Eligible decisions, identities and current task state | Unvalidated content or error, provenance, task version and lease |
| Validate and save | Reject stale completions, validate output, atomically persist or record failure | Generation result and current successful/task state | Updated logical content/state row |

The existing #3027 is renamed to `候选代币筛选`, retaining its ID, reference and position.
Three new processing cards use the normal allocator; references depend on the workspace.
The existing #1019 `asset_information_content` retains its ID, reference, fields and position.
The graph contains 13 design dependencies: five board inputs, three sequential handoffs,
identity input, three content/state reads (decision, execution recheck/claim, saving), and
one final write. No decision skip/wait/blocked branch is handed to generation. The result
is a logical view; neither intermediate candidate nor pending lists require new tables or queues.

Startup first ensures the original v1 design, then applies a transactional v2 upgrade.
The upgrade replaces only the eight v1-owned dependencies, preserves unrelated nodes,
positions and user connections, rejects missing/conflicting prerequisites, and is idempotent.
Obsolete v1 engine fields are removed only when their declarations still match and they
have no remaining edge or requirement references. The rename, new cards, field mappings,
reference counters, audit events and upgrade marker roll back together on failure.
Existing board calculations and Supabase list synchronization retain their contracts.

No crawler, generator, scheduler, production table or frontend reader is deployed here.
Observed result rows remain empty. `src/contentRefreshDesign.ts` is a pure UI design-case
evaluator (including the four-stage through-line), with no I/O, queue, atomic claims or generation. It is not a production task runner.

## Selection and scheduling requirements

| Board | Existing logical table | Ranking field | Filter |
| --- | --- | --- | --- |
| Hottest | `asset_scores_current` | `score_value` | `score_key = total_heat` |
| Warming | `leaderboard_warming` | `score` | Existing eligibility |
| Emerging | `leaderboard_emerging` | `score` | Existing eligibility |
| Cooling | `leaderboard_cooling` | `score` | Existing eligibility |
| Divergence | `leaderboard_divergence` | `score` | Existing eligibility |

Consume complete successful valid snapshots, with qualification/version/time checks before
sorting or limiting. Reject malformed or partial snapshots rather than backfilling missing ranks.
Sort by unrounded score descending then `asset_id` ascending, take each board's top N, then
union by stable `asset_id`. Names/tickers are not identity keys. An unavailable board contributes
nothing; other valid boards continue independently.

The four simple boards inherit their 15-minute validity from `leaderboard-simple.v1.json`.
The hottest source is backend #1006, not Supabase #1007. Its complete-read/freshness binding
is unresolved: `max_age_seconds = null` means unbound, not unlimited freshness. Do not apply
#1007's 180-second display rule. The design evaluator requires explicit `available`, `complete`,
`valid` reader assertions; its hottest example assumes that binding only for illustration.

Defaults are top 20 independently per board (at most 100 distinct assets), 1,800-second content
refresh, 60-second recheck and concurrency 2. Per-board N and per-type refresh intervals are
configurable without changing board display limits or market-data cadence. Check after a
successful table commit, at startup and on the timer; merge repeated notifications. A check
does not imply unconditional generation.

One content key is `asset_id + information_key`. Reuse existing language/variant discriminators
when binding the actual schema; variants must not overwrite each other. Enumerate enabled
types from the existing registry and generators, not page styles. Production `information_types`
stays empty until verified. Missing generator/input or unresolved source identity blocks that item.

No successful content means first generation. Otherwise `now - last_success_at >= interval`
means refresh due. Invalid/future timestamps block work. Retry/backoff and active-task checks
take precedence over expiry. Prioritize first-generation tasks, then earliest due time and
stable key. Recheck scope, bindings, state and due time immediately before calling the generator.
Cancel queued work when an asset leaves every top N; already running work may finish. Preserve
content on exit and use its age on re-entry. Clicking a page only reads saved content in v1.

## Persistence and recovery requirements

The result card specifies a logical view, not a required new physical table. Map to existing
storage before runtime work. Types/nullability are in the catalog; content and scheduling state
may live separately with an explicit content-key join. Keep every successful field on failure.

After source fetch and type-specific output validation, atomically save successful content,
source references, trustworthy data time, generator version and `last_success_at` with task
completion. Unknown `data_as_of` is null; generation time cannot substitute for source time.
Successful no-new-information and source failure are distinct according to the bound output
contract. Failure, timeout, invalid output or missing input neither erase successful content
nor advance its success time.

Retry still-eligible keys after 60, 300 and 900 seconds; further failures wait 1,800 seconds each.
Reset consecutive failures on success. Periodic checks cannot bypass `next_retry_at`.
One item's failure does not roll back another item's success.

Use persistent atomic claims, per-key monotonically increasing task versions and expiring
leases. Completions must match the current version and unexpired lease token. Lease renewal
invalidates the previous token. Recover expired work and reject stale completions before
replacing content. Bind lease duration, heartbeat, durable queue recovery and source limits
to existing task facilities. The pure completion evaluator assumes validated output and only
illustrates fencing and preservation; it does not prove deployed concurrency or recovery.

## Unconnected bindings

Current repository/graph evidence does not establish the real type registry, generators,
physical store, frontend reader, commit notifications, hottest freshness or persistent task
facility. Each is explicitly unconnected in the catalog/UI. Reuse verified fewunderstand
capabilities; do not invent source/product nodes or require a new Redis/Topic/service.
Production rollout requires a separate execution plan.

## Verification

```sh
npm run build
npx tsx --test src/contentRefreshDesign.test.ts
cd server
python3 -m unittest test_content_refresh.py test_leaderboard_simple.py
```

Rule checks cover ranking/filter-before-limit, stable-ID deduplication, invalid/incomplete and
unavailable snapshots, independent information types, first generation, expiry boundary,
retry backoff, lease expiry, stale completion rejection, preserved successful fields, exit and
re-entry. Migration checks cover additive installation, unchanged existing nodes, focused
field usages, idempotence and rollback. Inspect all four processing cards and the result table in a browser, including the three
branch choices, empty observed table, source navigation and collapsed technical settings.
The four-stage cases derive candidates, decisions, eligible handoffs, assumed generation
outputs and success/failure state replacement from the same synthetic records. The five-minute
example lease is only an assumption; actual lease duration stays unbound. Type-specific
validation and durable claims/transactions are external requirements, not implemented validators.
Upgrade checks also cover v1 identity/position preservation, unrelated links/field references,
focused field mappings, and rollback of rename, counters and audit events.
These checks validate the design implementation, not live generation or signal validity.
