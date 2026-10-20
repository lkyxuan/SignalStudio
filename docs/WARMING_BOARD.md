# CoinGecko warming board

Quantity revision approved 2026-10-20 in [SS-131](https://app.notion.com/p/3fe038a63d5a81beb4b5fbc40efb9c42):
publish and display up to 50 eligible rows with scrolling; fewer rows remain valid.
Scoring and eligibility are unchanged. Content refresh still selects at most 20 per board (60 unique).
This is the Studio definition and reference evaluator; Few runtime delivery remains unverified.

Approved 2026-10-14 in [SS-102](https://app.notion.com/p/3f9038a63d5a819eac83dde1100f58dc).
Algorithm `coingecko_warming_growth_v3`. This repository implements Studio contracts,
guarded migrations and independent synthetic evaluators, not Few consumers or a live
business page. This contract overrides legacy warming score-increment definitions;
the existing score ledger, hottest algorithm and alerts retain their semantics.

## Required behavior

Every healthy complete crawler round freezes one candidate cohort and source cutoff.
Select each coin's latest received observation before eligibility checks; never fall
back to an older positive/complete record. Accept `market_indicators_v2`, resolved
coin UUIDs, stable CoinGecko IDs, USD, matching source/coverage, finite nonnegative
rolling-24h volume and finite positive price/cap. Require request <= receive <= cutoff,
source time <= receive and no more than 15 minutes old. Conflicting IDs/messages reject
the batch. Do not mix coverage/source contexts. Keep the existing upstream range;
no new size or stablecoin exclusions. The recorded dev collector range is market
cap > USD10m; smaller-coin coverage and the reported 3-minute production/12-minute
test cadences remain separately unverified.

Revision approved 2026-10-20 by the owner in SS-102: “新币很重要，基准甚至不是按天算的，有多少数据用多少数据”. Few FEW-113 (PR #293, dev `e609d24`) is reported by the user as running on the test network; this delivery only changes SignalStudio and does not independently verify Few deployment.

Let `V` be current rolling-24h USD volume. Recompute the warming baseline `B` on
every request. Walk hourly targets backwards from `floor_hour(request_time - 75 minutes)`
through `request_time - 7 days` inclusive. At each target select the latest healthy
same-source, same-asset, USD, same-coverage observation within the preceding 30 minutes,
with finite nonnegative volume, valid source/request timestamps and received by the
current request. The most recent 75 minutes never enter B, avoiding H1 overlap.
Use every available sample, at least one; B is their positive arithmetic mean.
Record actual sample count `baseline_hours`, target times, sample times and IDs.
Display “基准 N 小时 / N 天”; 167 or more samples count as a full seven days.
`warming_baseline_days` retains sample-count/24 for lineage; it is no longer a daily-target count.
Do not freeze or cache B by day. Late arrivals may change later calculations,
never previously published snapshots. Few's legacy daily baseline cache table is
retained but no longer written; this repository does not alter Few storage.
The hottest rolling seven-day RVOL baseline remains unchanged and separate.

Use `asset_core.assets.created_at` as `asset_created_at`, the asset registration time,
not issue time. Set `is_new_asset` when registration age relative to request time is
nonnegative and less than seven days; snapshot `is_new` carries the same value.
Missing/invalid/future registration time is not labeled new. New coins participate
normally, with no separate ordering or bonus; display “新币”.

At request minus 60 minutes, take the latest healthy same-context historical volume
`H1`, received by that target, not after it and at most 15 minutes old; require positive
volume. The current and historical source timestamps are validated and actual sampling
times retained. Zero latest history must not fall back to an older positive value.
Compute `R = V/B` and `G = V/H1 - 1`. Require **R > 1 and G > 0**. Sort G descending,
R descending, then asset ID ascending, take at most 50 without padding. Set the
existing downstream `score` field to G (fraction, not percentage points or Z score).
No old accumulation, initial score, price-direction threshold or half-life contributes.
Allow hottest/warming overlap; no hottest result is required to compute warming.

At request minus 120 minutes, optionally select `H2` by the same 15-minute rule.
When positive and comparable, compute previous growth `H1/H2 - 1` and
`growth_change_pp = (G - previous_growth) * 100`. Values within 1e-9 pp of zero are
steady; positive values accelerate, negative values slow. This is a difference of
relative growth rates over target windows with recorded sampling skew, not a precise
derivative of actual short-window flow. It is explanation only, never a ranking
weight. Missing/conflicting/zero H2 leaves the explanation unknown and does not
exclude otherwise eligible coins. Source 24h price direction is separately labeled.

Missing B/H1 excludes that coin with its reason. If the nonempty qualified current
cohort has no complete B/H1 metrics, expose `insufficient_history` and
`warming_warmup=true`, not a successful empty market. A complete cohort with no
positive eligible growth is successful empty; healthy genuinely empty input is also
successful empty. All-invalid current inputs or failed/partial/unknown coverage are
unavailable. A successful snapshot expires at age >= 900 seconds; old results cannot
masquerade as current. Freeze parameters, references, rank and exclusion diagnostics
per snapshot and reject conflicting replay. Top-50 truncation does not change cohort
diagnostics. Display percentages and multiples rounded; sort unrounded numbers.

## Cards and delivery

- New state: CoinGecko warming candidate snapshot, owned by the #3017 program.
- New process: warming hourly baseline, inside that same program; no new collector,
  message version or independent scheduled job.
- Restore #3017 with the new calculation, preserving logical ID/number/position.
- Reuse #1008 and its content-refresh/interface references, preserving identity.

The historical #6002 no longer exists in the current graph; allocate a new candidate
state instead of resurrecting/reassigning that number. New numbers are installation
specific. Channels-to-state edges are intended references, not evidence of a running
writer. The hourly process recomputes B while published snapshot references remain immutable. All
four cards use the shared details template, synthetic input/output cases, collapsible
lineage and bilingual explanation. Opening details performs no business execution.
Old scoring-input edges and managed legacy warming fields are retired only on this
path. Unknown definitions, pins, protected contracts, mappings or external dependencies
refuse migration atomically; reentry preserves later edits. Existing positions and
downstream identities are retained; no global Arrange is performed.

## Verification and limitations

```sh
node --test src/warmingDesign.test.js
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=server python3 -m unittest server.test_coingecko_warming
node scripts/check_warming_previews.mjs /absolute/path/to/saved-graph.json
node scripts/check_hottest_previews.mjs /absolute/path/to/saved-graph.json
node scripts/check_polars_module.mjs /absolute/path/to/saved-graph.json
npm run check:details -- /absolute/path/to/saved-graph.json
npm run test:contracts
npm run test:layout
npm run build
```

Synthetic checks cover allowed overlap, steady high growth, increasing/slowing growth,
plateaus/falls, hour boundaries, 75-minute exclusion, partial history, per-request recomputation, new-asset age, missing B/H1/H2, zero denominators,
late/conflicting histories, latest-invalid observations, source/coverage conflicts,
3/12-minute target skew and valid empty vs unavailable states. Python independently
compares baselines, exact history references, metrics and rankings.

Rolling volume differences equal new entering flow minus old exiting flow only under
a consistent ideal window; they cannot reconstruct true new 1h/4h volume. Coverage
changes, revisions and wash trading may produce misleading increases. Aggregates do
not identify single trades, whales or insider activity. No claimed external hit rate
is reproduced here. Real history, snapshot persistence, observation/message adaptation,
long-tail coverage, predictive quality and business deployment remain unverified.
Continuous membership is one state; reentry debounce, event diffusion and notifications
remain out of this delivery.
