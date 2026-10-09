// Card preview only: no persistence, score publication or asset creation.
import catalog from '../catalog/asset-initial-score-sources.v1.json';
import pilot from '../catalog/identity-flow-case.v1.json';
import rollup from '../catalog/score-rollup.v1.json';

export type SourceScore = typeof catalog.rows[number];
export type InitialInput = { asset_id: string; asset_name: string | null; action: string; source_id?: string | null };
export type InitialDecision = {
  asset_id: string; asset_name: string | null; source_id: string; configuration: SourceScore;
  score_key: string; score_delta: number; decision_ref: string; decay_policy_ref: string; half_life_minutes: number;
};

export function previewInitialScore(input: InitialInput, rows: SourceScore[] = catalog.rows, saved: InitialDecision[] = []) {
  if (!input.asset_id) return { status: 'invalid_input', decision: null, added: 0 };
  const previous = saved.find(item => item.asset_id === input.asset_id && item.score_key === pilot.initial_score_policy.input_score_key);
  if (previous) return { status: 'retry', decision: previous, added: 0 };
  if (input.action === 'reused') return { status: 'reused', decision: null, added: 0 };
  if (input.action !== 'created') return { status: 'invalid_input', decision: null, added: 0 };
  const matches = rows.filter(row => row.source_id === input.source_id);
  if (matches.length !== 1) return { status: 'pending_configuration', decision: null, added: 0 };
  const config = matches[0]!;
  const decay = (rollup.configuration.decay_policies as Record<string, { half_life_minutes: number }>)[config.rule_version];
  if (!Number.isFinite(config.initial_score) || config.initial_score <= 0 || !decay
      || !Number.isFinite(config.half_life_minutes) || config.half_life_minutes <= 0
      || config.half_life_minutes !== decay.half_life_minutes) {
    return { status: 'pending_configuration', decision: null, added: 0 };
  }
  const decision: InitialDecision = {
    asset_id: input.asset_id, asset_name: input.asset_name, source_id: config.source_id, configuration: { ...config },
    score_key: pilot.initial_score_policy.input_score_key, score_delta: config.initial_score,
    decision_ref: pilot.initial_score_policy.decision_ref_template.replace('{asset_id}', input.asset_id),
    decay_policy_ref: config.rule_version, half_life_minutes: config.half_life_minutes,
  };
  return { status: 'accepted', decision, added: decision.score_delta };
}

// The observed Kaito through-line uses the table configuration, not a second fixed award.
const config = catalog.rows.find(row => row.source_id === pilot.source.operation_id)!;
export const initialScorePolicy = {
  ...pilot.initial_score_policy, score_delta: config.initial_score, decay_policy_ref: config.rule_version,
  decay: { ...pilot.initial_score_policy.decay, half_life_minutes: config.half_life_minutes },
};
