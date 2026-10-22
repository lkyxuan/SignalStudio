# Two CoinGecko collectors sharing market.snapshot

Approved on 2026-10-22 in [SS-139](https://app.notion.com/p/401038a63d5a81c085c4db0f7f4c8008). The effective additive contract is `catalog/market-collector-routing.v1.json`. It extends producer provenance in `market-channel.v1.json` without changing `market.snapshot.v1`'s root record shape, Topic, message key, existing metric formulas, consumer groups or board eligibility. This is a Studio definition and reference verification, not a Few runtime implementation.

## Identity and wire format

Both collectors use `/coins/markets`, a per-token raw record at the Value root, message key `id`, and compatible routing Headers `source=coingecko`, `type=market`, `category=spot`. These values require compatibility/registration verification in Few. Headers identify message semantics; they do not distinguish the collectors or classify an asset.

| Dimension | #2010 | #2051 |
| --- | --- | --- |
| `meta.operation_id` / normalized `source_id` | `coingecko.coins_markets` | `coingecko.coins_markets` |
| `meta.collector_id` | `coingecko.coins_markets` | `coingecko.stocks.token_markets` |
| `meta.collection_scope` | `default_market` | `tokenized_stocks` |
| `meta.coverage_key` | `coingecko.default_market.v1` | `coingecko.tokenized_stocks.v1` |
| API category | Existing configuration | `tokenized-stock` |
| Collection floor | Existing scope unchanged | No price/cap floor |

#2010 is the existing default market collector; it is not redefined to exclude stock tokens. An asset appearing through #2010 is not evidence that it is non-stock. Task scope and category-membership evidence are distinct from a global asset type. Both paths resolve the same stable coin ID through `coingecko_coin_id`; separate issuers' coin IDs remain distinct.

The catalog specifies every required core field, type, nullability, owner and normalized mapping. Optional upstream fields retain the existing transform and open-record behavior; this extension does not synthesize or remove them. Publisher-owned `meta.*` and legacy root `collected_at` are not native API response fields. The two collection timestamps must agree. The transport binding records generated fields separately from native response-to-Topic field usages.

## Runs, time and coverage

`round_id` identifies a shared scheduled round; `source_run_id` is a globally unique UUID for one collector's execution. All pages and retries of that execution reuse it. `source_observation_id = UUIDv5(namespace=source_run_id, name=coin ID)`. A repeated ID with changed content is a conflict, not an overwrite. `scheduled_at <= requested_at <= collected_at`; valid `last_updated <= collected_at`. Preserve actual source/request/first-receipt times and durable request/page/row references. Never default unknown provenance to #2010, label it healthy, or invent source time.

`coverage_ref` points to the collector-run report owned by existing #1014 coverage responsibilities. It can be pending when individual messages are published. Retain the existing `status=healthy|missing|partial|unknown` and `baseline_status` semantics; add `round_status=pending|complete|partial|failed` rather than replacing existing status values. Only healthy + complete with a full page manifest, termination evidence and no unresolved error proves a complete round. Failed/unknown record counts remain null, not zero. Physical report persistence, notifications and dereferencing remain Few implementation requirements, unverified here.

No completion is inferred from an arbitrary successful record, arrival order, lack of messages, or first page. New membership reconciliations and complete rankings must not use partial/failed/stale rounds. A future combined board waits for both reports for the same round and freezes the comparison cutoff at `max(completed_at)`; records must have arrived by that cutoff and still satisfy the existing freshness requirements. Late records retain their original round; never fill a current round with previous-round data. Existing single-market boards may use their own complete run. No schedule is changed; reported test cadence is 12 minutes, and future 3-minute feasibility still needs full-pagination duration and quota checks.

## Shared Polars and duplicate observations

The same #3035 program validates the registered collector/scope/coverage tuple, normalizes the core record, and looks up existing identity. It does not allocate a second UUID for a second collector. `source_only` still computes with null identity; failures/conflicts are not treated as identity misses. History continues to match canonical source, stable coin ID, USD and `coverage_key`. Keep the two scope histories separate; no silent default-market history substitution for Stocks RVOL. Cross-coverage reuse would require separate compatibility/rebuild approval.

#3041 assembles by `observation_id`, verifying source, collector, run, round, scope and identity consistency; it does not join unrelated null asset IDs. `collector_id`, `round_id`, `collection_scope`, `scheduled_at` and `coverage_ref` remain traceable in #5007. Metric versions, missing-history statuses, identity handling and consumer-specific adapters retain their existing contracts. The card's v2 case is illustrative; it does not establish compatibility with a v1-only consumer or deploy an adapter.

Preserve both collection origins when a coin appears in both tasks. For the same rule/version, deduplicate business acceptance by canonical source + coin ID + quote currency + canonical source timestamp + rule ID/version, as specified in the catalog. Compare the shared price/cap/volume/change fields for conflicts before accepting an event; optional unrequested fields are not quote conflicts. Missing source time cannot form this business key. Distinct market strategies need distinct rule identities; same-message replay and cross-collector business duplication are separate checks.

Current Crypto boards keep their existing default-market candidate scope; #2051 does not automatically expand it. A Stocks board uses its own full candidate scope. A future mixed board chooses one latest valid observation per coin within the shared frozen round, ordered by source time descending, receipt time descending and observation ID ascending after conflict checks; it recomputes relative statistics on that cohort, rather than merging scores computed in different scopes. This contract does not deploy any new board.

## Studio installation and verification

`server/market_collector_routing.py` atomically adds logical fields, native field usages, publisher metadata generation references and the catalog reference to the seven existing cards. It preserves node IDs, saved positions, original fields, graph edges and existing trigger/relation semantics. Generated metadata is owned by the Topic/publisher contract, not inserted into the upstream API response schema. The #1014 definition extension follows the existing guarded system-table migration pattern and restores its interactive-edit protection inside the transaction. Catalog refreshes require matching installed definition references; conflicting edits abort. No physical business tables or consumers are created.

#2051 retains standard request/response-first source layout and adds clearly labeled publisher metadata. #5004 shows two hypothetical messages with Headers and provenance. #3035/#3041 use the standard numbered input/output processing layout with explicit source selection and plain-language algorithms. Real HTTP evidence remains separate from these fixtures. The two examples deliberately use one fictional coin to make overlap visible.

Run:

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_market_collector_routing server.test_stocks_shared_pipeline server.test_stocks_design
npm run test:contracts
npm run test:layout
npm run build
node scripts/check_card_details.mjs <saved-graph.json>
```

`server/market_collector_reference.py` is a pure contract checker for fixtures/tests; it is not wired to the service or a business consumer. Tests cover provenance rejection, history isolation, semantic duplicate/conflict keys, guarded migration rollback and restart safety. Browser inspection and deployment health verify Studio delivery only. Actual Header registration, emitted messages, physical histories/reports, coverage completeness, consumer deployment and durable idempotency remain unverified.
