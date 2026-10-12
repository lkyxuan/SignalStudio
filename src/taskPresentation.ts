import type { Graph, GraphNode, Language } from './contracts';
import { cardKind } from './cardModel';
import { edgeBindings, isScheduled } from './edgePresentation';

type TaskGraph = Pick<Graph, 'nodes' | 'edges' | 'bindings'>;
export type TaskRole = 'collection' | 'result' | 'maintenance' | 'business' | 'unknown' | 'resource';
export const roleWords: Record<TaskRole, [string, string]> = {
  collection: ['爬虫采集', 'Collection'], result: ['采集结果处理', 'Collection result processing'],
  maintenance: ['系统内部维护', 'Internal maintenance'], business: ['独立业务处理', 'Independent business processing'],
  unknown: ['职责待核对', 'Responsibility unconfirmed'], resource: ['数据资源', 'Data resource'],
};
export const roleLabel = (role: TaskRole, language: Language) => roleWords[role][language === 'zh-CN' ? 0 : 1];
const maintenanceNames = new Set(['定期 AI 检查资产地图', '人工审核资产纠错建议', '执行获批资产纠错']);
const attached = (node: GraphNode, path: string) => node.card_contract?.config.definition_refs.some(ref => ref.path === path);
const resource = (node: GraphNode) => ['table', 'state', 'channel'].includes(cardKind(node)) || node.name.startsWith('kaito.resource.');
const maintenance = (node: GraphNode) => maintenanceNames.has(node.name) && attached(node, 'catalog/identity-flow-case.v1.json');
const complete = (config: Record<string, unknown>) => !(Array.isArray(config.unresolved) && config.unresolved.length);

// Follow only explicit calls/events and channel producers. Storage reads, changes,
// plain data lineage and references cannot prove a crawler triggered a task.
export function taskRoles(graph: TaskGraph): Map<string, TaskRole> {
  const roles = new Map<string, TaskRole>();
  for (const node of graph.nodes) roles.set(node.id, resource(node) ? 'resource' : maintenance(node) ? 'maintenance' : cardKind(node) === 'source' ? 'collection' : isScheduled(node) ? 'business' : 'unknown');
  const reached = new Set(graph.nodes.filter(node => roles.get(node.id) === 'collection').map(node => node.id));
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (let pass = 0; pass < graph.nodes.length; pass++) {
    let changed = false;
    for (const edge of graph.edges) {
      const from = byId.get(edge.upstream_id), to = byId.get(edge.downstream_id);
      if (!from || !to || !reached.has(from.id) || reached.has(to.id) || maintenance(to)) continue;
      const kind = cardKind(to);
      const carriesEvent = edgeBindings(graph, edge).some(binding => complete(binding.config) &&
        (kind === 'channel' ? binding.kind === 'publish' : ['process', 'decision'].includes(kind) &&
          binding.config.trigger === 'event' && ['consume', 'control', 'data', 'error'].includes(binding.kind)));
      if (!carriesEvent) continue;
      reached.add(to.id); changed = true;
    }
    if (!changed) break;
  }
  for (const node of graph.nodes) if (roles.get(node.id) === 'unknown' && reached.has(node.id)) roles.set(node.id, 'result');
  // A declared event with an untraceable origin remains unconfirmed, even when
  // its producer happens to read data originally collected by a crawler.
  return roles;
}

export type StartKind = 'schedule' | 'manual' | 'event' | 'change' | 'unknown';
const startWords: Record<StartKind, [string, string]> = {
  schedule: ['定时', 'Scheduled'], manual: ['人工', 'Manual'], event: ['消息/事件', 'Message/event'],
  change: ['数据变化', 'Data change'], unknown: ['启动待定义', 'Start undefined'],
};
export function taskStarts(graph: TaskGraph, node: GraphNode): StartKind[] {
  if (resource(node)) return [];
  const starts = new Set<StartKind>();
  const declared = node.card_contract?.config.trigger.kind;
  if (isScheduled(node)) starts.add('schedule');
  if (declared === 'manual' || node.name === '人工审核资产纠错建议' && attached(node, 'catalog/identity-flow-case.v1.json')) starts.add('manual');
  if (declared === 'event') starts.add('event');
  if (declared === 'change') starts.add('change');
  for (const edge of graph.edges.filter(edge => edge.downstream_id === node.id && !edge.presentation_role)) {
    for (const binding of edgeBindings(graph, edge)) {
      if (!complete(binding.config)) { if (['event', 'change'].includes(binding.config.trigger || '')) starts.add('unknown'); continue; }
      if (binding.config.trigger === 'event') starts.add('event');
      if (binding.config.trigger === 'change') starts.add('change');
    }
  }
  // The attached rollup module declares both a timer and event entry; its event
  // producer is still undefined in graph bindings (see existing trigger tracing).
  if (node.name === '计算当前资产评分' && attached(node, 'catalog/score-rollup.v1.json')) starts.add('event');
  if (!starts.size) starts.add('unknown');
  return (['schedule', 'manual', 'event', 'change', 'unknown'] as StartKind[]).filter(kind => starts.has(kind));
}
export const startsLabel = (starts: StartKind[], language: Language) => starts.map(kind => startWords[kind][language === 'zh-CN' ? 0 : 1]).join(' · ');

export type TaskRegion = { id: string; role: TaskRole; x: number; y: number; width: number; height: number; count: number };
// Derive disjoint regions from current coordinates. Safe after manual dragging,
// filtering or reopening: no saved position is changed and no outsider is enclosed.
export function taskRegions(graph: TaskGraph, visibleIds?: ReadonlySet<string>): TaskRegion[] {
  const roles = taskRoles(graph);
  const boxes = graph.nodes.filter(node => !visibleIds || visibleIds.has(node.id)).map(node => ({ id: node.id, role: roles.get(node.id)!, x: node.position_x - 20, y: node.position_y - 56, width: 340, height: 224, count: 1 }));
  const intersects = (a: TaskRegion, b: TaskRegion) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const regions: TaskRegion[] = boxes.filter(box => box.role !== 'resource' && !boxes.some(other => other.role !== box.role && intersects(box, other))).sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  for (let a = 0; a < regions.length; a++) {
    for (let b = a + 1; b < regions.length; b++) {
      const first = regions[a]!, next = regions[b]!;
      if (first.role !== next.role) continue;
      const x = Math.min(first.x, next.x), y = Math.min(first.y, next.y);
      const merged = { ...first, x, y, width: Math.max(first.x + first.width, next.x + next.width) - x, height: Math.max(first.y + first.height, next.y + next.height) - y, count: first.count + next.count };
      const near = merged.width <= Math.max(first.width, next.width) + 420 && merged.height <= Math.max(first.height, next.height) + 320;
      if (!near || boxes.some(box => box.role !== first.role && intersects(merged, box))) continue;
      regions[a] = merged; regions.splice(b, 1); b = a;
    }
  }
  return regions.map(region => ({ ...region, id: `task-region:${region.id}` }));
}
