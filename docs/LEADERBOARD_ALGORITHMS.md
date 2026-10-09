# Five leaderboard v1 execution contracts

Required behavior is owned by `catalog/leaderboard-scaffolds.v1.json` (revision
`2026-10-09-v1`). The user authorized defining all five algorithms and connecting
existing/new design cards on 2026-10-09. [Decision and rationale](https://app.notion.com/p/3f3038a63d5a81d0855de5015049f192)
and [implementation task](https://app.notion.com/p/3f4038a63d5a811eab3ff30e5e34f40c)
live in Notion. The following is the implementing system's required v1 behavior,
not a second copy of exploratory discussions. Initial numeric parameters are
chosen for a reproducible first version; their effectiveness is unverified.

## Implementation status

SignalStudio installs five algorithms into the existing 15 cards, adds five data
cards and four preparation cards, and shows synthetic paired numeric cases.
It does not execute these algorithms, start crawlers or timers, provision Redis,
create business tables, or deploy a leaderboard. There are no paired runtime
inputs/results for these five algorithms. Arithmetic and graph migration checks
validate the design representation, not signal effectiveness.

The five paths remain independent. The `total_heat` +100/seven-day demo, existing
#3010 sync, and #1007 read policy are unchanged and do not feed this v1.
An internal first rollout should validate hottest before accumulating/validating
warming and the remaining boards. Defined contracts do not authorize public
publishing. Free sustainable sources are required; existing RSS/Telegram operation
connections are proposed inputs, not evidence of continuous crawler coverage.
Specific feeds/channels, authorization and upstream-to-emitted mappings still
need verification. Kaito and market prices are not silently substituted for
original attention or opinion records.

## Evidence preparation

`归一榜单证据` consumes relevant RSS and Telegram fields, with `assets` and
`asset_identifiers` as identity lookup references. The source namespace and stable
external identifier must resolve uniquely to asset_id. Ambiguous text/tickers are
held for review; this path does not create or merge asset identities.

Retain complete original records durably before accepting evidence, using raw_ref
and a run ID in the raw archive. RSS identity uses the configured feed plus guid,
falling back to a canonical link; absent both, hold. Telegram uses the configured
account/namespace plus chat/peer ID and message ID, not message ID alone. An
adapter parses original times to UTC and supplies source_id, collected_at and
coverage_key as collector metadata; those are not invented upstream fields.
Original text/links, published_at, first collected_at and first available_at are
required. Replays retain their original times. Records with absent/future times,
missing provenance/text or unresolved identity do not enter scoring. A missing
RSS byline may use a verified original publisher as one attributed publishing
principal, with a namespaced author_id, never multiple inferred authors. Anonymous
or forwarded authors cannot be claimed as independent people for divergence.

For attention, one asset + canonical_story_id gives one contribution, choosing
its earliest available original (tie by evidence_id). Different original posts
on the same topic are separate stories. Same-author originals are capped at
three per asset per UTC hour, ordered by published_at then evidence_id. Each
accepted contribution weighs 1. Likes, volume and administrative asset creation
are not contributions in this version. Similarity deduplication accuracy and
asset attribution require review; no automatic quality success is asserted.

`leaderboard_coverage` is an explicit missing integration: the collector must
report every configured source in every five-minute bucket. A healthy bucket
requires all expected polls and completeness checks, not just a recent message.
A complete empty response may be healthy; absent telemetry, partial results,
permissions failure and missed polls are not zero attention. Source changes
produce a new coverage_key. A required window is usable only when all configured
sources and all buckets are healthy and available by the calculation cutoff.
Conservative blocking is intentional in v1; degraded-source comparisons need a
separately versioned rule, not a silent fallback.

## Common execution and storage

Use one UTC cutoff t every 300 seconds, on UTC five-minute boundaries. An input
must have published_at, collected_at and available_at at or before t. Opinion
annotations also have their own available_at. Recent windows are `(t-W, t]`;
future timestamps are invalid. Results use that cutoff as calculated_at.

Caches are versioned Hash generations under the existing per-board prefixes in
one shared Redis service. They contain the complete required dataset records,
cutoff, coverage_key and quality status. Per-card numerical inputs are derived
summaries, not a claim about observed Redis rows. Publish a generation only after
it is complete; use it consistently for the whole cycle. Old generations can
expire after 24 hours. Rebuild from durable datasets, preserving original times,
versions and references. Do not use a short cache TTL to erase first discovery.

Each board writes a complete result batch with a manifest: cycle_id, cutoff_at,
algorithm_version, coverage_key, status (`ready` or `unavailable`), reason and
result count. `ready` with zero qualifying rows is different from unavailable.
On missing coverage/history, publish unavailable with the reason; on processor
failure record a failed attempt and keep the read endpoint unavailable until a
new complete cycle, never expose a stale batch as current. Commit rows and manifest
before switching the current pointer atomically. Equal-cutoff retries are
idempotent by board/version/cycle; earlier cutoffs cannot replace newer ones.
Historical rows remain audit data, not current entries. Rows have asset_id as a
logical key *within the current board batch*. Durable storage keys additionally
include algorithm_version and cycle_id, enabling atomic removal of exits.

Select at most 50 qualifying assets per board by full-precision score descending,
then asset_id ascending; do not clamp to 99, compare scores across boards or pad
empty places. Score display may round to four decimals; ranking must not.
Read only a ready current batch with `0 <= query_time - calculated_at < 900s`.
Open pages remove expired entries and display an unavailable reason separately
from a valid empty board. This is a new per-board batch contract, not permission
to change the existing Supabase change-only synchronizer or its 180-second rule.

Retain evidence, coverage, opinion versions, history and batch audits for at least
30 days initially. Keep earliest discovery state durably beyond that retention.
Backtests use only records/annotations/coverage available at each original cutoff;
late arrivals never rewrite historical decisions into apparent earlier discoveries.

## Per-board requirements

| Board | Derived input and score | Eligibility |
| --- | --- | --- |
| Hottest | H = sum of 2^(-age_hours/6), within 24h | At least one accepted attention contribution; complete 24h coverage |
| Warming | A = latest-hour count; B = median of previous 168 complete hourly counts. Score = max(0, ln((A+2)/(B+2))) × ln(1+A) | A≥3, A>B, ≥2 attributed independent authors and ≥2 independent publishers; complete comparable history/coverage |
| Emerging | 100 × 2^(-age_hours/12) × (1+0.25×min(max(confirmations−1,0),2)) | Selected appearance age <72h; ≥1 independently supported origin; healthy coverage throughout the selected event's age |
| Cooling | ((P−H)/P) × ln(1+P); P = max heat in prior 24h | P≥5; ≥2 historical top-50 snapshots; drop≥25%; H below heat 1h ago; complete 24h comparable history and current coverage |
| Divergence | 4LS/(L+S)^2 × ln(1+L+S) per topic/horizon | ≥2 independent authors each side; weak side≥20%; original reasons, confidence≥0.8; complete 24h coverage |

### History and growth

`保存关注历史快照` computes the same hottest v1 contributions for **all** monitored
assets at every five-minute cutoff, including verified zero counts when coverage
is complete. Store heat, latest-hour count, version, coverage_key and actual
then-top-50 rank (null outside it). A new/unmapped asset without prior monitored
history has missing history; do not fabricate earlier zero snapshots.

For warming the 168 prior hourly counts refer to disjoint intervals ending at
`t-1h`, `t-2h`, …, `t-168h`, with the earliest interval starting at `t-169h`.
Take their median (mean of the middle two for 168 values). The latest hour is
excluded. This requires 169h of continuous comparable coverage. A recorded zero
is valid; an absent bucket is not. Publisher counts use verified origin identities,
not API vendor count: two Telegram channels copying one article are one publisher.
No historical baseline from a different coverage_key or heat algorithm is used.

For cooling use heat snapshots from `[t-24h,t]` at five-minute spacing, including
current H and the snapshot exactly at t-1h. Require all snapshots and coverage.
Count distinct historical top-50 cycles before t. Candidates can now be outside
top 50; all monitored assets remain available. This score describes observed
attention-scale retreat, including ordinary exponential decay; it does not claim
abnormal retreat or imply a price decline.

### First discovery

`记录首次有效发现` stores the earliest first_available_at of valid evidence for each
asset as system_first_seen, with occurred_at equal to that time for this type.
It does not use the administrative asset creation timestamp. Preserve it across
retries, coverage changes and later confirmations. A verified_launch or
source_listing needs explicit original evidence and its original event time;
an old token's new pool is neither sufficient proof of launch nor a time reset.

For each asset choose verified_launch if a verified record exists, else
source_listing if supported, else system_first_seen. If that selected type's
earliest event is expired, the asset is not reintroduced using a fresher fallback.
For each type use the earliest matching event time (tie by discovery_id), counting
only independent publishers confirming that *same* event, not a new event's
confirmations. Age is measured from occurred_at. Retain event_kind and occurred_at
in result details; 'new to our system' must never be presented as 'just issued'.
Store individual confirmations with publisher_id, evidence_id and available_at;
at each cutoff count only confirmations already available. A later corroboration
must not inflate a historical score. Emerging and divergence also read the
evidence dataset to check original collection times and retrieve source text.
The formula's 100 is an independent emerging score, not the demo total_heat posting.

### Opinions

`标注可比较观点` saves original evidence, topic_key, horizon, stance, reason,
confidence, annotation version and available_at. Annotation implementation and
accuracy are unverified. Only complete text-supported long/short records with
confidence≥0.8 enter the 24h group `(asset_id, topic_key, horizon)`. Deduplicate
reposts by original evidence and author. Choose one latest qualifying stance per
verified independent author per group, tie by opinion_id. That author cannot
supply both sides. L and S sum their unit contributions decayed with a 6h half-life.
Neutral/unknown and risk labels add neither side; L+S=0 is ineligible, no division.

Take the highest qualifying topic score for each asset, breaking topic ties by
(topic_key,horizon). Keep that group's two-sided originals and reasons in result
references/details. Opposite stances on different topics or time horizons are not
conflated. Missing classifications produce unavailable/insufficient evidence, not
fabricated opposing opinions.

## Verification and handoff

Each calculator card includes its formula, initial parameters, eligibility,
synthetic numeric case, module-owned implementation request and acceptance rules.
Implementing agents must also read its upstream datasets and these edge mappings.
Synthetic example values assume all identity/time/coverage checks passed; example
record counts do not assert collector coverage or complete history exists.

Run `python3 -m unittest discover -s server -p 'test_leaderboard*.py'` for migration
atomicity/idempotency, preserved IDs/positions, field lineage and numeric examples;
run the repository's frontend contract/layout checks and production build.
Before a real rollout, supply collector run IDs, raw records, coverage reports,
matched asset examples, actual cache generations and paired output batches.
Replay duplicates, missing history, source changes, future/late data, expired
batches, old-cycle retries, an asset exiting hottest but entering cooling, old
asset/new-pool cases and noncomparable opinions. Review each board's top ten plus
omitted candidates. No live accuracy, sustained collection or signal backtest has
been established by the design checks.
