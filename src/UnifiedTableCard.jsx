import React, { useEffect, useState } from 'react';
import { request } from './api';
import { BusinessTableRows } from './BusinessTableRows';
import { FieldCatalog } from './FieldPanels';
import { cardRelations } from './cardDetailModel';
import { nodeRef } from './graphRefs';
import { displayNodeName } from './i18n';
import { tableDefinition, tableRecordsEndpoint, tableRecordsResult, tableFlow, tableTechnology } from './tableDetailsModel';

const words = (zh, a, b) => zh ? a : b;
function constraints(column, table, zh) {
  return [table.primary_key.includes(column.name) && words(zh, '主键', 'Primary key'),
    table.unique_keys.some(key => key.includes(column.name)) && words(zh, '唯一', 'Unique'),
    column.required === true && words(zh, '必填', 'Required'),
    column.required === false && words(zh, '可空', 'Nullable'),
    column.format, column.unit,
    (column.min_value != null || column.max_value != null) && `${column.min_value ?? '—'} ~ ${column.max_value ?? '—'}`,
  ].filter(Boolean).join(' · ') || '—';
}
export function TableActualData({ node, table, language }) {
  const zh = language === 'zh-CN';
  const endpoint = tableRecordsEndpoint(node);
  const [attempt, retry] = useState(0);
  const [state, setState] = useState({ endpoint, status: endpoint ? 'loading' : 'unconnected', rows: [] });
  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    const controller = new AbortController();
    setState({ endpoint, status: 'loading', rows: [] });
    request(endpoint, { signal: controller.signal }).then(data => {
      const result = tableRecordsResult(data);
      if (active) setState({ endpoint, ...result });
    }).catch(() => { if (active) setState({ endpoint, status: 'error', rows: [] }); });
    return () => { active = false; controller.abort(); };
  }, [endpoint, attempt]);
  const current = state.endpoint === endpoint ? state : { status: endpoint ? 'loading' : 'unconnected', rows: [] };
  const messages = {
    unconnected: words(zh, '尚未接入真实数据接口。', 'The actual-data interface is not connected.'),
    loading: words(zh, '正在读取真实数据…', 'Loading actual data…'),
    empty: words(zh, '尚未回写真实数据。', 'No actual data has been returned yet.'),
    replay: words(zh, '尚未回写真实数据；现有记录是离线演算，不在这里展示。', 'No actual data has been returned; the saved records are an offline replay.'),
    error: words(zh, '读取失败，请重试。', 'Could not load data. Please retry.'),
  };
  return <section className="table-detail-section" aria-label={words(zh, '真实数据', 'Actual data')}>
    <h3>{words(zh, '真实数据', 'Actual data')}</h3>
    {current.status !== 'snapshot' && <p role={current.status === 'error' ? 'alert' : 'status'}>{messages[current.status]}</p>}
    {current.status === 'error' && <button type="button" onClick={() => retry(n => n + 1)}>{words(zh, '重新读取', 'Retry')}</button>}
    {current.status === 'snapshot' && <>
      <BusinessTableRows table={table} rows={current.rows} language={language} />
      <p>{words(zh, '数据库历史快照 · ', 'Saved database snapshot · ')}{current.rows.length} {words(zh, '行', 'rows')}</p>
      <p>{words(zh, '来源：', 'Source: ')}{current.source.system} · {current.source.environment} · {current.source.location}</p>
      <p>{words(zh, '采样时间：', 'Captured at: ')}<time dateTime={current.source.captured_at}>{current.source.captured_at}</time></p>
    </>}
  </section>;
}
function TableDataFlow({ node, graph, language, openNode }) {
  const zh = language === 'zh-CN';
  const flow = tableFlow(cardRelations(node, graph));
  const link = other => <button type="button" key={other.id} onClick={() => openNode(other.id)}>{nodeRef(other)} {displayNodeName(language, other.name)}</button>;
  return <section className="table-detail-section table-data-flow" aria-label={words(zh, '数据流向', 'Data flow')}>
    <h3>{words(zh, '数据流向', 'Data flow')}</h3>
    <p className="card-detail-provenance">{words(zh, '以下为设计中的读写关系。', 'Planned reads and writes.')}</p>
    <div className="table-flow-columns">
      <div><h4>{words(zh, '写入方', 'Writers')}</h4>{flow.writers.length ? flow.writers.map(link) : <p>{words(zh, '尚未指定', 'Not specified')}</p>}</div>
      <span className="table-flow-arrow" aria-hidden="true">→</span>
      <div className="table-flow-current"><h4>{words(zh, '当前表', 'This table')}</h4><strong>{nodeRef(node)} {displayNodeName(language, node.name)}</strong></div>
      <span className="table-flow-arrow" aria-hidden="true">→</span>
      <div><h4>{words(zh, '读取方', 'Readers')}</h4>{flow.readers.length ? flow.readers.map(link) : <p>{words(zh, '尚未指定', 'Not specified')}</p>}</div>
    </div>
    {flow.references.length > 0 && <div className="table-flow-references"><h4>{words(zh, '其他关联 · 读写方式待确定', 'Other links · access not specified')}</h4>{flow.references.map(link)}</div>}
  </section>;
}
export function UnifiedTableCard(props) {
  const { node, graph, language, mutate, busy } = props;
  const zh = language === 'zh-CN';
  const table = tableDefinition(node, graph);
  const tech = tableTechnology(node, zh);
  const [editing, setEditing] = useState(false);
  return <>
    <section className="table-detail-section" aria-label={words(zh, '设计字段', 'Designed fields')}>
      <h3>{words(zh, '设计字段', 'Designed fields')}</h3>
      {table.columns.length ? <div className="business-table-schema-scroll"><table className="business-table-raw table-design-fields">
        <thead><tr><th>{words(zh, '字段名', 'Field')}</th><th>{words(zh, '类型', 'Type')}</th><th>{words(zh, '含义', 'Meaning')}</th><th>{words(zh, '约束', 'Constraints')}</th></tr></thead>
        <tbody>{table.columns.map(column => <tr key={column.name}><td><code>{column.name}</code></td><td>{column.type || column.data_type || '—'}</td><td>{(zh ? column.label_zh : column.label_en || column.label_zh) || '—'}</td><td>{constraints(column, table, zh)}</td></tr>)}</tbody>
      </table></div> : <p>{words(zh, '尚未定义字段。', 'No fields have been defined.')}</p>}
      {table.editable && mutate && <><button type="button" onClick={() => setEditing(v => !v)}>{words(zh, editing ? '收起字段编辑' : '编辑字段', editing ? 'Close field editor' : 'Edit fields')}</button>
        {editing && <FieldCatalog node={node} fields={table.fields} language={language} mutate={mutate} busy={busy} />}</>}
    </section>
    <TableActualData key={node.id} node={node} table={table} language={language} />
    <TableDataFlow {...props} />
    <section className="table-detail-section" aria-label={words(zh, '技术说明', 'Technology')}>
      <h3>{words(zh, '技术说明', 'Technology')}</h3>
      <dl className="table-technology"><div><dt>{words(zh, '数据库 / 存储', 'Database / storage')}</dt><dd>{tech.storage}</dd></div><div><dt>{words(zh, '设计表名', 'Designed table name')}</dt><dd><code>{node.name}</code></dd></div></dl>
      <p>{tech.note}</p>
    </section>
  </>;
}
