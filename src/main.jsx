import { detailsReady } from './graphTransport';
import { CardDetails } from './CardDetails';
import { detailKind } from './cardDetailModel';
import { cardKinds, cardKind, kindLabel, kindStyle } from './cardModel';
import { CardTypeLibrary } from './CardTypeLibrary';
import { cardTypeGroups, matchesCardType } from './cardTypeFilters';
import { CardDefinitionSettings } from './CardDefinitionSettings';
import { CardProgressBadge, CardProgressNote } from './CardProgress';
import { request } from './api';
import { revealWorkspaceEdit, workspaceQuitHint } from './workspaceQuit';
import { useLiveGraph } from './useLiveGraph';
import { ServerUpdateNotice, WorkspaceVersion, useServerVersion } from './ServerUpdateNotice';
import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseEdge, Handle, Position, MarkerType, useEdgesState, useNodesState, useUpdateNodeInternals } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AlarmClock, Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleHelp, Database, GitBranch, Layers3, LayoutGrid, List, Maximize2, Network, Plus, Search, Sparkles, Trash2, X } from 'lucide-react';
import { EdgeMappingPanel, FieldCatalog } from './FieldPanels';
import { LocalFlowView } from './LocalFlowView';
import businessTables from '../catalog/business-tables.v1.json';
import scoreRollup from '../catalog/score-rollup.v1.json';
import { CatalogTranslationTable } from './CatalogTranslationTable';
import { SignalDesignGuide } from './SignalDesignGuide';
import { SignalNeedsPanel } from './SignalNeedsPanel';
import { sourcePurpose } from './SourceUsageGuide';
import { SourceCasePage } from './SourceCasePage';
import { OtherSourceCasePage } from './OtherSourceCasePage';
import { nodeRef, edgeRef, usageRef, IDENTITY_REFS } from './graphRefs';
import { createCardClickDispatcher } from './cardClicks';
import { coinGeckoProductStages } from './coinGeckoProductLayout';
import { LAYOUT_VERSION, autoLayout, layoutGroups, traceRoute, layoutStages } from './autoLayout';
import { crawlerPresentation, displayPositionUpdate, currentPresentationEdges } from './crawlerPresentation';
import { neighborLayout } from './neighborLayout';
import { arcStyles, bezierRoute, bezierControls } from './edgeRouting';
import { arcBounds } from './canvasViewport';
import { useCanvasNodeVisible, useCanvasNodeMode, useCanvasEdgeMode } from './CanvasRendering';
import { graphEmphasis } from './graphEmphasis';
import { relationFocus, edgePresentation, focusExplanation, traceTriggers, originLabel, isScheduled } from './edgePresentation';
import { processGraph, edgeFlows, processFlow, relationshipId } from './processFlows';
import { FeatureWorkspace } from './FeatureWorkspace';
import { GraphCanvas, useCanvasActions } from './GraphCanvas';
import { graphSearchIndex } from './featureTree';
import './edge-semantics.css';
import { displayNodeName, normalizeNodeReferences, translate } from './i18n';
import './style.css';
import './node-ref.css';
import './graph-search.css';
import './graph-card.css';
import './theme.css';

const BUSINESS_TABLE_NAMES = new Set(Object.keys(businessTables.tables));
const SOURCE_NAMES = {
  binance: 'Binance', 'binance-futures': 'Binance', coingecko: 'CoinGecko', dexscreener: 'DexScreener',
  kaito: 'Kaito', 'kaito-social-spider': 'Kaito', rss: 'RSS', 'crypto-rss-collector': 'RSS', taoli: 'Taoli', 'tg-spider': 'TG Bot',
  'tg-spider-telethon': 'TG Telethon', telegram: 'Telegram',
};
const sourceLabel = id => SOURCE_NAMES[id] || id;
const isReferenceResource = name => name.startsWith('kaito.resource.');
const contractSourceName = name => name.startsWith('coingecko.websocket.') || /^(binance\.usdm\.|kaito\.mcp\.|telegram\.)/.test(name) || isReferenceResource(name) ||
  ['coingecko.coins_markets', 'coingecko.search_trending', 'dexscreener.token_pairs_by_address', 'rss.item', 'taoli.funding_page'].includes(name);
const sourceBadgeId = id => ({ 'telegram-bot': 'tg-spider', 'telegram-telethon': 'tg-spider-telethon' })[id] || id;
const TABLE_GUIDANCE = {
  assets: 'Read the internal asset ID and identity status after an external identifier has matched.',
  asset_identifiers: 'Match a source namespace, external ID and context to an internal asset ID.',
  asset_relationships: 'Read reviewed related assets after a signal is calculated or when preparing a product view. A relationship alone does not make another asset noteworthy.',
  asset_monitoring_rules: 'Read the applicable rule and version when evaluating a signal.',
  asset_score_events: 'Read the evidence-backed contributions when explaining or recalculating an asset score.',
  asset_scores_current: 'Read the latest value for a selected score metric; derive ranks when querying.',
};
const NODE_GROUPS = [{ name: 'Card types', types: cardKinds.map(item => item.id) }];
const WORKFLOW_VIEWS = [
  { id: 'all', name: 'Overview' },
  { id: 'signal', name: 'Signal path' },
  { id: 'knowledge', name: 'Asset knowledge path' },
];
const TYPES = NODE_GROUPS.flatMap(group => group.types);
const DEFAULT_LANES = { asset_initial_score_sources: 'shared', Source: 'shared', 'Raw Field': 'shared', 'Redpanda Topic': 'shared', 'Redis Window': 'shared', 'Evidence Check': 'shared', 'Asset Resolution': 'shared', 'Relationship Discovery': 'knowledge', 'Review Decision': 'knowledge', 'Flow Result': 'knowledge', assets: 'shared', asset_identifiers: 'shared', asset_relationships: 'shared', asset_monitoring_rules: 'shared', asset_score_events: 'shared', asset_scores_current: 'shared', supabase_asset_scores: 'shared' };
const defaultLane = type => DEFAULT_LANES[type] || 'signal';
const nodeLane = node => node.workflow_lane || defaultLane(node.type);
const SIGNAL_TYPES = new Set(['Derived Field', 'Metric', 'Score', 'Ranking', 'Product Module']);
const KIND = { asset_initial_score_sources: 'state', Source: 'source', 'Raw Field': 'raw', 'Redpanda Topic': 'topic', 'Redis Window': 'cache', 'Ranking Table': 'state', 'Evidence Check': 'evidence', 'Asset Resolution': 'identity', 'Relationship Lookup': 'relationship', 'Relationship Discovery': 'relationship', 'Review Decision': 'review', 'Derived Field': 'derived', Metric: 'metric', Score: 'score', Ranking: 'ranking', 'Rule Evaluation': 'rule', 'Flow Result': 'event', 'Signal Event': 'event', 'Product Module': 'product', 'Application Interface': 'product', assets: 'state', asset_identifiers: 'state', asset_relationships: 'state', asset_monitoring_rules: 'state', asset_score_events: 'state', asset_scores_current: 'state', supabase_asset_scores: 'state', 'Asset Registry': 'state', 'Rule Registry': 'state' };
const OUTPUT_TYPES = new Set(['Flow Result', 'Signal Event', 'Ranking', 'Product Module']);
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

const LogicNode = React.memo(function LogicNode({ id, data, selected }) {
  const mode = useCanvasNodeMode(id);
  const t = text => translate(data.language, text);
  const kind = kindStyle(data);
  const cardSummary = mode === 'detail' && data.isContractSource ? sourcePurpose(data.name, data.language) : null;
  const isDecision = cardKind(data) === 'decision';
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => { updateNodeInternals(id); }, [id, data.portSignature, updateNodeInternals]);
  const renderPorts = (ports, type) => ports.map(port => {
    const sidePorts = ports.filter(item => item.side === port.side);
    const place = sidePorts.findIndex(item => item.id === port.id) + 1;
    const percent = `${(place / (sidePorts.length + 1)) * 100}%`;
    return <Handle key={`${type}:${port.id}`} id={`${type}:${port.id}`} type={type} position={port.paired?.position || (port.side === 'right' ? Position.Right : port.side === 'left' ? Position.Left : type === 'source' ? Position.Bottom : Position.Top)}
      className="flow-handle edge-port" style={port.paired ? { [port.side === 'normal' ? 'left' : 'top']: `calc(${port.paired.percent}% + ${port.paired.offset}px)` } : port.side !== 'normal' ? { top: type === 'source' ? `${15 + place / (sidePorts.length + 1) * 40}%` : `${65 + place / (sidePorts.length + 1) * 25}%` } : { left: percent }} isConnectable={false} />;
  });
  return <div style={{ visibility: mode !== 'hidden' ? 'visible' : 'hidden' }} data-render-mode={mode} data-viewport-visible={mode !== 'hidden'} className={`logic-node ${kind} ${OUTPUT_TYPES.has(data.type) ? 'output-node' : ''} ${data.is_system_state ? 'state-node' : ''} ${isDecision ? 'decision-node' : ''} ${selected ? 'is-selected' : ''}`}>
    <Handle type="target" position={Position.Top} className="flow-handle" />
    {renderPorts(data.inputPorts || [], 'target')}
    {mode === 'detail' ? <>
    <div className="node-top">
      <span className="node-ref">{nodeRef(data)}{data.card_contract?.config.resource?.parent_module && <span className="shared-card-badge" title={data.language === 'zh-CN' ? '所属Polars模块' : 'Owning Polars module'}>{data.card_contract.config.resource.parent_module.reference_number}</span>}{data.shared && <span className="shared-card-badge" title={data.language === 'zh-CN' ? '同编号共用同一份内容与配置；点击可同时高亮各处。显示副本的位置由整理规则安排。' : 'Same reference, shared content and settings. Select to highlight all occurrences. Mirrors are positioned by Arrange.'}>{data.language === 'zh-CN' ? '共用' : 'Shared'}</span>}</span>
      <div className="node-labels">
        <span className="node-glyph">{kind === 'product' ? <LayoutGrid size={15} /> : kind === 'source' || kind === 'state' || kind === 'topic' || kind === 'cache' ? <Database size={15} /> : kind === 'score' ? <Activity size={15} /> : kind === 'identity' || kind === 'relationship' ? <Network size={15} /> : <GitBranch size={15} />}</span>
        <span className="node-kind" title={kindLabel(cardKind(data), data.language)}>{kindLabel(cardKind(data), data.language)}</span>
        {data.catalogSourceId && data.type === 'Source' && <span className="source-origin-tag" data-source={data.catalogSourceId} title={sourceLabel(data.catalogSourceId)}>{sourceLabel(data.catalogSourceId)}</span>}
        {isScheduled(data) && <span className="schedule-start-badge" title={data.language === 'zh-CN' ? '此卡片有定时启动定义' : 'This card has a scheduled entry'}><AlarmClock size={13} />{data.language === 'zh-CN' ? '定时启动' : 'Scheduled start'}</span>}
        {Boolean(data.is_system_state) && <span className="state-node-badge" title={BUSINESS_TABLE_NAMES.has(data.name) ? data.language === 'zh-CN' ? '业务表定义' : 'Table definition' : t('Planned')}>{BUSINESS_TABLE_NAMES.has(data.name) ? data.language === 'zh-CN' ? '业务表定义' : 'Table definition' : t('Planned')}</span>}
        {data.pendingNeedNames?.length > 0 && <span className="node-need-count" title={data.pendingNeedNames.join('、')}>{data.language === 'zh-CN' ? `${data.pendingNeedNames.length} 项待找` : `${data.pendingNeedNames.length} needed`}</span>}
      </div>
      {data.isContractSource && !data.isReferenceResource && <span className="node-field-count">{data.language === 'zh-CN' ? `已列 ${data.fieldCount} 项` : `${data.fieldCount} listed`}</span>}
      {!data.isContractSource && data.fieldCount > 0 && <span className="node-field-count">{data.language === 'zh-CN' ? `${data.fieldCount} ${t('fields')}` : `${data.fieldCount} ${data.fieldCount === 1 ? 'field' : 'fields'}`}</span>}
    </div>
    <div className="node-body">
    <CardProgressBadge progress={data.progress} language={data.language} />
    <div className="node-name" title={`${nodeRef(data)} ${data.isContractSource && data.language === 'zh-CN' ? data.catalogRecordLabel || data.name : displayNodeName(data.language, data.name)} · ${data.name}`}><span className="node-name-text">{data.isContractSource && data.language === 'zh-CN' ? data.catalogRecordLabel || data.name : displayNodeName(data.language, data.name)}</span></div>
    <div className="node-definition" title={BUSINESS_TABLE_NAMES.has(data.name) ? businessTables.tables[data.name].purpose_zh : cardSummary || data.definition || ''}>{BUSINESS_TABLE_NAMES.has(data.name)
      ? data.language === 'zh-CN' ? `${businessTables.tables[data.name].label_zh} · 查看表结构和案例行。` : `${data.name} · view schema and case rows.`
      : cardSummary || (data.definition ? t(data.definition) : t('Add a definition'))}</div>
    </div>
    </> : mode === 'overview' ? <div className="node-overview" title={`${nodeRef(data)} · ${data.name}`}>
      <span>{nodeRef(data)}</span><strong>{data.isContractSource && data.language === 'zh-CN' ? data.catalogRecordLabel || data.name : displayNodeName(data.language, data.name)}</strong>
    </div> : null}
    <Handle type="source" position={Position.Bottom} className="flow-handle" />
    {renderPorts(data.outputPorts || [], 'source')}
  </div>;
});

