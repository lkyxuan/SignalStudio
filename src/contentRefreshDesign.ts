// Pure design-case evaluator. No network, scheduler, database or generation calls.
import contract from '../catalog/content-refresh.v1.json';

export type Row = { asset_id: string; calculated_at: string; score_key?: string; score_value?: number; score?: number };
export type Snapshot = { key: string; available: boolean; complete: boolean; valid: boolean; rows: Row[] };
export type ContentState = {
  asset_id: string; information_key: string; content_json?: string | null;
  last_success_at?: string | null; status: string; task_version: number;
  next_retry_at?: string | null; lease_until?: string | null; last_error?: string | null;
  failure_count?: number; last_attempt_at?: string | null;
  source_refs_json?: string; data_as_of?: string | null; generator_version?: string | null;
};
export type InformationType = { key: string; enabled: boolean; binding_ready: boolean; refresh_interval_seconds?: number };
export type Decision = { asset_id: string; information_key: string; action: string; reason: string; age_minutes: number | null; due_at: number };
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function selectCandidates(snapshots: Snapshot[], now: string, boards = contract.boards): string[] {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error('Invalid design clock');
  const ids = new Set<string>();
  for (const board of boards) {
    const snapshot = snapshots.find(item => item.key === board.key);
    if (!board.enabled || !snapshot?.available || !snapshot.complete || !snapshot.valid) continue;
    const seen = new Set<string>();
    const rows = snapshot.rows.filter(row => !board.filter.score_key || row.score_key === board.filter.score_key);
    // Refuse malformed partial snapshots; never silently backfill their top N.
    if (rows.some(row => {
      const time = Date.parse(row.calculated_at);
      const duplicate = seen.has(row.asset_id);
      seen.add(row.asset_id);
      const score = row[board.score_field as 'score' | 'score_value'];
      return !row.asset_id || duplicate || typeof score !== 'number' || !Number.isFinite(score) ||
        !Number.isFinite(time) || time > at ||
        (board.max_age_seconds != null && at - time > board.max_age_seconds * 1000);
    })) continue;
    const score = (row: Row) => row[board.score_field as 'score' | 'score_value']!;
    rows.sort((a, b) => score(b) - score(a) || compare(a.asset_id, b.asset_id));
    for (const row of rows.slice(0, Math.max(0, Math.floor(board.top_n)))) ids.add(row.asset_id);
  }
  return [...ids].sort(compare);
}

export function planDesignRefresh(ids: string[], types: InformationType[], states: ContentState[], now: string): Decision[] {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error('Invalid design clock');
  const decisions: Decision[] = [];
  for (const asset_id of [...new Set(ids)].sort(compare)) for (const type of types.filter(item => item.enabled)) {
    const state = states.find(item => item.asset_id === asset_id && item.information_key === type.key);
    const interval = type.refresh_interval_seconds ?? contract.configuration.default_refresh_interval_seconds;
    const success = state?.last_success_at ? Date.parse(state.last_success_at) : NaN;
    const hasContent = state?.content_json != null && state.last_success_at != null;
    const due = hasContent ? success + interval * 1000 : -Infinity;
    let action = 'skip', reason = 'fresh';
    const invalidTime = [state?.last_success_at, state?.lease_until, state?.next_retry_at]
      .some(value => value != null && !Number.isFinite(Date.parse(value)));
    if (!type.binding_ready) { action = 'blocked'; reason = 'binding_unconnected'; }
    else if (invalidTime || success > at || interval <= 0 || !Number.isFinite(interval) ||
      (state?.status === 'running' && !state.lease_until)) { action = 'blocked'; reason = 'invalid_time_or_interval'; }
    else if (state?.next_retry_at && Date.parse(state.next_retry_at) > at) { action = 'wait'; reason = 'retry_backoff'; }
    else if (state?.status === 'queued' || (state?.status === 'running' && (!state.lease_until || Date.parse(state.lease_until) > at))) {
      action = 'wait'; reason = 'active_task';
    } else if (!hasContent) { action = 'generate'; reason = 'first_generation'; }
    else if (at >= due) { action = 'refresh'; reason = 'expired'; }
    decisions.push({ asset_id, information_key: type.key, action, reason,
      age_minutes: Number.isFinite(success) ? (at - success) / 60000 : null, due_at: due });
  }
  const priority = (d: Decision) => d.action === 'generate' ? 0 : d.action === 'refresh' ? 1 : 2;
  return decisions.sort((a, b) => priority(a) - priority(b) ||
    (a.due_at === b.due_at ? 0 : a.due_at < b.due_at ? -1 : 1) ||
    compare(a.asset_id, b.asset_id) || compare(a.information_key, b.information_key));
}

