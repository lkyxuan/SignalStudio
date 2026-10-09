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
