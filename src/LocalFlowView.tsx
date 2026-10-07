import type { Language, GraphNode, Graph } from './contracts';
import React from 'react';
import { ArrowRight, Database, GitBranch } from 'lucide-react';
import { nodeRef } from './graphRefs';
import './local-flow-view.css';

function Neighbor({ node, language, onFocus, direction, label }: { node: GraphNode; language: Language; onFocus: (id: string) => void; direction: 'input' | 'output'; label: (name: string) => string }) {
  return <div className="local-neighbor">
    <button className="local-neighbor-node" onClick={() => onFocus(node.id)} title={language === 'zh-CN' ? '以这张卡为中心查看' : 'Focus this card'}>
      <span className="local-node-type">{node.is_system_state ? <Database size={14} /> : <GitBranch size={14} />}{node.is_system_state ? language === 'zh-CN' ? '表' : 'Table' : language === 'zh-CN' ? '卡片' : 'Card'}</span>
      <strong><span>{nodeRef(node)}</span>{label(node.name)}</strong>
    </button>
    <span className="local-link" aria-hidden="true">
      {direction === 'input' && <ArrowRight size={15} />}
      {direction === 'output' && <ArrowRight size={15} />}
    </span>
  </div>;
}

export function LocalFlowView({ graph, focusNode, language, label, onFocus, onOpenNode }: { graph: Graph; focusNode?: GraphNode; language: Language; label: (name: string) => string; onFocus: (id: string) => void; onOpenNode: (id: string) => void }) {
  if (!focusNode) return <div className="local-flow-empty">{language === 'zh-CN' ? '当前筛选下没有卡片。' : 'No cards match the current filter.'}</div>;
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const inputs = graph.edges.filter(edge => edge.downstream_id === focusNode.id)
    .map(edge => ({ edge, node: byId.get(edge.upstream_id) })).filter((item): item is typeof item & { node: GraphNode } => !!item.node);
  const outputs = graph.edges.filter(edge => edge.upstream_id === focusNode.id)
    .map(edge => ({ edge, node: byId.get(edge.downstream_id) })).filter((item): item is typeof item & { node: GraphNode } => !!item.node);
  const zh = language === 'zh-CN';
  return <div className="local-flow-view">
    <div className="local-flow-intro"><strong>{zh ? '单步关系 · 输入 → 当前卡片 → 输出' : 'One-step view · Input → Current card → Output'}</strong><span>{zh ? '点击相邻卡片继续走流程；线段仅表示卡片连接。' : 'Click a neighboring card to follow the flow; lines only connect cards.'}</span></div>
    <div className="local-flow-columns">
      <section className="local-flow-column local-flow-inputs"><h3>{zh ? '输入' : 'Input'} <span>{inputs.length}</span></h3><div className="local-flow-list">{inputs.length ? inputs.map(({ edge, node }) => <Neighbor key={edge.id} node={node} language={language} onFocus={onFocus} direction="input" label={label} />) : <p>{zh ? '没有已连接的输入' : 'No connected input'}</p>}</div></section>
      <section className="local-flow-center"><h3>{zh ? '当前卡片' : 'Current card'}</h3><button onClick={() => onOpenNode(focusNode.id)} className="local-focus-node"><span className="local-node-type">{focusNode.is_system_state ? <Database size={15} /> : <GitBranch size={15} />}{focusNode.is_system_state ? zh ? '表卡片' : 'Table card' : zh ? '节点卡片' : 'Node card'}</span><strong><span>{nodeRef(focusNode)}</span>{label(focusNode.name)}</strong><small>{zh ? '点击查看输入、输出和案例' : 'Click to inspect inputs, outputs and cases'}</small></button></section>
      <section className="local-flow-column local-flow-outputs"><h3>{zh ? '输出' : 'Output'} <span>{outputs.length}</span></h3><div className="local-flow-list">{outputs.length ? outputs.map(({ edge, node }) => <Neighbor key={edge.id} node={node} language={language} onFocus={onFocus} direction="output" label={label} />) : <p>{zh ? '没有已连接的输出' : 'No connected output'}</p>}</div></section>
    </div>
  </div>;
}
