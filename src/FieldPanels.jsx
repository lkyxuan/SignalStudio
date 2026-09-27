import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, Plus, Trash2, X } from 'lucide-react';
import { displayNodeName, translate } from './i18n';
import { displayCatalogNodeName, displayFieldName } from './catalogPresentation';
import { SourceContractFields } from './SourceContractFields';
import { nodeRef, edgeRef, usageRef } from './graphRefs';
import './field-panels.css';

const emptyField = { name: '', data_type: 'Text', definition: '', notes: '', example_value: '', unit: '', min_value: null, max_value: null, normalization_rule: '' };
const fieldContract = (field, t) => [
  field.unit && `${t('Unit')}: ${field.unit}`,
  (field.min_value != null || field.max_value != null) && `${t('Value range')}: ${field.min_value ?? '—'}–${field.max_value ?? '—'}`,
].filter(Boolean).join(' · ');
const readHeaders = value => { try { return JSON.parse(value || '[]'); } catch { return []; } };
const edgeForm = edge => ({ rationale: edge.rationale, transformation: edge.transformation || '',
  transport_kind: edge.transport_kind || 'unspecified', transport_topic: edge.transport_topic || '',
  transport_key: edge.transport_key || '', payload_schema: edge.payload_schema || '',
  transport_headers: readHeaders(edge.transport_headers) });

