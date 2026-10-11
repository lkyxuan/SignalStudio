# CoinGecko trending contribution

Approved on 2026-10-10 in the [Notion task](https://app.notion.com/p/3f4038a63d5a81569854f843005114be).
The approved deliverable is a SignalStudio source/processing card and precise design contracts.
The cards, synthetic preview and graph installer are implemented here. Collection, durable
snapshot/decision storage, publishing and admin queries in Fewunderstand remain unimplemented
and unverified for this rule. No credentials, scheduler or deployment is enabled by this change.

## Required behavior

- `GET /api/v3/search/trending`, no business parameters and no paid `show_max`, observes the
  default 15 coins. Keep the actual count if smaller. Consume only `coins`, preserve the complete
  raw response, and retain collection health. This is past-24-hour search popularity, not
  incremental searches in the collection interval. `coins[].item.score` is a zero-based rank,
  never score intensity. Authentication and host must match the implementing account's plan.
- Cadence comes from `catalog/source-collection-plans.v1.json`: every 30 minutes. The generated
  `catalog/source-contracts.v1.json` exports this plan and explicitly has no observed call case.
  Request start fixes a UTC half-hour slot; all retries retain it. Freeze the first valid
  successful response per slot atomically. Subsequent successes reuse it. Responses arriving
  at/after the original slot's end are retained as late evidence without awards. Do not backfill
  failed/missed slots. Empty successful `coins` is valid; malformed responses are failures.
- Deduplicate coin IDs in the frozen response. Use `asset_identifiers(source_namespace=coingecko,
  external_identifier=item.id)` and validate the referenced asset exists. Only a unique valid
  mapping may score. Missing/conflicting mappings retain pending evidence; no ticker merge or
  implicit asset creation. Freeze the resolved identity on acceptance; retries cannot retarget.
- Every mapped coin earns one `score_delta=10, score_key=total_heat` decision per slot.
  Save it durably and uniquely by source + coin ID + slot + rule version before publishing.
  `decision_ref=coingecko_trending/v1/{percent_encoded_coin_id}/{slot_start_utc}` uses a canonical
  millisecond UTC ISO timestamp (e.g. `2026-10-10T00:00:00.000Z`). Names are optional snapshots.
  Preserve raw snapshot/run references, rank, identity evidence, rule/version, reason and decision
  time; the complete required field list is in `catalog/coingecko-trending-contribution.v1.json`.
  `slot_start`, `run_id`, `snapshot_ref`, collection time and identity state are collector/processing
  metadata, not upstream API fields. The durable storage and resolver API must be supplied by
  Fewunderstand; a reference string alone does not satisfy persistence.
- Deliver seven existing score-decision fields to `提交评分事件` (#3006). It owns stable `event_key`
  generation and first accepted `created_at`; transport retries must reuse the original values.
  Pin `decay_policy_ref=coingecko_trending/v1` and `half_life_minutes=30` at acceptance. Do not
  republish changed rules under this version. Continue the existing Topic → independent Redis
  projection/archive → total_heat rollup → existing score/board publishing route.
- Decay each event independently with `delta * 2^(-max(0, elapsed_seconds/60)/H)` and sum at one
  calculation time. Preserve fractional minutes and full internal precision. Preserve the
  existing initial +100 contribution with H=10080 minutes, ranking and tie rules. Collection
  every 30 minutes, H=30 and the existing 60-second refresh are separate settings; existing
  immediate-trigger requests retain their prior implementation status.
- A coin absent from a successful next snapshot earns nothing new. Its old contributions decay
  naturally, with no time-generated debit events or new cutoff. Collection failures also earn
  nothing, but health must distinguish unavailable observation from actual absence/cooling.
  A maximum 50-row board is a display limit, not a promise to obtain 50 coins from this endpoint.

## Card implementation and verification

`server/coingecko_trending.py` is the historical four-edge installer; the ordered
`server/trending_channel.py` upgrade now replaces the direct source input with
source → social.data → contribution. Identifiers/assets and contribution → publisher remain.
It records consumed fields and installs once transactionally, preserving existing
user formulas, positions and later deletions. It does not alter the shared publisher, initial
scoring rule, current-score snapshot, or dormant leaderboard scaffold algorithms.

`src/CoinGeckoTrendingCard.jsx` uses the shared processing frame with paired numbered input/output,
source links, execution timing, bottom algorithm and collapsed technical settings. Cases come
from `src/coingeckoTrendingDesign.ts`, a pure synthetic preview with no runtime side effects.
Continuous on-list contributions are 10, 15, 17.5, 18.75 after four on-time rounds; after another
30 minutes without a new award the latter is 9.375. Rule subtotal and total score must remain
distinguishable in future admin explanations. No accepted runtime event is fabricated.

Run:

```sh
PYTHONPATH=server python3 -m unittest server.test_coingecko_trending server.test_trending_channel server.test_source_contract_store
npx tsx --test src/coingeckoTrendingDesign.test.ts
npm run build
```

The tests cover additive/idempotent installation, rollback, preservation of edits/deletions,
portable source cadence and evidence status, retry identity stability, slot boundaries,
missing/conflicting identity, failure/absence, and mixed/fractional per-event decay. Runtime
acceptance still requires real paired collection evidence, durable decision recovery, publisher
deduplication and end-to-end board/admin visibility in Fewunderstand.

## Collection message channel (SS-61)

Approved 2026-10-11 in [SS-61](https://app.notion.com/p/3f6038a63d5a81bda933cf5859c824f0).
`catalog/trending-channel.v1.json` supplements the original contribution contract and
overrides only its direct collection input. Reuse the existing broad `social.data` Topic:
search attention is an upstream observation, similar in domain to the Kaito attention/ranking
family in the local Fewunderstand registry. Do not create a per-source Topic or classify it
as a computed indicator, strategy signal, project metadata, or price snapshot.

The required new registry tuple is `source=coingecko`, `type=social-intelligence`,
`category=coingecko_search_trending_snapshot`, mapped to
`social.coingecko_search_trending_snapshot.v1`. These are Studio design requirements,
not an already registered/emitted message. Consumers read the broad Topic then dispatch
by the exact tuple and validate Value.data. Other registered types belong to their own
handlers; unknown/invalid messages require durable isolation, not default trending parsing.
Headers do not filter on the broker; the registry binds the schema version.

One record contains the complete `coins` list plus `slot_start`, `request_started_at`,
`collected_at`, `run_id`, `snapshot_ref`, and `status`. These fields live in Value.data.
`status=success` requires a valid list, including an empty list; `failed` uses null coins
and records health without implying absence. Preserve the complete original response/failure
evidence behind a durable snapshot_ref. Request retries retain the first request's slot,
transport retries retain the message and times, and the first valid success (even empty)
is frozen atomically. The key `data.slot_start` keeps this category's same-slot messages
together, but is not the scoring idempotency key.

The independent group `signalstudio.coingecko_trending_contribution` persists the snapshot
and idempotent decisions before resuming delivery through the original score publisher and
committing its own offset. Never generate a second contribution on crash/retry. Responses
arriving late and messages replayed after their original slot closes are evidence only,
without retroactive awards. Source identity resolution and all existing scoring/decay rules
remain authoritative.

The local Fewunderstand registry at a4b410d declares social.data with six partitions and
seven-day retention; live broker configuration, availability and archive/recovery coverage
remain unverified. This batch implements Studio cards, atomic once-only graph migration
and UI navigation. It does not edit Fewunderstand, register a running handler, create broker
resources, start collection or establish scoring runtime success.
