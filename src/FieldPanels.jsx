import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Plus, Trash2, X } from 'lucide-react';
import { displayNodeName, translate } from './i18n';
import { displayCatalogNodeName, displayFieldName } from './catalogPresentation';
import { SourceContractFields } from './SourceContractFields';
import { nodeRef, edgeRef, usageRef } from './graphRefs';
import { displayCaseValue, flattenAccount, SMART_FOLLOWING_OPERATION } from './smartFollowingCase';
import './field-panels.css';

const emptyField = { name: '', data_type: 'Text', definition: '', notes: '', example_value: '', unit: '', min_value: null, max_value: null, normalization_rule: '' };
const fieldContract = (field, t) => [
  field.unit && `${t('Unit')}: ${field.unit}`,
  (field.min_value != null || field.max_value != null) && `${t('Value range')}: ${field.min_value ?? '—'}–${field.max_value ?? '—'}`,
].filter(Boolean).join(' · ');
const readHeaders = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const edgeForm = edge => ({ rationale: edge.rationale, transformation: edge.transformation || '', branch_label: edge.branch_label || '',
  transport_kind: edge.transport_kind || 'unspecified', transport_topic: edge.transport_topic || '',
  transport_key: edge.transport_key || '', payload_schema: edge.payload_schema || '', consumer_group: edge.consumer_group || '',
  transport_headers: readHeaders(edge.transport_headers) });

export function NodeIOOverview({ node, graph, openEdge, openNode, language, nodeLabel }) {
  const t = text => translate(language, text);
  const displayName = name => nodeLabel?.(name) || displayCatalogNodeName(graph.nodes.find(item => item.name === name), language) || displayNodeName(language, name);
  const [selectedOutputId, setSelectedOutputId] = useState(null);
  useEffect(() => setSelectedOutputId(null), [node.id]);
  const inputs = graph.edges.filter(edge => edge.downstream_id === node.id);
  const outputs = graph.fields.filter(field => field.node_id === node.id);
  const selectedOutput = outputs.find(field => field.id === selectedOutputId);
  const downstreamUses = selectedOutput ? graph.field_usages.filter(usage => usage.source_field_id === selectedOutput.id).map(usage => {
    const edge = graph.edges.find(item => item.id === usage.edge_id);
    return { usage, edge, consumer: graph.nodes.find(item => item.id === edge?.downstream_id),
      target: graph.fields.find(item => item.id === usage.target_field_id) };
  }).filter(item => item.edge) : [];
  return <section className={`node-io ${inputs.length || node.type !== 'Source' ? '' : 'output-only'}`}>
    {(inputs.length > 0 || node.type !== 'Source') && <div className="io-column"><div className="io-title">{t('INPUTS')} <em>{inputs.length}</em></div>
      {inputs.length === 0 && <p className="io-empty">{t('No inputs connected yet.')}</p>}
      {inputs.map(edge => {
        const source = graph.nodes.find(item => item.id === edge.upstream_id);
        const usages = graph.field_usages.filter(item => item.edge_id === edge.id);
        return <button className="io-source" key={edge.id} onClick={() => source && openNode(source.id)}>
          <strong><span className="io-source-ref">{nodeRef(source)}</span>{source ? displayName(source.name) : '—'}</strong>
          {usages.length ? <ul>{usages.map(usage => { const field = graph.fields.find(item => item.id === usage.source_field_id); return <li key={usage.id}><span className="io-field-top"><strong>{field ? displayFieldName(field, language) : '—'}</strong><span>{field ? t(field.data_type) : '—'}</span></span>{field && fieldContract(field, t) && <span className="io-example">{fieldContract(field, t)}</span>}{field?.example_value && <span className="io-example">{t('Example')}: {field.example_value}</span>}</li>; })}</ul> : <small>{source?.is_system_state ? edge.rationale || (language === 'zh-CN' ? '规划读表，尚无实际查询结果。' : 'Planned table read; no observed result.') : t('Input fields not mapped yet.')}</small>}
        </button>;
      })}
    </div>}
    <div className="io-column"><div className="io-title">{t('OUTPUTS')} <em>{outputs.length}</em></div>
      {outputs.length ? <ul className="io-outputs">{outputs.map(field => <li key={field.id}><button className={selectedOutputId === field.id ? 'selected' : ''} onClick={() => setSelectedOutputId(selectedOutputId === field.id ? null : field.id)} aria-expanded={selectedOutputId === field.id}><span className="io-field-top"><strong>{displayFieldName(field, language)}</strong><span>{t(field.data_type)}</span></span>{fieldContract(field, t) && <span className="io-example">{fieldContract(field, t)}</span>}{field.example_value && <span className="io-example">{t('Example')}: {field.example_value}</span>}</button></li>)}</ul> : <p className="io-empty">{t('No output fields yet.')}</p>}
      {selectedOutput && <div className="io-lineage"><strong>{t('DOWNSTREAM FIELD USE')}</strong>
        {selectedOutput.normalization_rule && <p>{t('Normalization rule')}: {selectedOutput.normalization_rule}</p>}
        {downstreamUses.length ? downstreamUses.map(({ usage, edge, consumer, target }) => <button key={usage.id} onClick={() => openEdge(edge.id)}><span><span className="usage-inline-ref">{usageRef(usage)}</span>{consumer ? displayName(consumer.name) : '—'} {target ? `→ ${displayFieldName(target, language)}` : ''}</span></button>)
          : <p>{t('No downstream field mapping for this output.')}</p>}
      </div>}
    </div>
  </section>;
}

