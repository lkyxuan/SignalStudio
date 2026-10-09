# Four simple leaderboard execution contracts

The active contract is `catalog/leaderboard-simple.v1.json`. The user narrowed
scope on 2026-10-09: preserve the existing hot leaderboard and make the other
four simple. [Decision and work record](https://app.notion.com/p/3f4038a63d5a81fb9d5ecab6e5b6fb97).
The previous advanced catalog remains for migration compatibility and optional
future inputs; it is superseded for these four boards. Its extra hottest path is
shown as a reserve draft. Do not replace #3005/#1006 or alter #3010/#1007 policies.

## Required behavior

| Board | Inputs | Score and eligibility |
| --- | --- | --- |
| Warming | Current total_heat and one-hour-old snapshot | current − previous, strictly positive; both values required |
| Cooling | Same inputs plus prior full-source rank | previous − current, strictly positive; prior rank 1–100 |
| Emerging | assets.asset_id/name/created_at | 24 − age_hours, 0 ≤ age_hours < 24 |
| Divergence | Original comparable opinions | min(supporting authors, opposing authors); both ≥ 1 |

These are independent scores, not normalized percentages. Warming/cooling are
changes in the existing composite score, including new-asset additions and
natural decay; they do not prove independent attention or negative news.
Emerging means new to this system, not newly issued. Future or missing creation
times are rejected and retries do not reset created_at. Divergence compares
opinions, not price movements or mere message volume.

## Shared snapshots and inputs

`保存现有热榜快照` consumes the five fields of #1006 asset_scores_current,
filters total_heat, preserves full precision and original calculated_at, and
adds hottest_rank by score_value descending, asset_id ascending. Store complete
successful source batches every minute in `leaderboard_heat_snapshots` for
48 hours. This is a design requirement, not an observed continuous collector.
Source batch completeness must be verified by the implementing backend; partial
source reads are not successful snapshots. Replays are idempotent on
asset_id/calculated_at and cannot renew time or replace newer batches.

For cutoff t, use the latest successful full batch at or before t, no more than
two minutes old. For the baseline use the latest batch at or before t−1h,
no more than two minutes earlier. Missing whole batches produce unavailable;
missing either side for an individual asset skips that asset. Missing is never
zero. Compare the same asset_id/total_heat only. Do not use Supabase's retained
rows as history or drop assets solely because they left the current top 100.
Cache cards assemble only the summaries shown in their input_schema; history
selection and age/count derivation use the source records before scoring.

Divergence uses published_at in [t−24h,t], available_at ≤ t, matching asset,
topic_key and horizon. Verify original text, reason, evidence reference and
independent author identity. Remove forwards. For each author/group choose the
latest original opinion by published_at descending, opinion_id ascending, then
count only explicit long/short. Latest neutral/unknown does not retain an old
stance. Keep the highest-score topic per asset, ties topic_key/horizon ascending.
Keep contributing references and selected topic in batch audit. Missing opinion
input is unavailable; a verified complete input with no qualifying groups is an
empty successful result. No confidence weights or decay are added in this version.

## Results, cadence and verification status

All four keep exactly asset_id, asset_name, score, calculated_at and
algorithm_version in their result tables. Run independent complete batches every
five minutes using one UTC cutoff. Sort unrounded score descending, asset_id
ascending, take at most 50 and atomically replace each current batch. No fillers.
Retain batch identity, readiness/error and references as batch metadata, not extra
row columns. Older/retried batches cannot overwrite newer results. Failed or
insufficient input marks unavailable; results older than 15 minutes are not shown
as current. These rules do not change the original hot-board read policy.

Implemented in SignalStudio: three revised cards per path (cache, calculation,
result), two shared snapshot cards, focused synthetic numeric cases, source
navigation and a one-time transactional migration preserving existing identities,
positions and unrelated nodes. Later edits survive repeat startup; conflicting
prior calculation definitions stop migration rather than being overwritten.

Unverified: continuous complete #1006 batches, paired one-hour history,
production created_at semantics, original opinion collection/annotation,
real board results, Redis caches, timers, crawler coverage and deployment.
The saved real #1006 database snapshot is unchanged and does not supply historical
pairs. Specified empty tables do not prove deployed tables are empty.

Run `python3 -m unittest discover -s server -p 'test_leaderboard*.py'` and
`npm run build`. Migration tests cover original hot preservation, graph identity,
field/dependency replacement, repeat startup, conflicts and rollback; numeric
case checks validate shown arithmetic, not signal effectiveness.
