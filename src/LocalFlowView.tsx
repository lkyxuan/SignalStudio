import type { Language, GraphNode, Graph, GraphEdge } from './contracts';
import React from 'react';
import { AlarmClock, ArrowRight, Database, GitBranch } from 'lucide-react';
import { nodeRef } from './graphRefs';
import './local-flow-view.css';
import { edgePresentation, focusExplanation, traceTriggers, originLabel, edgeBindings } from './edgePresentation';
import { cardPresentation } from './cardPresentation';
import { CardProgressBadge } from './CardProgress';

function Neighbor({ node, language, onFocus, direction, label, graph, edge, focusNode, onOpenEdge }: { edge: GraphEdge; focusNode: GraphNode; onOpenEdge: (id: string) => void; graph: Graph; node: GraphNode; language: Language; onFocus: (id: string) => void; direction: 'input' | 'output'; label: (name: string) => string }) {
  const meaning = edgePresentation(graph, edge, language, focusNode);
  return <div className="local-neighbor">
    <button className="local-neighbor-node" onClick={() => onFocus(node.id)} title={language === 'zh-CN' ? '以这张卡为中心查看' : 'Focus this card'}>
      <span className="local-node-type">{node.is_system_state ? <Database size={14} /> : <GitBranch size={14} />}{cardPresentation(node,language).label}</span>
      <strong><span>{nodeRef(node)}</span>{label(node.name)}</strong><CardProgressBadge progress={graph.card_progress?.[node.id]} language={language}/><small>{cardPresentation(node,language).originText}</small>
    </button>
    <button className="local-link" data-tone={meaning.tone} onClick={() => onOpenEdge(edge.id)} title={language === 'zh-CN' ? '查看连线含义' : 'Inspect connection'}><span>{meaning.displayLabel}</span>
      {direction === 'input' && <ArrowRight size={15} />}
      {direction === 'output' && <ArrowRight size={15} />}
    </button>
  </div>;
}

export function LocalFlowView({ graph, focusNode, language, label, onFocus, onOpenNode, onOpenEdge }: { onOpenEdge: (id: string) => void; graph: Graph; focusNode?: GraphNode; language: Language; label: (name: string) => string; onFocus: (id: string) => void; onOpenNode: (id: string) => void }) {
  if (!focusNode) return <div className="local-flow-empty">{language === 'zh-CN' ? '当前筛选下没有卡片。' : 'No cards match the current filter.'}</div>;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const startsStep = (edge: GraphEdge) => edgeBindings(graph, edge).some(binding => ['event', 'change'].includes(binding.config.trigger || ''));
  const inputs = graph.edges.filter(edge => edge.downstream_id === focusNode.id)
    .sort((a, b) => Number(startsStep(b)) - Number(startsStep(a)))
    .map(edge => ({ edge, node: byId.get(edge.upstream_id) })).filter((item): item is typeof item & { node: GraphNode } => !!item.node);
  const outputs = graph.edges.filter(edge => edge.upstream_id === focusNode.id)
    .map(edge => ({ edge, node: byId.get(edge.downstream_id) })).filter((item): item is typeof item & { node: GraphNode } => !!item.node);
  const zh = language === 'zh-CN';
  return <div className="local-flow-view">
    <div className="local-flow-intro"><strong>{zh ? '单步关系 · 输入 → 当前卡片 → 输出' : 'One-step view · Input → Current card → Output'}</strong><span>{focusExplanation(graph, focusNode, language)}</span></div>
    <div className="local-trigger-origins"><strong>{zh ? '触发源头' : 'Trigger origins'}</strong>{traceTriggers(graph, focusNode).origins.map(origin => <button key={`${origin.node.id}:${origin.reason}`} onClick={() => onFocus(origin.node.id)} title={label(origin.node.name)}>{origin.reason === 'schedule' && <AlarmClock size={13} />}{originLabel(origin, language)}</button>)}</div>
    <div className="local-flow-columns">
      <section className="local-flow-column local-flow-inputs"><h3>{zh ? '输入' : 'Input'} <span>{inputs.length}</span></h3><div className="local-flow-list">{inputs.length ? inputs.map(({ edge, node }) => <Neighbor key={edge.id} node={node} language={language} onFocus={onFocus} direction="input" label={label} graph={graph} edge={edge} focusNode={focusNode} onOpenEdge={onOpenEdge} />) : <p>{zh ? '没有已连接的输入' : 'No connected input'}</p>}</div></section>
      <section className="local-flow-center"><h3>{zh ? '当前卡片' : 'Current card'}</h3><button onClick={() => onOpenNode(focusNode.id)} className="local-focus-node"><span className="local-node-type">{focusNode.is_system_state ? <Database size={15} /> : <GitBranch size={15} />}{cardPresentation(focusNode,language).label}</span><strong><span>{nodeRef(focusNode)}</span>{label(focusNode.name)}</strong><CardProgressBadge progress={graph.card_progress?.[focusNode.id]} language={language}/><small>{cardPresentation(focusNode,language).originText}</small><small>{zh ? '点击查看输入、输出和案例' : 'Click to inspect inputs, outputs and cases'}</small></button></section>
      <section className="local-flow-column local-flow-outputs"><h3>{zh ? '输出' : 'Output'} <span>{outputs.length}</span></h3><div className="local-flow-list">{outputs.length ? outputs.map(({ edge, node }) => <Neighbor key={edge.id} node={node} language={language} onFocus={onFocus} direction="output" label={label} graph={graph} edge={edge} focusNode={focusNode} onOpenEdge={onOpenEdge} />) : <p>{zh ? '没有已连接的输出' : 'No connected output'}</p>}</div></section>
    </div>
  </div>;
}
