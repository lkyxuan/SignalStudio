import type { Graph, GraphEdge, GraphNode, Language } from './contracts';
import { cardKind } from './cardModel';
import copy from '../catalog/card-detail-copy.v1.json';
import rollup from '../catalog/score-rollup.v1.json';

type RelationGraph = Pick<Graph, 'nodes' | 'edges' | 'bindings'>;
type Binding = NonNullable<Graph['bindings']>[number];
const actions = new Set(['source', 'process', 'decision']);
const words: Record<string, [string, string]> = {
  read: ['读取', 'Read'], write: ['写入', 'Write'], data: ['传递数据', 'Pass data'],
  control: ['分支控制', 'Branch control'], publish: ['发布消息', 'Publish'],
  consume: ['消费消息', 'Consume'], error: ['失败处理', 'Handle failure'], reference: ['引用', 'Reference'],
};
export function edgeBindings(graph: RelationGraph, edge: GraphEdge): Binding[] {
  return (graph.bindings || []).filter(binding => binding.edge_id === edge.id);
}

// A read belongs to its reader, a write to its writer. Never walk across shared storage.
export function edgeProcess(graph: RelationGraph, edge?: GraphEdge): GraphNode | undefined {
  if (!edge) return undefined;
  const bindings = edgeBindings(graph, edge);
  const ownerIds = new Set(bindings.map(binding =>
    ['write', 'publish'].includes(binding.kind) ? edge.upstream_id :
      ['read', 'consume', 'control', 'data', 'error'].includes(binding.kind) ? edge.downstream_id : null));
  ownerIds.delete(null);
  if (ownerIds.size !== 1) return undefined;
  return graph.nodes.find(node => ownerIds.has(node.id) && actions.has(cardKind(node)));
}

export function relationFocus(graph: RelationGraph, nodeId?: string | null, edgeId?: string | null) {
  return graph.nodes.find(node => node.id === nodeId) || edgeProcess(graph, graph.edges.find(edge => edge.id === edgeId));
}
function branchText(graph: RelationGraph, edge: GraphEdge, binding: Binding, zh: boolean): string {
  if (!binding.branch) return '';
  const source = graph.nodes.find(node => node.id === edge.upstream_id);
  const entries = copy.decisions as Record<string, { branches: Record<string, string[]> }>;
  // Module wording applies only while the original module is still attached.
  const modulePath = source?.name === '刷新判断' ? 'catalog/content-refresh.v1.json' : 'catalog/identity-flow-case.v1.json';
  const entry = source?.card_contract?.config.definition_refs.some(ref => ref.path === modulePath)
    ? entries[source.name]?.branches[binding.branch] : undefined;
  const en: Record<string, string> = { approve: 'Approved', hold: 'Held', reject: 'Rejected', matched: 'Matched', unmatched: 'Unmatched', conflict: 'Conflict', first: 'First generation', due: 'Due for refresh' };
  return zh ? entry?.[0] || binding.branch : en[binding.branch] || binding.branch;
}
function bindingText(graph: RelationGraph, edge: GraphEdge, binding: Binding, zh: boolean) {
  const relation = words[binding.kind]?.[zh ? 0 : 1] || (zh ? '待定义' : 'Undefined');
  const branch = branchText(graph, edge, binding, zh);
  const trigger = binding.config.trigger;
  let label = binding.kind === 'control' && branch
    ? trigger === 'event' ? (zh ? `${branch}后触发` : `${branch} → trigger`) : (zh ? `分支：${branch}` : `Branch: ${branch}`)
    : relation;
  if (binding.kind !== 'control' && branch) label += zh ? `（${branch}）` : ` (${branch})`;
  if (trigger === 'change') label += zh ? ' · 变化后触发' : ' · Trigger on change';
  if (trigger === 'event' && binding.kind !== 'control') label += zh ? ' · 事件触发' : ' · Event trigger';
  if (binding.kind === 'control' && trigger !== 'event' && trigger !== 'change' && trigger !== 'none') label += zh ? ' · 触发待定义' : ' · Trigger undefined';
  if (Array.isArray(binding.config.unresolved) && binding.config.unresolved.length) label += zh ? ' · 待完善' : ' · Incomplete';
  return label;
}