export function NodeIOOverview({ node, graph, openEdge, language }) {
  const t = text => translate(language, text);
  const displayName = name => displayCatalogNodeName(graph.nodes.find(item => item.name === name), language) || displayNodeName(language, name);
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
        const headers = readHeaders(edge.transport_headers);
        return <button className="io-source" key={edge.id} onClick={() => openEdge(edge.id)}>
          <strong><span className="edge-inline-ref">{edgeRef(edge)}</span>{source ? displayName(source.name) : '—'}</strong><span className={`io-transport ${edge.transport_kind || 'unspecified'}`}>{t(edge.transport_kind === 'redpanda' ? 'Redpanda' : edge.transport_kind === 'direct' ? 'Direct' : 'Unspecified')}</span>
          {edge.transport_kind === 'redpanda' && <small>{edge.transport_topic}{headers.length ? ` · ${t('Headers')}: ${headers.map(item => `${item.name}${item.consumed ? ` (${t('Used')})` : ''}`).join(', ')}` : ''}</small>}
          {usages.length ? <ul>{usages.map(usage => { const field = graph.fields.find(item => item.id === usage.source_field_id); return <li key={usage.id}><span className="io-field-top"><strong><span className="usage-inline-ref">{usageRef(usage)}</span>{field ? displayFieldName(field, language) : '—'}</strong><span>{field ? t(field.data_type) : '—'}</span></span>{field && fieldContract(field, t) && <span className="io-example">{fieldContract(field, t)}</span>}{field?.example_value && <span className="io-example">{t('Example')}: {field.example_value}</span>}</li>; })}</ul> : <small>{t('Input fields not mapped yet.')}</small>}
        </button>;
      })}
    </div>}
    <div className="io-column"><div className="io-title">{t('OUTPUTS')} <em>{outputs.length}</em></div>
      {outputs.length ? <ul className="io-outputs">{outputs.map(field => <li key={field.id}><button className={selectedOutputId === field.id ? 'selected' : ''} onClick={() => setSelectedOutputId(selectedOutputId === field.id ? null : field.id)} aria-expanded={selectedOutputId === field.id}><span className="io-field-top"><strong>{displayFieldName(field, language)}</strong><span>{t(field.data_type)}</span></span>{fieldContract(field, t) && <span className="io-example">{fieldContract(field, t)}</span>}{field.example_value && <span className="io-example">{t('Example')}: {field.example_value}</span>}</button></li>)}</ul> : <p className="io-empty">{t('No output fields yet.')}</p>}
      {selectedOutput && <div className="io-lineage"><strong>{t('DOWNSTREAM FIELD USE')}</strong>
        {selectedOutput.normalization_rule && <p>{t('Normalization rule')}: {selectedOutput.normalization_rule}</p>}
        {downstreamUses.length ? downstreamUses.map(({ usage, edge, consumer, target }) => <button key={usage.id} onClick={() => openEdge(edge.id)}><span><span className="usage-inline-ref">{usageRef(usage)}</span>{consumer ? displayName(consumer.name) : '—'} {target ? `→ ${displayFieldName(target, language)}` : ''}</span><small>{edgeRef(edge)} · {t(edge.transport_kind === 'redpanda' ? 'Redpanda' : edge.transport_kind === 'direct' ? 'Direct' : 'Unspecified')}</small></button>)
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

export function EdgeMappingPanel({ edge, sourceNode, targetNode, sourceFields, targetFields, usages, mutate, busy, language }) {
  const [edgeDraft, setEdgeDraft] = useState(() => edgeForm(edge));
  const [mapping, setMapping] = useState({ source_field_id: '', target_field_id: '', usage_note: '' });
  const [lineContract, setLineContract] = useState(null);
  const t = text => translate(language, text);
  const displayName = name => displayCatalogNodeName([sourceNode, targetNode].find(item => item?.name === name), language) || displayNodeName(language, name);
  const isTableAccess = Boolean(sourceNode?.is_system_state || targetNode?.is_system_state);
  const isSignalMessage = edge.transport_kind === 'redpanda' && Boolean(targetNode?.signal_key);
  useEffect(() => { setEdgeDraft(edgeForm(edge));
    setMapping({ source_field_id: '', target_field_id: '', usage_note: '' }); }, [edge]);
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
  const addUsage = async () => {
    const result = await mutate(`/edges/${edge.id}/usages`, 'POST', mapping, 'Field usage added');
    if (result) setMapping({ source_field_id: '', target_field_id: '', usage_note: '' });
  };
  const saveEdge = () => mutate(`/edges/${edge.id}`, 'PATCH', {
    ...edgeDraft, transport_kind: isTableAccess ? 'direct' : edgeDraft.transport_kind,
    transport_headers: edgeDraft.transport_headers.filter(item => item.name.trim())
  }, 'Connection saved');
  return <div className="edge-detail-scroll">
    <div className="edge-path"><strong>{sourceNode && <><span className="path-node-ref">{nodeRef(sourceNode)}</span>{displayName(sourceNode.name)}</>}</strong><ArrowRight size={15} /><strong>{targetNode && <><span className="path-node-ref">{nodeRef(targetNode)}</span>{displayName(targetNode.name)}</>}</strong></div>
    {!isTableAccess && edge.transport_kind === 'redpanda' && <section className="message-flow-summary">
      <div className="message-flow-title"><strong>{edgeRef(edge)} · {language === 'zh-CN' ? 'Redpanda 消息内容' : 'Redpanda message payload'}</strong><span>{lineContract?.evidence_status === 'design_only_no_emitted_message_verified' ? language === 'zh-CN' ? '规划，未验证消息' : 'Planned, no verified message' : language === 'zh-CN' ? '设计连接' : 'Design connection'}</span></div>
      <div className="message-flow-route"><span>{language === 'zh-CN' ? '爬虫写入' : 'Crawler writes'}</span><ArrowRight size={13} /><code>{edge.transport_topic}</code><span>{language === 'zh-CN' ? `键：${edge.transport_key}` : `Key: ${edge.transport_key}`}</span></div>
      {lineContract ? <>
        <p>{language === 'zh-CN' ? `规划每个币种一条消息。data 保留完整上游记录；以下 ${lineContract.declared_upstream_field_inventory.length} 项是来源契约已声明的路径，新增字段也透传。` : `One planned message per coin. data preserves the complete upstream record; these ${lineContract.declared_upstream_field_inventory.length} paths are declared by the source contract, and new fields pass through too.`}</p>
        <div className="message-payload-fields"><strong>{language === 'zh-CN' ? `data · 已声明 ${lineContract.declared_upstream_field_inventory.length} 个字段路径` : `data · ${lineContract.declared_upstream_field_inventory.length} declared field paths`}</strong>
          {lineContract.declared_upstream_field_inventory.map(field => <div key={field.message_path}><code>{field.message_path}</code><span>{field.type}</span></div>)}
        </div>
        <div className="message-payload-fields"><strong>{language === 'zh-CN' ? 'meta · 消息元信息' : 'meta · message metadata'}</strong>
          {lineContract.payload.metadata_fields.map(field => <div key={field.path}><code>{field.path}</code><span>{field.required ? language === 'zh-CN' ? '必填' : 'required' : ''}</span></div>)}
        </div>
        <p>{language === 'zh-CN' ? '字段清单来自上游契约；实际爬虫消息尚未核对。' : 'Field paths come from the upstream contract; no emitted crawler message has been verified.'}</p>
      </> : <p>{language === 'zh-CN' ? '尚无版本化消息字段契约。' : 'No versioned message field contract is available.'}</p>}
    </section>}
    <p className="section-help">{isSignalMessage ? language === 'zh-CN' ? '此连接描述爬虫写入 Redpanda 的消息。下游节点详情记录字段使用与计算。' : 'This connection describes the crawler message written to Redpanda. Open the downstream node for field usage and calculation.' : isTableAccess ? t(sourceNode?.is_system_state ? 'This edge plans a direct table read. Describe the lookup keys and result used by the processing step.' : 'This edge plans a table update. Describe the reviewed decision and values to write.') : t('The downstream node depends on this source. Record exactly which source fields it consumes and which output they help produce.')}</p>
    {!isTableAccess && <div className="transport-editor"><div className="section-heading"><span>{t('TRANSPORT')}</span></div>
      <label>{t('Transport method')}<select value={edgeDraft.transport_kind} onChange={e => setEdgeDraft({ ...edgeDraft, transport_kind: e.target.value })}><option value="unspecified">{t('Unspecified')}</option><option value="direct">{t('Direct')}</option><option value="redpanda">{t('Redpanda')}</option></select></label>
      {edgeDraft.transport_kind === 'redpanda' && <><label>{t('Topic')}<input value={edgeDraft.transport_topic} placeholder="market.prices" onChange={e => setEdgeDraft({ ...edgeDraft, transport_topic: e.target.value })} /></label>
        <label>{t('Message key')}<input value={edgeDraft.transport_key} placeholder="asset_symbol" onChange={e => setEdgeDraft({ ...edgeDraft, transport_key: e.target.value })} /></label>
        <label>{t('Payload schema reference')}<input value={edgeDraft.payload_schema} placeholder="price-event/v1" onChange={e => setEdgeDraft({ ...edgeDraft, payload_schema: e.target.value })} /></label>
        <div className="header-heading"><span>{t('Headers')}</span><button onClick={() => setEdgeDraft({ ...edgeDraft, transport_headers: [...edgeDraft.transport_headers, { name: '', description: '', consumed: false }] })}><Plus size={13} /> {t('Add header')}</button></div>
        {edgeDraft.transport_headers.map((header, index) => <div className="header-row" key={index}><input aria-label={`${t('Header name')} ${index + 1}`} value={header.name} placeholder={t('Header name')} onChange={e => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} /><input aria-label={`${t('Header meaning')} ${index + 1}`} value={header.description} placeholder={t('Header meaning')} onChange={e => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.map((item, i) => i === index ? { ...item, description: e.target.value } : item) })} /><label className="header-consumed"><input type="checkbox" checked={Boolean(header.consumed)} onChange={e => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.map((item, i) => i === index ? { ...item, consumed: e.target.checked } : item) })} />{t('Used')}</label><button aria-label={`${t('Remove header')} ${index + 1}`} onClick={() => setEdgeDraft({ ...edgeDraft, transport_headers: edgeDraft.transport_headers.filter((_, i) => i !== index) })}><X size={13} /></button></div>)}
        <p className="section-help">{isSignalMessage ? language === 'zh-CN' ? '消息头与 data / meta 一起描述爬虫写入内容。' : 'Headers, data and meta describe what the crawler writes.' : t('Headers are message metadata. Map consumed payload fields below; reuse the upstream schema when the payload is unchanged.')}</p></>}
    </div>}
    <label>{isSignalMessage ? language === 'zh-CN' ? '爬虫如何封装消息？' : 'How does the crawler package the message?' : t(isTableAccess ? 'Lookup / write contract' : 'How are the inputs transformed?')}<textarea rows="4" value={edgeDraft.transformation} placeholder={t(isTableAccess ? 'Keys, filters, expected result or reviewed update' : 'e.g. Filter by asset and time window, deduplicate, then count mentions.')} onChange={e => setEdgeDraft({ ...edgeDraft, transformation: e.target.value })} /></label>
    <label>{t('Why is this dependency needed?')}<textarea rows="3" value={edgeDraft.rationale} placeholder={t('Design reason for this connection')} onChange={e => setEdgeDraft({ ...edgeDraft, rationale: e.target.value })} /></label>
    <button className="mini-primary edge-save" disabled={busy || (edgeDraft.transport_kind === 'redpanda' && !edgeDraft.transport_topic.trim())} onClick={saveEdge}><Check size={13} /> {t('Save connection')}</button>
    {!isTableAccess && !isSignalMessage && <><div className="section-heading mapping-heading"><span>{t('FIELD USAGE')} <em>{usages.length}</em></span></div>
    {usages.length === 0 && <div className="field-empty">{t('No field usage defined yet. This connection only records a node-level dependency.')}</div>}
    {usages.map(usage => {
      const source = sourceFields.find(field => field.id === usage.source_field_id);
      const target = targetFields.find(field => field.id === usage.target_field_id);
      return <div className="mapping-card" key={usage.id}><span className="mapping-ref">{usageRef(usage)}</span><div className="mapping-line"><span>{source ? displayFieldName(source, language) : t('Missing source field')}</span><ArrowRight size={13} /><span>{target ? displayFieldName(target, language) : t('Node output')}</span><button title={t('Remove field usage')} aria-label={language === 'zh-CN' ? `删除${usageRef(usage)}：${source ? displayFieldName(source, language) : '字段'}的使用关系` : `Remove ${usageRef(usage)} usage of ${source?.name || 'field'}`} onClick={() => mutate(`/usages/${usage.id}`, 'DELETE', null, 'Field usage removed')}><X size={13} /></button></div><label className="mapping-target-label">{language === 'zh-CN' ? '生成的输出字段' : 'Output field produced'}<select aria-label={language === 'zh-CN' ? `为${source ? displayFieldName(source, language) : '输入'}选择输出字段` : `Choose output field for ${source?.name || 'input'}`} value={usage.target_field_id || ''} disabled={busy} onChange={event => mutate(`/usages/${usage.id}`, 'PATCH', { target_field_id: event.target.value || null }, language === 'zh-CN' ? '输出字段已关联' : 'Output field linked')}><option value="">{t('Node level / unspecified')}</option>{targetFields.map(field => <option key={field.id} value={field.id}>{displayFieldName(field, language)}</option>)}</select></label>{usage.usage_note && <small>{usage.usage_note}</small>}</div>;
    })}
    <div className="mapping-editor"><div className="mapping-editor-title">{t('Add field usage')}</div><label>{t('From')} {sourceNode && displayName(sourceNode.name)}<select aria-label={t('Source field')} value={mapping.source_field_id} onChange={e => setMapping({ ...mapping, source_field_id: e.target.value })}><option value="">{t('Select source field')}</option>{sourceFields.map(field => <option key={field.id} value={field.id}>{displayFieldName(field, language)}</option>)}</select></label><label>{t('Produces on')} {targetNode && displayName(targetNode.name)}<select aria-label={t('Target field')} value={mapping.target_field_id} onChange={e => setMapping({ ...mapping, target_field_id: e.target.value })}><option value="">{t('Node level / unspecified')}</option>{targetFields.map(field => <option key={field.id} value={field.id}>{displayFieldName(field, language)}</option>)}</select></label><label>{t('Field usage note')}<input aria-label={t('Field usage note')} value={mapping.usage_note} placeholder={t('Optional: how this field is used')} onChange={e => setMapping({ ...mapping, usage_note: e.target.value })} /></label><button className="mini-primary" disabled={busy || !mapping.source_field_id} onClick={addUsage}><Plus size={13} /> {t('Add mapping')}</button>{sourceFields.length === 0 && <p className="mapping-note">{language === 'zh-CN' ? `请先向 ${sourceNode ? displayName(sourceNode.name) : ''} 添加字段。` : `Add fields to ${sourceNode?.name} first.`}</p>}</div></>}
  </div>;
}
