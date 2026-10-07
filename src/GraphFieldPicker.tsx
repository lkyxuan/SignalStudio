import { request } from './api';
import type { Graph, GraphNode, Language, SourceContracts } from './contracts';
import React, { useEffect, useState } from 'react';
import { Check, ExternalLink, Plus, Search, X } from 'lucide-react';
import { displayNodeName } from './i18n';
import './graph-field-picker.css';

export function GraphFieldPicker({ language, graph, availableTargets, targetNode, initialOperationId, selectedRequirementId, busy, onUse, onSelectTarget, onSelectRequirement, onClose }: GraphFieldPickerProps) {
  const zh = language === 'zh-CN';
  const word = (cn: string, en: string) => zh ? cn : en;
  const [contract, setContract] = useState<SourceContracts | null>(null);
  const [error, setError] = useState('');
  const [operationId, setOperationId] = useState(initialOperationId || '');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let active = true;
    request('/source-contracts/v1').then(result => {
      if (active) {
        setContract(result);
        setOperationId(current => current || result.operations[0]?.id || '');
      }
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (initialOperationId) setOperationId(initialOperationId);
  }, [initialOperationId]);
  useEffect(() => {
    if (contract?.operations.some(operation => operation.id === targetNode?.name))
      setOperationId(targetNode!.name);
  }, [contract, targetNode?.id]);

  const target = targetNode?.type === 'Source' ? null : targetNode;
  const targetRequirements = (graph.requirements || []).filter(item => item.node_id === target?.id);
  const requirementId = targetRequirements.some(item => item.id === selectedRequirementId) ? selectedRequirementId ?? '' : '';
  const importedByCatalogId = new Map((graph.fields || []).filter(field => field.catalog_field_id)
    .map(field => [field.catalog_field_id, field]));
  const activeEdgeBySource = new Map((graph.edges || []).filter(edge => edge.downstream_id === target?.id)
    .map(edge => [edge.upstream_id, edge]));
  const alreadyUsed = (fieldId: string) => {
    const imported = importedByCatalogId.get(fieldId);
    if (!imported) return false;
    if (!target) return true;
    const edge = activeEdgeBySource.get(imported.node_id);
    return Boolean(edge && (graph.field_usages || []).some(usage =>
      usage.edge_id === edge.id && usage.source_field_id === imported.id));
  };
  const operation = contract?.operations.find(item => item.id === operationId);
  const fields = (operation?.fields || []).filter(field =>
    `${field.label_zh} ${field.path} ${field.purpose_zh || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  const coverageLabel = operation?.response_coverage === 'not_inventoried'
    ? word('字段尚未盘点', 'Fields not inventoried')
    : word('字段清单可能不完整', 'Field list may be incomplete');
  const evidenceLabel = (field: SourceContracts['operations'][number]['fields'][number]) => field.evidence === 'official_documentation'
    ? word('官方文档', 'Official documentation')
    : field.evidence === 'mcp_sample'
      ? word('MCP 响应样本', 'MCP response sample')
      : word('API 响应样本', 'API response sample');

  return <aside className="graph-field-picker" aria-label={word('选择上游字段', 'Choose upstream fields')}>
    <div className="picker-head"><div><span>{word('本产品上游契约', 'SIGNALSTUDIO CONTRACT')}</span><h2>{word('选择上游字段', 'Choose upstream fields')}</h2></div><button onClick={onClose} aria-label={word('关闭字段选择', 'Close field picker')}><X size={17} /></button></div>
    <div className="picker-target"><label>{word('要连接的处理节点', 'Processing node to connect')}<select value={target?.id || ''} onChange={event => onSelectTarget(event.target.value || null)}><option value="">{word('暂不连接，只加入画布', 'Add without connecting')}</option>{availableTargets.filter(node => node.type !== 'Source').map(node => <option key={node.id} value={node.id}>{displayNodeName(language, node.name)}</option>)}</select></label>
      {targetRequirements.length > 0 && <label>{word('对应哪项数据需求', 'Data need')}<select value={requirementId} onChange={event => onSelectRequirement(event.target.value || null)}><option value="">{word('暂不匹配需求', 'No match yet')}</option>{targetRequirements.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}</div>
    <div className="picker-controls"><label>{word('上游来源与操作', 'Upstream operation')}<select value={operationId} onChange={event => { setOperationId(event.target.value); setQuery(''); }}>
      {contract?.operations.map(item => <option key={item.id} value={item.id}>{contract.sources.find(source => source.id === item.source_id)?.label_zh} · {item.label_zh} ({item.fields.length})</option>)}</select></label>
      <label className="picker-search"><Search size={15} /><input value={query} placeholder={word('搜索字段名称或路径…', 'Search name or path…')} onChange={event => setQuery(event.target.value)} /></label>
      {operation && <div className="picker-source-context" title={operation.endpoint}>
        <div className="picker-source-context-head"><span className="picker-coverage-label">{coverageLabel}</span>{operation.documentation_url && <a className="picker-doc-link" href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{word('上游文档', 'Source docs')}<ExternalLink size={13} aria-hidden="true" /></a>}</div>
        <p>{word('这里列的是上游契约中的字段。加入画布只记录设计关系，不代表爬虫已采集。', 'These fields come from the upstream contract. Adding one records a design relationship, not crawler collection.')}</p>
      </div>}
    </div>
    {error && <div className="picker-error" role="alert">{error}</div>}
    <div className="picker-fields">{!contract && !error && <p className="picker-empty">{word('正在加载上游契约…', 'Loading upstream contract…')}</p>}
      {fields.map(field => {
        const id = `source-contracts.v1::${operation!.id}::${field.path}`;
        const used = alreadyUsed(id);
        return <div className="picker-field" key={id}><div className="picker-field-title"><strong>{zh ? field.label_zh : field.path}</strong></div>
          <p className="picker-field-explanation">{field.purpose_zh || field.condition || word('上游返回字段', 'Upstream response field')}</p>
          <code className="picker-field-path" title={field.path}>{field.path}</code>
          <div className="picker-field-evidence"><span>{evidenceLabel(field)}</span>{field.example_value !== null && field.example_value !== undefined && <span className="picker-field-value" title={word('上游响应示例值', 'Example value from an upstream response')}>{word('示例值', 'Example')} <code>{JSON.stringify(field.example_value)}</code></span>}</div>
          <button disabled={busy || (used && !requirementId)} onClick={() => onUse({ id }, target?.id, requirementId)}>{used && !requirementId ? <Check size={14} /> : <Plus size={14} />}{used && !requirementId ? word('已在图中', 'On graph') : target ? word('用作输入', 'Use as input') : word('加到画布', 'Add to graph')}</button></div>;
      })}
      {contract && !fields.length && <p className="picker-empty">{operation?.fields.length ? word('没有匹配字段。', 'No matching fields.') : word('尚无可核对字段；需要第一方说明或返回样本。', 'No verified fields yet.')}</p>}
    </div>
  </aside>;
}

interface GraphFieldPickerProps {
  language: Language; graph: Graph; availableTargets: GraphNode[];
  targetNode?: GraphNode | null; initialOperationId?: string | null;
  selectedRequirementId?: string | null; busy: boolean;
  onUse: (field: { id: string }, targetId?: string, requirementId?: string | null) => void;
  onSelectTarget: (id: string | null) => void;
  onSelectRequirement: (id: string | null) => void;
  onClose: () => void;
}
