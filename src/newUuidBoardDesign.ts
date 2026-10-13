// Synthetic design evaluator, with explicit assumptions for unbound runtime inputs.
import spec from '../catalog/new-uuid-board.v1.json';
export type Asset = {asset_id: string; name: string | null; asset_kind: string; identity_status: string;
  created_at: string; creation_origin: string; source_refs_json: string[]};
export function selectNewUuidDesign(rows: Asset[], now: string, bindingReady = true, limit = spec.top_n) {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error('Invalid design clock');
  if (!bindingReady) return {available: false, rows: [], reason: 'creation_origin_unconnected'};
  if (rows.some(row => !['discovery','initial_import','migration','reimport','uuid_replacement'].includes(row.creation_origin)))
    return {available: false, rows: [], reason: 'creation_origin_unknown'};
  // Conflicting duplicate UUID rows are a broken complete read, not a new object.
  if (new Set(rows.map(row => row.asset_id)).size !== rows.length)
    return {available: false, rows: [], reason: 'duplicate_identity'};
  const eligible = rows.filter(row => row.asset_id && row.identity_status === 'confirmed' &&
    row.creation_origin === 'discovery' && Number.isFinite(Date.parse(row.created_at)) &&
    Date.parse(row.created_at) <= at);
  eligible.sort((a,b) => Date.parse(b.created_at) - Date.parse(a.created_at) ||
    (a.asset_id < b.asset_id ? -1 : a.asset_id > b.asset_id ? 1 : 0));
  return {available: true, reason: 'synthetic_bindings_assumed', rows: eligible.slice(0, limit).map((row,index) => ({
    asset_id: row.asset_id, asset_name: row.name, asset_kind: row.asset_kind, created_at: row.created_at,
    source_refs_json: row.source_refs_json, rank: index + 1, calculated_at: now, algorithm_version: 'new_uuid_v1',
  }))};
}