function FieldEditor({ initial, onSave, onCancel, busy, language }) {
  const [draft, setDraft] = useState(initial);
  const t = text => translate(language, text);
  return <div className="field-editor">
    <div className="field-editor-row"><label>{t('Field name')}<input aria-label={t('Field name')} autoFocus value={draft.name} placeholder={t('e.g. author_id')} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label><label>{t('Data type')}<input aria-label={t('Data type')} value={language === 'zh-CN' && draft.data_type === initial.data_type ? t(draft.data_type) : draft.data_type} placeholder={t('Text / Integer / Timestamp')} onChange={e => setDraft({ ...draft, data_type: e.target.value })} /></label></div>
    <label>{t('Definition')}<textarea aria-label={t('Field definition')} rows="2" value={draft.definition} placeholder={t('What does this field mean?')} onChange={e => setDraft({ ...draft, definition: e.target.value })} /></label>
    <div className="field-contract-heading"><strong>{t('Output contract')}</strong><button type="button" onClick={() => setDraft({ ...draft, data_type: 'Decimal', unit: '%', min_value: 0, max_value: 100 })}>{t('Set as percentage (0–100)')}</button></div>
    <div className="field-editor-contract"><label>{t('Unit')}<input aria-label={t('Unit')} value={draft.unit || ''} placeholder={t('e.g. %, USD, count')} onChange={e => setDraft({ ...draft, unit: e.target.value })} /></label><label>{t('Minimum value')}<input aria-label={t('Minimum value')} type="number" value={draft.min_value ?? ''} onChange={e => setDraft({ ...draft, min_value: e.target.value })} /></label><label>{t('Maximum value')}<input aria-label={t('Maximum value')} type="number" value={draft.max_value ?? ''} onChange={e => setDraft({ ...draft, max_value: e.target.value })} /></label></div>
    <label>{t('Normalization rule')}<textarea aria-label={t('Normalization rule')} rows="2" value={draft.normalization_rule || ''} placeholder={t('e.g. clamp(raw / baseline × 100, 0, 100)')} onChange={e => setDraft({ ...draft, normalization_rule: e.target.value })} /></label>
    <label>{t('Notes')}<input aria-label={t('Field notes')} value={draft.notes} placeholder={t('Optional research note')} onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
    <label>{t('Example output')}<input aria-label={t('Example output')} value={draft.example_value || ''} placeholder={draft.unit === '%' ? t('e.g. 73.4% (illustration only)') : t('Any illustrative output, e.g. sample_123')} onChange={e => setDraft({ ...draft, example_value: e.target.value })} /></label>
    <p className="field-example-help">{t('The example shows the expected output format; it is not a stored data record.')}</p>
    <div className="field-editor-actions"><button className="text-button" onClick={onCancel}>{t('Cancel')}</button><button className="mini-primary" disabled={busy || !draft.name.trim()} onClick={() => onSave(draft)}><Check size={13} /> {t('Save field')}</button></div>
  </div>;
}

