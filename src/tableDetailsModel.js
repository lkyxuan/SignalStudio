import business from '../catalog/business-tables.v1.json';
import pages from '../catalog/asset-pages.v1.json';
import weights from '../catalog/dynamic-weights.v1.json';

// Use the same canonical business schemas as the previous table cards. Other
// tables use saved graph fields, never example rows or a crawler's raw response.
export function tableDefinition(node, graph) {
  const declared = node.name === pages.table.name ? pages.table
    : weights.tables[node.name] || business.tables[node.name];
  const fields = (graph.fields || []).filter(f => f.node_id === node.id).sort((a, b) => a.ordinal - b.ordinal);
  const columns = declared?.columns || fields.map(f => ({
    name: f.name, type: f.data_type, label_zh: f.definition,
    label_en: f.definition_en, unit: f.unit,
    min_value: f.min_value, max_value: f.max_value,
  }));
  return { columns, primary_key: declared?.primary_key || node.card_contract?.config.resource?.primary_key || [],
    unique_keys: declared?.unique_keys || [], editable: !declared &&
      !node.card_contract?.config.definition_refs?.length, fields };
}

export const tableRecordsEndpoint = node => node.name === 'asset_scores_current'
  ? '/table-backfills/1006' : null;

export function tableRecordsResult(data) {
  if (!data || !Array.isArray(data.rows)) throw new Error('Invalid table response');
  if (!data.snapshot) {
    if (data.rows.length) throw new Error('Missing data source');
    return { status: 'empty', rows: [] };
  }
  // Replays are useful for calculation checks, but are not observed table rows.
  if (data.snapshot.evidence_kind === 'offline_replay') return { status: 'replay', rows: [] };
  if (data.snapshot.evidence_kind !== 'database_snapshot' || !data.snapshot.source?.captured_at ||
      !data.snapshot.source?.system || !data.snapshot.source?.environment || !data.snapshot.source?.location) {
    throw new Error('Missing database snapshot provenance');
  }
  return { status: data.rows.length ? 'snapshot' : 'empty', rows: data.rows, source: data.snapshot.source };
}

// Read request and read-result edges describe the same reader. Classify by
// validated bindings first, then deduplicate per card and role.
export function tableFlow(relations) {
  const groups = { writers: new Map(), readers: new Map(), references: new Map() };
  for (const relation of relations) {
    if (!relation.other) continue;
    const kinds = new Set(relation.bindings.map(b => b.kind));
    const roles = [];
    if (kinds.has('write')) roles.push('writers');
    if (kinds.has('read')) roles.push('readers');
    if (!roles.length) roles.push('references');
    for (const role of roles) groups[role].set(relation.other.id, relation.other);
  }
  return Object.fromEntries(Object.entries(groups).map(([key, nodes]) => [key, [...nodes.values()]]));
}

// Named storage choices from the existing scoring and translation contracts.
// A design choice is not a verified physical binding.
export function tableTechnology(node, zh) {
  const config = node.card_contract?.config || {};
  const resource = config.resource || {};
  const translation = config.definition_refs?.some(ref => ref.path === 'catalog/worth-reading-translation.v1.json');
  let storage = resource.technology || config.technology;
  if (!storage && translation) storage = node.name.startsWith('app_') ? 'Supabase（PostgreSQL）' : 'PostgreSQL';
  if (!storage && node.name === 'supabase_asset_scores') storage = 'Supabase（PostgreSQL）';
  if (!storage && node.name === 'asset_score_events') storage = 'Delta / Parquet';
  const snapshot = node.name === 'asset_scores_current';
  return {
    storage: storage || (snapshot ? 'PostgreSQL' : zh ? '待确定' : 'To be determined'),
    note: snapshot
      ? zh ? '已有测试网 PostgreSQL 结果快照；这里读取保存的快照，尚未接入实时查询。' : 'A saved testnet PostgreSQL snapshot is available; live queries are not connected.'
      : storage ? zh ? '这是当前设计或代码记录的存储方案，实际接入情况见“真实数据”。' : 'Storage from the current design or code records; see Actual data for connection status.'
        : zh ? '尚未确定具体数据库或存储方案。' : 'A database or storage choice has not been specified.',
  };
}
