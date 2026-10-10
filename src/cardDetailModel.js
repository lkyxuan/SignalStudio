import { cardKind, cardKinds } from './cardModel';
import copy from '../catalog/card-detail-copy.v1.json';
import refresh from '../catalog/content-refresh.v1.json';
import simple from '../catalog/leaderboard-simple.v1.json';
import scaffolds from '../catalog/leaderboard-scaffolds.v1.json';
import initial from '../catalog/asset-initial-score-sources.v1.json';
import trending from '../catalog/coingecko-trending-contribution.v1.json';
import reference from '../catalog/coingecko-implemented-signals.v1.json';
import sync from '../catalog/supabase-score-sync.v1.json';
import sources from '../catalog/source-contracts.v1.json';
import rollup from '../catalog/score-rollup.v1.json';

export const isCatalogSource = name => sources.operations.some(item => item.id === name) || sources.resources.some(item => item.id === name);

export function detailKind(node) {
  const kind = cardKind(node);
  return cardKinds.some(item => item.id === kind) ? kind : 'unknown';
}
export function resourceSettings(node) {
  const resource = node.card_contract?.config.resource;
  if (resource && !resource.legacy_settings_ref) return resource;
  try { const value = JSON.parse(node.notes || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; }
}
// Bind display-only fallback copy to its original module identity, never to a reused card number.
function acceptedCopy(node) {
  const entry = copy.explanations[node.name];
  const refs = node.card_contract?.config.definition_refs || [];
  return entry && entry.definition_refs.some(path => refs.some(ref => ref.path === path)) ? entry : null;
}
export function cardExplanation(node, language) {
  const zh = language === 'zh-CN';
  const stage = refresh.stages.find(item => item.name === node.name);
  const board = simple.boards.find(item => item.calculator_name === node.name);
  const prep = scaffolds.preprocessors.find(item => item.name === node.name);
  const referenceCard = reference.cards.find(item => item.name === node.name);
  const moduleNode = [initial.node, trending.node, sync.node].find(item => item.name === node.name);
  if (zh && stage) return stage.algorithm_zh;
  if (zh && board) return board.description;
  if (zh && prep) return prep.algorithm_zh;
  if (zh && referenceCard) return referenceCard.algorithm;
  if (moduleNode) return (zh ? moduleNode.formula : moduleNode.formula_en) || node.formula;
  if (node.formula?.trim()) return node.formula;
  return acceptedCopy(node)?.[zh ? 'zh' : 'en'] || '';
}
export function executionSummary(node, language) {
  const zh = language === 'zh-CN';
  const stage = refresh.stages.find(item => item.name === node.name);
  if (stage) return stage.trigger_zh;
  if (node.name === rollup.node.name) return zh ? '新贡献成功写入 #6001 后立即计算受影响资产；另每 60 秒刷新全部事件资产的衰减（已确认定义，运行另行核对）。' : 'Recompute affected assets after a new #6001 contribution; refresh all event assets every 60 seconds (approved definition; runtime separately verified).';
  const trigger = node.card_contract?.config.trigger || {};
  if (trigger.kind === 'schedule' && trigger.interval_seconds > 0) return zh ? `每 ${trigger.interval_seconds} 秒运行（定义）。` : `Every ${trigger.interval_seconds} seconds (definition).`;
  const labels = zh ? { manual:'人工开始。',event:'收到约定事件后开始。',change:'约定数据变化后开始。' } : {manual:'Start manually.',event:'Start on the specified event.',change:'Start on the specified data change.'};
  return labels[trigger.kind] || (zh ? '运行时机沿用所属模块；未明确的触发条件保持待定义。' : 'Use the owning module’s trigger; unspecified conditions remain undefined.');
}
export function cardRelations(node, graph) {
  const ports = new Map((graph.ports || []).map(port => [port.id, port]));
  return graph.edges.filter(edge => edge.upstream_id === node.id || edge.downstream_id === node.id).map(edge => {
    const incoming = edge.downstream_id === node.id;
    const other = graph.nodes.find(item => item.id === (incoming ? edge.upstream_id : edge.downstream_id));
    const bindings = (graph.bindings || []).filter(binding => binding.edge_id === edge.id &&
      ports.get(binding.source_port_id)?.node_id === edge.upstream_id && ports.get(binding.target_port_id)?.node_id === edge.downstream_id);
    return { edge, other, incoming, bindings };
  });
}
export function decisionBranches(node, graph, language) {
  const zh = language === 'zh-CN';
  const config = node.card_contract?.config;
  const declared = config?.branches || [];
  const expectedPath = node.name === '刷新判断' ? 'catalog/content-refresh.v1.json' : 'catalog/identity-flow-case.v1.json';
  const moduleCopy = config?.definition_refs?.some(ref => ref.path === expectedPath) ? copy.decisions[node.name] : null;
  const outgoing = cardRelations(node, graph).filter(item => !item.incoming);
  return declared.map(branch => {
    const wording = moduleCopy?.branches[branch.id];
    const condition = branch.condition && branch.condition !== 'definition_refs' ? branch.condition : wording?.[1];
    return { ...branch, label:zh && wording ? wording[0] : branch.id,
      condition:condition || (zh ? '条件尚未定义' : 'Condition undefined'),
      targets:outgoing.filter(item => item.bindings.some(binding => binding.branch === branch.id)).map(item => item.other).filter(Boolean) };
  });
}
export function decisionActor(node) {
  return node.card_contract?.config.actor || (node.card_contract?.config.profile === 'manual_review' ? 'human' : null) ||
    (node.card_contract?.config.definition_refs?.some(ref => ref.path === (node.name === '刷新判断' ? 'catalog/content-refresh.v1.json' : 'catalog/identity-flow-case.v1.json')) ? copy.decisions[node.name]?.actor : null) || 'unknown';
}
