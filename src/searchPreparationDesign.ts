// Pure design evaluation. No source reads, searches, writes or generation.
import spec from '../catalog/search-preparation.v1.json';
export type SearchPolicy = 'realtime_search_required' | 'coverage_based';
export type Material = {
  asset_id: string; material_key: string; source_ref: string; text: string;
  published_at: string | null; fetched_at: string; expires_at: string;
};
export type SearchOutcome = { status: 'success' | 'empty' | 'failed' | 'unconnected'; results: Material[]; error?: string };
export type PreparationInput = {
  asset_id: string; information_key: string; task_version: number; lease_until: string; now: string;
  required_keys: string[]; existing: Material[]; search: SearchOutcome; policy?: SearchPolicy;
};
export function prepareMaterials(input: PreparationInput) {
  const at = Date.parse(input.now);
  if (!Number.isFinite(at)) throw new Error('Invalid preparation clock');
  const policy = input.policy ?? spec.default_search_policy as SearchPolicy;
  const validTask = !!input.asset_id && !!input.information_key && input.required_keys.length > 0 &&
    Number.isInteger(input.task_version) && input.task_version > 0 && Date.parse(input.lease_until) > at;
  const usable = (m: Material) => m.asset_id === input.asset_id && !!m.source_ref && !!m.text &&
    !!m.material_key && Number.isFinite(Date.parse(m.fetched_at)) && Date.parse(m.fetched_at) <= at &&
    Date.parse(m.expires_at) > at && (m.published_at === null ||
      (Number.isFinite(Date.parse(m.published_at)) && Date.parse(m.published_at) <= at));
  const existing = input.existing.filter(usable);
  const covered = new Set(existing.map(m => m.material_key));
  const coverageGaps = input.required_keys.filter(key => !covered.has(key));
  const gaps = policy === 'realtime_search_required' ? [...input.required_keys] : coverageGaps;
  const route = !validTask ? 'blocked' : policy === 'realtime_search_required' || gaps.length ? 'need_search' : 'enough';
  // This evaluator assumes a successful current search response belongs to this
  // input task. The real adapter must verify query/task identity before invoking it.
  const searched = route === 'need_search' && input.search.status === 'success' ? input.search.results.filter(usable) : [];
  const joined = [...existing, ...searched];
  const unique = joined.filter((m, i) => joined.findIndex(other => other.source_ref === m.source_ref &&
    other.material_key === m.material_key && other.text === m.text && other.published_at === m.published_at) === i);
  const allCovered = new Set(unique.map(m => m.material_key));
  const missing = input.required_keys.filter(key => !allCovered.has(key));
  // Current policy requires current search evidence, even with a complete cache.
  const realtimeMissing = policy === 'realtime_search_required' ? input.required_keys.filter(key =>
    !searched.some(m => m.material_key === key)) : [];
  let error: string | null = null;
  if (route === 'blocked') error = 'invalid_preparation_request';
  else if (route === 'need_search' && input.search.status !== 'success')
    error = input.search.error || `search_${input.search.status}`;
  else if (missing.length || realtimeMissing.length) error = 'insufficient_source_evidence';
  const times = unique.map(m => m.published_at);
  const dataAsOf = !times.length || times.some(t => t === null) ? null :
    new Date(Math.min(...times.map(t => Date.parse(t!)))).toISOString();
  return { policy, route, existing, gaps, coverage_gaps: coverageGaps, searched, materials: unique, missing,
    preparation_error: error, ready: !error, source_refs_json: JSON.stringify([...new Set(unique.map(m => m.source_ref))]),
    data_as_of: dataAsOf };
}

export function preparationCase(asset_id: string, information_key: string, task_version: number,
  lease_until: string, now: string, scenario: 'check' | 'failure' | 'boundary' | 'enough' | 'empty' | 'unconnected' = 'check') {
  const material = (suffix: string): Material => ({ asset_id, material_key: 'news',
    source_ref: `https://example.invalid/design/${asset_id}/${suffix}`, text: '虚构比特币新闻资料，仅用于演示资料流转',
    published_at: null, fetched_at: now, expires_at: new Date(Date.parse(now) + 600000).toISOString() });
  const input: PreparationInput = { asset_id, information_key, task_version, lease_until, now,
    required_keys: ['news'], existing: [{ ...material('stored'), fetched_at: new Date(Date.parse(now) - 300000).toISOString() }], policy: scenario === 'enough' ? 'coverage_based' : 'realtime_search_required',
    search: scenario === 'failure' ? { status: 'failed', results: [], error: 'synthetic_fetch_timeout' }
      : scenario === 'empty' ? { status: 'empty', results: [] }
      : scenario === 'unconnected' ? { status: 'unconnected', results: [] }
      : { status: 'success', results: [material('live-search')] } };
  const result = prepareMaterials(input);
  const key = { asset_id, information_key, task_version, lease_until };
  const query_key = `${asset_id}:${information_key}:news:synthetic-workflow-v1`;
  const decision = { ...key, route: result.route, gaps_json: JSON.stringify(result.gaps), search_policy: result.policy };
  const read = { ...key, materials_json: JSON.stringify(result.existing), gaps_json: decision.gaps_json, search_policy: result.policy };
  const search = result.route !== 'need_search' ? [] : [{ ...key, query_key,
    query_json: JSON.stringify({ asset_id, material_keys: ['news'], time_range: 'synthetic-current-window', workflow_version: 'synthetic-v1' }),
    results_json: JSON.stringify(result.searched), search_status: input.search.status,
    fetched_at: input.search.status === 'success' || input.search.status === 'empty' ? now : null,
    expires_at: input.search.status === 'success' || input.search.status === 'empty' ? material('x').expires_at : null,
    attempt_error: input.search.error ?? (input.search.status === 'unconnected' ? 'search_unconnected' : null) }];
  const assembled = { ...key, prepared_materials_json: JSON.stringify(result.materials), source_refs_json: result.source_refs_json,
    data_as_of: result.data_as_of, preparation_error: result.preparation_error };
  // On failure the last successful cache remains, with separate attempt state.
  const cache = search.map(row => ({ ...row, results_json: row.search_status === 'success' || row.search_status === 'empty'
    ? row.results_json : JSON.stringify(input.existing), fetched_at: row.fetched_at ?? input.existing[0]!.fetched_at,
    expires_at: row.expires_at ?? input.existing[0]!.expires_at }));
  const cachedBefore = { ...key, query_key, query_json: JSON.stringify({ asset_id, material_keys: ['news'], workflow_version: 'synthetic-v1' }),
    results_json: JSON.stringify(input.existing), search_status: 'success', fetched_at: input.existing[0]!.fetched_at,
    expires_at: input.existing[0]!.expires_at, attempt_error: null };
  return { input, result, read, decision, search, cache, cachedBefore, assembled };
}
