# Asset information content refresh · v1

Approved 2026-10-10: [plan and implementation record](https://app.notion.com/p/3f4038a63d5a8170b017f6615cf4af45).
Current three-board inputs approved 2026-10-13 in [SS-84](https://app.notion.com/p/3f8038a63d5a811b8c93dc4d0026804d).
The authoritative portable contract is [`catalog/content-refresh.v1.json`](../catalog/content-refresh.v1.json).

## Delivered scope

The approved 2026-10-10 refinement splits the engine into four processing cards:

| Stage | Responsibility | Inputs | Output |
| --- | --- | --- | --- |
| Candidate selection | Per-board valid token top N, then stable-ID union | Warming, hottest and new-UUID results | Candidate `asset_id` values |
| Refresh decision | Per-type first/due/fresh/backoff/active checks | Candidates and content/state table | Decisions; only first/due proceed |
| Fetch and generate | Recheck eligibility and atomically claim before calling existing capabilities | Eligible decisions, identities and current task state | Unvalidated content or error, provenance, task version and lease |
| Validate and save | Reject stale completions, validate output, atomically persist or record failure | Generation result and current successful/task state | Updated logical content/state row |

The existing #3027 is renamed to `候选代币筛选`, retaining its ID, reference and position.
Three new processing cards use the normal allocator; references depend on the workspace.
The existing #1019 `asset_information_content` retains its ID, reference, fields and position.
The current refresh contract contains 11 design dependencies: three board inputs, three sequential handoffs,
identity input, three content/state reads (decision, execution recheck/claim, saving), and
one final write. No decision skip/wait/blocked branch is handed to generation. The result
is a logical view; neither intermediate candidate nor pending lists require new tables or queues.

Startup first ensures the original v1 design, then applies a transactional v2 upgrade.
These historical installers read immutable `server/migration_snapshots` inputs. The final
SS-84 migration adds the new UUID process/result, aligns candidate selection to three
boards and binds the homepage third position, preserving existing IDs and positions.
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
| Hottest | `leaderboard_hottest` | `score` | Confirmed token identities |
| Warming | `leaderboard_warming` | `score` | Existing eligibility |
| New UUID | `leaderboard_new_uuid` | First registration `created_at` | Confirmed discovery-origin objects; only coins enter token content |

Consume complete successful valid snapshots, with qualification/version/time checks before
sorting or limiting. Reject malformed or partial snapshots rather than backfilling missing ranks.
Sort hottest/warming by unrounded score descending and new UUIDs by first registration
time descending, then `asset_id` ascending; take each board's top N qualified tokens, then
union by stable `asset_id`. Names/tickers are not identity keys. An unavailable board contributes
nothing; other valid boards continue independently.

Require successful complete current result snapshots younger than 15 minutes; at exactly
900 seconds they expire. This is snapshot age, not object age. The newest UUID list has no
object-age cutoff. Actual complete readers and identity/type qualification remain unbound.
Do not substitute backend total_heat #1006 or Supabase #1007; their demonstration and
180-second display rule are separate from these board results.

Defaults are top 20 independently per board (at most 60 distinct assets), 1,800-second content
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
physical store, frontend reader, commit notifications, complete board readers or persistent task
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

SS-84 checks additionally run `python3 -m unittest test_new_uuid_board.py` and
`npx tsx --test src/newUuidBoardDesign.test.ts src/contentRefreshDesign.test.ts` from the
appropriate server/repository directories. New-UUID runtime requirements are in
[NEW_UUID_BOARD.md](NEW_UUID_BOARD.md). The source registry declares `assets.created_at`;
creation-origin classification and actual timestamp coverage remain unverified.
