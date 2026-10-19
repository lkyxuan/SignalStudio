# CoinGecko Stocks design

Approved on 2026-10-20 in [SS-127](https://app.notion.com/p/3fe038a63d5a8141981fc9f89c1f079c), under [SS-126](https://app.notion.com/p/3fe038a63d5a81b9a6f0ee5e1a64063b). The versioned definition is `catalog/coingecko-stocks.v1.json`; paired upstream observations are separate in `catalog/coingecko-stocks-observed.v1.json`.

## Delivery and scope

This batch implements 18 Studio design cards: ten endpoint sources, four processing boundaries and four logical tables. It does not implement a continuous collector, physical Stocks stores, historical backfill, a business Stocks application or ranking consumers. All added relationships are references with `trigger=none`. Opening a card never calls CoinGecko.

The additive installer `server/stocks_design.py` adds one independent Stocks area, references the existing `assets` and `asset_identifiers`, preserves existing definitions, positions and bindings, and adds only new display occurrences for those shared tables. The one-time marker is `coingecko_stocks_design_ss127_v1`. Name collisions or transaction failures abort installation; restarts preserve subsequent edits. Future definition changes require a separately reviewed migration rather than resetting the marker.

## Required collection behavior for the future collector

- Discover the full `/rwas/list?asset_type=stock` directory and all `/coins/markets?category=tokenized-stock` pages. These are different entity levels, not interchangeable lists. Do not apply the Crypto collector's USD10m market-cap floor. ETF and commodity types are separate. Stock type alone does not establish US listing status, public listing, completeness or tradability.
- Keep RWA ID, coin ID, issuer, chain/contract and internal asset ID mappings distinct. One underlying stock may have many tokens. Use `/rwas/{id}?tokens=true` and token metadata as evidence; never merge by symbol alone or invent missing issuer/listing information.
- Reconcile membership only after a complete successful scan. Persist round ID, source cutoff, page counts, unique IDs, duplicate/conflict diagnostics and errors. A rate limit, missing page or uncertain coverage must not become a successful empty market or a removal decision.
- Batch market pages, refresh directory/metadata less often, and backfill history by ID/range with checkpointing. Exact cadence and concurrency remain unbound until actual key entitlements, provider cache/update frequency and budget are verified. Honor 429/backoff; stop bounded sample capture after a rate limit. No scheduler is installed in this batch.
- Retain raw source, entity level, currency, source/request/receive time, coverage version and quality state. Missing values remain missing, zero observed volume stays zero, and insufficient history is explicit. Neither is grounds for silently deleting a directory member.
- Chart price/market-cap/volume points are not OHLCV. Do not sum rolling-24-hour volume points as incremental turnover. RWA aggregates and individual-token observations must not be mixed or double-counted.
- Reuse generic history/metric capabilities through a separate Stocks cohort. Current Crypto heat/warming contracts remain authoritative and unchanged. A Stocks board requires its own coverage, history eligibility, cohort statistics and acceptance; filtering a Crypto Top N does not produce an independent Stocks ranking.

## Endpoint inventory

| Purpose | Endpoints | Entity level |
| --- | --- | --- |
| Discovery | `/rwas/list`, `/coins/markets` with `category=tokenized-stock` | Underlying asset / token |
| Current markets | `/rwas/markets?asset_type=stock`, same token markets endpoint | Aggregate / token |
| Identity | `/rwas/{id}`, `/coins/{id}` | Underlying-to-token / token contracts |
| Issuers | `/rwas/issuers/list`, `/rwas/issuers/{id}` | Issuer; not every product is stock |
| Venues | `/rwas/{id}/tickers` | Token trading venues |
| History | `/rwas/{id}/market_chart`, `/coins/{id}/market_chart` | Aggregate / token |

The catalog records official parameter schemas, response paths, documentation URLs/check times and content hashes. Documentation describes possible fields; it does not establish collected observations. Source cards show the paired request and response first, then collapsed parameter/field/collection settings. Array excerpts show returned and saved counts; complete saved histories remain accessible without dropping observed days.

## Observations and limits

On 2026-10-20, the stock RWA directory returned 792 records. A category scan returned four pages of 250 unique token IDs (1,000 total); page five returned HTTP 429. Its full category size is unknown and is not recorded as 1,200 stocks. Counts and memberships are time-specific, and pagination was not a frozen upstream snapshot.

The committed capture independently saved successful directory, aggregate markets and Nvidia detail calls. Nvidia's response listed 11 issuer/token versions. The keyless RWA venue and history requests returned HTTP 401 indicating Basic or above; other samples were rate limited or not called after 429. These are observed access results for this environment, not a statement about the user's existing paid key. Sample capture uses public read-only calls and never saves credentials. Run it explicitly with `python3 scripts/capture_stocks_source_cases.py`; it overwrites the observation artifact and requires review before a new definition revision is delivered.

Tokenized prices, capitalization and volume describe the tokenized market, not underlying stock exchange metrics or company capitalization. Listing markets, mapping coverage, production entitlement, cost, latency and historical availability remain unverified. The source labels and Stocks product wording must retain that distinction.

## Verification

```bash
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_stocks_design
npm run test:contracts
npm run test:layout
npm run build
npm run check:details -- /absolute/path/to/saved-graph.json
```

Verify the Stocks group, representative paired samples and failure states, shared identity links, and narrow details in the browser separately. These checks verify Studio design behavior and graph preservation; they do not validate a running collector or a stock-trading signal.
