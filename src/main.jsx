import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, MarkerType, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Database, GitBranch, Layers3, LayoutGrid, List, Maximize2, Network, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { EdgeMappingPanel, FieldCatalog, NodeIOOverview } from './FieldPanels';
import { CatalogTranslationTable } from './CatalogTranslationTable';
import { SignalDesignGuide } from './SignalDesignGuide';
import { SignalNeedsPanel } from './SignalNeedsPanel';
import { SourceUsageGuide, sourcePurpose } from './SourceUsageGuide';
import { nodeRef, edgeRef, usageRef } from './graphRefs';
import { autoLayout } from './autoLayout';
import { displayNodeName, normalizeNodeReferences, translate } from './i18n';
import './style.css';
import './node-ref.css';

const API = '/api';
const SOURCE_NAMES = {
  binance: 'Binance', 'binance-futures': 'Binance', coingecko: 'CoinGecko', dexscreener: 'DexScreener',
  kaito: 'Kaito', 'kaito-social-spider': 'Kaito', rss: 'RSS', 'crypto-rss-collector': 'RSS', taoli: 'Taoli', 'tg-spider': 'TG Bot',
  'tg-spider-telethon': 'TG Telethon', telegram: 'Telegram',
};
const sourceLabel = id => SOURCE_NAMES[id] || id;
const isReferenceResource = name => name.startsWith('kaito.resource.');
const contractSourceName = name => /^(binance\.usdm\.|kaito\.mcp\.|telegram\.)/.test(name) || isReferenceResource(name) ||
  ['coingecko.coins_markets', 'dexscreener.token_pairs_by_address', 'rss.item', 'taoli.funding_page'].includes(name);
