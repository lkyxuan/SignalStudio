import assert from 'node:assert/strict';
import test from 'node:test';
import contract from '../catalog/content-refresh.v1.json';
import { buildDesignPipeline, selectCandidates, planDesignRefresh, settleDesignAttempt, type ContentState, type Snapshot } from './contentRefreshDesign';

const now = contract.case.now;
const type = { key: contract.case.information_key, enabled: true, binding_ready: true };
const state = contract.case.states[1]!;

test('four-stage case hands only eligible content keys to generation and preserves fresh content', () => {
  const flow = buildDesignPipeline('check');
  assert.deepEqual(flow.candidates.map(row => row.asset_id), ['demo-A', 'demo-B', 'demo-C']);
  assert.deepEqual(flow.eligible.map(row => row.asset_id), ['demo-C', 'demo-B']);
  assert.deepEqual(flow.attempts.map(row => row.asset_id), flow.eligible.map(row => row.asset_id));
  assert.deepEqual(flow.after.find(row => row.asset_id === 'demo-A'), flow.before.find(row => row.asset_id === 'demo-A'));
  for (const attempt of flow.attempts) {
    const before = flow.before.find(row => row.asset_id === attempt.asset_id)!;
    const saved = flow.after.find(row => row.asset_id === attempt.asset_id)!;
    assert.equal(attempt.task_version, before.task_version + 1);
    assert.equal(saved.content_json, attempt.candidate_content_json);
    assert.equal(saved.last_success_at, flow.now);
    assert.equal(saved.lease_until, null);
  }
  assert.ok(flow.recheck.every(row => row.reason === 'fresh'));
  const boundary = buildDesignPipeline('boundary');
  assert.equal(boundary.eligible.find(row => row.asset_id === 'demo-A')?.age_minutes, 30);
  assert.equal(boundary.attempts.length, 3);
});

test('four-stage failure carries the error to saving and independent success to the next check', () => {
  const flow = buildDesignPipeline('failure');
  const attempt = flow.attempts.find(row => row.asset_id === 'demo-B')!;
  assert.equal(attempt.candidate_content_json, null);
  assert.equal(attempt.attempt_error, 'synthetic_fetch_timeout');
  const previous = flow.before.find(row => row.asset_id === 'demo-B')!;
  const failed = flow.after.find(row => row.asset_id === 'demo-B')!;
  for (const field of ['content_json', 'last_success_at', 'source_refs_json', 'data_as_of', 'generator_version'] as const)
    assert.equal(failed[field], previous[field]);
  assert.equal(failed.next_retry_at, '2026-10-10T02:01:00.000Z');
  assert.equal(flow.recheck.find(row => row.asset_id === 'demo-B')?.reason, 'retry_backoff');
  assert.equal(flow.recheck.find(row => row.asset_id === 'demo-C')?.reason, 'fresh');
  assert.equal(flow.after.find(row => row.asset_id === 'demo-C')?.last_success_at, flow.now);
});

test('top N is per board, after ranking and eligibility; cross-board IDs merge without using names', () => {
  const boards = contract.boards.map(board => ({ ...board, top_n: 1 }));
  assert.deepEqual(selectCandidates(contract.case.board_snapshots, now, boards), ['demo-A']);
  assert.deepEqual(selectCandidates(contract.case.board_snapshots, now), ['demo-A', 'demo-B', 'demo-C']);
  const snapshot: Snapshot = { ...contract.case.board_snapshots[0]!, rows: [
    { asset_id: 'other-score', score_key: 'other', score_value: 999, calculated_at: now },
    { asset_id: 'z', score_key: 'total_heat', score_value: 1, calculated_at: now },
    { asset_id: 'a', score_key: 'total_heat', score_value: 1, calculated_at: now },
  ] };
  assert.deepEqual(selectCandidates([snapshot], now, boards), ['a']);
});

test('bad, unavailable, incomplete or expired snapshots never masquerade as current candidates', () => {
  const board = contract.case.board_snapshots[1]!;
  for (const patch of [{ available: false }, { complete: false }, { valid: false }]) {
    assert.deepEqual(selectCandidates([{ ...board, ...patch }], now), []);
  }
  for (const time of ['invalid', '2026-10-10T02:01:00Z', '2026-10-10T01:44:59Z']) {
    assert.deepEqual(selectCandidates([{ ...board, rows: [{ asset_id: 'a', score: 1, calculated_at: time }] }], now), []);
  }
  // One bad row invalidates this snapshot, rather than silently filling its spot.
  assert.deepEqual(selectCandidates([{ ...board, rows: [...board.rows, { ...board.rows[0]! }] }], now), []);
  assert.deepEqual(selectCandidates([{ ...board, rows: [{ asset_id: 'a', score: 1, calculated_at: '2026-10-10T01:45:00Z' }] }], now), ['a']);
  assert.deepEqual(selectCandidates([{ ...board, available: false }, contract.case.board_snapshots[0]!], now), ['demo-A', 'demo-B']);
});

