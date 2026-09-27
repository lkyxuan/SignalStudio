import React, { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import './catalog-translation-table.css';

export function CatalogTranslationTable({ language }) {
  const zh = language === 'zh-CN';
  const word = (cn, en) => zh ? cn : en;
  const [contract, setContract] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [sourceId, setSourceId] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/source-contracts/v1').then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to load upstream contract');
      if (active) setContract(result);
    }).catch(failure => { if (active) setError(failure.message); });
    return () => { active = false; };
  }, []);

  const rows = (contract?.operations || []).filter(operation => !sourceId || operation.source_id === sourceId)
    .flatMap(operation => operation.fields.map(field => ({ operation, field })))
    .filter(({ operation, field }) => `${operation.id} ${operation.label_zh} ${field.path} ${field.label_zh} ${field.purpose_zh || ''}`
      .toLowerCase().includes(query.trim().toLowerCase()));

  return <section className="translation-view">
    <div className="translation-intro"><div><span className="translation-eyebrow">SIGNALSTUDIO · SOURCE CONTRACT V1</span><h1>{word('字段用途与案例', 'Field guide and examples')}</h1><p>{word('字段来自本产品的上游契约；证据与示例按各操作分别标注。', 'Fields come from the application upstream contract, with evidence labeled per operation.')}</p></div><div className="translation-actions"><strong>{rows.length} <small>{word('条字段定义', 'field definitions')}</small></strong></div></div>
    <div className="translation-controls"><label><Search size={16} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={word('搜索操作、字段或用途…', 'Search operation, field or purpose…')} /></label><select value={sourceId} onChange={event => setSourceId(event.target.value)}><option value="">{word('全部来源', 'All sources')}</option>{contract?.sources.map(source => <option key={source.id} value={source.id}>{zh ? source.label_zh : source.id}</option>)}</select></div>
    {error && <p role="alert">{error}</p>}
    {!contract && !error && <p>{word('正在读取上游契约…', 'Loading upstream contract…')}</p>}
    {contract && <div className="translation-table-wrap"><table><thead><tr><th>{word('来源与操作', 'Source and operation')}</th><th>{word('字段与用途', 'Field and purpose')}</th><th>{word('依据', 'Evidence')}</th><th>{word('案例值', 'Example')}</th></tr></thead><tbody>{rows.map(({ operation, field }) => <tr key={`${operation.id}:${field.path}`}>
      <td><strong>{zh ? contract.sources.find(source => source.id === operation.source_id)?.label_zh : operation.source_id}</strong><span>{zh ? operation.label_zh : operation.id}</span><a href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{word('上游说明', 'Upstream reference')}</a></td>
      <td><strong>{zh ? field.label_zh : field.path}</strong><code>{field.path}</code><span>{field.purpose_zh || field.condition || '—'}</span></td>
      <td>{field.evidence === 'official_documentation' ? word('官方文档', 'Official documentation') : field.evidence === 'mcp_sample' ? word('MCP 响应样本', 'MCP response sample') : word('API 响应样本', 'API response sample')}</td>
      <td>{field.example_value === null || field.example_value === undefined ? '—' : <code>{JSON.stringify(field.example_value)}</code>}</td>
    </tr>)}</tbody></table>{!rows.length && <p>{word('没有匹配字段。', 'No matching fields.')}</p>}</div>}
  </section>;
}
