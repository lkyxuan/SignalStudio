import React, { useState } from 'react';
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
  page_observation_lower_bound: '实际网页显示的列；不是底层 API 契约',
};

const inputCoverage = {
  official_documentation: ['官方接口文档', 'Official API documentation'],
  live_mcp_input_schema: ['Kaito 在线 MCP tools/list（2026-09-28）', 'Live Kaito MCP tools/list (2026-09-28)'],
  official_mcp_resource: ['MCP 资源说明', 'MCP resource documentation'],
  design_input: ['本产品的采集输入设计', 'Product ingestion design'],
  unverified: ['输入契约待核对', 'Input contract not verified'],
  live_page_controls: ['Taoli 实际网页筛选控件（2026-09-28）', 'Observed Taoli page controls (2026-09-28)'],
};

function InputFields({ operation, zh }) {
  const fields = operation.inputs || [];
  const unknown = operation.input_coverage === 'unverified';
  const pageControls = operation.input_coverage === 'live_page_controls';
  const required = fields.filter(field => field.required).length;
  const optional = fields.length - required;
  const source = inputCoverage[operation.input_coverage] || inputCoverage.unverified;
  return <section className="source-contract-inputs" aria-label={zh ? '接口参数定义' : 'API parameter definitions'}>
    <div className="source-contract-io-heading">
      <strong>{zh ? pageControls ? '页面筛选控件' : '接口参数定义' : pageControls ? 'Page filters' : 'API parameter definitions'}</strong>
      <span>{unknown ? (zh ? '数量未知' : 'Count unknown') : zh ? `${required} 必填 · ${optional} 可省略` : `${required} required · ${optional} optional`}</span>
    </div>
    <p className="source-contract-input-note">{pageControls ? (zh ? '这里只列本次观察到的网页控件；上方案例显示当时实际采用的筛选值。' : 'These are observed page controls. The example above shows the active filters.') : (zh ? '这里只说明接口允许哪些参数；上方案例中的值才是实际发送的输入。' : 'These are allowed parameters. Only the values in the observed call above were sent.')}</p>
    <p className="source-contract-evidence">{zh ? source[0] : source[1]}{operation.input_source_url && <a href={operation.input_source_url} target="_blank" rel="noopener noreferrer">{zh ? '查看依据' : 'View source'}<ArrowUpRight size={11} aria-hidden="true" /></a>}</p>
    {operation.input_note_zh && <p className="source-contract-input-note">{zh ? operation.input_note_zh : operation.input_note_zh}</p>}
    {unknown ? <p className="source-contract-input-empty">{zh ? '尚不能确认参数名或必填数量。' : 'Parameter names and required count are not confirmed.'}</p>
      : fields.length === 0 ? <p className="source-contract-input-empty">{zh ? '无调用参数。' : 'No call parameters.'}</p>
      : <div className="source-contract-input-list">{fields.map(field => <div className="source-contract-input-field" key={field.name} title={zh ? field.description_en || '' : ''}>
        <div><strong title={field.name}>{zh ? field.label_zh : field.name}</strong><span className={field.required ? 'required' : ''}>{zh ? field.required ? '必填' : '可省略' : field.required ? 'Required' : 'Optional'}</span></div>
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

function fieldExampleValue(operation, field) {
  const response = operation.call_examples?.[0]?.response;
  const name = field.path.replace(/\[date\]$/, '');
  return response && Object.prototype.hasOwnProperty.call(response, name) &&
    (response[name] === null || typeof response[name] !== 'object')
    ? response[name] : field.example_value;
}

function CallPreview({ operation, zh }) {
  const [selectedExample, setSelectedExample] = useState(0);
  const examples = operation.call_examples || [];
  const example = examples[selectedExample];
  if (!example) return <section className="source-call-preview source-call-preview-empty" aria-label={zh ? '实际调用案例' : 'Observed call example'}>
    <strong>{zh ? '暂缺实际调用案例' : 'No observed call yet'}</strong>
    <p>{zh ? operation.call_status_note_zh || '目前没有保存同一次请求与返回的实测记录，因此这里不展示推测的输入或返回。' : operation.call_status_note_en || 'No verified request and response from the same call have been saved for this operation.'}</p>
  </section>;
  const inputs = Object.entries(example.request || {});
  const outputs = example.response && !Array.isArray(example.response) ? Object.entries(example.response) : [];
  const series = example.daily_series || [];
  const pageObservation = example.evidence === 'live_page_observation';
  return <section className="source-call-preview" aria-label={zh ? '输入与返回速览' : 'Input and response preview'}>
    <div className="source-call-preview-head"><strong>{zh ? pageObservation ? '实际网页案例' : '实际调用案例' : pageObservation ? 'Observed page example' : 'Observed call example'}</strong><span>{zh ? pageObservation ? '左右来自同一次页面观察' : '左右来自同一次调用' : pageObservation ? 'Same page observation' : 'Same live call'}</span></div>
    {examples.length > 1 && <div className="source-call-preview-tabs" role="group" aria-label={zh ? pageObservation ? '切换实际网页案例' : '切换实际调用案例' : pageObservation ? 'Switch observed page examples' : 'Switch observed calls'}>
      {examples.map((item, index) => <button type="button" key={item.observed_at} aria-pressed={selectedExample === index} onClick={() => setSelectedExample(index)}>{zh ? item.case_label_zh || `案例 ${index + 1}` : item.case_label_en || `Call ${index + 1}`}</button>)}
    </div>}
    <div className={`source-call-preview-grid${series.length ? ' has-series' : ''}`}>
      <div className="source-call-preview-side">
        <h4>{zh ? pageObservation ? '实际筛选条件' : '实际传入' : pageObservation ? 'Active page filters' : 'Actual input'} <small>{zh ? pageObservation ? '页面所用' : '已发送' : pageObservation ? 'On page' : 'Sent'}</small></h4>
        {inputs.length ? <dl>{inputs.map(([name, value]) => <div key={name}><dt><code>{name}</code></dt><dd><code>{JSON.stringify(value)}</code></dd></div>)}</dl> : <p>{zh ? '这次未传参数（空对象）' : 'No parameters were sent ({})'}</p>}
      </div>
      <div className="source-call-preview-side">
        <h4>{zh ? pageObservation ? '页面实见结果' : '实际返回' : pageObservation ? 'Observed page row' : 'Actual response'} <small>{pageObservation ? (zh ? '表格中的一行' : 'One table row') : series.length ? (zh ? `全部 ${series.length} 天` : `All ${series.length} days`) : example.result_count > 1 ? (zh ? `首条 / 共 ${example.result_count} 条` : `First of ${example.result_count}`) : example.result_count === 0 ? (zh ? '0 条' : '0 results') : (zh ? '返回节选' : 'Response excerpt')}</small></h4>
        {series.length ? <div className="source-call-preview-series">{series.map(row => <div key={row.date}>
          <strong>{row.date}</strong>
          {Object.entries(row).filter(([name]) => name !== 'date').map(([name, value]) => <span key={name}><small>{name === 'total_engagement' ? (zh ? '总' : 'Total') : name === 'smart_engagement' ? (zh ? '高质' : 'Smart') : name}</small> {value}</span>)}
        </div>)}</div> : outputs.length ? <dl>{outputs.map(([name, value]) => <div key={name}><dt><code>{name}</code></dt><dd><code>{JSON.stringify(value)}</code></dd></div>)}</dl> : <p>{Array.isArray(example.response) && example.response.length === 0 ? (zh ? '返回空列表（0 条）' : 'Empty list (0 results)') : (zh ? '此次返回没有可展示的字段' : 'No displayable fields in this response')}</p>}
      </div>
    </div>
    <div className="source-call-preview-meaning"><strong>{zh ? '这次查到了什么' : 'What this call returned'}</strong>
      <p>{zh ? example.explanation_zh || example.response_note_zh : example.explanation_en || 'The left side shows the actual request. The right side shows its response.'}</p>
    </div>
  </section>;
}

export function SourceContractFields({ data, language }) {
  if (!data) return null;
  const zh = language === 'zh-CN';
  const entries = data.operations || (data.operation ? [data.operation] : data.resource ? [data.resource] : []);
  return <section className="source-contracts" aria-label={zh ? '上游字段' : 'Upstream fields'}>
    {entries.map(operation => <div className="source-contract-operation" key={operation.id}>
      <div className="source-contract-operation-head">
        <strong>{zh ? operation.label_zh : operation.id}</strong>
        <a href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{zh ? '官方说明' : 'Documentation'}<ArrowUpRight size={13} aria-hidden="true" /></a>
      </div>
      <CallPreview key={operation.id} operation={operation} zh={zh} />
      <details className="source-contract-all-fields"><summary>{zh ? `查看字段定义与接口信息（${(operation.inputs || []).length} 项输入 / ${operation.fields.length} 项返回）` : `Field definitions and API details (${(operation.inputs || []).length} inputs / ${operation.fields.length} outputs)`}</summary>
        <div className="source-contract-origin"><span>{zh ? '数据来源' : 'Source'}</span><a href={data.source.authority_url} target="_blank" rel="noopener noreferrer">{zh ? data.source.label_zh : data.source.id}<ArrowUpRight size={13} aria-hidden="true" /></a></div>
        <div className="source-contract-meta"><span>{operation.uri ? (zh ? '资源 ID' : 'Resource ID') : (zh ? '操作 ID' : 'Operation ID')}</span><code>{operation.id}</code></div>
        <div className="source-contract-endpoint"><span>{operation.uri ? (zh ? 'MCP 资源' : 'MCP resource') : operation.endpoint.startsWith('mcp://') ? 'MCP' : operation.endpoint.startsWith('/') ? 'GET' : '来源'}</span><code>{operation.uri || operation.endpoint}</code></div>
        <InputFields operation={operation} zh={zh} />
        <div className="source-contract-io-heading"><strong>{zh ? '返回字段' : 'Response fields'}</strong><span>{zh ? `${operation.fields.length} 个已列字段` : `${operation.fields.length} listed fields`}</span></div>
        <p className="section-help">{operation.uri ? (zh ? operation.note_zh : 'The response has not been checked.') : (zh ? coverage[operation.response_coverage] || operation.response_coverage : operation.response_coverage)}{!operation.uri && zh && operation.note_zh ? `。${operation.note_zh}` : ''}</p>
        {operation.fields.length ? <div className="kaito-tool-fields">{operation.fields.map((field, index) => <SourceFieldCard
        key={field.path} number={index + 1} name={zh ? field.label_zh : field.path} path={field.path}
        purpose={field.purpose_zh} useCase={zh ? guidance(field) : field.path}
        exampleValue={fieldExampleValue(operation, field)} showNullValue={field.evidence === 'api_sample'}
        observed={field.evidence === 'mcp_sample' || field.evidence === 'live_page_observation'}
        exampleLabel={field.evidence === 'mcp_sample' ? (zh ? 'MCP 响应样本' : 'MCP sample') :
          field.evidence === 'api_sample' ? (zh ? 'API 响应样本' : 'API sample') :
          field.evidence === 'live_page_observation' ? (zh ? '网页观察值' : 'Observed page value') : undefined}
        exampleStatus={field.evidence === 'official_documentation' ? 'unavailable' : undefined}
        exampleUrl={operation.sample_url || operation.documentation_url}
        language={language} />)}</div>
          : <p className="section-help">{operation.uri
          ? (zh ? operation.note_zh : 'The documentation says this resource needs no authentication. Its response has not been checked, so no fields are inferred.')
          : (zh ? '尚无经过核对的上游字段；需要第一方接口或返回样本。' : 'No verified upstream fields yet.')}</p>}
      </details>
    </div>)}
  </section>;
}
