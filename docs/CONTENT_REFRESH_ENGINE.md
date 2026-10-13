# Asset information content refresh · v1

Approved 2026-10-10: [plan and implementation record](https://app.notion.com/p/3f4038a63d5a8170b017f6615cf4af45).
Current three-board inputs approved 2026-10-13 in [SS-84](https://app.notion.com/p/3f8038a63d5a811b8c93dc4d0026804d).
The authoritative portable contract is [`catalog/content-refresh.v1.json`](../catalog/content-refresh.v1.json).

## Delivered scope

SS-87 approved 2026-10-13: [card split and default realtime search](https://app.notion.com/p/3f8038a63d5a810fa05bdfc1a2b29003). The current #3030 generates content from prepared data; collection is expressed by five separate cards. `catalog/search-preparation.v1.json` owns these cards, branch conditions and unconnected data/search/store bindings.

The original four-stage design, expanded by SS-87, now has these responsibilities:

| Stage | Responsibility | Inputs | Output |
| --- | --- | --- | --- |
| Candidate selection | Per-board valid token top N, then stable-ID union | Warming, hottest and new-UUID results | Candidate `asset_id` values |
| Refresh decision | Per-type first/due/fresh/backoff/active checks | Candidates and content/state table | Decisions; only first/due proceed |
| Read collected data | Recheck eligibility and claim before reading bound data and saved searches | Eligible decisions, identities and current task state | Usable collected materials and gaps |
| Assess gaps | Choose current search or future sufficient-data path | Existing material coverage and freshness requirements | need_search / enough / blocked |
| Search supplement | Call bound tools/workflows for missing or current information | Selected search requirement | Success, empty, failed or unconnected search outcome |
| Search material store | Preserve last successful search materials and attempt state | Search outcomes | Logical stored materials; physical store unbound |
| Assemble generation inputs | Join existing data with the selected route; check task identity and evidence | Collected data and current search, or explicit enough decision | Prepared material bundle or preparation error |
| Generate from data | Recheck current task and consume prepared materials; no fetching/searching | Prepared materials or error, current task state | Unvalidated content or error, provenance, task version and lease |
| Validate and save | Reject stale completions, validate output, atomically persist or record failure | Generation result and current successful/task state | Updated logical content/state row |

The existing #3027 is renamed to `候选代币筛选`, retaining its ID, reference and position.
The original three added processing cards retain their identity. SS-87 adds five cards using the normal allocator (three processes, one decision and one table); references depend on the workspace. #3030 keeps its ID, reference and saved position under the name `根据资料生成内容`.
The existing #1019 `asset_information_content` retains its ID, reference, fields and position.
The current route is #3029 → collected-data reader → gap decision. Existing materials also
flow directly to assembly. The decision selects search supplementation (current default) or
an explicit sufficient-data route (future policy). Search writes the logical material store
and hands the current outcome to assembly. Assembly hands materials or an error to #3030;
#3031 remains the final validator/saver. The search store feeds later reads, not an immediate
execution loop. Only first/due content decisions start preparation. No physical queue or
business data reader is invented by these design connections.

The default policy is `realtime_search_required`: every eligible content update needs current
search evidence even when stored materials cover the requested topics. This is an accepted
policy for current incomplete crawler coverage, not a verified coverage audit of every token.
The future `coverage_based` policy bypasses search only if all required material types and
freshness requirements are satisfied. It is shown in a synthetic case and is not active.
The content update schedule and source freshness are independent. Reading a webpage still
only reads saved content; it does not trigger a search.

Business-data readers, actual search tools, source freshness intervals, storage retention and
physical storage remain unbound. Grok/Surf/custom workflows are candidates, not verified
integrations. Search results must retain source identity, original URL, known publication
time, fetch time and expiry. Source time remains null when unknown; fetch time never replaces
it. Freshness expiry does not define storage deletion. Failures preserve prior successful
search material and its timestamps. Successful empty responses are distinct from failures;
without required current evidence the default route blocks generation, routes the error
through #3030/#3031, and preserves previous successful content and normal retry rules.

Assembly waits for collected data and the selected route, correlated by asset ID, information
type and content-task version under a valid lease. It must not wait for both mutually exclusive
branches. Source duplicates are removed, conflicts retain attribution, and another task's
results cannot satisfy the current request. Current search results enter assembly directly;
reading the store is not proof that this task's search completed. Simultaneous identical
queries may share an in-flight request only with explicit task-correlated delivery. Earlier
prepared data cannot substitute for required current search evidence in the default policy.

Startup first ensures the original v1 design, then applies a transactional v2 upgrade.
These historical installers read immutable `server/migration_snapshots` inputs. The final
SS-84 migration adds the new UUID process/result, aligns candidate selection to three
boards and binds the homepage third position, preserving existing IDs and positions.
The historical four-stage upgrade replaces only the eight v1-owned dependencies, preserves unrelated nodes,
positions and user connections, rejects missing/conflicting prerequisites, and is idempotent.
Obsolete v1 engine fields are removed only when their declarations still match and they
have no remaining edge or requirement references. The rename, new cards, field mappings,
reference counters, audit events and upgrade marker roll back together on failure.
SS-87 then transactionally replaces only the owned #3029→#3030 and identity→#3030 shortcuts, adds five cards and their exact field mappings, updates #3030 and the #3029 destination wording, and advances recognized definition references. Edited definitions, name collisions and unknown revisions stop migration; failures roll back cards, edges, counters and audit records. Existing IDs/positions, extra user fields and unrelated connections survive.
Existing board calculations and Supabase list synchronization retain their contracts.

No crawler, generator, scheduler, production table or frontend reader is deployed here.
Observed result rows remain empty. `src/contentRefreshDesign.ts` is a pure UI design-case
evaluator (including the preparation and generation through-line), with no I/O, queue, atomic claims or generation. It is not a production task runner.

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

After material preparation, generation and type-specific output validation, atomically save successful content,
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
field usages, idempotence and rollback. Inspect the original content-flow cards and the five preparation cards and the result table in a browser, including the three
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

SS-87 verification additionally runs:

```sh
python3 -m unittest discover -s server -p test_search_preparation.py
npx tsx --test src/searchPreparationDesign.test.ts src/contentRefreshDesign.test.ts
```

The pure preparation evaluator checks required categories, provenance, asset match, freshness,
lease expiry, default current-search policy and future bypass. Its adapter inputs assume the
search outcome is already correlated with the current query/task; real adapter validation,
atomic claims and concurrent request sharing remain unimplemented. Fictional records live
only in design-case views, never the observed result tables.
