import test from 'node:test';
import assert from 'node:assert/strict';
import { firstInput, previewTrending, previewDecayedSum, trendingCases } from './coingeckoTrendingDesign';
import rollup from '../catalog/score-rollup.v1.json';

test('same slot retries freeze decision and mapping; next slot earns another ten', () => {
  const first = previewTrending(firstInput).decision!;
  assert.equal(first.score_delta, 10);
  assert.equal(first.half_life_minutes, 30);
  const retry = previewTrending({ ...firstInput, asset_id: 'changed', run_id: 'retry' }, [first]);
  assert.equal(retry.added, 0);
  assert.equal(retry.decision, first);
  const next = previewTrending(trendingCases[1]!.input, [first]);
  assert.equal(next.added, 10);
  assert.notEqual(next.decision!.decision_ref, first.decision_ref);
  assert.equal(previewTrending({ ...firstInput, source_rank_zero_based: 14 }).added, 10);
});

test('failed, absent, unresolved, conflicting and late inputs never earn', () => {
  for (const sample of trendingCases.slice(3)) assert.equal(previewTrending(sample.input, sample.accepted).added, 0, sample.label);
  for (const rank of [-1, 15, 0.5, NaN]) assert.equal(previewTrending({ ...firstInput, source_rank_zero_based: rank }).added, 0);
  assert.equal(previewTrending({ ...firstInput, slot_start: '2026-10-10T00:01:00Z' }).added, 0);
  assert.equal(previewTrending({ ...firstInput, collected_at: '2026-10-10T00:30:00Z' }).added, 0);
});

test('per-event decay retains fractional minutes and sums mixed policies', () => {
  const base = Date.parse('2026-10-10T00:00:00Z');
  const time = (minutes: number) => new Date(base + minutes * 60_000).toISOString();
  const events = [0, 30, 60, 90].map(minutes => ({ score_delta: 10, half_life_minutes: 30, created_at: time(minutes) }));
  [10, 15, 17.5, 18.75].forEach((expected, index) => assert.equal(previewDecayedSum(events.slice(0, index + 1), time(index * 30)), expected));
  assert.equal(previewDecayedSum(events, time(120)), 9.375);
  assert.equal(previewDecayedSum([events[0]!], time(0.5)), 10 * 2 ** (-0.5 / 30));
  const mixed = [{ score_delta: 100, half_life_minutes: 10080, created_at: time(0) }, events[0]!];
  assert.equal(previewDecayedSum(mixed, time(30)), 100 * 2 ** (-30 / 10080) + 5);
  assert.equal(rollup.configuration.decay_policies['asset_initial_score/v1'].half_life_minutes, 10080);
  assert.equal(rollup.configuration.decay_policies['coingecko_trending/v1'].half_life_minutes, 30);
});
