import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../catalog/asset-initial-score-sources.v1.json';
import pilot from '../catalog/identity-flow-case.v1.json';
import tables from '../catalog/business-tables.v1.json';
import { previewInitialScore } from './initialScoreDesign';

const input = pilot.cases[0]!.create_result;
test('creation reads the independent configuration; existing and missing sources do not award', () => {
  const config = catalog.rows[0]!;
  assert.equal(previewInitialScore(input).added, config.initial_score);
  assert.equal(previewInitialScore({ ...input, action: 'reused' }).status, 'reused');
  assert.equal(previewInitialScore({ ...input, source_id: null }).status, 'pending_configuration');
  assert.equal(previewInitialScore({ ...input, source_id: 'x_user_id' }).decision, null);
  // A second configured channel can differ without changing the processor.
  const other = { ...config, source_id: 'synthetic-public-search', initial_score: 10 };
  assert.equal(previewInitialScore({ ...input, source_id: other.source_id }, [config, other]).added, 10);
});
test('pending can recover; retries preserve the accepted source, amount and parameters', () => {
  assert.equal(previewInitialScore(input, []).decision, null);
  const decision = previewInitialScore(input).decision!;
  const changed = [{ ...catalog.rows[0]!, initial_score: 900 }];
  const retry = previewInitialScore({ ...input, source_id: 'another-source' }, changed, [decision]);
  assert.equal(retry.status, 'retry');
  assert.equal(retry.added, 0);
  assert.deepEqual(retry.decision, decision);
  assert.equal(previewInitialScore({ ...input, action: 'reused' }, [], [decision]).added, 0);
});
test('ambiguous or invalid configurations stay pending instead of silently defaulting', () => {
  const config = catalog.rows[0]!;
  for (const rows of [[config, config], [{ ...config, initial_score: NaN }],
    [{ ...config, initial_score: -1 }], [{ ...config, half_life_minutes: 0 }],
    [{ ...config, half_life_minutes: 30 }], [{ ...config, rule_version: 'unknown/v1' }]]) {
    const result = previewInitialScore(input, rows);
    assert.equal(result.status, 'pending_configuration');
    assert.equal(result.added, 0);
  }
});
test('configuration rows fit the separate table and handoffs preserve discovery provenance', () => {
  const fields = tables.tables.asset_initial_score_sources.columns.map(col => col.name);
  assert.deepEqual(Object.keys(catalog.rows[0]!), fields);
  assert.deepEqual(tables.tables.asset_initial_score_sources.primary_key, ['source_id']);
  assert.ok(!('score_delta' in pilot.initial_score_policy));
  for (const item of pilot.cases) assert.equal(item.create_result.source_id, pilot.source.operation_id);
});