// Only this attached module specifies the numbered approve → read → guarded-write story.
// Other edges retain truthful relation/trigger labels; no topological execution order is inferred.
function correctionStage(graph: RelationGraph, edge: GraphEdge, binding: Binding, focus?: GraphNode) {
  if (!focus || focus.reference_number !== 3003 || focus.name !== '执行获批资产纠错' ||
      !focus.card_contract?.config.definition_refs.some(ref => ref.path === 'catalog/identity-flow-case.v1.json')) return 0;
  if (edge.downstream_id === focus.id && binding.kind === 'control' && binding.branch === 'approve' && binding.config.trigger === 'event') return 1;
  if (edge.downstream_id === focus.id && binding.kind === 'read' && binding.config.trigger === 'none') return 2;
  if (edge.upstream_id === focus.id && binding.kind === 'write' && binding.config.trigger === 'none') return 3;
  return 0;
}
export function edgePresentation(graph: RelationGraph, edge: GraphEdge | undefined, language: Language, focus?: GraphNode) {
  const zh = language === 'zh-CN';
  const bindings = edge ? edgeBindings(graph, edge) : [];
  const labels = bindings.map(binding => {
    const stage = correctionStage(graph, edge!, binding, focus);
    return stage ? (zh ? ['', '① 批准后触发', '② 读取当前记录', '③ 核对通过后写入'] : ['', '① Trigger on approval', '② Read current record', '③ Write after checks'])[stage]!
      : bindingText(graph, edge!, binding, zh);
  });
  const tones = new Set(bindings.map(binding => binding.config.trigger === 'event' || binding.config.trigger === 'change' || binding.kind === 'control' ? 'trigger' :
    binding.kind === 'read' ? 'read' : binding.kind === 'write' ? 'write' : binding.kind === 'error' ? 'error' : 'data'));
  return { label: [...new Set(labels)].join(' / ') || (zh ? '关系待定义' : 'Relation undefined'),
    tone: tones.size === 1 ? [...tones][0]! : 'data' };
}
export function focusExplanation(graph: RelationGraph, focus: GraphNode | undefined, language: Language) {
  const zh = language === 'zh-CN';
  if (!focus) return zh ? '选中连线，查看所属处理的触发、读取和去向。' : 'Select a connection to see its process, triggers, reads and destinations.';
  if (!actions.has(cardKind(focus))) return zh ? '共享存储和通道的入线、出线不自动组成执行顺序；请选择具体连线。' : 'Incoming and outgoing storage/channel connections do not imply an execution sequence. Select a connection.';
  const knownCorrection = focus.reference_number === 3003 && focus.name === '执行获批资产纠错' && focus.card_contract?.config.definition_refs.some(ref => ref.path === 'catalog/identity-flow-case.v1.json');
  if (knownCorrection) return zh ? '#4003 批准后，#3003 读取当前记录，核对通过才写回。①②③ 表示设计阶段。' : 'After #4003 approval, #3003 reads current records and writes only after checks. ①②③ describe design stages.';
  const triggers = graph.edges.filter(edge => edge.downstream_id === focus.id && edgeBindings(graph, edge).some(binding => ['event', 'change'].includes(binding.config.trigger || '')))
    .map(edge => graph.nodes.find(node => node.id === edge.upstream_id)).filter((node): node is GraphNode => !!node);
  const from = [...new Set(triggers.map(node => `#${node.reference_number ?? node.name}`))].join('、');
  return from ? (zh ? `来自 ${from} 的约定事件或变化可触发当前步骤；读取与写入按线上含义对应，不表示各输入之间有先后。` : `Specified events or changes from ${from} can trigger this step. Read/write labels do not order independent inputs.`)
    : (zh ? '已突出当前步骤的直接关系；运行时机按卡片定义，不能由读表连线推断。' : 'Direct relations of this step are highlighted. Its trigger follows the card definition, not the read arrows.');
}