const GroupLabel = React.memo(function GroupLabel({ id, data }) {
  const visible = useCanvasNodeVisible(id);
  return <div style={{ visibility: visible ? 'visible' : 'hidden' }} className="graph-group-label"><strong>{data.title}</strong><span>{data.count}</span></div>;
});
const DirectArcEdge = React.memo(function DirectArcEdge({ id, sourceX, sourceY, targetX, targetY, data, style, markerEnd, markerStart, interactionWidth }) {
  const link = { ...data, source: [sourceX, sourceY], target: [targetX, targetY] };
  const bounds = useMemo(() => arcBounds(link, data.meaning), [data, sourceX, sourceY, targetX, targetY]);
  const mode = useCanvasEdgeMode(bounds);
  const [a, b, c, d] = bezierControls(link);
  if (mode === 'hidden') return null;
  if (mode === 'overview') return <g data-render-mode="overview" onClick={event => { event.stopPropagation(); data.onSelect?.(); }}><title>{data.meaning}</title><BaseEdge id={id} path={bezierRoute(link)} style={{ ...style, strokeWidth: 1 }} interactionWidth={interactionWidth} /></g>;
  const midpoint = axis => (a[axis] + 3 * b[axis] + 3 * c[axis] + d[axis]) / 8;
  return <g data-render-mode="detail" onClick={event => { event.stopPropagation(); data.onSelect?.(); }}><title>{data.meaning}</title><BaseEdge id={id} path={bezierRoute(link)} style={style} markerEnd={markerEnd} markerStart={markerStart} interactionWidth={interactionWidth}
    label={data.meaning} labelX={midpoint(0)} labelY={midpoint(1)} labelStyle={{ fill: style.stroke, fontSize: 11, fontWeight: 600 }}
    labelBgStyle={{ fill: 'var(--ss-surface)', stroke: 'var(--ss-border)' }} labelBgPadding={[7, 5]} labelBgBorderRadius={5} className="edge-meaning-path" /></g>;
});
const MemoCardDetails = React.memo(CardDetails);
const MemoCardDefinitionSettings = React.memo(CardDefinitionSettings);
const MemoFieldCatalog = React.memo(FieldCatalog);
const edgeTypes = { directArc: DirectArcEdge };
const nodeTypes = { logic: LogicNode, groupLabel: GroupLabel };

function IconButton({ children, title, onClick, active, className = '' }) {
  return <button className={`icon-button ${active ? 'active' : ''} ${className}`} onClick={onClick} title={title} aria-label={title}>{children}</button>;
}

