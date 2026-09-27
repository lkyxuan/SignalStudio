import React from 'react';
import { ArrowUpRight } from 'lucide-react';
import { SourceFieldCard } from './SourceFieldCard';
import './source-contract-fields.css';

const coverage = {
  api_sample_lower_bound: '官方 API 响应样本；字段是已见下限',
  api_sample_plus_documented_optionals: 'API 样本及文档中的条件字段',
  mcp_sample_lower_bound: 'MCP 响应样本；字段是已见下限',
  no_output_sample: '尚无返回样本',
  documented_planned_selection: '按官方文档选择的计划字段',
  not_inventoried: '尚未盘点响应字段',
  awaiting_first_party_schema: '等待第一方接口或字段说明',
};

const inputCoverage = {
  official_documentation: ['官方接口文档', 'Official API documentation'],
  public_proxy_snapshot: ['MetaSearch-IO 旧版工具代码（2026-04-01）', 'Historical MetaSearch-IO tool code (2026-04-01)'],
  official_mcp_resource: ['MCP 资源说明', 'MCP resource documentation'],
  design_input: ['本产品的采集输入设计', 'Product ingestion design'],
  unverified: ['输入契约待核对', 'Input contract not verified'],
};

function InputFields({ operation, zh }) {
  const fields = operation.inputs || [];
  const unknown = operation.input_coverage === 'unverified';
  const historical = operation.input_coverage === 'public_proxy_snapshot';
  const required = fields.filter(field => field.required).length;
  const optional = fields.length - required;
  const source = inputCoverage[operation.input_coverage] || inputCoverage.unverified;
  return <section className="source-contract-inputs" aria-label={zh ? '调用输入' : 'Call inputs'}>
    <div className="source-contract-io-heading">
      <strong>{zh ? historical ? '旧版调用输入' : '调用输入' : historical ? 'Historical call inputs' : 'Call inputs'}</strong>
      <span>{unknown ? (zh ? '数量未知' : 'Count unknown') : historical ? (zh ? `旧版 ${required} 必填 · ${optional} 可选；线上未知` : `Historical ${required} required · ${optional} optional; live unknown`) : zh ? `${required} 必填 · ${optional} 可选` : `${required} required · ${optional} optional`}</span>
    </div>
    <p className="source-contract-evidence">{zh ? source[0] : source[1]}{operation.input_source_url && <a href={operation.input_source_url} target="_blank" rel="noopener noreferrer">{zh ? '查看依据' : 'View source'}<ArrowUpRight size={11} aria-hidden="true" /></a>}</p>
    {operation.input_note_zh && <p className="source-contract-input-note">{zh ? operation.input_note_zh : operation.input_note_zh}</p>}
    {unknown ? <p className="source-contract-input-empty">{zh ? '尚不能确认参数名或必填数量。' : 'Parameter names and required count are not confirmed.'}</p>
      : fields.length === 0 ? <p className="source-contract-input-empty">{zh ? '无调用参数。' : 'No call parameters.'}</p>
      : <div className="source-contract-input-list">{fields.map(field => <div className="source-contract-input-field" key={field.name} title={zh ? field.description_en || '' : ''}>
        <div><strong title={field.name}>{zh ? field.label_zh : field.name}</strong><span className={field.required ? 'required' : ''}>{zh ? field.required ? '必填' : '可选' : field.required ? 'Required' : 'Optional'}</span></div>
        <code>{field.name}</code>
        {field.default !== undefined && <small>{zh ? '默认/预设：' : 'Default/preset: '}{field.default}</small>}
        {field.accepted_values && <small>{zh ? '可用值：' : 'Accepted: '}{field.accepted_values}</small>}
        {field.condition_zh && <small>{field.condition_zh}</small>}
        {!zh && field.description_en && <small>{field.description_en}</small>}
      </div>)}</div>}
  </section>;
}