test('the visible through-line case derives first generation, due refresh and fresh skip', () => {
  const decisions = planDesignRefresh(selectCandidates(contract.case.board_snapshots, now), [type], contract.case.states, now);
  assert.deepEqual(decisions.map(({ asset_id, action, age_minutes, reason }) => ({ asset_id, action, age_minutes, reason })), contract.case.expected);
  const boundary = planDesignRefresh(['demo-A'], [type], contract.case.states, '2026-10-10T02:10:00Z');
  assert.equal(boundary[0]?.action, 'refresh');
  const independent = planDesignRefresh(['demo-A', 'demo-A'], [type, { ...type, key: 'other' }], contract.case.states, now);
  assert.equal(independent.length, 2);
  assert.equal(independent.find(d => d.information_key === 'other')?.action, 'generate');
  assert.deepEqual(planDesignRefresh([], [type], contract.case.states, now), []); // exit
  assert.equal(planDesignRefresh(['demo-B'], [type], contract.case.states, now)[0]?.action, 'refresh'); // re-entry
  assert.deepEqual(planDesignRefresh(['demo-A'], [{ ...type, enabled: false }], [], now), []);
  assert.equal(planDesignRefresh(['demo-A'], [{ ...type, binding_ready: false }], [], now)[0]?.action, 'blocked');
  assert.equal(planDesignRefresh(['demo-A'], [type], [{ ...contract.case.states[0]!, last_success_at: '2026-10-11T00:00:00Z' }], now)[0]?.action, 'blocked');
});

test('failure preserves all successful fields; polling cannot bypass retries or a running lease', () => {
  const running: ContentState = { ...state, status: 'running', lease_until: '2026-10-10T02:05:00Z',
    source_refs_json: '["old-source"]', data_as_of: '2026-10-10T00:55:00Z', generator_version: 'old/v1' };
  const failed = settleDesignAttempt(running, { task_version: running.task_version, lease_until: running.lease_until!, now, error: 'timeout' });
  for (const key of ['content_json', 'last_success_at', 'source_refs_json', 'data_as_of', 'generator_version'] as const) assert.equal(failed[key], running[key]);
  assert.equal(failed.next_retry_at, '2026-10-10T02:01:00.000Z');
  assert.equal(planDesignRefresh(['demo-B'], [type], [failed], now)[0]?.reason, 'retry_backoff');
  assert.equal(planDesignRefresh(['demo-B'], [type], [failed], failed.next_retry_at!)[0]?.action, 'refresh');
  assert.equal(planDesignRefresh(['demo-B'], [type], [running], now)[0]?.reason, 'active_task');
  assert.equal(planDesignRefresh(['demo-B'], [type], [running], '2026-10-10T02:05:00Z')[0]?.action, 'refresh');
  assert.equal(planDesignRefresh(['demo-B'], [type], [{ ...state, status: 'queued' }], now)[0]?.reason, 'active_task');
  assert.equal(planDesignRefresh(['demo-B'], [type], [{ ...state, status: 'running' }], now)[0]?.action, 'blocked');
  for (const [failure_count, expected] of [[1, 300], [2, 900], [3, 1800], [4, 1800]]) {
    const output = settleDesignAttempt({ ...running, failure_count }, { task_version: running.task_version, lease_until: running.lease_until!, now });
    assert.equal(Date.parse(output.next_retry_at!) - Date.parse(now), expected! * 1000);
  }
});

test('completion requires the current unexpired lease; a started task can finish after exit', () => {
  const running: ContentState = { ...state, status: 'running', lease_until: '2026-10-10T02:05:00Z', failure_count: 3 };
  const completion = { task_version: running.task_version, lease_until: running.lease_until!, now,
    result: { content_json: '{"text":"new"}', source_refs_json: '["source"]', data_as_of: null, generator_version: 'demo/v1' } };
  assert.equal(settleDesignAttempt(running, { ...completion, task_version: 0 }), running);
  assert.equal(settleDesignAttempt(running, { ...completion, lease_until: '2026-10-10T02:04:00Z' }), running);
  assert.equal(settleDesignAttempt(running, { ...completion, now: running.lease_until! }), running);
  const success = settleDesignAttempt(running, completion);
  assert.equal(success.last_success_at, now);
  assert.equal(success.data_as_of, null); // generation time is not source time
  assert.equal(success.content_json, completion.result.content_json);
  assert.equal(success.failure_count, 0);
  assert.equal(success.next_retry_at, null);
  assert.equal(contract.information_types.length, 0); // no fake production generators
  assert.equal(contract.result.observed_rows.length, 0);
});