function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem('signalstudio-language') === 'en' ? 'en' : 'zh-CN');
  const t = text => translate(language, text);
  const displayName = name => language === 'zh-CN' ? catalogEntityInfo[name]?.label_cn || displayNodeName(language, name) : displayNodeName(language, name);
  const [graph, setGraph] = useState({ nodes: [], edges: [], fields: [], field_usages: [], requirements: [] });
  const [contractSummary, setContractSummary] = useState(null);
  const [catalogEntityInfo, setCatalogEntityInfo] = useState({});
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [view, setView] = useState('graph');
  const [laneView, setLaneView] = useState('all');
  const [graphDisplayMode, setGraphDisplayMode] = useState('full');
  const [focusNodeId, setFocusNodeId] = useState(null);
  const [routeOccurrenceId, setRouteOccurrenceId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [focusedEdgeId, setFocusedEdgeId] = useState(null);
  const [flowFocusId, setFlowFocusId] = useState(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState(null);
  const [filter, setFilter] = useState('');
  const [searchOccurrenceIndex, setSearchOccurrenceIndex] = useState(0);
  useEffect(() => setSearchOccurrenceIndex(0), [filter]);
  const [typeFilter, setTypeFilter] = useState('All types');
  const [showCreate, setShowCreate] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [proposal, setProposal] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [draft, setDraft] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [newNode, setNewNode] = useState({ name: '', kind: 'process', workflow_lane: 'signal', definition: '' });
  const [showHelp, setShowHelp] = useState(false);
  const [showCase016, setShowCase016] = useState(false);
  const [case016Index, setCase016Index] = useState(0);
  const [otherSourceCase, setOtherSourceCase] = useState(null);
  const [flowInstance, setFlowInstance] = useState(null);
  const pendingRoute = useRef(null);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === 'zh-CN' ? 'SignalStudio · 数据逻辑设计工作台' : 'SignalStudio';
    localStorage.setItem('signalstudio-language', language);
  }, [language]);

  const flash = (message, error = false) => { setNotice({ message, error }); setTimeout(() => setNotice(null), 4200); };
  const presentation = useMemo(() => processGraph(graph), [graph]);
  const towerView = useMemo(() => crawlerPresentation(graph.nodes, graph.edges, presentation.edges), [graph, presentation]);
  const visualNodes = useMemo(() => new Map(towerView.nodes.map(node => [node.id, node])), [towerView]);
  const visualEdges = useMemo(() => new Map(towerView.edges.map(edge => [edge.id, edge])), [towerView]);
  const logicalNodeId = id => visualNodes.get(id)?.logicalId || id;
  const logicalEdgeId = id => visualEdges.get(id)?.logicalEdgeId || id;
  const live = useLiveGraph(setGraph);
  const serverVersion = useServerVersion();
  const lastEditedControl = useRef(null);
  const trackEdit = event => {
    if (!event.target.closest('[data-workspace-editor]')) return;
    lastEditedControl.current = event.target;
    live.markEdited();
  };
  useEffect(() => {
    const reveal = () => revealWorkspaceEdit(document, lastEditedControl.current);
    window.signalstudioQuitHint = () => workspaceQuitHint(showCreate, showPrompt, language);
    window.addEventListener('signalstudio-reveal-draft', reveal);
    return () => { delete window.signalstudioQuitHint; window.removeEventListener('signalstudio-reveal-draft', reveal); };
  }, [showCreate, showPrompt, language]);
  useEffect(() => {
    window.signalstudioCanQuit = () => live.canQuit() && !busy && !showCreate && !showPrompt;
    window.signalstudioQuitState = () => busy || live.writePending() ? 'busy' : window.signalstudioCanQuit() ? 'safe' : 'draft';
    return () => { delete window.signalstudioCanQuit; delete window.signalstudioQuitState; };
  }, [live, busy, showCreate, showPrompt]);
  useEffect(() => { live.resetEdited(); }, [selectedId, selectedEdgeId]);
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
  }, [graph.contract_revision]);
  useEffect(() => {
    const fieldCounts = new Map();
    const nodeById = new Map(towerView.nodes.map(node => [node.id, node]));
    const nodeNameById = new Map(towerView.nodes.map(node => [node.id, node.name]));
    for (const field of graph.fields || []) if (!['internal', 'hidden'].includes(field.catalog_visibility))
      fieldCounts.set(field.node_id, (fieldCounts.get(field.node_id) || 0) + 1);
    const usageCounts = new Map();
    for (const usage of graph.field_usages || []) usageCounts.set(usage.edge_id, (usageCounts.get(usage.edge_id) || 0) + 1);
    const pendingNeedNames = new Map();
    for (const requirement of graph.requirements || []) if (!requirement.source_field_id) pendingNeedNames.set(requirement.node_id, [...(pendingNeedNames.get(requirement.node_id) || []), requirement.name]);
    const ports = new Map(towerView.nodes.map(node => [node.id, { inputPorts: [], outputPorts: [] }]));
    const arcs = arcStyles(towerView.nodes, towerView.edges);
    for (const edge of towerView.edges) {
      ports.get(edge.upstream_id)?.outputPorts.push({ id: edge.id, side: arcs.get(edge.id)?.sourceSide || 'normal', paired: arcs.get(edge.id)?.sourcePort });
      ports.get(edge.downstream_id)?.inputPorts.push({ id: edge.id, side: arcs.get(edge.id)?.targetSide || 'normal', paired: arcs.get(edge.id)?.targetPort });
    }
    for (const [id, nodePorts] of ports) {
      nodePorts.inputPorts.sort((a, b) => (nodeById.get(towerView.edges.find(edge => edge.id === a.id)?.upstream_id)?.position_x ?? 0) - (nodeById.get(towerView.edges.find(edge => edge.id === b.id)?.upstream_id)?.position_x ?? 0) || a.id.localeCompare(b.id));
      nodePorts.outputPorts.sort((a, b) => (nodeById.get(towerView.edges.find(edge => edge.id === a.id)?.downstream_id)?.position_x ?? 0) - (nodeById.get(towerView.edges.find(edge => edge.id === b.id)?.downstream_id)?.position_x ?? 0) || a.id.localeCompare(b.id));
      nodePorts.portSignature = `${id}:${nodePorts.inputPorts.map(port => `${port.id}:${port.side}:${JSON.stringify(port.paired)}`).join(',')}/${nodePorts.outputPorts.map(port => `${port.id}:${port.side}:${JSON.stringify(port.paired)}`).join(',')}`;
    }
    setNodes(towerView.nodes.map(n => ({ id: n.id, draggable: true, type: 'logic', ariaLabel: language === 'zh-CN' ? catalogEntityInfo[n.name]?.label_cn || displayNodeName(language, n.name) : displayNodeName(language, n.name), position: { x: n.position_x, y: n.position_y }, data: { ...n, id: n.logicalId, progress: graph.card_progress?.[n.logicalId], ...ports.get(n.id), language, isContractSource: contractSourceName(n.name), isReferenceResource: isReferenceResource(n.name), catalogSourceId: catalogEntityInfo[n.name]?.source, catalogRecordLabel: catalogEntityInfo[n.name]?.label_cn, fieldCount: BUSINESS_TABLE_NAMES.has(n.name) ? businessTables.tables[n.name].columns.length : contractSourceName(n.name) ? catalogEntityInfo[n.name]?.field_count ?? 0 : fieldCounts.get(n.logicalId) || 0, pendingNeedNames: pendingNeedNames.get(n.logicalId) || [] } })));
    setEdges(towerView.edges.map(e => { const color = 'var(--ss-edge)';
      return { id: e.id, source: e.upstream_id, target: e.downstream_id, sourceHandle: `source:${e.id}`, targetHandle: `target:${e.id}`, type: 'directArc', data: arcs.get(e.id), animated: false,
        ariaLabel: `${displayNodeName(language, nodeNameById.get(e.upstream_id))} → ${displayNodeName(language, nodeNameById.get(e.downstream_id))}`,
        style: { stroke: color, strokeWidth: 1.5, strokeDasharray: arcs.get(e.id)?.dashed ? '6 4' : undefined }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } }; }));
  }, [graph, towerView, language, catalogEntityInfo, setNodes, setEdges]);

  const selected = graph.nodes.find(n => n.id === selectedId);
  const isSignal = selected && SIGNAL_TYPES.has(selected.type) && selected.name !== scoreRollup.node.name;
  const selectedEdge = graph.edges.find(e => e.id === selectedEdgeId);
  const detailIds = selected ? [...new Set([selected.id, ...graph.edges.flatMap(edge => edge.upstream_id === selected.id ? [edge.downstream_id] : edge.downstream_id === selected.id ? [edge.upstream_id] : [])])]
    : selectedEdge ? [selectedEdge.upstream_id, selectedEdge.downstream_id] : [];
  const detailKey = detailIds.join(',');
  const detailReady = detailsReady(graph, detailIds);
  useEffect(() => {
    let active = true;
    setDetailError(null);
    if (detailKey && !detailReady) live.loadDetails(detailKey.split(',')).catch(error => { if (active) setDetailError(error.message); });
    return () => { active = false; };
  }, [detailKey, detailReady, graph.revision, live.status, live.loadDetails, detailAttempt]);
  const nodeFields = useMemo(() => selected ? (graph.fields || []).filter(field => field.node_id === selected.id) : [], [graph.fields, selected?.id]);
  const selectedInputEdgeIds = new Set(selected ? graph.edges.filter(edge => edge.downstream_id === selected.id).map(edge => edge.id) : []);
  const inheritedOutputIds = new Set((graph.field_usages || []).filter(usage => selectedInputEdgeIds.has(usage.edge_id) && usage.target_field_id).map(usage => usage.target_field_id));
  const addedOutputFields = useMemo(() => nodeFields.filter(field => !inheritedOutputIds.has(field.id)), [nodeFields, graph.field_usages, graph.edges, selected?.id]);
  const edgeSource = selectedEdge ? graph.nodes.find(n => n.id === selectedEdge.upstream_id) : null;
  const edgeTarget = selectedEdge ? graph.nodes.find(n => n.id === selectedEdge.downstream_id) : null;
  const sourceFields = edgeSource ? (graph.fields || []).filter(field => field.node_id === edgeSource.id) : [];
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
  const cardClicks = useRef(null);
  if (!cardClicks.current) cardClicks.current = createCardClickDispatcher();
  useEffect(() => {
    cardClicks.current.cancel();
    return () => cardClicks.current.cancel();
  }, [view, laneView, filter, typeFilter, graphDisplayMode]);
  const draftBase = useRef(null);
  useEffect(() => {
    const previousBase = draftBase.current;
    setDraft(previous => selected ? previous?.id === selected.id && previousBase && JSON.stringify(previous) !== JSON.stringify(previousBase) ? previous : { ...selected } : null);
    draftBase.current = selected;
  }, [selected]);
  useEffect(() => { setDraft(selected ? { ...selected } : null); }, [live.editorEpoch]);
  const visibleForLane = (node, lane) => lane === 'all' || nodeLane(node) === 'shared' || nodeLane(node) === lane;
  const knowledgeNodeIds = new Set(graph.nodes.filter(node => nodeLane(node) === 'knowledge').map(node => node.id));
  const knowledgeVisibleIds = new Set(knowledgeNodeIds);
  for (const edge of graph.edges) if (knowledgeNodeIds.has(edge.upstream_id) || knowledgeNodeIds.has(edge.downstream_id)) {
    knowledgeVisibleIds.add(edge.upstream_id);
    knowledgeVisibleIds.add(edge.downstream_id);
  }
  const visibleInView = node => laneView === 'knowledge' ? knowledgeVisibleIds.has(node.id) : visibleForLane(node, laneView);
  const deferredFilter = useDeferredValue(filter);
  const query = deferredFilter.trim().toLowerCase();
  const isNodeReferenceQuery = /^#\d{1,4}$/.test(query);
  const cardReferenceQuery = /^#?\d{1,4}$/.test(query) ? `#${query.replace(/^#/, '')}` : null;
  const connectedIds = new Set(graph.edges.flatMap(edge => [edge.upstream_id, edge.downstream_id]));
  const normalizeRef = value => value.toLowerCase().replace(/^([lr])0*(\d+)/, (_, prefix, digits) => prefix + Number(digits));
  const referenceMatchEdges = useMemo(() => /^[lr]\d+(?:-q)?$/.test(query) ? presentation.edges.filter(edge =>
    normalizeRef(edgePresentation(presentation, edge, language).displayLabel.split(' · ')[0]) === normalizeRef(query) ||
    (graph.field_usages || []).some(usage => usage.edge_id === edge.id && normalizeRef(usageRef(usage)) === normalizeRef(query))) : [], [query, presentation, graph.field_usages, language]);
  const referenceMatchNodes = new Set(referenceMatchEdges.flatMap(edge => [edge.upstream_id, edge.downstream_id]));
  const searchIndex = useMemo(() => {
    const index = graphSearchIndex(graph.nodes, graph.fields || [], graph.requirements || [], name => `${displayName(name)} ${sourcePurpose(name, language) || ''}`);
    graph.nodes.forEach(node => index.set(node.id, `${index.get(node.id)} ${t(node.type).toLowerCase()}`));
    return index;
  }, [graph, language, catalogEntityInfo]);
  const matchesQuery = n => !query || referenceMatchNodes.has(n.id) || searchIndex.get(n.id)?.includes(query) || t(n.type).toLowerCase().includes(query);
  const typeGroups = useMemo(() => cardTypeGroups(graph.nodes, language), [graph.nodes, language]);
  const filtered = useMemo(() => graph.nodes.filter(n => (visibleInView(n) || referenceMatchNodes.has(n.id) || isNodeReferenceQuery) &&
    (matchesCardType(n, typeFilter) || referenceMatchNodes.has(n.id) || isNodeReferenceQuery) &&
    matchesQuery(n)).sort((a, b) => a.reference_number - b.reference_number), [graph, query, laneView, typeFilter, searchIndex, language, referenceMatchEdges]);
  const tableRows = filtered;
  // Every graph search navigates the complete canvas; table searches still filter.
  const locatingCard = view === 'graph' && Boolean(query);
  const searchMatches = locatingCard ? graph.nodes.filter(node => cardReferenceQuery
    ? nodeRef(node).toLowerCase() === cardReferenceQuery : matchesQuery(node)) : [];
  const searchMatchIds = new Set(searchMatches.map(node => node.id));
  const searchMatchKey = searchMatches.map(node => node.id).join(',');
  const searchTarget = searchMatches.length === 1 ? searchMatches[0] : null;
  const searchOccurrences = searchTarget ? towerView.nodes.filter(node => node.logicalId === searchTarget.id) : [];
  const searchOccurrence = searchOccurrences[searchOccurrenceIndex % (searchOccurrences.length || 1)];
  const focusEdge = useCallback(id => { setFlowFocusId(null); cardClicks.current.cancel(); setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(id); setFocusNodeId(null); }, []);
  const edgeMeanings = useMemo(() => {
    const connection = presentation.edges.find(edge => edge.id === (focusedEdgeId || selectedEdgeId));
    const choices = edgeFlows(presentation, connection);
    const owner = graph.nodes.find(node => node.id === flowFocusId && choices.some(choice => choice.id === node.id)) || relationFocus(presentation, selectedId, focusedEdgeId || selectedEdgeId);
    return new Map(presentation.edges.map(edge => [edge.id, edgePresentation(presentation, edge, language, owner)]));
  }, [graph, presentation, language, flowFocusId, selectedId, focusedEdgeId, selectedEdgeId]);
  const movingCanvas = useRef(false);
  const { canvasNodes, highlightingType, typeMatchIds, typeChoice, filteredIds, localFocus, focusConnection, flowChoices, relationOwner, currentFlow, triggerTrace, relatedNodeIds, relatedEdgeIds, routeStart, hasGraphFocus, displayNodes, displayEdges } = useMemo(() => {
  // Category navigation emphasizes the full canvas; only table rows are filtered.
  const canvasNodes = locatingCard ? graph.nodes : graph.nodes.filter(visibleInView);
  const highlightingType = view === 'graph' && graphDisplayMode !== 'local' && typeFilter !== 'All types' && !locatingCard;
  const typeMatchIds = new Set(highlightingType ? graph.nodes.filter(node => matchesCardType(node, typeFilter)).map(node => node.id) : []);
  const typeChoice = typeGroups.flatMap(group => [group, ...group.children]).find(item => item.id === typeFilter);
  const filteredIds = new Set(canvasNodes.map(n => n.id));
  const localFocus = graph.nodes.find(node => node.id === focusNodeId) || filtered.find(node => node.reference_number === IDENTITY_REFS.lookup) || filtered.find(node => connectedIds.has(node.id)) || filtered[0];
  const groupLabels = layoutGroups(graph.nodes, graph.edges).flatMap(group => {
    if (group.flow) return [];
    const members = group.nodes.filter(node => filteredIds.has(node.id));
    if (!members.length) return [];
    return [{
      id: `group-label:${group.key}`, type: 'groupLabel',
      position: { x: Math.min(...members.map(node => node.position_x)), y: Math.min(...members.map(node => node.position_y)) - 40 },
      data: { title: language === 'zh-CN' ? group.title : group.titleEn,
        count: language === 'zh-CN' ? `${members.length} 个` : `${members.length} ${members.length === 1 ? 'node' : 'nodes'}` },
      width: 340, height: 26, measured: { width: 340, height: 26 },
      draggable: false, selectable: false, connectable: false, focusable: false, style: { pointerEvents: 'none' },
    }];
  });
  for (const towerId of new Set(towerView.nodes.map(node => node.towerId))) {
    const members = towerView.nodes.filter(node => node.towerId === towerId && filteredIds.has(node.logicalId));
    const ids = new Set(members.map(node => node.id));
    const stages = coinGeckoProductStages(graph.nodes.find(node => node.id === towerId)?.name, members)
      ?? layoutStages(members, towerView.edges.filter(edge => ids.has(edge.upstream_id) && ids.has(edge.downstream_id)));
    groupLabels.push(...stages.map(stage => ({
      id: `${stage.id}:${towerId || 'shared-area'}`, type: 'groupLabel', position: { x: stage.x, y: stage.y },
      data: { title: language === 'zh-CN' ? stage.title : stage.titleEn, count: stage.count },
      width: 300, height: 36, measured: { width: 300, height: 36 }, draggable: false, selectable: false, connectable: false,
      style: { pointerEvents: 'none' },
    })));
  }
  const focusConnection = presentation.edges.find(edge => edge.id === (focusedEdgeId || selectedEdgeId));
  const flowChoices = edgeFlows(presentation, focusConnection);
  const relationOwner = graph.nodes.find(node => node.id === flowFocusId && flowChoices.some(choice => choice.id === node.id)) || relationFocus(presentation, selectedId, focusedEdgeId || selectedEdgeId);
  const currentFlow = relationOwner ? processFlow(presentation, relationOwner.id) : null;
  const triggerTrace = traceTriggers(graph, relationOwner);
  const emphasis = graphEmphasis(graph.nodes, presentation.edges, {
    routeNodeId: filteredIds.has(focusNodeId) ? focusNodeId : null,
    detailNodeId: relationOwner?.id || selectedId, selectedEdgeId: selectedEdgeId || focusedEdgeId, hoveredEdgeId,
  }, presentation);
  const relatedNodeIds = emphasis.nodeIds, relatedEdgeIds = emphasis.edgeIds;
  const routeStart = logicalNodeId(routeOccurrenceId) === focusNodeId ? routeOccurrenceId : focusNodeId;
  const occurrenceRoute = focusNodeId ? traceRoute(towerView.nodes, towerView.edges, routeStart) : null;
  const hasGraphFocus = emphasis.active && !highlightingType;
  const displayNodes = [...nodes.map(n => { const id = n.data.id; const related = occurrenceRoute ? occurrenceRoute.nodeIds.has(n.id) : relatedNodeIds.has(id); return { ...n, hidden: !filteredIds.has(id), className: highlightingType ? typeMatchIds.has(id) ? 'graph-type-match' : '' : id === focusNodeId ? 'graph-search-target graph-route-focus' : hasGraphFocus ? related ? 'graph-related' : 'graph-dimmed' : searchMatchIds.has(id) ? 'graph-search-target' : '' }; }), ...groupLabels];
  const displayEdges = currentPresentationEdges(edges, visualEdges, edgeMeanings).map(e => {
    const meaning = edgeMeanings.get(logicalEdgeId(e.id));
    const color = ({ read: 'var(--ss-blue)', write: 'var(--ss-success)', trigger: 'var(--ss-purple)', error: 'var(--ss-error)', data: 'var(--ss-muted)' })[meaning.tone];
    return { ...e,
      hidden: !filteredIds.has(logicalNodeId(e.source)) || !filteredIds.has(logicalNodeId(e.target)),
      className: hasGraphFocus ? (occurrenceRoute ? occurrenceRoute.edgeIds.has(e.id) : relatedEdgeIds.has(logicalEdgeId(e.id))) ? 'graph-related' : 'graph-dimmed' : referenceMatchEdges.some(edge => edge.id === logicalEdgeId(e.id)) ? 'graph-related' : '',
      data: { ...e.data, meaning: meaning.displayLabel, onSelect: () => focusEdge(logicalEdgeId(e.id)) }, ariaLabel: `${e.ariaLabel} · ${meaning.displayLabel}`,
      style: { ...e.style, stroke: color }, markerEnd: { ...e.markerEnd, color },
    };
  });
    return { canvasNodes, highlightingType, typeMatchIds, typeChoice, filteredIds, localFocus, focusConnection, flowChoices, relationOwner, currentFlow, triggerTrace, relatedNodeIds, relatedEdgeIds, routeStart, hasGraphFocus, displayNodes, displayEdges };
  }, [graph, towerView, nodes, edges, presentation, language, laneView, view, graphDisplayMode, query, typeFilter, focusNodeId, selectedId, selectedEdgeId, focusedEdgeId, flowFocusId, hoveredEdgeId, routeOccurrenceId, searchOccurrenceIndex, catalogEntityInfo, focusEdge, edgeMeanings]);
  const miniMapColor = useCallback(node => typeMatchIds.has(node.data.id) ? 'var(--ss-accent)' : ({ source: 'var(--ss-blue)', raw: 'var(--ss-neutral)', evidence: 'var(--ss-blue)', identity: 'var(--ss-blue)', relationship: 'var(--ss-blue)', review: 'var(--ss-purple)', derived: 'var(--ss-purple)', metric: 'var(--ss-success)', score: 'var(--ss-accent)', ranking: 'var(--ss-pink)', rule: 'var(--ss-warning)', event: 'var(--ss-warning)', product: 'var(--ss-error)', state: 'var(--ss-blue)', topic: 'var(--ss-purple)', cache: 'var(--ss-pink)' })[KIND[node.data.type]] || 'var(--ss-neutral)', [typeMatchIds]);
  const visibleNodeIds = towerView.nodes.filter(node => filteredIds.has(node.logicalId)).map(node => node.id).join(',');
  const wasLocatingCard = useRef(false);
  useEffect(() => {
    const leavingCardSearch = wasLocatingCard.current;
    wasLocatingCard.current = locatingCard;
    if (view !== 'graph' || graphDisplayMode !== 'full' || !flowInstance) return;
    if (locatingCard) {
      if (!searchMatches.length) return;
      const frame = requestAnimationFrame(() => {
        if (!searchTarget) {
          flowInstance.fitView({ nodes: searchMatches.map(node => ({ id: node.id })), padding: 0.2, maxZoom: 0.85, duration: 250 });
          return;
        }
        const target = flowInstance.getNode(searchOccurrence?.id || searchTarget.id);
        if (!target) return;
        flowInstance.setCenter(target.position.x + (target.measured?.width ?? 286) / 2,
          target.position.y + (target.measured?.height ?? 174) / 2, { zoom: 0.85, duration: 250 });
      });
      return () => cancelAnimationFrame(frame);
    }
    // Clearing the locator removes its highlight without moving or fitting the viewport.
    if ((leavingCardSearch && !query) || !visibleNodeIds) return;
    const frame = requestAnimationFrame(() => flowInstance.fitView({
      nodes: visibleNodeIds.split(',').map(id => ({ id })), padding: 0.2, maxZoom: 0.85, duration: 250,
    }));
    return () => cancelAnimationFrame(frame);
  }, [query, Boolean(visibleNodeIds), view, graphDisplayMode, flowInstance, searchMatchKey, searchOccurrenceIndex]);

  const mutate = async (path, method, body, success, saveMain = false) => {
    try { setBusy(true); const preserve = !saveMain && draft && selected && JSON.stringify(draft) !== JSON.stringify(selected); const result = await live.write(path, method, body, preserve); if (success) flash(success); return result; }
    catch (error) { flash(error.message, true); return null; }
    finally { setBusy(false); }
  };
  const saveNode = async () => { if (!draft) return; const saved = await mutate(`/nodes/${draft.id}`, 'PATCH', Object.fromEntries(Object.entries(draft).filter(([key, value]) => !['kind', 'card_contract', 'detail_loaded', 'detail_revision', 'id', 'reference_number', 'created_at', 'updated_at', 'position_x', 'position_y', 'is_catalog_source', 'is_system_state', 'signal_key'].includes(key) && value !== selected?.[key])), 'Node saved', true); if (saved) { const latest = live.getGraph().nodes.find(node => node.id === saved.id); draftBase.current = latest; setDraft(latest ? { ...latest } : null); } };
  const deleteNode = async () => { if (!selected || !confirm(language === 'zh-CN' ? `删除“${displayName(selected.name)}”及其所有连接？` : `Delete “${selected.name}” and its connections?`)) return;
    const result = await mutate(`/nodes/${selected.id}`, 'DELETE', null, 'Node deleted'); if (result) setSelectedId(null); };
  const addNode = async () => { const result = await mutate('/nodes', 'POST', newNode, 'Node created');
    if (result) { setShowCreate(false); setSelectedId(result.id); setNewNode({ name: '', kind: 'process', workflow_lane: 'signal', definition: '' }); setTimeout(() => flowInstance?.setCenter(result.position_x, result.position_y, { zoom: 0.85, duration: 450 }), 80); } };
  const connect = async connection => { await mutate('/edges', 'POST', { upstream_id: logicalNodeId(connection.source), downstream_id: logicalNodeId(connection.target) }, 'Connection created'); };
  const deleteEdge = async () => { if (!selectedEdgeId) return; const result = await mutate(`/edges/${selectedEdgeId}`, 'DELETE', null, 'Connection deleted'); if (result) setSelectedEdgeId(null); };
  const propose = async () => { try { setBusy(true); setProposal(await live.write('/proposals', 'POST', { prompt: normalizeNodeReferences(language, prompt, graph.nodes) }, true)); }
    catch (error) { flash(error.message, true); } finally { setBusy(false); } };
  const applyProposal = async () => { const result = await mutate('/proposals/apply', 'POST', proposal, 'Proposed changes applied');
    if (result) { setSelectedId(result.id); setProposal(null); setPrompt(''); setShowPrompt(false); setTimeout(() => flowInstance?.setCenter(result.position_x, result.position_y, { zoom: 0.85, duration: 450 }), 80); } };
  const openNode = id => { cardClicks.current.cancel(); setSelectedId(logicalNodeId(id)); setSelectedEdgeId(null); setFocusedEdgeId(null); setFocusNodeId(null); };
  const fitRoute = id => {
    const route = traceRoute(towerView.nodes, towerView.edges, id);
    flowInstance?.fitView({ nodes: [...route.nodeIds].map(nodeId => ({ id: nodeId })), padding: 0.2, maxZoom: 0.85, duration: 350 });
  };
  const showRoute = id => {
    setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(null); setFocusNodeId(logicalNodeId(id)); setRouteOccurrenceId(id);
    if (graphDisplayMode === 'functions') { pendingRoute.current = id; setGraphDisplayMode('full'); }
    else fitRoute(id);
  };
  const focusSelectedRelations = async () => {
    if (!selected || busy) return;
    const renderedCards = new Map((flowInstance?.getNodes() || nodes).filter(node => graph.nodes.some(original => original.id === node.id)).map(node => [node.id, node]));
    const cards = graph.nodes.map(node => renderedCards.get(node.id) || {
      id: node.id, position: { x: node.position_x, y: node.position_y },
    });
    const moved = neighborLayout(cards, graph.edges, selected.id);
    if (!moved.length) {
      flash(language === 'zh-CN' ? '这张卡片没有直接上下游' : 'This card has no direct neighbors');
      return;
    }
    const movedById = new Map(moved.map(position => [position.id, position]));
    const positions = cards.map(card => movedById.get(card.id) || {
      id: card.id, position_x: card.position.x, position_y: card.position.y,
    });
    const result = await mutate('/nodes/layout', 'POST', { layout_version: LAYOUT_VERSION, positions },
      language === 'zh-CN' ? '上下游已拉近，新位置已保存' : 'Neighbors moved closer; positions saved');
    if (result) {
      setSelectedEdgeId(null);
      setView('graph');
      setGraphDisplayMode('full');
    }
  };
  const openCase016 = index => { setCase016Index(index); setShowCase016(true); };
  const closeCase016 = useCallback(() => setShowCase016(false), []);
  const closeOtherSourceCase = useCallback(() => setOtherSourceCase(null), []);
  const openEdge = visualId => { const id = relationshipId(presentation.edges.find(edge => edge.id === visualId)); if (!graph.edges.some(edge => edge.id === id)) return; setFlowFocusId(null); cardClicks.current.cancel(); setSelectedId(null); setSelectedEdgeId(id); setFocusedEdgeId(null); if (graphDisplayMode === 'full') setFocusNodeId(null); };

  const arrangeNodes = async () => {
    if (!graph.nodes.length) return;
    const positions = autoLayout(graph.nodes, graph.edges);
    const result = await mutate('/nodes/layout', 'POST', { layout_version: LAYOUT_VERSION, positions, reset_display_positions: true }, 'Nodes arranged');
    if (result) { setFocusNodeId(null); const active = new Set((layoutGroups(graph.nodes, graph.edges).find(group => group.flow)?.nodes || []).map(node => node.id)); setTimeout(() => flowInstance?.fitView({ nodes: crawlerPresentation(graph.nodes.map(node => ({ ...node, display_positions: {}, ...positions.find(p => p.id === node.id) })), graph.edges).nodes.filter(node => active.has(node.logicalId)).map(node => ({ id: node.id })), padding: 0.16, maxZoom: 0.85, duration: 450 }), 100); }
  };
  const canvasActions = useCanvasActions({
    nodesChange: onNodesChange, edgesChange: onEdgesChange,
    init: instance => { setFlowInstance(instance); if (pendingRoute.current) { const route = traceRoute(towerView.nodes, towerView.edges, pendingRoute.current); pendingRoute.current = null; requestAnimationFrame(() => instance.fitView({ nodes: [...route.nodeIds].map(id => ({id})), padding: 0.2, maxZoom: 0.85, duration: 250 })); } },
    nodeClick: (event, node) => { if (node.type === 'logic') cardClicks.current.single(() => openNode(node.id), event.detail); },
    nodeDoubleClick: (_, node) => { if (node.type === 'logic') showRoute(node.id); },
    edgeEnter: (_, edge) => { if (!movingCanvas.current) setHoveredEdgeId(logicalEdgeId(edge.id)); },
    edgeLeave: () => { if (!movingCanvas.current) setHoveredEdgeId(null); },
    moveStart: () => { movingCanvas.current = true; setHoveredEdgeId(null); }, moveEnd: () => { movingCanvas.current = false; },
    paneClick: () => { cardClicks.current.cancel(); setFocusNodeId(null); setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(null); },
    dragStart: () => { cardClicks.current.cancel(); live.beginDrag(); },
    dragStop: async (_, node) => { try { await mutate(`/nodes/${node.data.id}/display-position`, 'POST', { layout_version: LAYOUT_VERSION, ...displayPositionUpdate(towerView.nodes, node.id, node.position) }); } finally { live.endDrag(); } },
    connect, edgeClick: (_, edge) => focusEdge(logicalEdgeId(edge.id)), edgeDoubleClick: (_, edge) => openEdge(logicalEdgeId(edge.id)),
    openNode, openEdge, mutate, nodeLabel: displayName,
    openSource: (name, index) => name === 'kaito.mcp.kaito_advanced_search' ? openCase016(index) : setOtherSourceCase({ operationId: name, caseIndex: index }),
  });
  const discardEdits = () => {
    setShowCreate(false); setShowPrompt(false); setProposal(null); setPrompt('');
    setNewNode({ name: '', kind: 'process', workflow_lane: 'signal', definition: '' });
    live.discard();
  };
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-navigation">
      <div className="brand"><div className="brand-mark"><Activity size={22} strokeWidth={2.2} /></div><div><strong>{t('SignalStudio')}</strong><span>{t('DESIGN STUDIO')}</span></div></div>
      <div className="sidebar-section-label">{t('WORKSPACE')}</div>
      <button className="sidebar-link selected" onClick={() => { setView('graph'); setSelectedId(null); }}><Layers3 size={17} /> {t('Signal design graph')} <ChevronDown size={15} className="sidebar-chevron" /></button>
      <div className="sidebar-section-label nav-label">{t('VIEWS')}</div>
      <button className={`sidebar-link ${view === 'graph' ? 'view-active' : ''}`} onClick={() => setView('graph')}><GitBranch size={17} /> {t('Graph View')} <span className="side-shortcut">⌘1</span></button>
      <button className={`sidebar-link ${view === 'table' ? 'view-active' : ''}`} onClick={() => setView('table')}><List size={17} /> {t('Table View')} <span className="side-shortcut">⌘2</span></button>
      <button className={`sidebar-link ${view === 'translations' ? 'view-active' : ''}`} onClick={() => { setView('translations'); setSelectedId(null); setSelectedEdgeId(null); }}><List size={17} /> {language === 'zh-CN' ? '字段用途与案例' : 'Field guide and examples'}</button>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label">{language === 'zh-CN' ? '画布节点' : 'GRAPH NODES'} <span>{graph.nodes.length}</span></div>
      <CardTypeLibrary groups={typeGroups} language={language} selected={typeFilter} onSelect={id => { setTypeFilter(typeFilter === id ? 'All types' : id); setFilter(''); setFocusNodeId(null); setView('graph'); setGraphDisplayMode('full'); setLaneView('all'); }} />
      <button className="sidebar-link" onClick={() => setShowHelp(true)}><CircleHelp size={17} /> {t('How it works')}</button><WorkspaceVersion language={language} version={serverVersion} />
      </div>
      <div className="sidebar-bottom"><div className="language-switch" role="group" aria-label={language === 'zh-CN' ? '界面语言' : 'Interface language'}><button className={language === 'zh-CN' ? 'active' : ''} onClick={() => setLanguage('zh-CN')} aria-pressed={language === 'zh-CN'}>中文</button><button className={language === 'en' ? 'active' : ''} onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>English</button></div><div className="local-status"><span className="status-dot" /> {language === 'zh-CN' ? (live.status === 'ready' ? '已连接主机' : '只读 · 等待同步') : (live.status === 'ready' ? 'Host connected' : 'Read-only · awaiting sync')} <span>Mac mini</span></div></div>
    </aside>

    <main className="main-pane">
      <ServerUpdateNotice language={language} version={serverVersion} />
      {(live.status !== 'ready' || !live.cacheAvailable) && <div className="live-update-banner" role="status"><span>{live.status === 'identity-error'
        ? (language === 'zh-CN' ? '工作台身份不匹配，已禁止保存。请核对地址后重新打开。' : 'Workspace identity mismatch. Saving is disabled. Check the address and reopen.')
        : live.status === 'ready' ? (language === 'zh-CN' ? '已连接；本地快照无法保存，下次断网可能无法查看。' : 'Connected; local snapshot storage is unavailable.')
        : language === 'zh-CN' ? `${live.confirmedAt ? '正在显示本地只读快照' : '正在连接工作台，尚无可用快照'}；联网并确认最新版本前不能保存。请求超时后会自动重试。`
        : `${live.confirmedAt ? 'Showing a local read-only snapshot' : 'Connecting; no snapshot available'}. Saving requires a confirmed connection. Timed-out reads retry automatically.`}
        {live.status !== 'ready' && <small className="connection-feedback">{live.retryPhase === 'queued' ? (language === 'zh-CN' ? '等待重新连接…' : 'Waiting to reconnect…')
          : live.retryPhase === 'connecting' ? (language === 'zh-CN' ? '重新连接中…' : 'Reconnecting…')
          : live.connectionError === 'timeout' ? (language === 'zh-CN' ? '连接请求超时，等待自动重试。' : 'Connection timed out. Waiting to retry.')
          : live.connectionError === 'identity' ? (language === 'zh-CN' ? '连接被拒绝：工作台身份不匹配。' : 'Connection rejected: workspace identity mismatch.')
          : live.connectionError ? (language === 'zh-CN' ? '连接失败，请检查网络或主机服务；稍后自动重试。' : 'Connection failed. Check the network or host; retrying shortly.')
          : (language === 'zh-CN' ? '等待连接…' : 'Waiting to connect…')}</small>}
        {live.confirmedAt && <small> {language === 'zh-CN' ? '上次确认：' : 'Last confirmed: '}{new Date(live.confirmedAt).toLocaleString(language)}</small>}</span><button onClick={live.reconnect} disabled={live.retryPhase !== 'idle'} aria-busy={live.retryPhase !== 'idle'}>{live.retryPhase !== 'idle' && <span className="connection-spinner" aria-hidden="true" />}{live.retryPhase === 'queued' ? (language === 'zh-CN' ? '等待重新连接…' : 'Waiting to reconnect…') : live.retryPhase === 'connecting' ? (language === 'zh-CN' ? '重新连接中…' : 'Reconnecting…') : (language === 'zh-CN' ? '重新连接' : 'Retry connection')}</button></div>}
      {live.conflict && <div className={`live-update-banner ${showCreate || showPrompt ? 'modal-conflict' : ''}`} role="alert"><span>{language === 'zh-CN' ? '工作台有外部更新，已保留未保存编辑。' : 'External changes detected. Your unsaved edits are preserved.'}</span><button onClick={discardEdits}>{language === 'zh-CN' ? '放弃草稿，载入最新' : 'Discard drafts and load latest'}</button><button onClick={live.accept}>{language === 'zh-CN' ? '保留编辑，允许覆盖后保存' : 'Keep edits and allow overwrite on save'}</button></div>}

      <header className="topbar"><div className="breadcrumb">{t('Workspace')} <span>/</span> {t('Signal design graph')} <span>/</span> <strong>{view === 'translations' ? language === 'zh-CN' ? '字段用途与案例' : 'Field guide and examples' : t(view === 'graph' ? 'Graph' : 'Table')}</strong></div><div className="top-actions"><span className="top-meta">{t('LOCAL PROJECT')}</span>{view !== 'translations' && <button className="button-primary" onClick={() => setShowCreate(true)}><Plus size={16} /> {t('New node')}</button>}</div></header>
      {view === 'translations' ? <CatalogTranslationTable language={language} /> : <>
      <section className="workspace-head"><div><div className="eyebrow"><span className="eyebrow-line" /> {t('DESIGN STUDIO')}</div><h1>{t('Signal design graph')}</h1><p>{language === 'zh-CN' ? '在同一张地图查看关系：缩小看概览，放大看卡片细节；可按编号、名称或字段关系定位。' : 'One map: zoom out for an overview, zoom in for card details. Search by reference, name or field relation.'}</p></div><div className="workspace-stats"><div><strong>{contractSummary?.entries ?? '—'}</strong><span>{language === 'zh-CN' ? '上游入口' : 'UPSTREAM ENTRIES'}</span></div><i /><div><strong>{contractSummary?.fields ?? '—'}</strong><span title={language === 'zh-CN' ? '当前已列出的样本字段和文档计划字段；并非完整返回字段总数' : 'Sample paths and planned documented fields; not a complete output schema'}>{language === 'zh-CN' ? '已列字段定义' : 'LISTED FIELD DEFINITIONS'}</span></div><i /><div><strong>{graph.edges.length}</strong><span>{t('CONNECTIONS')}</span></div></div></section>
      <section className="work-card">
        <div className="workflow-tabs" role="tablist" aria-label={t('Workflow paths')}>{WORKFLOW_VIEWS.map(item => <button key={item.id} role="tab" aria-selected={laneView === item.id} className={laneView === item.id ? 'active' : ''} onClick={() => { setLaneView(item.id); setTypeFilter('All types'); setFocusNodeId(null); setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(null); }}>{t(item.name)}</button>)}<p>{language === 'zh-CN' ? '总览和两条路径使用同一张设计图' : 'Overview and both paths use the same design graph'}</p></div>
        <div className="view-toolbar">{view === 'graph' && <div className="view-switch" aria-label={language === 'zh-CN' ? '画布范围' : 'Canvas scope'}><button className={graphDisplayMode === 'full' ? 'active' : ''} onClick={() => setGraphDisplayMode('full')}>{language === 'zh-CN' ? '完整画布' : 'Full canvas'}</button><button className={graphDisplayMode === 'functions' ? 'active' : ''} onClick={() => setGraphDisplayMode('functions')}>{language === 'zh-CN' ? '功能目录' : 'Features'}</button></div>}{graphDisplayMode === 'local' && <button className="button-secondary" onClick={() => { setGraphDisplayMode('full'); setFocusNodeId(null); }}>{language === 'zh-CN' ? '返回完整画布' : 'Back to full graph'}</button>}<div className="view-switch"><button className={view === 'graph' ? 'active' : ''} onClick={() => setView('graph')}><GitBranch size={15} /> {t('Graph')}</button><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}><List size={15} /> {t('Table')}</button></div><div className="toolbar-right"><div className="search-box"><Search size={16} /><input placeholder={language === 'zh-CN' ? '定位编号、名称或R字段关系' : 'Locate number, name, or R field relation'} value={filter} onChange={e => { setFilter(e.target.value); setFocusNodeId(null); }} /><kbd>⌘ K</kbd></div><select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setFocusNodeId(null); }}><option value="All types">{t('All types')}</option>{typeGroups.map(group => <optgroup key={group.id} label={group.label}><option value={group.id}>{group.label}</option>{group.children.map(child => <option key={child.id} value={child.id}>{child.label}</option>)}</optgroup>)}</select>{view === 'graph' && graphDisplayMode === 'full' && <button className="layout-button" onClick={arrangeNodes} disabled={busy || !graph.nodes.length || laneView !== 'all'} title={laneView === 'all' ? t('Restore standard layout; CoinGecko is grouped by product line') : t('Arrange all nodes in Overview')}><LayoutGrid size={15} /> {t('Arrange nodes')}</button>}{view === 'graph' && graphDisplayMode === 'full' && <IconButton title={t('Fit graph')} onClick={() => document.querySelector('.react-flow__controls-fitview')?.click()}><Maximize2 size={16} /></IconButton>}</div></div>
        {view === 'graph' ? graphDisplayMode === 'functions' ? <FeatureWorkspace graph={graph} presentation={presentation} nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} labels={language === 'zh-CN' ? FLOW_LABELS_ZH : undefined} actions={canvasActions} miniMapColor={miniMapColor} language={language} query={query} searchIndex={searchIndex} typeFilter={typeFilter} allowedIds={canvasNodes.map(n => n.id).join(',')} catalogEntityInfo={catalogEntityInfo}/> : graphDisplayMode === 'local' ? <LocalFlowView graph={presentation} focusNode={localFocus} language={language} label={displayName} onFocus={id => { setFocusNodeId(id); setSelectedId(null); setSelectedEdgeId(null); }} onOpenNode={openNode} onOpenEdge={openEdge} /> : <div className="graph-wrap">{focusNodeId && <div className="route-toolbar"><span>{language === 'zh-CN' ? '完整关联路线' : 'Complete route'}</span><button onClick={() => fitRoute(routeStart)}>{language === 'zh-CN' ? '适应路线' : 'Fit route'}</button><button onClick={() => openNode(focusNodeId)}>{language === 'zh-CN' ? '查看卡片详情' : 'Card details'}</button><button onClick={() => setFocusNodeId(null)}>{language === 'zh-CN' ? '取消高亮' : 'Clear highlight'}</button></div>}<GraphCanvas nodes={displayNodes} edges={displayEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} labels={language === 'zh-CN' ? FLOW_LABELS_ZH : undefined} actions={canvasActions} miniMapColor={miniMapColor}/>
          {(relationOwner || focusConnection) && <div className="edge-relation-guide"><details key={focusedEdgeId || relationOwner?.id || 'overview'} open={Boolean(focusedEdgeId)}><summary>{relationOwner ? `${nodeRef(relationOwner)} · ${language === 'zh-CN' ? '关联流程' : 'Related flow'}` : language === 'zh-CN' ? '关联流程' : 'Related flow'}</summary>{flowChoices.length > 1 && <div className="flow-memberships"><strong>{language === 'zh-CN' ? '这条线连接两个流程，可切换查看：' : 'This connection belongs to adjacent flows:'}</strong>{flowChoices.map(node => <button key={node.id} aria-pressed={relationOwner?.id === node.id} onClick={() => setFlowFocusId(node.id)}>{nodeRef(node)} · {displayName(node.name)}</button>)}</div>}{(relationOwner || focusConnection) && <p>{focusConnection && !flowChoices.length ? language === 'zh-CN' ? '这条线尚未定义执行者，不能确认流程归属。保留原关系，待核对。' : 'No executing step is defined for this connection; flow membership remains unconfirmed.' : focusExplanation(graph, relationOwner, language)}</p>}{currentFlow && <p className="flow-line-list">{language === 'zh-CN' ? '本组连线：' : 'Flow connections: '}{presentation.edges.filter(edge => currentFlow.edgeIds.has(edge.id)).map(edge => edgePresentation(presentation, edge, language, relationOwner).displayLabel).join('；')}</p>}{relationOwner && <div className="edge-trigger-origins"><strong>{language === 'zh-CN' ? '触发源头' : 'Trigger origins'}</strong>{triggerTrace.origins.map(origin => <button key={`${origin.node.id}:${origin.reason}`} onClick={() => openNode(origin.node.id)} title={displayName(origin.node.name)}>{origin.reason === 'schedule' && <AlarmClock size={13} />}{originLabel(origin, language)}</button>)}</div>}</details><div className="edge-relation-actions">{relationOwner && <button onClick={() => flowInstance?.fitView({ nodes: towerView.nodes.filter(node => relatedNodeIds.has(node.logicalId)).map(node => ({ id: node.id })), padding: 0.25, maxZoom: 0.85, duration: 300 })}>{language === 'zh-CN' ? '适应关联流程' : 'Fit related flow'}</button>}{relationOwner && <button onClick={() => { setGraphDisplayMode('local'); setFocusNodeId(relationOwner.id); setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(null); }}>{language === 'zh-CN' ? '查看单步关系' : 'One-step view'}</button>}{focusedEdgeId && <button onClick={() => openEdge(focusedEdgeId)}>{language === 'zh-CN' ? '连线详情' : 'Connection details'}</button>}{(selectedId || selectedEdgeId || focusedEdgeId) && <button onClick={() => { setSelectedId(null); setSelectedEdgeId(null); setFocusedEdgeId(null); }}>{language === 'zh-CN' ? '取消聚焦' : 'Clear focus'}</button>}</div></div>}

          {highlightingType && <div className="graph-search-status" role="status">{language === 'zh-CN' ? `已高亮 ${typeChoice?.label || typeFilter} · ${typeMatchIds.size} 张卡片 · 保留完整图谱` : `Highlighted ${typeChoice?.label || typeFilter} · ${typeMatchIds.size} cards · Full graph preserved`}</div>}
          {locatingCard && <div className="graph-search-status" role="status">{searchTarget ? (language === 'zh-CN' ? `已定位 ${nodeRef(searchTarget)} · 保留完整图谱` : `Located ${nodeRef(searchTarget)} · Full graph preserved`) : (language === 'zh-CN' ? searchMatches.length ? `已定位 ${searchMatches.length} 张卡片 · 保留完整图谱` : `未找到匹配项 ${query} · 保留完整图谱` : searchMatches.length ? `Located ${searchMatches.length} cards · Full graph preserved` : `No matches for ${query} · Full graph preserved`)}{searchOccurrences.length > 1 && <span className="shared-location-nav">{language === 'zh-CN' ? `共用位置 ${searchOccurrenceIndex % searchOccurrences.length + 1}/${searchOccurrences.length}` : `Shared location ${searchOccurrenceIndex % searchOccurrences.length + 1}/${searchOccurrences.length}`}<button onClick={() => setSearchOccurrenceIndex(value => (value + 1) % searchOccurrences.length)}>{language === 'zh-CN' ? '下一处' : 'Next location'}</button></span>}</div>}
          </div>
          : <div className="table-wrap"><table><thead><tr><th>{t('NAME')}</th><th>{t('TYPE')}</th><th>{language === 'zh-CN' ? '实现核对' : 'Implementation'}</th><th>{t('PATH')}</th><th>{t('FIELDS')}</th><th>{t('FORMULA / DEFINITION')}</th><th>{t('UPSTREAM')}</th><th>{t('DOWNSTREAM')}</th><th>{t('PRODUCT')}</th><th></th></tr></thead><tbody>{tableRows.map(n => {
            const up = graph.edges.filter(e => e.downstream_id === n.id).length, down = graph.edges.filter(e => e.upstream_id === n.id).length;
            const usage = productUsage.get(n.id) || [];
            return <tr key={n.id} onClick={() => openNode(n.id)} className={selectedId === n.id ? 'selected-row' : ''}><td><span className={`table-type-mark ${KIND[n.type]}`} /><span className="table-node-ref">{nodeRef(n)}</span>{displayName(n.name)}{contractSourceName(n.name) && catalogEntityInfo[n.name] && <span className="source-origin-tag table-source-tag" data-source={catalogEntityInfo[n.name].source}>{sourceLabel(catalogEntityInfo[n.name].source)}</span>}</td><td><span className={`type-pill ${KIND[n.type]}`}>{kindLabel(cardKind(n),language)}</span></td><td><CardProgressBadge progress={graph.card_progress?.[n.id]} language={language}/></td><td>{t(nodeLane(n) === 'shared' ? 'Both paths' : nodeLane(n) === 'knowledge' ? 'Asset knowledge path' : 'Signal path')}</td><td>{isReferenceResource(n.name) ? (language === 'zh-CN' ? '参考目录' : 'Reference list') : contractSourceName(n.name) ? (language === 'zh-CN' ? `已列 ${catalogEntityInfo[n.name]?.field_count ?? 0}` : `${catalogEntityInfo[n.name]?.field_count ?? 0} listed`) : BUSINESS_TABLE_NAMES.has(n.name) ? businessTables.tables[n.name].columns.length : (graph.fields || []).filter(field => field.node_id === n.id && !['internal', 'hidden'].includes(field.catalog_visibility)).length}</td><td className="description-cell">{BUSINESS_TABLE_NAMES.has(n.name) ? (language === 'zh-CN' ? businessTables.tables[n.name].purpose_zh : businessTables.tables[n.name].purpose_en) : sourcePurpose(n.name, language) || n.formula || n.definition || '—'}</td><td>{up}</td><td>{down}</td><td title={usage.map(item => displayName(item.name)).join('、')}>{usage.length ? usage.length === 1 ? displayName(usage[0].name) : `${usage.length} ${t('modules')}` : '—'}</td><td><ArrowUpRight size={15} /></td></tr>;
          })}</tbody></table>{tableRows.length === 0 && <div className="empty-table">{t('No nodes match your search.')}</div>}</div>}
      </section>
      <div className="bottom-prompt"><div className="prompt-icon"><Sparkles size={18} /></div><div><strong>{t('Design with natural language')}</strong><span>{t('Describe a new node and its dependencies. Review changes before applying.')}</span></div><button onClick={() => setShowPrompt(true)}>{t('Draft a change')} <ArrowRight size={16} /></button></div>
      </>}
    </main>

    {(selected || selectedEdge) && <aside key={live.editorEpoch} onChangeCapture={trackEdit} className={`inspector ${selected && BUSINESS_TABLE_NAMES.has(selected.name) ? 'business-table-inspector' : ''}`}><div className="inspector-head"><span>{t('INSPECTOR')}</span><IconButton title={t('Close inspector')} onClick={() => { setSelectedId(null); setSelectedEdgeId(null); }}><X size={17} /></IconButton></div>
      {!detailReady && <div className="inspector-scroll" role="status"><p>{detailError || (language === 'zh-CN' ? '正在加载卡片详情…' : 'Loading card details…')}</p>{detailError && <button onClick={() => setDetailAttempt(value => value + 1)}>{language === 'zh-CN' ? '重新加载详情' : 'Retry details'}</button>}</div>}
      {detailReady && selected && draft && <><div className="inspector-title"><span className={`inspector-icon ${kindStyle(selected)}`}><GitBranch size={20} /></span><div><span className="small-label">{isReferenceResource(selected.name) ? language === 'zh-CN' ? 'MCP 参考资源' : 'MCP RESOURCE' : contractSourceName(selected.name) ? language === 'zh-CN' ? '本产品上游操作' : 'UPSTREAM OPERATION' : kindLabel(cardKind(selected),language)}</span><h2><span className="inspector-node-ref">{nodeRef(selected)}</span>{displayName(selected.name)}</h2><button className="inspector-focus-relations" onClick={focusSelectedRelations} disabled={busy} title={language === 'zh-CN' ? '在完整画布中拉近直接上下游卡片，并保存新位置' : 'Move direct upstream and downstream cards closer on the full canvas and save their positions'}><GitBranch size={14} />{language === 'zh-CN' ? '拉近上下游' : 'Bring neighbors closer'}</button></div></div><div className="inspector-scroll" key={selected.id}><CardProgressNote progress={graph.card_progress?.[selected.id]} language={language}/><MemoCardDetails key={selected.id} node={selected} graph={graph} openNode={canvasActions.openNode} language={language} mutate={canvasActions.mutate} busy={busy} nodeLabel={canvasActions.nodeLabel} purpose={selected.definition} onOpenSource={canvasActions.openSource}/>{['process','decision'].includes(detailKind(selected)) && ![3006,3009].includes(selected.reference_number) && !selected.card_contract?.config.read_only ? selected.type === 'Asset Resolution' ? <>
        <details className="processing-advanced"><summary>{language === 'zh-CN' ? '其他设置' : 'Other settings'}</summary>
          <label>{language === 'zh-CN' ? '这张节点卡做什么（编辑）' : 'What this node does (edit)'}<textarea data-workspace-editor="node" value={draft.definition} onChange={e => setDraft({ ...draft, definition: e.target.value })} rows={3} /></label>
          <details className="processing-technical"><summary>{language === 'zh-CN' ? '节点设置' : 'Node settings'}</summary>
            <label>{t('Name')}<input data-workspace-editor="node" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
            <label>{t('Type')}<input readOnly value={kindLabel(cardKind(selected), language)} /></label>
            <label>{t('Workflow path')}<select data-workspace-editor="node" value={draft.workflow_lane || defaultLane(draft.type)} onChange={e => setDraft({ ...draft, workflow_lane: e.target.value })}><option value="shared">{t('Both paths')}</option><option value="signal">{t('Signal path')}</option><option value="knowledge">{t('Asset knowledge path')}</option></select></label>
          </details>
          <details className="processing-technical"><summary>{language === 'zh-CN' ? `本步骤新增字段 · ${addedOutputFields.length}` : `Fields added by this step · ${addedOutputFields.length}`}</summary>
            <p>{language === 'zh-CN' ? '来源字段按输入原样保留；这里只编辑本步骤新增的输出字段。' : 'Source fields pass through unchanged; edit only fields added by this step here.'}</p>
            <MemoFieldCatalog node={selected} fields={addedOutputFields} mutate={canvasActions.mutate} busy={busy} language={language} />
          </details>
        </details>
      </> : <><details className="processing-advanced"><summary>{language === 'zh-CN' ? '其他设置' : 'Other settings'}</summary><label>{language === 'zh-CN' ? '这张节点卡做什么（编辑）' : 'What this node does (edit)'}<textarea data-workspace-editor="node" value={isSignal ? draft.decision_question || '' : draft.definition} placeholder={language === 'zh-CN' ? '用一句话描述目的' : 'Describe the goal in one sentence'} onChange={e => setDraft({ ...draft, [isSignal ? 'decision_question' : 'definition']: e.target.value })} rows={3} /></label><label>{t('Name')}<input data-workspace-editor="node" value={language === 'zh-CN' && draft.name === selected.name ? displayName(draft.name) : draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>{t('Type')}<input readOnly value={kindLabel(cardKind(selected), language)} /></label><label>{t('Workflow path')}<select data-workspace-editor="node" value={draft.workflow_lane || defaultLane(draft.type)} onChange={e => setDraft({ ...draft, workflow_lane: e.target.value })}><option value="shared">{t('Both paths')}</option><option value="signal">{t('Signal path')}</option><option value="knowledge">{t('Asset knowledge path')}</option></select></label>
        {isSignal && <SignalDesignGuide node={draft} graph={graph} fields={nodeFields} language={language} />}
        {isSignal && draft.signal_key && <p className="signal-package-link"><a href={`/api/signals/${encodeURIComponent(draft.signal_key)}/package`} target="_blank" rel="noreferrer">{language === 'zh-CN' ? '查看版本化执行包 JSON ↗' : 'Open versioned execution package JSON ↗'}</a><small>{language === 'zh-CN' ? '图中文字与执行包不一致时，接口会列出待修正项。' : 'The API lists mismatches between graph text and the execution package.'}</small></p>}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '1 · 要判断什么' : '1 · What should this signal tell you?'}</div>}
        {isSignal && <label>{language === 'zh-CN' ? '限制说明' : 'Limitations'}<textarea data-workspace-editor="node" value={draft.definition} onChange={e => setDraft({ ...draft, definition: e.target.value })} rows={2} /></label>}
        {TYPE_HELP[draft.type] && <p className="node-type-help">{t(TYPE_HELP[draft.type])}</p>}
        {RESOURCE_REFERENCES[draft.type] && <p className="state-reference"><Database size={14} /> {t(RESOURCE_REFERENCES[draft.type])}</p>}

        {isSignal && <label>{language === 'zh-CN' ? '观察窗口与更新频率' : 'Observation window and cadence'}<input data-workspace-editor="node" value={draft.observation_window || ''} placeholder={language === 'zh-CN' ? '例如：滚动 24 小时，每小时更新' : 'e.g. rolling 24 hours, refreshed hourly'} onChange={e => setDraft({ ...draft, observation_window: e.target.value })} /></label>}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '2 · 需要哪些数据' : '2 · Which data is needed?'}</div>}
        {selected.type !== 'Source' && <SignalNeedsPanel node={draft} graph={graph} mutate={mutate} busy={busy} language={language} />}
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '3 · 怎样计算与判断' : '3 · How is it calculated and interpreted?'}</div>}
        <label>{t('Formula')}<textarea data-workspace-editor="node" value={draft.formula} placeholder={t('Math, pseudocode, SQL, or a natural language formula')} onChange={e => setDraft({ ...draft, formula: e.target.value })} rows={3} /></label>
        {isSignal && <label>{language === 'zh-CN' ? '触发条件 / 分档解释' : 'Trigger rule or interpretation'}<textarea data-workspace-editor="node" value={draft.trigger_rule || ''} placeholder={language === 'zh-CN' ? '例如：相对历史基线超过 2 倍，且至少持续 3 小时' : 'e.g. above 2× baseline for at least 3 hours'} onChange={e => setDraft({ ...draft, trigger_rule: e.target.value })} rows={3} /></label>}
        <MemoFieldCatalog node={selected} fields={addedOutputFields} mutate={canvasActions.mutate} busy={busy} language={language} />
        {isSignal && <div className="signal-stage-heading">{language === 'zh-CN' ? '4 · 怎样检验效果' : '4 · How will it be validated?'}</div>}
        {isSignal && <label>{language === 'zh-CN' ? '验证方法' : 'Validation plan'}<textarea data-workspace-editor="node" value={draft.validation_plan || ''} placeholder={language === 'zh-CN' ? '例如：对照历史事件与人工标注，统计误报和漏报' : 'e.g. compare with historical events and review false positives'} onChange={e => setDraft({ ...draft, validation_plan: e.target.value })} rows={3} /></label>}
        {isSignal && <label>{language === 'zh-CN' ? '验证记录' : 'Validation observations'}<textarea data-workspace-editor="node" value={draft.validation_evidence || ''} placeholder={language === 'zh-CN' ? '实际测试后记录样本、结果和仍存在的问题' : 'Record the sample, results, and remaining issues after testing'} onChange={e => setDraft({ ...draft, validation_evidence: e.target.value })} rows={3} /></label>}
        {[['rationale', 'Design rationale', 'Why is it designed this way?'], ['caveats', 'Caveats', 'Limits and special cases'], ['notes', 'Research notes', 'Additional context']].map(([key, label, placeholder]) => <label key={key}>{t(label)}<textarea data-workspace-editor="node" value={draft[key]} placeholder={t(placeholder)} onChange={e => setDraft({ ...draft, [key]: e.target.value })} rows={3} /></label>)}
        <div className="relations"><div className="relation-heading"><ArrowDownRight size={16} /> {t('UPSTREAM')} <span>{upstream.length}</span></div>{upstream.length ? upstream.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No upstream nodes')}</em>}</div>
        <div className="relations"><div className="relation-heading"><ArrowUpRight size={16} /> {t('DOWNSTREAM')} <span>{downstream.length}</span></div>{downstream.length ? downstream.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No downstream nodes')}</em>}</div>
        <div className="relations"><div className="relation-heading"><LayoutGrid size={16} /> {t('USED BY PRODUCT')} <span>{products.length}</span></div>{products.length ? products.map(n => <button key={n.id} onClick={() => openNode(n.id)}>{displayName(n.name)}<ArrowRight size={14} /></button>) : <em>{t('No product module downstream')}</em>}</div></details></> : null}
      {detailKind(selected) !== 'unknown' && <MemoCardDefinitionSettings node={selected} graph={graph} language={language} mutate={canvasActions.mutate} busy={busy} />}</div>{!['process','decision'].includes(detailKind(selected)) || selected.card_contract?.config.read_only || selected.reference_number === 3009 ? null : <div className="inspector-footer"><button className="button-danger" onClick={deleteNode} title={t('Delete node')} aria-label={t('Delete node')}><Trash2 size={16} /></button><button className="button-primary" disabled={busy} onClick={saveNode}><Check size={16} /> {t('Save changes')}</button></div>}</>}
      {detailReady && selectedEdge && <><div className="inspector-title"><span className="inspector-icon metric"><ArrowRight size={20} /></span><div><span className="small-label">{selectedEdge.transport_kind === 'redpanda' ? language === 'zh-CN' ? 'REDPANDA 消息' : 'REDPANDA MESSAGE' : t('FIELD LEVEL DEPENDENCY')}</span><h2><span className="inspector-edge-ref">{edgeRef(selectedEdge)}</span>{t('Connection')}</h2></div></div><EdgeMappingPanel edge={selectedEdge} sourceNode={edgeSource} targetNode={edgeTarget} sourceFields={sourceFields} mutate={mutate} busy={busy} language={language} nodeLabel={displayName} graph={graph} /><div className="inspector-footer edge-footer"><button className="button-danger-text" onClick={deleteEdge}><Trash2 size={16} /> {t('Delete connection')}</button></div></>}
    </aside>}

    {showCreate && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowCreate(false); }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">{t('NEW LOGIC UNIT')}</span><h2>{t('Create node')}</h2></div><IconButton title={t('Close')} onClick={() => setShowCreate(false)}><X size={18} /></IconButton></div><div className="modal-body"><label>{t('Name')}<input autoFocus placeholder={t('e.g. Liquidity Signal')} value={newNode.name} onChange={e => setNewNode({ ...newNode, name: e.target.value })} /></label><label>{t('Type')}<select value={newNode.kind} onChange={e => setNewNode({ ...newNode, kind: e.target.value })}>{cardKinds.map(item => <option key={item.id} value={item.id}>{kindLabel(item.id, language)}</option>)}</select></label><label>{t('Workflow path')}<select value={newNode.workflow_lane} onChange={e => setNewNode({ ...newNode, workflow_lane: e.target.value })}><option value="shared">{t('Both paths')}</option><option value="signal">{t('Signal path')}</option><option value="knowledge">{t('Asset knowledge path')}</option></select></label>{TYPE_HELP[newNode.type] && <p className="node-type-help">{t(TYPE_HELP[newNode.type])}</p>}<label>{t('Definition')}<textarea rows="4" placeholder={t('What does this node represent?')} value={newNode.definition} onChange={e => setNewNode({ ...newNode, definition: e.target.value })} /></label></div><div className="modal-footer"><button className="button-secondary" onClick={() => setShowCreate(false)}>{t('Cancel')}</button><button className="button-primary" disabled={busy || !newNode.name.trim()} onClick={addNode}>{t('Create node')} <ArrowRight size={16} /></button></div></div></div>}

    {showPrompt && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowPrompt(false); }}><div className="modal proposal-modal"><div className="modal-header"><div><span className="eyebrow">{t('NATURAL LANGUAGE DRAFT')}</span><h2>{t('Propose a change')}</h2></div><IconButton title={t('Close')} onClick={() => setShowPrompt(false)}><X size={18} /></IconButton></div><div className="modal-body"><p className="modal-intro">{t('Describe a new node and reference existing nodes by name. Nothing is changed until you confirm.')}</p><textarea className="prompt-input" rows="4" value={prompt} onChange={e => { setPrompt(e.target.value); setProposal(null); }} />
        {proposal && <div className="proposal-preview"><div className="proposal-heading"><Sparkles size={16} /> {t('PROPOSED CHANGES')} <span className="proposal-source">{t(proposal.source === 'model' ? 'MODEL DRAFT' : 'LOCAL DRAFT')}</span></div><div className="proposal-node"><span className="proposal-action">{t('CREATE NODE')}</span><strong>{displayName(proposal.node.name)}</strong><span className={`type-pill ${KIND[proposal.node.type]}`}>{kindLabel(cardKind(proposal.node),language)}</span></div>{[['definition','Definition'],['formula','Formula'],['rationale','Design rationale'],['caveats','Caveats'],['notes','Research notes']].filter(([key]) => proposal.node[key]).map(([key,label]) => <div className="proposal-field" key={key}><b>{t(label)}</b><span>{proposal.node[key]}</span></div>)}{proposal.upstream_names.map(n => <div className="proposal-link" key={n}>{displayName(n)} <ArrowRight size={14} /> {displayName(proposal.node.name)}</div>)}{proposal.downstream_names.map(n => <div className="proposal-link" key={n}>{displayName(proposal.node.name)} <ArrowRight size={14} /> {displayName(n)}</div>)}{proposal.warnings.map(w => <div className="proposal-warning" key={w}>{t(w)}</div>)}</div>}
      </div><div className="modal-footer"><button className="button-secondary" onClick={() => { setShowPrompt(false); setProposal(null); }}>{t('Cancel')}</button>{proposal ? <button className="button-primary" disabled={busy} onClick={applyProposal}><Check size={16} /> {t('Confirm changes')}</button> : <button className="button-primary" disabled={busy || !prompt.trim()} onClick={propose}><Sparkles size={16} /> {t('Generate proposal')}</button>}</div></div></div>}
    {showHelp && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowHelp(false); }}><div className="modal"><div className="modal-header"><div><span className="eyebrow">{t('QUICK GUIDE')}</span><h2>{t('How it works')}</h2></div><IconButton title={t('Close')} onClick={() => setShowHelp(false)}><X size={18} /></IconButton></div><div className="modal-body help-content"><p><strong>{language === 'zh-CN' ? '信号线。' : 'Signal path. '}</strong>{language === 'zh-CN' ? '切到信号线，从数据来源和证据检查出发，设计指标计算、规则判断和信号产出。' : 'Open the signal path to trace sources and evidence checks through metrics, rules and signal outputs.'}</p><p><strong>{language === 'zh-CN' ? '资产认知线。' : 'Asset knowledge path. '}</strong>{language === 'zh-CN' ? '切到资产认知线，设计资产识别／绑定、关系发现与审核。五张规划业务表各自是画布节点；处理步骤与具体表连线。' : 'Open the asset knowledge path to design resolution, relationship discovery and review. Each of the five planned business tables is a graph node connected to specific processing steps.'}</p><p><strong>{language === 'zh-CN' ? '寻找与检验数据。' : 'Find and validate data. '}</strong>{language === 'zh-CN' ? '在节点里列出所需数据，匹配爬虫字段，并记录检验方法。设计完成不代表已有真实记录或信号有效。' : 'List required inputs, match crawler fields, and record a validation plan. A complete design does not establish that records exist or that a signal works.'}</p></div><div className="modal-footer"><button className="button-primary" onClick={() => setShowHelp(false)}>{t('Got it')}</button></div></div></div>}
    {showCase016 && <SourceCasePage language={language} initialCaseIndex={case016Index} onClose={closeCase016} />}
    {otherSourceCase && <OtherSourceCasePage key={otherSourceCase.operationId} operationId={otherSourceCase.operationId} initialCaseIndex={otherSourceCase.caseIndex} language={language} onClose={closeOtherSourceCase} />}
    {notice && <div className={`toast ${notice.error ? 'toast-error' : ''}`}>{notice.error ? <X size={16} /> : <Check size={16} />}{t(notice.message)}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
