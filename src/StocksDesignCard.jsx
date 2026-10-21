import React, { useState } from 'react';
import spec from '../catalog/coingecko-stocks.v1.json';
import evidence from '../catalog/coingecko-stocks-observed.v1.json';
import './stocks-design.css';
import './source-case-inspector.css';

export function stocksCard(node) {
  const key = node.card_contract?.config.resource?.stocks_key;
  return spec.cards.find(c => c.key === key && c.name === node.name && c.kind === node.kind);
}
const valueText = value => value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
function RecordFields({ entries }) {
  return <dl className="source-case-inspector-fields">{entries.map(([key,value],index)=><div key={key}>
    <dt><span className="source-case-field-number">{String(index+1).padStart(2,'0')}</span><code>{key}</code></dt>
    <dd>{valueText(value)}</dd>
  </div>)}</dl>;
}
function Rows({ value, zh }) {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const [selected, select] = useState(0);
  const row = rows[Math.min(selected, Math.max(0, rows.length-1))];
  return <>
    {rows.length > 1 && <label>{zh?'选择返回记录':'Returned row'} <select aria-label={zh?'选择返回记录':'Select returned row'} value={selected} onChange={e=>select(Number(e.target.value))}>{rows.map((r,i)=><option key={i} value={i}>{r.name || r.id || i+1}</option>)}</select></label>}
    {row && typeof row === 'object' && !Array.isArray(row) ? <RecordFields entries={Object.entries(row)}/> : <pre>{JSON.stringify(value,null,2)}</pre>}
    <details><summary>{zh?'查看保存的完整响应／片段':'Saved response / excerpt'}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>
  </>;
}
export function StocksDesignCard({node,language}) {
  const card=stocksCard(node), zh=language==='zh-CN';
  const operation=spec.operations.find(o=>o.key===card.key), sample=evidence.cases[card.key];
  const policy=spec.policy;
  const observed=sample?.status==='observed';
  return <div className="stocks-design">
    <p className="card-detail-provenance">{zh?'Stocks 爬虫来源设计 · 上游接口样本另列 · 爬虫运行未核验':'Stocks crawler source design · upstream API samples separate · collector runtime unverified'}</p>
    {operation ? <>
      <div className="source-case-inspector" aria-label={zh?'爬虫请求与返回':'Crawler request and response'}>
      <section className="source-case-inspector-section"><h3>{zh?'输入 · 上游请求参数':'Input · upstream request parameters'}</h3>
        <p>{zh?'来源：CoinGecko HTTP API，由这张爬虫卡发起请求。':'Source: CoinGecko HTTP API, requested by this crawler card.'}</p>
        <p><code>GET {operation.endpoint}</code> <a href={operation.documentation_url} target="_blank" rel="noreferrer">{zh?'官方说明':'Documentation'}</a></p>
        <RecordFields entries={Object.entries(sample?.request || operation.sample_request || {})}/>
        <p>{observed ? sample.url : zh?'以上为查询设计或失败请求，不能当作成功调用案例。':'Query design or failed request, not a successful observed call.'}</p>
      </section>
      <section className="source-case-inspector-section"><h3>{zh?'输出 · 接口返回记录':'Output · API response record'}</h3>
        {sample && <p>{sample.observed_at} · {sample.status} {sample.http_status || ''}</p>}
        {observed ? <><p>{sample.response_excerpt ? (zh?`本次返回 ${sample.response_count} 条，保存前 ${sample.response.length} 条；不是全量数据。`:`Returned ${sample.response_count} rows; saved ${sample.response.length}, not full coverage.`) : zh?'保存本次完整返回；不代表完整市场覆盖。':'Complete response for this request, not full market coverage.'}</p><Rows key={node.id} value={sample.response} zh={zh}/></>
          : <><p>{zh?'本次没有取得成功的行情返回。以下只列文档设计字段，不是数据库表行或真实采集结果。':'No successful market response was captured. The following are documented fields, not database rows or collected records.'}</p>
            <RecordFields entries={operation.fields.map(field=>[field.path,zh?`${field.label_zh} · 未取得返回值`:`${field.type} · no observed value`])}/>
          </>}
        {observed && sample.response?.tokens?.length > 0 && <><h4>{zh?'本次返回的发行商代币版本':'Issuer-token versions in this response'}</h4><Rows value={sample.response.tokens} zh={zh}/></>}
      </section>
      <section className="source-case-inspector-explanation source-case-inspector-purpose">
        <h3>{zh?'这张爬虫卡做什么':'What this crawler source does'}</h3>
        <p>{zh?card.purpose_zh:card.purpose_en}</p>
        <h3>{zh?'这次调用到了哪一步':'What this call reached'}</h3>
        <p>{observed ? zh?'已保存上游接口返回；这不是爬虫持续运行或下游落库证据。':'An upstream response is saved; it does not establish continuous collection or downstream persistence.' : zh?'已保存的请求未成功取得数据；没有可解读的行情记录，也没有下游落库证据。':'The saved request did not obtain data; no market record or downstream persistence is observed.'}</p>
        {!observed && (sample?.note || sample?.response) && <p>{valueText(sample.note || sample.response)}</p>}
        {card.key==='token_markets' && <><h3>{zh?'采集结果交给哪里':'Where collected results go'}</h3><p>{zh?'设计：按 coin ID 输出原始行情到 #5004 market.snapshot，再由归档程序保存历史、#3035 Polars 计算指标。#2051 是爬虫来源，不是数据库，也不直接发布 indicator.data。':'Design: emit raw per-coin observations to #5004 market.snapshot, then archive history and calculate metrics in #3035 Polars. #2051 is a crawler source, not a database; it does not publish directly to indicator.data.'}</p></>}
      </section>
      </div>
    </> : <>
      <section><h3>{zh?'输入与输出 · 设计定义':'Input and output · design definition'}</h3><p>{zh?card.purpose_zh:card.purpose_en}</p>
        <p>{zh?'输入与去向见数据流向；以下字段是接口/存储设计，没有真实爬虫表行。':'See data-flow connections for inputs/destinations. Fields below describe interfaces/storage, not observed crawler rows.'}</p>
        <div className="stocks-horizontal"><table><thead><tr>{card.fields.map(f=><th key={f.path}>{f.path}</th>)}</tr></thead><tbody><tr><td colSpan={card.fields.length}>{zh?'物理存储未绑定 · 无爬虫运行样本':'No physical storage binding or crawler observations'}</td></tr></tbody></table></div>
      </section>
      {card.kind==='process' && <section><h3>{zh?'何时运行':'When it runs'}</h3><p>{zh?'由所属 Stocks 采集轮次驱动；具体频率待额度核验。当前不调度或执行。':'Driven by a Stocks collection round; cadence awaits quota validation. No execution or scheduling.'}</p><h3>{zh?'怎么处理':'How it works'}</h3><p>{zh?card.purpose_zh:card.purpose_en}</p></section>}
    </>}
    <section><h3>{zh?'范围与数据口径':'Scope and meaning'}</h3><p>{zh?policy.scope_zh:policy.scope_en}</p><p>{zh?policy.limits_zh:policy.limits_en}</p></section>
    <details className="processing-advanced"><summary>{zh?'采集设置、字段与证据':'Collection settings, fields and evidence'}</summary>
      <p>{zh?policy.collection_zh:policy.collection_en}</p><p>{zh?policy.identity_zh:policy.identity_en}</p><p>{zh?policy.history_zh:policy.history_en}</p>
      <p>{zh?'当前样本与全量数量证据':'Sample and inventory evidence'}：{JSON.stringify(spec.verification)}</p>
      {operation && <><h4>{zh?'官方参数定义':'Documented parameters'}</h4><dl>{operation.inputs.map(f=><div key={f.name}><dt><code>{f.name}</code> · {f.required?'required':'optional'} · {f.location}</dt><dd>{f.description}<pre>{JSON.stringify(f.schema,null,2)}</pre></dd></div>)}</dl><p>{operation.notes}</p><p>{operation.documentation_checked_at} · SHA256 {operation.documentation_sha256}</p></>}
      <h4>{zh?'字段定义 · 不等于已采集字段':'Field definitions · not collected-field evidence'}</h4>
      <dl>{(operation?.fields || card.fields).map(f=><div key={f.path}><dt><code>{f.path}</code> · {f.type}{f.nullable?' | null':''}</dt><dd>{zh?f.label_zh:f.path} {f.description}</dd></div>)}</dl>
      {sample?.response_sha256 && <p>Response SHA256: {sample.response_sha256}</p>}
    </details>
  </div>;
}
