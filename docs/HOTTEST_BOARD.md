# CoinGecko trading heat board

Approved 2026-10-13 in [SS-95](https://app.notion.com/p/3f8038a63d5a81069b8ff12d27254eb4).
`catalog/coingecko-hottest.v1.json` overrides only the hottest-board path and adds
versioned seven-day RVOL to the existing Polars module. This repository implements
Studio definitions, a guarded migration, synthetic inspectors and pure evaluators;
it does not execute Few collectors, consumers, physical stores or a business page.

## Required calculation

For each complete valid asset, compute current rolling-24h volume, turnover
(volume / market cap), absolute signed-24h price change, and seven-day RVOL.
RVOL divides current volume by the arithmetic mean of seven historical daily
as-of observations. At current `requested_at` minus 1–7 days, select the most recent
observation not after each target, at most 30 minutes older, received by that target.
Match source, stable coin ID, USD and coverage version. Require seven distinct
observations, nonnegative finite volumes and positive mean. Missing history produces
null with a reason, never a different scoring version or reallocated weight.
Do not add rolling-24h snapshots to manufacture daily/hourly incremental volume.

Freeze one cohort, source cutoff, coverage, parameter version, observations and
normalization statistics per batch. Take each asset's latest valid observation
before checking RVOL; do not reuse an older complete observation to hide missing
history. Only uniquely resolved coin identities rank. Source `asset`/`token` labels
need an explicit verified coin adapter. Current USD price/market cap must be finite
and positive; observations must be no older than 15 minutes. Keep the existing
collector's >USD10m range; add no board volume/cap or asset-class exclusions.
Stablecoins and wrapped assets may therefore remain in this first version.

Within the same cohort, for each metric `x`, compute `y = ln(1+x)`,
`z = (y - median(y)) / (1.4826 * median(abs(y - median(y))))`, clipped to [-3, 3].
Units are fixed: USD volume, fractional turnover, RVOL multiples and percentage-point
price changes (5 means 5%). `log1p` is an explicit zero-safe adjustment to the supplied
`log(x)` proposal. It changes relative distances and must not be removed as redundant.

`score = .35*z(RVOL) + .25*z(turnover) + .20*z(volume) + .20*z(abs_price_change)`.
The score is between -3 and +3, may be negative, and is not a probability or
statistical significance. Scale <=1e-12 makes that component zero for everyone,
with a visible degenerate flag; do not reweight or silently use ordinary Z.
All-degenerate or single-asset cohorts are incomparable and cannot publish a normal
ranking. An empty qualified cohort under healthy complete coverage is a successful
empty result. Partial/unknown/failed coverage must not masquerade as an empty market.

Every five minutes, target a new atomic snapshot. Sort full-precision score descending,
then asset ID ascending, take at most 20, display two decimals. Keep original values,
log1p values, raw/clipped Z, weights/contributions, cohort median/MAD/scale, exclusions,
input references and timestamps. Age >=900 seconds expires the result. Replaying a
snapshot ID must use identical frozen inputs/results or reject conflicts. No events,
accumulation, old `activity_score`, initial score, social/search +10 or decay enter this
ranking. Existing score events, warming design and alerts retain their prior semantics.

## Cards and version compatibility

- New module process: seven-day baseline (#3048 in the shared graph).
- New module process: seven-day RVOL (#3049).
- New state: latest heat candidates (#6007), owned by the future #3018 consumer.
- Existing #3018 restored: whole-cohort normalization and ranking, not per-coin Z.
- Existing #1009 reused: successful snapshot results, keeping downstream references.

Numbers above identify this installation; algorithms use stable IDs and selectors.
The channel-to-state **reference** documents intended stream input without claiming a
running state writer. The planned `signalstudio.coingecko_hottest_v1` consumer belongs
to #3018's program; its broker/store bindings remain unverified.

#3035's shared program obtains inputs and computes the additional two children.
#3041 assembles once per observation and publishes `market_indicators_v2` through
#5007. All original fields/identities remain, including nullable UUIDs. Legacy readers
explicitly accept v1/v2, project unchanged old fields, and retain original metric IDs;
RVOL never becomes a fifth legacy scoring contribution. Frozen v1 messages are not
rewritten. This is a required backend adapter, not proof Few implements it.

The new catalog has precedence over older hottest descriptions in `market-current`
and `polars-indicator-current`; those files remain historical migration inputs and
current definitions for unaffected behavior. Export includes the overriding catalog,
updated action versions, fields, ownership and bindings. The retired scoring fields
are removed only from the new hottest path; historical ledger and other board inputs
are preserved. Unknown edits, protected contracts, external dependencies and unknown
reference digests stop migration; it rolls back atomically. Later edits survive reentry.

## Verification and actual limits

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_coingecko_hottest server.test_market_scoring_reference
npx tsx --test src/hottestDesign.test.js
node scripts/check_hottest_previews.mjs /absolute/path/to/saved-graph.json
node scripts/check_coingecko_previews.mjs /absolute/path/to/saved-graph.json
node scripts/check_polars_module.mjs /absolute/path/to/saved-graph.json
npm run check:details -- /absolute/path/to/saved-graph.json
npm run test:contracts
npm run test:layout
npm run build
```

Synthetic cases include complete history, a missing day, zero current values, zero
baseline, all-degenerate MAD, partial coverage, stale observations and empty batches.
Independent Python and JavaScript evaluators compare history selection, normalized
components, exact ordering and expiry. They are explanatory reference functions, not
an operational board engine. Live seven-day coverage, actual message versioning,
identity adaptation, batch persistence/recovery and ranking usefulness remain unknown.