export function FieldCatalog({ node, fields, mutate, busy, language }) {
  const [editing, setEditing] = useState(null);
  const [sourceContract, setSourceContract] = useState(null);
  const [contractError, setContractError] = useState('');
  const t = text => translate(language, text);
  const isResource = node.name.startsWith('kaito.resource.');
  const plannedSource = isResource || node.name.startsWith('kaito.mcp.') || node.name.startsWith('binance.usdm.') || node.name.startsWith('dexscreener.') || node.name.startsWith('coingecko.') || node.name.startsWith('rss.') || node.name.startsWith('taoli.') || node.name.startsWith('telegram.');
  useEffect(() => setEditing(null), [node.id]);
  useEffect(() => {
    let active = true;
    setSourceContract(null);
    setContractError('');
    if (plannedSource) {
      fetch(`/api/source-contracts/v1/${isResource ? 'resources' : 'operations'}/${encodeURIComponent(node.name)}`).then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Unable to load upstream contract');
        if (active) setSourceContract(result);
      }).catch(error => { if (active) setContractError(error.message); });
    }
    return () => { active = false; };
  }, [plannedSource, isResource, node.name]);
  const save = async draft => {
    const result = editing === 'new'
      ? await mutate(`/nodes/${node.id}/fields`, 'POST', draft, 'Field added')
      : await mutate(`/fields/${editing}`, 'PATCH', draft, 'Field updated');
    if (result) setEditing(null);
  };
  const remove = async field => {
    if (!confirm(language === 'zh-CN' ? `删除字段“${field.name}”？` : `Delete field “${field.name}”?`)) return;
    await mutate(`/fields/${field.id}`, 'DELETE', null, 'Field deleted');
  };
  if (plannedSource) return <section className="field-catalog">
    {sourceContract ? <SourceContractFields data={sourceContract} language={language} />
      : <p className="section-help">{contractError || (language === 'zh-CN' ? '正在读取上游契约…' : 'Loading upstream contract…')}</p>}
  </section>;
  return <section className="field-catalog">
    <div className="section-heading"><span>{t('OUTPUT FIELD DEFINITIONS')} <em>{fields.length}</em></span><button onClick={() => setEditing('new')}><Plus size={14} /> {t('Add field')}</button></div>
    <p className="section-help">{t('Fields describe what this node provides. No actual records are stored here.')}</p>
    {fields.length === 0 && editing !== 'new' && <div className="field-empty">{t('No fields yet. Add the outputs this node provides.')}</div>}
    {fields.map(field => <div className="field-card" key={field.id}>
      {editing === field.id ? <FieldEditor initial={field} onSave={save} onCancel={() => setEditing(null)} busy={busy} language={language} />
        : <><div className="field-card-head"><button className="field-name-button" onClick={() => setEditing(field.id)}>{field.name}</button><span className="field-data-type">{t(field.data_type)}</span><button className="field-remove" title={language === 'zh-CN' ? `删除${field.name}` : `Delete ${field.name}`} aria-label={language === 'zh-CN' ? `删除${field.name}` : `Delete ${field.name}`} onClick={() => remove(field)}><Trash2 size={13} /></button></div>{field.definition && <p>{field.definition}</p>}{fieldContract(field, t) && <small>{fieldContract(field, t)}</small>}{field.normalization_rule && <small>{t('Normalization rule')}: {field.normalization_rule}</small>}{field.example_value && <small>{t('Example')}: {field.example_value}</small>}{field.notes && <small>{field.notes}</small>}</>}
    </div>)}
    {editing === 'new' && <FieldEditor initial={emptyField} onSave={save} onCancel={() => setEditing(null)} busy={busy} language={language} />}
  </section>;
}