function moduleSchedule(node: GraphNode) {
  const refs = node.card_contract?.config.definition_refs || [];
  if (node.name === '定期 AI 检查资产地图' && refs.some(ref => ref.path === 'catalog/identity-flow-case.v1.json')) return { interval: undefined };
  if (node.name === rollup.node.name && refs.some(ref => ref.path === 'catalog/score-rollup.v1.json')) return { interval: rollup.configuration.schedule.interval_seconds };
  return undefined;
}
export type TriggerOrigin = { node: GraphNode; reason: 'schedule' | 'manual' | 'source' | 'change' | 'event' | 'undefined' | 'cycle' };
export function traceTriggers(graph: RelationGraph, focus?: GraphNode) {
  const nodeIds = new Set<string>(), edgeIds = new Set<string>();
  const origins = new Map<string, TriggerOrigin>();
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const visited = new Set<string>();
  const addOrigin = (node: GraphNode, reason: TriggerOrigin['reason']) => origins.set(`${node.id}:${reason}`, { node, reason });
  function visit(node: GraphNode, path: Set<string>) {
    nodeIds.add(node.id);
    if (path.has(node.id)) { addOrigin(node, 'cycle'); return; }
    if (visited.has(node.id)) return;
    visited.add(node.id);
    const currentPath = new Set(path).add(node.id);
    const trigger = node.card_contract?.config.trigger.kind;
    const scheduled = trigger === 'schedule' || !!moduleSchedule(node);
    if (scheduled) addOrigin(node, 'schedule');
    if (trigger === 'manual') addOrigin(node, 'manual');
    const reviewModule = node.name === '人工审核资产纠错建议' && node.card_contract?.config.definition_refs.some(ref => ref.path === 'catalog/identity-flow-case.v1.json');
    if (reviewModule && trigger !== 'manual') addOrigin(node, 'manual');
    const incoming = graph.edges.filter(edge => edge.downstream_id === node.id && edgeBindings(graph, edge).some(binding =>
      // A channel's producer is the origin of a consumed event. Reads/writes/references are not calls.
      cardKind(node) === 'channel' ? binding.kind === 'publish' : ['event', 'change'].includes(binding.config.trigger || '')));
    if (!incoming.length && !scheduled && trigger !== 'manual' && !reviewModule) {
      addOrigin(node, cardKind(node) === 'source' ? 'source' : trigger === 'event' ? 'event' : trigger === 'change' ? 'change' : 'undefined');
    }
    if (!incoming.length && node.name === rollup.node.name && moduleSchedule(node)) addOrigin(node, 'event');
    for (const edge of incoming) {
      const source = byId.get(edge.upstream_id);
      if (!source) continue;
      edgeIds.add(edge.id); nodeIds.add(source.id);
      const changedRead = edgeBindings(graph, edge).some(binding => binding.config.trigger === 'change' && binding.kind === 'read');
      if (changedRead) addOrigin(source, 'change'); // Do not invent which writer caused the observed storage change.
      else visit(source, currentPath);
    }
  }
  if (focus && !['table', 'state'].includes(cardKind(focus))) visit(focus, new Set());
  return { nodeIds, edgeIds, origins: [...origins.values()] };
}
export function originLabel(origin: TriggerOrigin, language: Language) {
  const zh = language === 'zh-CN';
  const labels = {
    schedule: ['定时触发', 'Scheduled'], manual: ['人工触发', 'Manual'],
    source: ['来源采集 · 时机待定义', 'Source collection · timing undefined'], change: ['约定数据变化', 'Specified data change'],
    event: ['事件来源待定义', 'Event origin undefined'], undefined: ['触发来源待定义', 'Trigger origin undefined'], cycle: ['循环 · 起点待核对', 'Cycle · origin needs review'],
  };
  const interval = origin.node.card_contract?.config.trigger.interval_seconds ?? moduleSchedule(origin.node)?.interval;
  const description = origin.reason === 'schedule' && typeof interval === 'number' && interval > 0
    ? (zh ? `每 ${interval} 秒（定义）` : `Every ${interval}s (definition)`) : labels[origin.reason][zh ? 0 : 1];
  return `#${origin.node.reference_number ?? origin.node.name} · ${description}`;
}
