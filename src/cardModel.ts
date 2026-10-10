import model from '../catalog/card-model.v1.json';

export const cardKinds = model.kinds;
export const cardModelVersion = model.version;
export function cardKind(node: { kind?: unknown; type: string; reference_number?: number | null; is_system_state?: number }): string {
  if (typeof node.kind === 'string') return node.kind;
  const override = (model.legacy_kind_overrides as Record<string, string>)[String(node.reference_number)];
  if (override && (model.migration.expected_names as Record<string,string>)[String(node.reference_number)] === (node as {name?:string}).name) return override;
  if (node.is_system_state || ['Ranking Table', 'Asset Registry', 'Rule Registry'].includes(node.type)) return 'table';
  return ({ Source: 'source', 'Redpanda Topic': 'channel', 'Redis Window': 'state', 'Rule Evaluation': 'decision', 'Review Decision': 'decision', 'Asset Resolution': 'decision' } as Record<string, string>)[node.type] || 'process';
}
export function kindLabel(kind: string, language: string): string {
  const item = cardKinds.find(item => item.id === kind);
  return item ? language === 'zh-CN' ? item.label_zh : item.label_en : language === 'zh-CN' ? '未知定义（只读）' : 'Unknown definition (read-only)';
}
export function kindStyle(node: Parameters<typeof cardKind>[0]): string {
  return cardKinds.find(item => item.id === cardKind(node))?.style || 'metric';
}