type Completion = { task_version: number; lease_until: string; now: string;
  result?: { content_json: string; source_refs_json: string; data_as_of: string | null; generator_version: string };
  error?: string };

export function settleDesignAttempt(state: ContentState, completion: Completion): ContentState {
  const at = Date.parse(completion.now);
  if (!Number.isFinite(at)) throw new Error('Invalid design clock');
  if (state.status !== 'running' || state.task_version !== completion.task_version ||
      state.lease_until !== completion.lease_until || !(Date.parse(completion.lease_until) > at)) return state;
  if (completion.result) {
    // The type-specific output validator is an external binding, not simulated here.
    return { ...state, ...completion.result, last_success_at: completion.now,
      last_attempt_at: completion.now, status: 'idle', next_retry_at: null, lease_until: null,
      last_error: null, failure_count: 0 };
  }
  const count = (state.failure_count ?? 0) + 1;
  const delays = contract.configuration.retry_delays_seconds;
  const delay = delays[count - 1] ?? contract.configuration.retry_exhausted_cooldown_seconds;
  return { ...state, status: 'failed', last_attempt_at: completion.now, lease_until: null,
    failure_count: count, last_error: completion.error || 'generation_failed',
    next_retry_at: new Date(at + delay * 1000).toISOString() };
}

export type DesignScenario = 'check' | 'failure' | 'boundary';
export type DesignAttempt = {
  asset_id: string; information_key: string; candidate_content_json: string | null;
  source_refs_json: string; data_as_of: string | null; generator_version: string | null;
  task_version: number; lease_until: string; attempt_error: string | null;
};

// Follow the same declared fictional records through four UI stages. Output and
// binding readiness are assumptions for illustration, never fetch/generator calls.
export function buildDesignPipeline(scenario: DesignScenario) {
  const demo = contract.case;
  const now = scenario === 'boundary' ? '2026-10-10T02:10:00Z' : demo.now;
  const types = [{ key: demo.information_key, enabled: true, binding_ready: true }];
  const ids = selectCandidates(demo.board_snapshots, now);
  const before: ContentState[] = ids.map(asset_id => demo.states.find(row => row.asset_id === asset_id) ?? {
    asset_id, information_key: demo.information_key, content_json: null, last_success_at: null,
    status: 'idle', task_version: 0, next_retry_at: null, failure_count: 0,
  });
  const decisions = planDesignRefresh(ids, types, before, now);
  const eligible = decisions.filter(row => row.action === 'generate' || row.action === 'refresh');
  const attempts: DesignAttempt[] = [];
  const saved = new Map(before.map(row => [row.asset_id, row]));
  const claimed: ContentState[] = [];
  for (const decision of eligible) {
    const state = saved.get(decision.asset_id)!;
    const running = { ...state, status: 'running', task_version: state.task_version + 1,
      lease_until: new Date(Date.parse(now) + 300000).toISOString() };
    claimed.push(running);
    const sample = demo.generated_samples.find(row => row.asset_id === decision.asset_id)!;
    const failure = scenario === 'failure' && decision.asset_id === 'demo-B';
    const attempt = { asset_id: state.asset_id, information_key: state.information_key,
      candidate_content_json: failure ? null : sample.candidate_content_json,
      source_refs_json: failure ? '[]' : sample.source_refs_json,
      data_as_of: sample.data_as_of, generator_version: failure ? null : sample.generator_version,
      task_version: running.task_version, lease_until: running.lease_until,
      attempt_error: failure ? 'synthetic_fetch_timeout' : null };
    attempts.push(attempt);
    saved.set(state.asset_id, settleDesignAttempt(running, {
      task_version: attempt.task_version, lease_until: attempt.lease_until, now,
      ...(failure ? { error: attempt.attempt_error! } : { result: {
        content_json: sample.candidate_content_json, source_refs_json: sample.source_refs_json,
        data_as_of: sample.data_as_of, generator_version: sample.generator_version,
      } }),
    }));
  }
  const after = [...saved.values()];
  return { now, before, candidates: ids.map(asset_id => ({ asset_id })), decisions, eligible,
    claimed, attempts, after, recheck: planDesignRefresh(ids, types, after, now) };
}