export function EdgeMappingPanel({ edge, sourceNode, targetNode, sourceFields, mutate, busy, language, nodeLabel }) {
  const [edgeDraft, setEdgeDraft] = useState(() => edgeForm(edge));
  const [lineContract, setLineContract] = useState(null);
  const t = text => translate(language, text);
  const displayName = name => nodeLabel?.(name) || displayCatalogNodeName([sourceNode, targetNode].find(item => item?.name === name), language) || displayNodeName(language, name);
  const isTableAccess = Boolean(sourceNode?.is_system_state || targetNode?.is_system_state);
  const isSignalMessage = edge.transport_kind === 'redpanda' && Boolean(targetNode?.signal_key);
  const isSmartFollowing = edge.transport_kind === 'redpanda' && sourceNode?.name === SMART_FOLLOWING_OPERATION;
  const messageHeaders = readHeaders(edge.transport_headers);
  const [observedCase, setObservedCase] = useState(null);
  useEffect(() => {
    setObservedCase(null);
    if (!isSmartFollowing) return undefined;
    let active = true;
    fetch(`/api/source-cases/v1/${encodeURIComponent(SMART_FOLLOWING_OPERATION)}`)
      .then(response => response.json())
      .then(data => { if (active) setObservedCase(data.cases?.find(item => item.response_complete && Array.isArray(item.response) && item.response.length)); })
      .catch(() => {});
    return () => { active = false; };
  }, [isSmartFollowing, edge.id]);
  useEffect(() => { setEdgeDraft(edgeForm(edge)); }, [edge]);
  useEffect(() => {
    if (edge.transport_kind !== 'redpanda' || !targetNode?.signal_key) {
      setLineContract(null);
      return;
    }
    let current = true;
    fetch(`/api/edges/${encodeURIComponent(edge.id)}/contract`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Connection contract unavailable');
        return data.connection;
      })
      .then(data => { if (current) setLineContract(data); })
      .catch(() => { if (current) setLineContract(null); });
    return () => { current = false; };
  }, [edge, targetNode?.signal_key]);
  const saveEdge = () => mutate(`/edges/${edge.id}`, 'PATCH', {
    ...edgeDraft, transport_kind: isTableAccess ? 'direct' : edgeDraft.transport_kind,
    transport_headers: edgeDraft.transport_headers.filter(item => item.name.trim())
  }, 'Connection saved');
  return <div className="edge-detail-scroll">
    <div className="edge-path"><strong>{sourceNode && <><span className="path-node-ref">{nodeRef(sourceNode)}</span>{displayName(sourceNode.name)}</>}</strong><ArrowRight size={15} /><strong>{targetNode && <><span className="path-node-ref">{nodeRef(targetNode)}</span>{displayName(targetNode.name)}</>}</strong></div>
    {edge.transport_kind !== 'redpanda' && <section className="edge-plain-summary">
      {edge.branch_label && <strong>{language === 'zh-CN' ? '分支：' : 'Branch: '}{edge.branch_label}</strong>}
      <h3>{language === 'zh-CN' ? isTableAccess ? '这条线表示什么' : '这条线传什么' : isTableAccess ? 'What this connection means' : 'What this connection carries'}</h3>
      <p>{edge.rationale || (language === 'zh-CN' ? '这条线的用途尚未写明。' : 'The purpose of this connection is not described yet.')}</p>
      <div className="edge-plain-method"><strong>{language === 'zh-CN' ? '方式' : 'Method'}</strong><span>{isTableAccess ? language === 'zh-CN' ? sourceNode?.is_system_state ? '直接读表' : '直接写表' : sourceNode?.is_system_state ? 'Direct table read' : 'Direct table write' : edge.transport_kind === 'redpanda' ? 'Redpanda' : t(edge.transport_kind === 'direct' ? 'Direct' : 'Unspecified')}</span>{edge.transport_kind === 'redpanda' && edge.transport_topic && <code>{edge.transport_topic}</code>}</div>
      <small>{language === 'zh-CN' ? isTableAccess ? '规划连接；尚无实际表查询或写入记录。' : '规划连接；尚无实际队列消息验证。' : isTableAccess ? 'Planned connection; no observed table query or write.' : 'Planned connection; no emitted queue message verified.'}</small>
    </section>}
    {!isTableAccess && edge.transport_kind === 'redpanda' && <section className="message-flow-summary">
      <div className="message-flow-title"><strong>{language === 'zh-CN' ? 'Redpanda 消息字段' : 'Redpanda message fields'}</strong><span>{language === 'zh-CN' ? '规划，未验证消息' : 'Planned, no verified message'}</span></div>
      <div className="message-flow-route"><span>{language === 'zh-CN' ? '生产者写入' : 'Producer writes'}</span><ArrowRight size={13} /><code>{edge.transport_topic}</code><span>{language === 'zh-CN' ? `消息键：${edge.transport_key || '待定义'}` : `Message key: ${edge.transport_key || 'To define'}`}</span><span>{language === 'zh-CN' ? `消费者组：${edge.consumer_group || '待定义'}` : `Consumer group: ${edge.consumer_group || 'To define'}`}</span></div>
      <p>{language === 'zh-CN' ? `格式：${edge.payload_schema || '待定义'}。下游卡片负责解析和处理消息。` : `Schema: ${edge.payload_schema || 'To define'}. The downstream node owns parsing and processing.`}</p>
      {lineContract ? <>
        <p>{language === 'zh-CN' ? `规划每个币种一条消息。data 保留完整上游记录；以下 ${lineContract.declared_upstream_field_inventory.length} 项是来源契约已声明的路径，新增字段也透传。` : `One planned message per coin. data preserves the complete upstream record; these ${lineContract.declared_upstream_field_inventory.length} paths are declared by the source contract, and new fields pass through too.`}</p>
        <div className="message-payload-fields"><strong>{language === 'zh-CN' ? `data · 已声明 ${lineContract.declared_upstream_field_inventory.length} 个字段路径` : `data · ${lineContract.declared_upstream_field_inventory.length} declared field paths`}</strong>
          {lineContract.declared_upstream_field_inventory.map(field => <div key={field.message_path}><code>{field.message_path}</code><span>{field.type}</span></div>)}
        </div>
        <p>{language === 'zh-CN' ? '字段清单来自上游契约；实际爬虫消息尚未核对。' : 'Field paths come from the upstream contract; no emitted crawler message has been verified.'}</p>
      </> : isSignalMessage ? <p>{language === 'zh-CN' ? '尚无版本化消息字段契约。' : 'No versioned message field contract is available.'}</p> : isSmartFollowing ? <>
        <p>{language === 'zh-CN' ? `计划把 #2030 每条账号记录原样放进 data；本次上游调用返回 ${observedCase?.response?.length ?? '—'} 条。下面是首条上游记录投影出的拟发消息，不是实际 Redpanda 消息。` : `Planned: one message per #2030 account row, preserving the complete row in data. The fields below are from an upstream example, not an emitted message.`}</p>
        <div className="message-payload-fields"><strong>{language === 'zh-CN' ? `data · 首条上游记录 ${observedCase?.response?.[0] ? flattenAccount(observedCase.response[0]).length : sourceFields.length} 项已见字段` : 'data · observed first account row'}</strong>
          {(observedCase?.response?.[0] ? flattenAccount(observedCase.response[0]) : sourceFields.map(field => [field.name, undefined])).map(([path, value], index) => <div key={path}><code>{String(index + 1).padStart(2, '0')} · data.{path}</code><span>{value === undefined ? '—' : displayCaseValue(value)}</span></div>)}
        </div>
        <p>{language === 'zh-CN' ? 'data 保留完整上游对象，新增字段也透传；16 项只是首条实见字段。爬虫实际发出的消息与消费结果尚未验证。' : 'The complete upstream object passes through, including future fields. Emitted messages and consumer results are not verified.'}</p>
      </> : <>
        <p>{language === 'zh-CN' ? `消息格式：${edge.payload_schema || '未指定'}。data 保留完整上游记录；下列字段是当前已列出的消费字段，不代表上游返回字段全集。` : `Schema: ${edge.payload_schema || 'unspecified'}. data retains the complete upstream record; these are the currently listed consumed fields, not the full upstream response.`}</p>
        <div className="message-payload-fields"><strong>{language === 'zh-CN' ? 'data · 已列字段' : 'data · listed fields'}</strong>{sourceFields.map(field => <div key={field.id}><code>data.{field.name}</code><span>{field.data_type}</span></div>)}</div>
        <p>{language === 'zh-CN' ? '消息封装与 Headers 均为设计，实际爬虫消息尚未验证。' : 'The message envelope and headers are planned; no emitted crawler message has been verified.'}</p>
      </>}
      <div className="message-payload-fields"><strong>Headers · {messageHeaders.length}</strong>{messageHeaders.length ? messageHeaders.map((header, index) => <div key={header.name}><code>{String(index + 1).padStart(2, '0')} · {header.name}</code><span>{header.description}</span></div>) : <p>{language === 'zh-CN' ? '尚未定义 Headers' : 'No Headers defined yet'}</p>}</div>
    </section>}
    {!isTableAccess && <details className="edge-advanced"><summary>{language === 'zh-CN' ? '其他设置' : 'Other settings'}</summary>
      <div className="transport-editor">
        <label>{language === 'zh-CN' ? '分支名称' : 'Branch label'}<input value={edgeDraft.branch_label} placeholder={language === 'zh-CN' ? '例如：已匹配' : 'e.g. Matched'} onChange={e => setEdgeDraft({ ...edgeDraft, branch_label: e.target.value })} /></label>
        <label>{t('Transport method')}<select value={edgeDraft.transport_kind} onChange={e => setEdgeDraft({ ...edgeDraft, transport_kind: e.target.value })}><option value="unspecified">{t('Unspecified')}</option><option value="direct">{t('Direct')}</option><option value="redpanda">{t('Redpanda')}</option></select></label>
        {edgeDraft.transport_kind === 'redpanda' && <>
          <label>{t('Topic')}<input value={edgeDraft.transport_topic} placeholder="market.prices" onChange={e => setEdgeDraft({ ...edgeDraft, transport_topic: e.target.value })} /></label>
          <label>{t('Message key')}<input value={edgeDraft.transport_key} placeholder="data.id" onChange={e => setEdgeDraft({ ...edgeDraft, transport_key: e.target.value })} /></label>
          <label>{language === 'zh-CN' ? '消费者组' : 'Consumer group'}<input value={edgeDraft.consumer_group} placeholder="signalstudio.consumer" onChange={e => setEdgeDraft({ ...edgeDraft, consumer_group: e.target.value })} /></label>
          <label>{t('Payload schema reference')}<input value={edgeDraft.payload_schema} placeholder="message/v1" onChange={e => setEdgeDraft({ ...edgeDraft, payload_schema: e.target.value })} /></label>
          <div className="header-heading"><span>Headers</span><button type="button" onClick={() => setEdgeDraft({ ...edgeDraft, transport_headers: [...edgeDraft.transport_headers, { name: '', description: '', consumed: false }] })}><Plus size={13} /> {language === 'zh-CN' ? '添加' : 'Add'}</button></div>
          {edgeDraft.transport_headers.map((header, index) => <div className="header-row" key={index}><input aria-label={`${t('Header name')} ${index + 1}`} value={header.name} placeholder={language === 'zh-CN' ? '名称' : 'Name'} onChange={e => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} /><input aria-label={`${t('Header meaning')} ${index + 1}`} value={header.description} placeholder={language === 'zh-CN' ? '记录什么' : 'What it records'} onChange={e => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.map((item, i) => i === index ? { ...item, description: e.target.value } : item) })} /><button type="button" aria-label={`${t('Remove header')} ${index + 1}`} onClick={() => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.filter((_, i) => i !== index) })}><X size={13} /></button></div>)}
        </>}
      </div>
      <button className="mini-primary edge-save" disabled={busy || (edgeDraft.transport_kind === 'redpanda' && !edgeDraft.transport_topic.trim())} onClick={saveEdge}><Check size={13} /> {t('Save connection')}</button>
    </details>}
  </div>;
}