const sourceBadgeId = id => ({ 'telegram-bot': 'tg-spider', 'telegram-telethon': 'tg-spider-telethon' })[id] || id;
const TABLE_GUIDANCE = {
  assets: 'Read the internal asset ID and identity status after an external identifier has matched.',
  asset_identifiers: 'Match a source namespace, external ID and context to an internal asset ID.',
  asset_relationships: 'Read reviewed related assets after a signal is calculated or when preparing a product view. A relationship alone does not make another asset noteworthy.',
  asset_monitoring_rules: 'Read the applicable rule and version when evaluating a signal.',
};
const NODE_GROUPS = [
  { name: 'Data sources', types: ['Source', 'Raw Field'] },
  { name: 'Processing steps', types: ['Evidence Check', 'Asset Resolution', 'Relationship Lookup', 'Relationship Discovery', 'Review Decision', 'Derived Field', 'Metric', 'Score', 'Rule Evaluation'] },
  { name: 'Business tables', types: ['assets', 'asset_identifiers', 'asset_relationships', 'asset_monitoring_rules'] },
  { name: 'Outputs', types: ['Signal Event', 'Ranking', 'Product Module'] },
];
const CREATABLE_GROUPS = NODE_GROUPS.filter(group => group.name !== 'Business tables');
const WORKFLOW_VIEWS = [
  { id: 'all', name: 'Overview' },
  { id: 'signal', name: 'Signal path' },
  { id: 'knowledge', name: 'Asset knowledge path' },
];
const TYPES = NODE_GROUPS.flatMap(group => group.types);
const DEFAULT_LANES = { Source: 'shared', 'Raw Field': 'shared', 'Evidence Check': 'shared', 'Asset Resolution': 'shared', 'Relationship Discovery': 'knowledge', 'Review Decision': 'knowledge', assets: 'shared', asset_identifiers: 'shared', asset_relationships: 'shared', asset_monitoring_rules: 'shared' };
const defaultLane = type => DEFAULT_LANES[type] || 'signal';
const nodeLane = node => node.workflow_lane || defaultLane(node.type);
const SIGNAL_TYPES = new Set(['Derived Field', 'Metric', 'Score', 'Ranking', 'Product Module']);
const KIND = { Source: 'source', 'Raw Field': 'raw', 'Evidence Check': 'evidence', 'Asset Resolution': 'identity', 'Relationship Lookup': 'relationship', 'Relationship Discovery': 'relationship', 'Review Decision': 'review', 'Derived Field': 'derived', Metric: 'metric', Score: 'score', Ranking: 'ranking', 'Rule Evaluation': 'rule', 'Signal Event': 'event', 'Product Module': 'product', assets: 'state', asset_identifiers: 'state', asset_relationships: 'state', asset_monitoring_rules: 'state', 'Asset Registry': 'state', 'Rule Registry': 'state' };
const OUTPUT_TYPES = new Set(['Signal Event', 'Ranking', 'Product Module']);
const TYPE_HELP = {
  'Evidence Check': 'Check source coverage, freshness and provenance before treating observations as evidence.',
  'Asset Resolution': 'Match source identifiers and context to an internal asset, retaining the evidence and match status.',
  'Relationship Lookup': 'After a signal or before display, read reviewed related assets; this does not make them signals.',
  'Relationship Discovery': 'Propose an evidenced relationship between assets for review; this does not confirm the relationship.',
  'Review Decision': 'Review a proposed identity or relationship before a future run uses the updated asset state.',
  'Rule Evaluation': 'Use metric results and a versioned rule to decide whether a signal event should fire.',
  'Signal Event': 'Describe the triggered result, its asset, rule version, window and supporting evidence.',
};
const RESOURCE_REFERENCES = {
  'Asset Resolution': 'Read asset_identifiers to find a candidate, then assets to confirm the internal identity. Preserve the match evidence and status.',
  'Relationship Lookup': 'Read asset_relationships for the current asset_id, then assets for the related identities.',
  'Relationship Discovery': 'Propose evidence-backed relationships for review before writing asset_relationships.',
  'Review Decision': 'Confirm or reject identity and relationship proposals before updating the corresponding tables for later runs.',
  'Rule Evaluation': 'Read the applicable version from asset_monitoring_rules.',
};
const FLOW_LABELS_ZH = {
  'node.a11yDescription.default': '按回车键或空格键选择节点，按删除键删除，按退出键取消。',
  'node.a11yDescription.keyboardDisabled': '按回车键或空格键选择节点，然后用方向键移动，按删除键删除，按退出键取消。',
  'node.a11yDescription.ariaLiveMessage': ({ direction, x, y }) => `节点向${({ left: '左', right: '右', up: '上', down: '下' })[direction] || direction}移动。新位置：横坐标 ${x}，纵坐标 ${y}。`,
  'edge.a11yDescription.default': '按回车键或空格键选择连接，然后按删除键删除，或按退出键取消。',
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '适应画布',
  'minimap.ariaLabel': '缩略图',
  'handle.ariaLabel': '连接点',
};

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options,
    body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function LogicNode({ data, selected }) {
  const t = text => translate(data.language, text);
  const kind = KIND[data.type] || 'metric';
  const cardSummary = data.isContractSource ? sourcePurpose(data.name, data.language) : null;
  return <div className={`logic-node ${kind} ${OUTPUT_TYPES.has(data.type) ? 'output-node' : ''} ${data.is_system_state ? 'state-node' : ''} ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Left} className="flow-handle" />
    <div className="node-top"><span className="node-glyph">{kind === 'product' ? <LayoutGrid size={15} /> : kind === 'source' || kind === 'state' ? <Database size={15} /> : kind === 'score' ? <Activity size={15} /> : kind === 'identity' || kind === 'relationship' ? <Network size={15} /> : <GitBranch size={15} />}</span><span className="node-kind">{data.isReferenceResource ? data.language === 'zh-CN' ? 'MCP 参考资源' : 'MCP resource' : data.isContractSource ? data.language === 'zh-CN' ? '上游操作' : 'Upstream operation' : data.is_system_state ? t('Business table') : t(data.type)}</span>{data.catalogSourceId && data.type === 'Source' && <span className="source-origin-tag" data-source={data.catalogSourceId} title={data.catalogSourceId}>{sourceLabel(data.catalogSourceId)}</span>}{Boolean(data.is_system_state) && <span className="state-node-badge">{t('Planned')}</span>}{data.pendingNeedNames?.length > 0 && <span className="node-need-count" title={data.pendingNeedNames.join('、')}>{data.language === 'zh-CN' ? `${data.pendingNeedNames.length} 项待找` : `${data.pendingNeedNames.length} needed`}</span>}{data.isContractSource && !data.isReferenceResource && <span className="node-field-count">{data.language === 'zh-CN' ? `已列 ${data.fieldCount} 项` : `${data.fieldCount} listed`}</span>}{!data.isContractSource && data.fieldCount > 0 && <span className="node-field-count">{data.language === 'zh-CN' ? `${data.fieldCount} ${t('fields')}` : `${data.fieldCount} ${data.fieldCount === 1 ? 'field' : 'fields'}`}</span>}</div>
    <div className="node-name" title={`${nodeRef(data)} ${data.name}`}><span className="node-ref">{nodeRef(data)}</span><span className="node-name-text">{data.isContractSource && data.language === 'zh-CN' ? data.catalogRecordLabel || data.name : displayNodeName(data.language, data.name)}</span></div>
    <div className="node-definition" title={cardSummary || data.definition || ''}>{cardSummary || (data.definition ? t(data.definition) : t('Add a definition'))}</div>
    <Handle type="source" position={Position.Right} className="flow-handle" />
  </div>;
}

function GroupLabel({ data }) {
  return <div className="graph-group-label"><strong>{data.title}</strong><span>{data.count}</span></div>;
}
const nodeTypes = { logic: LogicNode, groupLabel: GroupLabel };

function StateNodeDetails({ node, upstream, downstream, openNode, language }) {
  const t = text => translate(language, text);
  return <div className="state-details">
    <p>{t(TABLE_GUIDANCE[node.name] || 'This older aggregate reference should be replaced with links to specific business tables.')}</p>
    <div className="state-tables"><strong>{t('Table / access target')}</strong><code>{node.name}</code><span>{t('Connection status: planned; no live query or business records are connected.')}</span></div>
    <div className="relations"><div className="relation-heading"><ArrowDownRight size={16} /> {t('UPSTREAM')} <span>{upstream.length}</span></div>{upstream.length ? upstream.map(item => <button key={item.id} onClick={() => openNode(item.id)}>{displayNodeName(language, item.name)}<ArrowRight size={14} /></button>) : <em>{t('No upstream nodes')}</em>}</div>
    <div className="relations"><div className="relation-heading"><ArrowUpRight size={16} /> {t('DOWNSTREAM')} <span>{downstream.length}</span></div>{downstream.length ? downstream.map(item => <button key={item.id} onClick={() => openNode(item.id)}>{displayNodeName(language, item.name)}<ArrowRight size={14} /></button>) : <em>{t('No downstream nodes')}</em>}</div>
  </div>;
}

function SourceFlowSummary({ node, graph, openEdge, language }) {
  const t = text => translate(language, text);
  const outgoing = graph.edges.filter(edge => edge.upstream_id === node.id);
  const byId = new Map(graph.nodes.map(item => [item.id, item]));
  const destinations = new Set();
  const pending = outgoing.map(edge => edge.downstream_id);
  while (pending.length) {
    const id = pending.shift();
    if (destinations.has(id)) continue;
    destinations.add(id);
    pending.push(...graph.edges.filter(edge => edge.upstream_id === id).map(edge => edge.downstream_id));
  }
  return <section className="source-flow-summary">
    <div className="source-flow-heading"><strong>{t('Designed destinations')} <span>{outgoing.length}</span></strong><small>{t('Downstream nodes')} {destinations.size}</small></div>
    {outgoing.length ? outgoing.map(edge => <button key={edge.id} onClick={() => openEdge(edge.id)}><span className="edge-inline-ref">{edgeRef(edge)}</span><span>{displayNodeName(language, byId.get(edge.downstream_id)?.name || '—')}</span><small>{t(edge.transport_kind === 'redpanda' ? 'Redpanda' : edge.transport_kind === 'direct' ? 'Direct' : 'Unspecified')}</small><ArrowRight size={14} /></button>) : <p>{t('No downstream connection has been designed for this source.')}</p>}
    <small>{t('These counts describe design links, not actual message or record counts.')}</small>
  </section>;
}

function IconButton({ children, title, onClick, active, className = '' }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} title={title} aria-label={title}>{children}</button>;
}

function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem('data-logic-language') === 'en' ? 'en' : 'zh-CN');
  const t = text => translate(language, text);
  const displayName = name => language === 'zh-CN' ? catalogEntityInfo[name]?.label_cn || displayNodeName(language, name) : displayNodeName(language, name);
  const [graph, setGraph] = useState({ nodes: [], edges: [], fields: [], field_usages: [], requirements: [] });
  const [contractSummary, setContractSummary] = useState(null);
  const [catalogEntityInfo, setCatalogEntityInfo] = useState({});
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [view, setView] = useState('graph');
  const [laneView, setLaneView] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All types');
  const [showCreate, setShowCreate] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState(null);
  const [newNode, setNewNode] = useState({ name: '', type: 'Metric', workflow_lane: 'signal', definition: '' });
  const [showHelp, setShowHelp] = useState(false);
  const [flowInstance, setFlowInstance] = useState(null);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'zh-CN' ? '数据逻辑设计工作台' : 'Data Logic IDE';
    localStorage.setItem('data-logic-language', language);
  }, [language]);

  const flash = (message, error = false) => { setNotice({ message, error }); setTimeout(() => setNotice(null), 4200); };
  const reload = useCallback(async () => {
    try { setGraph(await request('/graph')); } catch (error) { flash(error.message, true); }
  }, []);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => {
    request('/source-contracts/v1')
      .then(contracts => {
        setContractSummary({ entries: contracts.operation_count + contracts.resource_count,
          fields: contracts.operations.reduce((total, operation) => total + operation.fields.length, 0) });
        setCatalogEntityInfo(Object.fromEntries(
          [...contracts.operations, ...contracts.resources].map(entry => [entry.id, {
            label_cn: entry.label_zh, source: sourceBadgeId(entry.source_id),
            field_count: entry.fields.length,
          }])));
      }).catch(error => flash(error.message, true));
  }, []);
  useEffect(() => {
    const fieldCounts = new Map();
    const nodeById = new Map(graph.nodes.map(node => [node.id, node]));
    const nodeNameById = new Map(graph.nodes.map(node => [node.id, node.name]));
    for (const field of graph.fields || []) if (!['internal', 'hidden'].includes(field.catalog_visibility))
      fieldCounts.set(field.node_id, (fieldCounts.get(field.node_id) || 0) + 1);
    const usageCounts = new Map();
    for (const usage of graph.field_usages || []) usageCounts.set(usage.edge_id, (usageCounts.get(usage.edge_id) || 0) + 1);
    const pendingNeedNames = new Map();
    for (const requirement of graph.requirements || []) if (!requirement.source_field_id) pendingNeedNames.set(requirement.node_id, [...(pendingNeedNames.get(requirement.node_id) || []), requirement.name]);
    setNodes(graph.nodes.map(n => ({ id: n.id, type: 'logic', ariaLabel: language === 'zh-CN' ? catalogEntityInfo[n.name]?.label_cn || displayNodeName(language, n.name) : displayNodeName(language, n.name), position: { x: n.position_x, y: n.position_y }, data: { ...n, language, isContractSource: contractSourceName(n.name), isReferenceResource: isReferenceResource(n.name), catalogSourceId: catalogEntityInfo[n.name]?.source, catalogRecordLabel: catalogEntityInfo[n.name]?.label_cn, fieldCount: contractSourceName(n.name) ? catalogEntityInfo[n.name]?.field_count ?? 0 : fieldCounts.get(n.id) || 0, pendingNeedNames: pendingNeedNames.get(n.id) || [] } })));
    setEdges(graph.edges.map(e => { const redpanda = e.transport_kind === 'redpanda'; const stateRead = Boolean(nodeById.get(e.upstream_id)?.is_system_state); const stateWrite = Boolean(nodeById.get(e.downstream_id)?.is_system_state); const stateEdge = stateRead || stateWrite; const color = stateEdge ? '#688bb8' : redpanda ? '#8869b8' : '#6b778b';
      return { id: e.id, source: e.upstream_id, target: e.downstream_id, type: 'smoothstep', animated: false,
        ariaLabel: `${edgeRef(e)}: ${displayNodeName(language, nodeNameById.get(e.upstream_id))} → ${displayNodeName(language, nodeNameById.get(e.downstream_id))}`,
        label: [edgeRef(e), stateRead ? t('Read table') : stateWrite ? t('Proposed table write') : redpanda ? `${t('Redpanda')}${e.transport_topic ? ` · ${e.transport_topic}` : ''}` : (usageCounts.get(e.id) || 0) > 1 ? `${usageCounts.get(e.id)} ${t('fields')}` : ''].filter(Boolean).join(' · '),
        labelStyle: { fontSize: 10, fill: stateEdge ? '#557cac' : redpanda ? '#7657a5' : '#538078', fontWeight: 700 }, labelBgStyle: { fill: stateEdge ? '#f1f5fb' : redpanda ? '#f7f3fc' : '#f6fbf9', fillOpacity: .95 }, labelBgPadding: [5, 3], labelBgBorderRadius: 4,
        style: { stroke: color, strokeWidth: stateEdge || redpanda ? 2 : 1.5, strokeDasharray: stateEdge || redpanda ? '5 4' : undefined }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } }; }));
  }, [graph, language, catalogEntityInfo, setNodes, setEdges]);

  const selected = graph.nodes.find(n => n.id === selectedId);
  const isSignal = selected && SIGNAL_TYPES.has(selected.type);
  const selectedEdge = graph.edges.find(e => e.id === selectedEdgeId);
  const nodeFields = selected ? (graph.fields || []).filter(field => field.node_id === selected.id) : [];
  const edgeSource = selectedEdge ? graph.nodes.find(n => n.id === selectedEdge.upstream_id) : null;
  const edgeTarget = selectedEdge ? graph.nodes.find(n => n.id === selectedEdge.downstream_id) : null;
  const sourceFields = edgeSource ? (graph.fields || []).filter(field => field.node_id === edgeSource.id) : [];
  const targetFields = edgeTarget ? (graph.fields || []).filter(field => field.node_id === edgeTarget.id) : [];
  const edgeUsages = selectedEdge ? (graph.field_usages || []).filter(usage => usage.edge_id === selectedEdge.id) : [];
  const upstream = selected ? graph.edges.filter(e => e.downstream_id === selected.id).map(e => graph.nodes.find(n => n.id === e.upstream_id)).filter(Boolean) : [];
  const downstream = selected ? graph.edges.filter(e => e.upstream_id === selected.id).map(e => graph.nodes.find(n => n.id === e.downstream_id)).filter(Boolean) : [];
  const productUsage = useMemo(() => {
    const nodeById = new Map(graph.nodes.map(n => [n.id, n]));
    const outgoing = new Map();
    for (const edge of graph.edges) outgoing.set(edge.upstream_id, [...(outgoing.get(edge.upstream_id) || []), edge.downstream_id]);
    return new Map(graph.nodes.map(node => {
      const seen = new Set([node.id]), queue = [node.id], result = [];
      while (queue.length) for (const id of outgoing.get(queue.shift()) || []) if (!seen.has(id)) {
        seen.add(id); queue.push(id); const next = nodeById.get(id); if (next?.type === 'Product Module') result.push(next);
      }
      return [node.id, node.type === 'Product Module' ? [node] : result];
    }));
  }, [graph]);
  const products = selected ? productUsage.get(selected.id) || [] : [];
  useEffect(() => { setDraft(previous => selected ? previous?.id === selected.id ? previous : { ...selected } : null); }, [selected]);
  const visibleForLane = (node, lane) => lane === 'all' || nodeLane(node) === 'shared' || nodeLane(node) === lane;
  const visibleInView = node => visibleForLane(node, laneView);
  const query = filter.trim().toLowerCase();
  const connectedIds = new Set(graph.edges.flatMap(edge => [edge.upstream_id, edge.downstream_id]));
  const referenceMatchEdges = query ? graph.edges.filter(edge => edgeRef(edge).toLowerCase() === query ||
    (graph.field_usages || []).some(usage => usage.edge_id === edge.id && usageRef(usage).toLowerCase() === query)) : [];
  const referenceMatchNodes = new Set(referenceMatchEdges.flatMap(edge => [edge.upstream_id, edge.downstream_id]));
  const filtered = graph.nodes.filter(n => (visibleInView(n) || referenceMatchNodes.has(n.id)) &&
    (typeFilter === 'All types' || n.type === typeFilter || referenceMatchNodes.has(n.id)) &&
    (referenceMatchNodes.has(n.id) || `${nodeRef(n)} ${n.name} ${displayName(n.name)} ${sourcePurpose(n.name, language) || ''} ${n.definition} ${n.decision_question || ''} ${n.trigger_rule || ''} ${t(n.type)} ${(graph.fields || []).filter(field => field.node_id === n.id).map(field => `${field.name} ${field.definition}`).join(' ')} ${(graph.requirements || []).filter(item => item.node_id === n.id).map(item => `${item.name} ${item.purpose}`).join(' ')}`.toLowerCase().includes(query))).sort((a, b) => displayName(a.name).localeCompare(displayName(b.name), language));
  const tableRows = filtered;
  const filteredIds = new Set(filtered.map(n => n.id));
  const labelGroups = new Map();
  for (const node of graph.nodes) {
    if (connectedIds.has(node.id) || !filteredIds.has(node.id)) continue;
    const key = node.is_system_state ? 'tables' : node.type === 'Source' ? `source:${node.name.split('.')[0]}` : null;
    if (!key) continue;
    if (!labelGroups.has(key)) labelGroups.set(key, []);
    labelGroups.get(key).push(node);
  }
  const groupLabels = [...labelGroups].filter(([key, members]) => key === 'tables' || members.length > 1).map(([key, members]) => ({
    id: `group-label:${key}`, type: 'groupLabel',
    position: { x: Math.min(...members.map(node => node.position_x)), y: Math.min(...members.map(node => node.position_y)) - 32 },
    data: { title: key === 'tables' ? t('Business tables') : sourceLabel(key.slice(7)),
      count: language === 'zh-CN' ? `${members.length} 个` : `${members.length} nodes` },
    width: 148, height: 22, measured: { width: 148, height: 22 },
    draggable: false, selectable: false, connectable: false, focusable: false, style: { pointerEvents: 'none' },
  }));
  const displayNodes = [...nodes.map(n => ({ ...n, hidden: !filteredIds.has(n.id) })), ...groupLabels];
  const displayEdges = edges.map(e => ({ ...e, hidden: !filteredIds.has(e.source) || !filteredIds.has(e.target) }));
  const visibleNodeIds = filtered.map(node => node.id).join(',');
  useEffect(() => {
    if (view !== 'graph' || !flowInstance || !visibleNodeIds) return;
    const frame = requestAnimationFrame(() => flowInstance.fitView({
      nodes: visibleNodeIds.split(',').map(id => ({ id })), padding: 0.2, maxZoom: 0.85, duration: 250,
    }));
    return () => cancelAnimationFrame(frame);
  }, [filter, typeFilter, visibleNodeIds, view, flowInstance]);

  const mutate = async (path, method, body, success) => {
    try { setBusy(true); const result = await request(path, { method, body }); await reload(); if (success) flash(success); return result; }
    catch (error) { flash(error.message, true); return null; }
    finally { setBusy(false); }
  };
  const saveNode = async () => { if (!draft) return; await mutate(`/nodes/${draft.id}`, 'PATCH', draft, 'Node saved'); };
  const deleteNode = async () => { if (!selected || !confirm(language === 'zh-CN' ? `删除“${displayName(selected.name)}”及其所有连接？` : `Delete “${selected.name}” and its connections?`)) return;
    const result = await mutate(`/nodes/${selected.id}`, 'DELETE', null, 'Node deleted'); if (result) setSelectedId(null); };
  const addNode = async () => { const result = await mutate('/nodes', 'POST', newNode, 'Node created');
    if (result) { setShowCreate(false); setSelectedId(result.id); setNewNode({ name: '', type: 'Metric', workflow_lane: 'signal', definition: '' }); setTimeout(() => flowInstance?.setCenter(result.position_x, result.position_y, { zoom: 0.85, duration: 450 }), 80); } };
  const connect = async connection => { await mutate('/edges', 'POST', { upstream_id: connection.source, downstream_id: connection.target }, 'Connection created'); };
  const deleteEdge = async () => { if (!selectedEdgeId) return; const result = await mutate(`/edges/${selectedEdgeId}`, 'DELETE', null, 'Connection deleted'); if (result) setSelectedEdgeId(null); };
  const propose = async () => { try { setBusy(true); setProposal(await request('/proposals', { method: 'POST', body: { prompt: normalizeNodeReferences(language, prompt, graph.nodes) } })); }
    catch (error) { flash(error.message, true); } finally { setBusy(false); } };
  const applyProposal = async () => { const result = await mutate('/proposals/apply', 'POST', proposal, 'Proposed changes applied');
    if (result) { setSelectedId(result.id); setProposal(null); setPrompt(''); setShowPrompt(false); setTimeout(() => flowInstance?.setCenter(result.position_x, result.position_y, { zoom: 0.85, duration: 450 }), 80); } };
  const openNode = id => { setSelectedId(id); setSelectedEdgeId(null); };
  const openEdge = id => { setSelectedEdgeId(id); setSelectedId(null); };
  const arrangeNodes = async () => {
    if (!graph.nodes.length) return;
    const positions = autoLayout(graph.nodes, graph.edges);
    const result = await mutate('/nodes/layout', 'POST', { positions }, 'Nodes arranged');
    if (result) setTimeout(() => flowInstance?.fitView({ padding: 0.16, maxZoom: 0.85, duration: 450 }), 100);
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Network size={22} strokeWidth={2.2} /></div><div><strong>{t('Data Logic')}</strong><span>{t('DESIGN STUDIO')}</span></div></div>
      <div className="sidebar-section-label">{t('WORKSPACE')}</div>
      <button className="sidebar-link selected" onClick={() => { setView('graph'); setSelectedId(null); }}><Layers3 size={17} /> {t('Data Logic Graph')} <ChevronDown size={15} className="sidebar-chevron" /></button>
      <div className="sidebar-section-label nav-label">{t('VIEWS')}</div>
      <button className={`sidebar-link ${view === 'graph' ? 'view-active' : ''}`} onClick={() => setView('graph')}><GitBranch size={17} /> {t('Graph View')} <span className="side-shortcut">⌘1</span></button>
      <button className={`sidebar-link ${view === 'table' ? 'view-active' : ''}`} onClick={() => setView('table')}><List size={17} /> {t('Table View')} <span className="side-shortcut">⌘2</span></button>
      <button className={`sidebar-link ${view === 'translations' ? 'view-active' : ''}`} onClick={() => { setView('translations'); setSelectedId(null); setSelectedEdgeId(null); }}><List size={17} /> {language === 'zh-CN' ? '字段用途与案例' : 'Field guide and examples'}</button>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label">{language === 'zh-CN' ? '画布节点' : 'GRAPH NODES'} <span>{graph.nodes.length}</span></div>
      <div className="library-list">{NODE_GROUPS.map(group => <div className="library-group" key={group.name}><div className="library-group-label">{t(group.name)}</div>{group.types.map(type => <button key={type} className={`library-item ${typeFilter === type ? 'library-active' : ''}`} onClick={() => setTypeFilter(typeFilter === type ? 'All types' : type)}><span className={`type-dot ${KIND[type]}`} />{t(type)}<span>{graph.nodes.filter(n => n.type === type).length}</span></button>)}</div>)}</div>
      <div className="sidebar-bottom"><div className="language-switch" role="group" aria-label={language === 'zh-CN' ? '界面语言' : 'Interface language'}><button className={language === 'zh-CN' ? 'active' : ''} onClick={() => setLanguage('zh-CN')} aria-pressed={language === 'zh-CN'}>中文</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>English</button></div><button className="sidebar-link" onClick={() => setShowHelp(true)}><CircleHelp size={17} /> {t('How it works')}</button><div className="local-status"><span className="status-dot" /> {t('Saved locally')} <span>{t('SQLite')}</span></div></div>
    </aside>

    <main className="main-pane">
      <header className="topbar"><div className="breadcrumb">{t('Workspace')} <span>/</span> {t('Data Logic Graph')} <span>/</span> <strong>{view === 'translations' ? language === 'zh-CN' ? '字段用途与案例' : 'Field guide and examples' : t(view === 'graph' ? 'Graph' : 'Table')}</strong></div><div className="top-actions"><span className="top-meta">{t('LOCAL PROJECT')}</span>{view !== 'translations' && <button className="button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> {t('New node')}</button>}</div></header>
      {view === 'translations' ? <CatalogTranslationTable language={language} /> : <>
      <section className="workspace-head"><div><div className="eyebrow"><span className="eyebrow-line" /> {t('DESIGN STUDIO')}</div><h1>{t('Data Logic Graph')}</h1><p>{language === 'zh-CN' ? '总览显示上游操作、MCP 参考资源、规划业务表和设计节点。' : 'Overview shows upstream operations, MCP reference resources, planned business tables, and design nodes.'}</p></div><div className="workspace-stats"><div><strong>{contractSummary?.entries ?? '—'}</strong><span>{language === 'zh-CN' ? '上游入口' : 'UPSTREAM ENTRIES'}</span></div><i /><div><strong>{contractSummary?.fields ?? '—'}</strong><span title={language === 'zh-CN' ? '当前已列出的样本字段和文档计划字段；并非完整返回字段总数' : 'Sample paths and planned documented fields; not a complete output schema'}>{language === 'zh-CN' ? '已列字段定义' : 'LISTED FIELD DEFINITIONS'}</span></div><i /><div><strong>{graph.edges.length}</strong><span>{t('CONNECTIONS')}</span></div></div></section>
      <section className="work-card">
        <div className="workflow-tabs" role="tablist" aria-label={t('Workflow paths')}>{WORKFLOW_VIEWS.map(item => <button key={item.id} role="tab" aria-selected={laneView === item.id} className={laneView === item.id ? 'active' : ''} onClick={() => { setLaneView(item.id); setTypeFilter('All types'); setSelectedId(null); setSelectedEdgeId(null); }}>{t(item.name)}</button>)}<p>{language === 'zh-CN' ? '总览和两条路径使用同一张设计图' : 'Overview and both paths use the same design graph'}</p></div>
        <div className="view-toolbar"><div className="view-switch"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><GitBranch size={15} /> {t('Graph')}</button><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><List size={15} /> {t('Table')}</button></div><div className="toolbar-right"><div className="search-box"><Search size={16} /><input placeholder={language === 'zh-CN' ? '搜索名称、#节点、L连线或R关系' : 'Search name, # node, L line, or R relation'} value={filter} onChange={e => setFilter(e.target.value)} /><kbd>⌘ K</kbd></div><select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="All types">{t('All types')}</option>{TYPES.map(type => <option key={type} value={type}>{t(type)}</option>)}</select>{view === 'graph' && <button className="layout-button" onClick={arrangeNodes} disabled={busy || !graph.nodes.length || laneView !== 'all'} title={laneView === 'all' ? t('Group unconnected nodes; arrange dependencies left to right') : t('Arrange all nodes in Overview')}><LayoutGrid size={15} /> {t('Arrange nodes')}</button>}<IconButton title={t('Fit graph')} onClick={() => document.querySelector('.react-flow__controls-fitview')?.click()}><Maximize2 size={16} /></IconButton></div></div>
        {view === 'graph' ? <div className="graph-wrap"><ReactFlow nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} ariaLabelConfig={language === 'zh-CN' ? FLOW_LABELS_ZH : undefined} proOptions={{ hideAttribution: true }} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => openNode(node.id)} onPaneClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}
          onNodeDragStop={(_, node) => mutate(`/nodes/${node.id}`, 'PATCH', { position_x: node.position.x, position_y: node.position.y })}
          onConnect={connect} onEdgeClick={(_, edge) => openEdge(edge.id)} onInit={setFlowInstance} deleteKeyCode={null}
          fitView fitViewOptions={{ padding: 0.16, maxZoom: 0.75 }} minZoom={0.15} maxZoom={1.5} defaultEdgeOptions={{ type: 'smoothstep' }}>
          <Background color="#dfe4e8" gap={22} size={1} /><Controls showInteractive={false} />{filtered.length > 0 && <MiniMap pannable zoomable nodeColor={node => ({ source: '#6599cd', raw: '#7f91a6', evidence: '#6c93a0', identity: '#557dbc', relationship: '#709dca', review: '#9982b7', derived: '#9278ba', metric: '#51a89d', score: '#d69a5d', ranking: '#d894b6', rule: '#be9270', event: '#c4886f', product: '#d17984', state: '#587fb2' })[KIND[node.data.type]] || '#aaa'} />}</ReactFlow>
          {filtered.length > 0 && <div className="graph-hint"><span className="hint-dot" /> {t('Drag from a node handle to create a dependency')} <span className="hint-sep">·</span> {t('Select a connection to remove it')}</div>}</div>
          : <div className="table-wrap"><table><thead><tr><th>{t('NAME')}</th><th>{t('TYPE')}</th><th>{t('PATH')}</th><th>{t('FIELDS')}</th><th>{t('FORMULA / DEFINITION')}</th><th>{t('UPSTREAM')}</th><th>{t('DOWNSTREAM')}</th><th>{t('PRODUCT')}</th><th></th></tr></thead><tbody>{tableRows.map(n => {
            const up = graph.edges.filter(e => e.downstream_id === n.id).length, down = graph.edges.filter(e => e.upstream_id === n.id).length;
            const usage = productUsage.get(n.id) || [];
            return <tr key={n.id} onClick={() => openNode(n.id)} className={selectedId === n.id ? 'selected-row' : ''}><td><span className={`table-type-mark ${KIND[n.type]}`} /><span className="table-node-ref">{nodeRef(n)}</span>{displayName(n.name)}{contractSourceName(n.name) && catalogEntityInfo[n.name] && <span className="source-origin-tag table-source-tag" data-source={catalogEntityInfo[n.name].source}>{sourceLabel(catalogEntityInfo[n.name].source)}</span>}</td><td><span className={`type-pill ${KIND[n.type]}`}>{t(n.type)}</span></td><td>{t(nodeLane(n) === 'shared' ? 'Both paths' : nodeLane(n) === 'knowledge' ? 'Asset knowledge path' : 'Signal path')}</td><td>{isReferenceResource(n.name) ? (language === 'zh-CN' ? '参考目录' : 'Reference list') : contractSourceName(n.name) ? (language === 'zh-CN' ? `已列 ${catalogEntityInfo[n.name]?.field_count ?? 0}` : `${catalogEntityInfo[n.name]?.field_count ?? 0} listed`) : (graph.fields || []).filter(field => field.node_id === n.id && !['internal', 'hidden'].includes(field.catalog_visibility)).length}</td><td className="description-cell">{sourcePurpose(n.name, language) || n.formula || n.definition || '—'}</td><td>{up}</td><td>{down}</td><td title={usage.map(item => displayName(item.name)).join('、')}>{usage.length ? usage.length === 1 ? displayName(usage[0].name) : `${usage.length} ${t('modules')}` : '—'}</td><td><ArrowUpRight size={15} /></td></tr>;
          })}</tbody></table>{tableRows.length === 0 && <div className="empty-table">{t('No nodes match your search.')}</div>}</div>}
      </section>
      <div className="bottom-prompt"><div className="prompt-icon"><Sparkles size={18} /></div><div><strong>{t('Design with natural language')}</strong><span>{t('Describe a new node and its dependencies. Review changes before applying.')}</span></div><button onClick={() => setShowPrompt(true)}>{t('Draft a change')} <ArrowRight size={16} /></button></div>
      </>}
    </main>

    {(selected || selectedEdge) && <aside className="inspector"><div className="inspector-head"><span>{t('INSPECTOR')}</span><IconButton title={t('Close inspector')} onClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}><X size={17} /></IconButton></div>
      {selected && draft && <><div className="inspector-title"><span className={`inspector-icon ${KIND[selected.type]}`}><GitBranch size={20} /></span><div><span className="small-label">{isReferenceResource(selected.name) ? language === 'zh-CN' ? 'MCP 参考资源' : 'MCP RESOURCE' : contractSourceName(selected.name) ? language === 'zh-CN' ? '本产品上游操作' : 'UPSTREAM OPERATION' : t(selected.type)}</span><h2><span className="inspector-node-ref">{nodeRef(selected)}</span>{displayName(selected.name)}</h2></div></div><div className="inspector-scroll">{contractSourceName(selected.name) ? <><FieldCatalog node={selected} fields={nodeFields} mutate={mutate} busy={busy} language={language} /><SourceUsageGuide node={selected} language={language} hasDownstream={downstream.length > 0} /><SourceFlowSummary node={selected} graph={graph} openEdge={openEdge} language={language} /></> : selected.is_system_state ? <StateNodeDetails node={selected} upstream={upstream} downstream={downstream} openNode={openNode} language={language} /> : <><label>{t('Name')}<input value={language === 'zh-CN' && draft.name === selected.name ? displayName(draft.name) : draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>{t('Type')}<select value={draft.type} onChange={e => { const type = e.target.value; setDraft({ ...draft, type, workflow_lane: defaultLane(type) }); }}>{CREATABLE_GROUPS.map(group => <optgroup key={group.name} label={t(group.name)}>{group.types.map(type => <option key={type} value={type}>{t(type)}</option>)}</optgroup>)}</select></label><label>{t('Workflow path')}<select value={draft.workflow_lane || defaultLane(draft.type)} onChange={e => setDraft({ ...draft, workflow_lane: e.target.value })}><option value="shared">{t('Both paths')}</option><option value="signal">{t('Signal path')}</option><option value="knowledge">{t('Asset knowledge path')}</option></select></label>
        {isSignal && <SignalDesignGuide node={draft} graph={graph} fields={nodeFields} language={language} />}
        {isSignal && draft.signal_key && <p className="signal-package-link"><a href={`${API}/signals/${encodeURIComponent(draft.signal_key)}/package`} target="_blank" rel="noreferrer">{language === 'zh-CN' ? '查看版本化执行包 JSON ↗' : 'Open versioned execution package JSON ↗'}</a><small>{language === 'zh-CN' ? '图中文字与执行包不一致时，接口会列出待修正项。' : 'The API lists mismatches between graph text and the execution package.'}</small></p>}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '1 · 要判断什么' : '1 · What should this signal tell you?'}</div>}
        {isSignal && <label>{language === 'zh-CN' ? '要回答的问题 / 支持的判断' : 'Decision question'}<textarea value={draft.decision_question || ''} placeholder={language === 'zh-CN' ? '例如：这个资产的热度是否正在持续增加？' : 'e.g. Is this asset gaining sustained attention?'} onChange={e => setDraft({ ...draft, decision_question: e.target.value })} rows={2} /></label>}
        {TYPE_HELP[draft.type] && <p className="node-type-help">{t(TYPE_HELP[draft.type])}</p>}
        {RESOURCE_REFERENCES[draft.type] && <p className="state-reference"><Database size={14} /> {t(RESOURCE_REFERENCES[draft.type])}</p>}
        <label>{t('Definition')}<textarea value={draft.definition} placeholder={t('What does this node represent?')} onChange={e => setDraft({ ...draft, definition: e.target.value })} rows={4} /></label>
        {isSignal && <label>{language === 'zh-CN' ? '观察窗口与更新频率' : 'Observation window and cadence'}<input value={draft.observation_window || ''} placeholder={language === 'zh-CN' ? '例如：滚动 24 小时，每小时更新' : 'e.g. rolling 24 hours, refreshed hourly'} onChange={e => setDraft({ ...draft, observation_window: e.target.value })} /></label>}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '2 · 需要哪些数据' : '2 · Which data is needed?'}</div>}
        {selected.type !== 'Source' && <SignalNeedsPanel node={draft} graph={graph} mutate={mutate} busy={busy} language={language} />}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '3 · 怎样计算与判断' : '3 · How is it calculated and interpreted?'}</div>}
        <label>{t('Formula')}<textarea value={draft.formula} placeholder={t('Math, pseudocode, SQL, or a natural language formula')} onChange={e => setDraft({ ...draft, formula: e.target.value })} rows={3} /></label>
        {isSignal && <label>{language === 'zh-CN' ? '触发条件 / 分档解释' : 'Trigger rule or interpretation'}<textarea value={draft.trigger_rule || ''} placeholder={language === 'zh-CN' ? '例如：相对历史基线超过 2 倍，且至少持续 3 小时' : 'e.g. above 2× baseline for at least 3 hours'} onChange={e => setDraft({ ...draft, trigger_rule: e.target.value })} rows={3} /></label>}
        <FieldCatalog node={selected} fields={nodeFields} mutate={mutate} busy={busy} language={language} />
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '4 · 怎样检验效果' : '4 · How will it be validated?'}</div>}
        {isSignal && <label>{language === 'zh-CN' ? '验证方法' : 'Validation plan'}<textarea value={draft.validation_plan || ''} placeholder={language === 'zh-CN' ? '例如：对照历史事件与人工标注，统计误报和漏报' : 'e.g. compare with historical events and review false positives'} onChange={e => setDraft({ ...draft, validation_plan: e.target.value })} rows={3} /></label>}
        {isSignal && <label>{language === 'zh-CN' ? '验证记录' : 'Validation observations'}<textarea value={draft.validation_evidence || ''} placeholder={language === 'zh-CN' ? '实际测试后记录样本、结果和仍存在的问题' : 'Record the sample, results, and remaining issues after testing'} onChange={e => setDraft({ ...draft, validation_evidence: e.target.value })} rows={3} /></label>}
        <NodeIOOverview node={selected} graph={graph} openEdge={openEdge} language={language} />
        {[['rationale', 'Design rationale', 'Why is it designed this way?'], ['caveats', 'Caveats', 'Limits and special cases'], ['notes', 'Research notes', 'Additional context']].map(([key, label, placeholder]) => <label key={key}>{t(label)}<textarea value={draft[key]} placeholder={t(placeholder)} onChange={e => setDraft({ ...draft, [key]: e.target.value })} rows={3} /></label>)}
        <div className="relations"><div className="relation-heading"><ArrowDownRight size={16} /> {t('UPSTREAM')} <span>{upstream.length}</span></div>{upstream.length ? upstream.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No upstream nodes')}</em>}</div>
        <div className="relations"><div className="relation-heading"><ArrowUpRight size={16} /> {t('DOWNSTREAM')} <span>{downstream.length}</span></div>{downstream.length ? downstream.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No downstream nodes')}</em>}</div>
        <div className="relations"><div className="relation-heading"><LayoutGrid size={16} /> {t('USED BY PRODUCT')} <span>{products.length}</span></div>{products.length ? products.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No product module downstream')}</em>}</div></>}
      </div>{contractSourceName(selected.name) || selected.is_system_state ? null : <div className="inspector-footer"><button className="button-danger" onClick={deleteNode} title={t('Delete node')} aria-label={t('Delete node')}><Trash2 size={16} /></button><button className="button-primary" disabled={busy} onClick={saveNode}><Check size={16} /> {t('Save changes')}</button></div>}</>}
      {selectedEdge && <><div className="inspector-title"><span className="inspector-icon metric"><ArrowRight size={20} /></span><div><span className="small-label">{t('FIELD LEVEL DEPENDENCY')}</span><h2><span className="inspector-edge-ref">{edgeRef(selectedEdge)}</span>{t('Connection')}</h2></div></div><EdgeMappingPanel edge={selectedEdge} sourceNode={edgeSource} targetNode={edgeTarget} sourceFields={sourceFields} targetFields={targetFields} usages={edgeUsages} mutate={mutate} busy={busy} language={language} /><div className="inspector-footer edge-footer"><button className="button-danger-text" onClick={deleteEdge}><Trash2 size={16} /> {t('Delete connection')}</button></div></>}
    </aside>}

    {showCreate && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowCreate(false); }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">{t('NEW LOGIC UNIT')}</span><h2>{t('Create node')}</h2></div><IconButton title={t('Close')} onClick={() => setShowCreate(false)}><X size={18} /></IconButton></div><div className="modal-body"><label>{t('Name')}<input autoFocus placeholder={t('e.g. Liquidity Signal')} value={newNode.name} onChange={e => setNewNode({ ...newNode, name: e.target.value })} /></label><label>{t('Type')}<select value={newNode.type} onChange={e => { const type = e.target.value; setNewNode({ ...newNode, type, workflow_lane: defaultLane(type) }); }}>{CREATABLE_GROUPS.map(group => <optgroup key={group.name} label={t(group.name)}>{group.types.map(type => <option key={type} value={type}>{t(type)}</option>)}</optgroup>)}</select></label><label>{t('Workflow path')}<select value={newNode.workflow_lane} onChange={e => setNewNode({ ...newNode, workflow_lane: e.target.value })}><option value="shared">{t('Both paths')}</option><option value="signal">{t('Signal path')}</option><option value="knowledge">{t('Asset knowledge path')}</option></select></label>{TYPE_HELP[newNode.type] && <p className="node-type-help">{t(TYPE_HELP[newNode.type])}</p>}<label>{t('Definition')}<textarea rows="4" placeholder={t('What does this node represent?')} value={newNode.definition} onChange={e => setNewNode({ ...newNode, definition: e.target.value })} /></label></div><div className="modal-footer"><button className="button-secondary" onClick={() => setShowCreate(false)}>{t('Cancel')}</button><button className="button-primary" disabled={busy || !newNode.name.trim()} onClick={addNode}>{t('Create node')} <ArrowRight size={16} /></button></div></div></div>}

    {showPrompt && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowPrompt(false); }}><div className="modal proposal-modal"><div className="modal-header"><div><span className="eyebrow">{t('NATURAL LANGUAGE DRAFT')}</span><h2>{t('Propose a change')}</h2></div><IconButton title={t('Close')} onClick={() => setShowPrompt(false)}><X size={18} /></IconButton></div><div className="modal-body"><p className="modal-intro">{t('Describe a new node and reference existing nodes by name. Nothing is changed until you confirm.')}</p><textarea className="prompt-input" rows="4" value={prompt} onChange={e => { setPrompt(e.target.value); setProposal(null); }} />
        {proposal && <div className="proposal-preview"><div className="proposal-heading"><Sparkles size={16} /> {t('PROPOSED CHANGES')} <span className="proposal-source">{t(proposal.source === 'model' ? 'MODEL DRAFT' : 'LOCAL DRAFT')}</span></div><div className="proposal-node"><span className="proposal-action">{t('CREATE NODE')}</span><strong>{displayName(proposal.node.name)}</strong><span className={`type-pill ${KIND[proposal.node.type]}`}>{t(proposal.node.type)}</span></div>{[['definition','Definition'],['formula','Formula'],['rationale','Design rationale'],['caveats','Caveats'],['notes','Research notes']].filter(([key]) => proposal.node[key]).map(([key,label]) => <div className="proposal-field" key={key}><b>{t(label)}</b><span>{proposal.node[key]}</span></div>)}{proposal.upstream_names.map(n => <div className="proposal-link" key={n}>{displayName(n)} <ArrowRight size={14} /> {displayName(proposal.node.name)}</div>)}{proposal.downstream_names.map(n => <div className="proposal-link" key={n}>{displayName(proposal.node.name)} <ArrowRight size={14} /> {displayName(n)}</div>)}{proposal.warnings.map(w => <div className="proposal-warning" key={w}>{t(w)}</div>)}</div>}
      </div><div className="modal-footer"><button className="button-secondary" onClick={() => { setShowPrompt(false); setProposal(null); }}>{t('Cancel')}</button>{proposal ? <button className="button-primary" disabled={busy} onClick={applyProposal}><Check size={16} /> {t('Confirm changes')}</button> : <button className="button-primary" disabled={busy || !prompt.trim()} onClick={propose}><Sparkles size={16} /> {t('Generate proposal')}</button>}</div></div></div>}
    {showHelp && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowHelp(false); }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">{t('QUICK GUIDE')}</span><h2>{t('How it works')}</h2></div><IconButton title={t('Close')} onClick={() => setShowHelp(false)}><X size={18} /></IconButton></div><div className="modal-body help-content"><p><strong>{language === 'zh-CN' ? '信号线。' : 'Signal path. '}</strong>{language === 'zh-CN' ? '切到信号线，从数据来源和证据检查出发，设计指标计算、规则判断和信号产出。' : 'Open the signal path to trace sources and evidence checks through metrics, rules and signal outputs.'}</p><p><strong>{language === 'zh-CN' ? '资产认知线。' : 'Asset knowledge path. '}</strong>{language === 'zh-CN' ? '切到资产认知线，设计资产识别／绑定、关系发现与审核。四张业务表各自是画布节点；处理步骤与具体表连线。' : 'Open the asset knowledge path to design resolution, relationship discovery and review. Each of the four business tables is a graph node connected to specific processing steps.'}</p><p><strong>{language === 'zh-CN' ? '寻找与检验数据。' : 'Find and validate data. '}</strong>{language === 'zh-CN' ? '在节点里列出所需数据，匹配爬虫字段，并记录检验方法。设计完成不代表已有真实记录或信号有效。' : 'List required inputs, match crawler fields, and record a validation plan. A complete design does not establish that records exist or that a signal works.'}</p></div><div className="modal-footer"><button className="button-primary" onClick={() => setShowHelp(false)}>{t('Got it')}</button></div></div></div>}
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`}>{notice.error ? <X size={16} /> : <Check size={16} />}{t(notice.message)}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