function guidance(field) {
  if (field.use_case_zh) return field.use_case_zh;
  const path = field.path;
  if (/(^|\.)(id|symbol|address|username|user_id|chat_id|guid|link)$/i.test(path))
    return '先确认对象身份，再与其他来源的记录关联。';
  if (/(time|date|timestamp|updated|created|pubDate)/i.test(path))
    return '核对观察时间与统计窗口，再做时间序列比较。';
  if (/(price|rate|ratio|change|volume|share|count|rank|interest|cap|liquidity)/i.test(path))
    return '按相同对象和时间窗口比较，结合其他字段检验变化。';
  return field.purpose_zh || '先确认此字段在返回对象中的含义，再决定关联或计算方式。';
}

export function SourceContractFields({ data, language }) {
  if (!data) return null;
  const zh = language === 'zh-CN';
  const entries = data.operations || (data.operation ? [data.operation] : data.resource ? [data.resource] : []);
  return <section className="source-contracts" aria-label={zh ? '上游字段' : 'Upstream fields'}>
    <div className="source-contract-origin">
      <span>{zh ? '数据来源' : 'Source'}</span>
      <a href={data.source.authority_url} target="_blank" rel="noopener noreferrer">{zh ? data.source.label_zh : data.source.id}<ArrowUpRight size={13} aria-hidden="true" /></a>
    </div>
    {entries.map(operation => <div className="source-contract-operation" key={operation.id}>
      <div className="source-contract-operation-head">
        <strong>{zh ? operation.label_zh : operation.id}</strong>
        <a href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{zh ? '官方说明' : 'Documentation'}<ArrowUpRight size={13} aria-hidden="true" /></a>
      </div>
      <div className="source-contract-meta"><span>{operation.uri ? (zh ? '资源 ID' : 'Resource ID') : (zh ? '操作 ID' : 'Operation ID')}</span><code>{operation.id}</code></div>
      <div className="source-contract-endpoint"><span>{operation.uri ? (zh ? 'MCP 资源' : 'MCP resource') : operation.endpoint.startsWith('mcp://') ? 'MCP' : operation.endpoint.startsWith('/') ? 'GET' : '来源'}</span><code>{operation.uri || operation.endpoint}</code></div>
      <InputFields operation={operation} zh={zh} />
      <div className="source-contract-io-heading"><strong>{zh ? '返回字段' : 'Response fields'}</strong><span>{zh ? `${operation.fields.length} 个已列字段` : `${operation.fields.length} listed fields`}</span></div>
      {operation.uri ? <p className="section-help">{zh ? operation.purpose_zh : 'Reference list used to resolve supported identifiers before querying Kaito.'}</p>
        : <p className="section-help">{zh ? coverage[operation.response_coverage] || operation.response_coverage : operation.response_coverage}{zh && operation.note_zh ? `。${operation.note_zh}` : ''}</p>}
      {operation.fields.length ? <div className="kaito-tool-fields">{operation.fields.map(field => <SourceFieldCard
        key={field.path} name={zh ? field.label_zh : field.path} path={field.path}
        purpose={field.purpose_zh} useCase={zh ? guidance(field) : field.path}
        exampleValue={field.example_value} showNullValue={field.evidence === 'api_sample'}
        observed={field.evidence === 'mcp_sample'}
        exampleLabel={field.evidence === 'mcp_sample' ? (zh ? 'MCP 响应样本' : 'MCP sample') :
          field.evidence === 'api_sample' ? (zh ? 'API 响应样本' : 'API sample') : undefined}
        exampleStatus={field.evidence === 'official_documentation' ? 'unavailable' : undefined}
        exampleUrl={operation.sample_url || operation.documentation_url}
        language={language} />)}</div>
        : <p className="section-help">{operation.uri
          ? (zh ? operation.note_zh : 'The documentation says this resource needs no authentication. Its response has not been checked, so no fields are inferred.')
          : (zh ? '尚无经过核对的上游字段；需要第一方接口或返回样本。' : 'No verified upstream fields yet.')}</p>}
    </div>)}
  </section>;
}
