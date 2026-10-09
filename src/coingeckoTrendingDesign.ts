// Deterministic, synthetic card preview. No collection, persistence or publishing.
import catalog from '../catalog/coingecko-trending-contribution.v1.json';

export interface TrendingInput {
  coin_id: string;
  source_rank_zero_based: number;
  slot_start: string;
  collected_at: string;
  run_id: string;
  snapshot_ref: string;
  listed: boolean;
  source_ok: boolean;
  identity: 'unique' | 'missing' | 'conflict';
  asset_id: string | null;
  asset_name: string | null;
}
export interface TrendingDecision {
  asset_id: string;
  asset_name: string | null;
  score_key: string;
  score_delta: number;
  decision_ref: string;
  decay_policy_ref: string;
  half_life_minutes: number;
}

export function previewTrending(input: TrendingInput, accepted: TrendingDecision[] = []) {
  const slot = Date.parse(input.slot_start);
  const collected = Date.parse(input.collected_at);
  if (!Number.isFinite(slot) || slot % 1_800_000 !== 0 || !Number.isFinite(collected)
      || collected < slot || collected >= slot + 1_800_000) {
    return { status: 'invalid_or_late', decision: null, added: 0 };
  }
  if (!input.source_ok) return { status: 'source_failed', decision: null, added: 0 };
  if (!input.listed) return { status: 'not_listed', decision: null, added: 0 };
  if (!input.coin_id || !Number.isInteger(input.source_rank_zero_based)
      || input.source_rank_zero_based < 0 || input.source_rank_zero_based >= catalog.source_limit) {
    return { status: 'invalid_record', decision: null, added: 0 };
  }
  const ref = `${catalog.rule.version}/${encodeURIComponent(input.coin_id)}/${new Date(slot).toISOString()}`;
  // A frozen decision wins over subsequent mapping changes or retries.
  const previous = accepted.find(item => item.decision_ref === ref);
  if (previous) return { status: 'retry', decision: previous, added: 0 };
  if (input.identity !== 'unique' || !input.asset_id) return { status: 'identity_pending', decision: null, added: 0 };
  const decision: TrendingDecision = {
    asset_id: input.asset_id, asset_name: input.asset_name,
    score_key: catalog.rule.score_key, score_delta: catalog.rule.score_delta,
    decision_ref: ref, decay_policy_ref: catalog.rule.decay_policy_ref,
    half_life_minutes: catalog.rule.half_life_minutes,
  };
  return { status: 'accepted', decision, added: catalog.rule.score_delta };
}

export function previewDecayedSum(events: { score_delta: number; created_at: string; half_life_minutes: number }[], at: string) {
  const time = Date.parse(at);
  if (!Number.isFinite(time)) throw new Error('Invalid calculation time');
  return events.reduce((sum, event) => {
    const created = Date.parse(event.created_at);
    if (!Number.isFinite(created) || !Number.isFinite(event.score_delta)
        || !Number.isFinite(event.half_life_minutes) || event.half_life_minutes <= 0) throw new Error('Invalid contribution');
    return sum + event.score_delta * 2 ** (-Math.max(0, (time - created) / 60_000) / event.half_life_minutes);
  }, 0);
}

export const firstInput: TrendingInput = {
  coin_id: 'bitcoin', source_rank_zero_based: 0, slot_start: '2026-10-10T00:00:00Z',
  collected_at: '2026-10-10T00:00:05Z', run_id: 'synthetic-run-001', snapshot_ref: 'synthetic-snapshot-001',
  listed: true, source_ok: true, identity: 'unique', asset_id: 'synthetic-asset-btc', asset_name: 'Bitcoin',
};
const first = previewTrending(firstInput).decision!;
export const trendingCases = [
  { label: '首次上榜', input: firstInput, accepted: [] },
  { label: '下一轮仍上榜', input: { ...firstInput, slot_start: '2026-10-10T00:30:00Z', collected_at: '2026-10-10T00:30:05Z', run_id: 'synthetic-run-002', snapshot_ref: 'synthetic-snapshot-002' }, accepted: [first] },
  { label: '同轮请求重试', input: { ...firstInput, run_id: 'synthetic-run-retry' }, accepted: [first] },
  { label: '成功采集但已离榜', input: { ...firstInput, slot_start: '2026-10-10T00:30:00Z', collected_at: '2026-10-10T00:30:05Z', listed: false }, accepted: [first] },
  { label: '采集失败', input: { ...firstInput, slot_start: '2026-10-10T00:30:00Z', collected_at: '2026-10-10T00:30:05Z', source_ok: false }, accepted: [first] },
  { label: '身份未匹配', input: { ...firstInput, identity: 'missing' as const, asset_id: null }, accepted: [] },
  { label: '身份冲突', input: { ...firstInput, identity: 'conflict' as const, asset_id: null }, accepted: [] },
  { label: '响应跨槽迟到', input: { ...firstInput, collected_at: '2026-10-10T00:30:01Z' }, accepted: [] },
];
