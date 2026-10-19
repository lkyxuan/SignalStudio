import React, { useState } from 'react';
import spec from '../catalog/coingecko-stocks.v1.json';
import evidence from '../catalog/coingecko-stocks-observed.v1.json';
import './stocks-design.css';

export function stocksCard(node) {
  const key = node.card_contract?.config.resource?.stocks_key;
  return spec.cards.find(c => c.key === key && c.name === node.name && c.kind === node.kind);
}
const valueText = value => value === undefined ? '—' : typeof value === 'string' ? value : JSON.stringify(value);
function Rows({ value, zh }) {
  const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const [selected, select] = useState(0);
  const row = rows[Math.min(selected, Math.max(0, rows.length-1))];
  return <>
    {rows.length > 1 && <label>{zh?'选择返回记录':'Returned row'} <select value={selected} onChange={e=>select(Number(e.target.value))}>{rows.map((r,i)=><option key={i} value={i}>{r.name || r.id || i+1}</option>)}</select></label>}
    {row && typeof row === 'object' && !Array.isArray(row) ? <div className="stocks-horizontal"><table><thead><tr>{Object.keys(row).map(k=><th key={k}>{k}</th>)}</tr></thead><tbody><tr>{Object.entries(row).map(([k,v])=><td key={k}>{v && typeof v === 'object' ? <details><summary>{Array.isArray(v)?`${v.length} ${zh?'项':'items'}`:zh?'展开对象':'Expand object'}</summary><pre>{JSON.stringify(v,null,2)}</pre></details>:valueText(v)}</td>)}</tr></tbody></table></div> : <pre>{JSON.stringify(value,null,2)}</pre>}
    <details><summary>{zh?'查看保存的完整响应／片段':'Saved response / excerpt'}</summary><pre>{JSON.stringify(value,null,2)}</pre></details>
  </>;
}
export function StocksDesignCard({node,language}) {
  const card=stocksCard(node), zh=language==='zh-CN';
  const operation=spec.operations.find(o=>o.key===card.key), sample=evidence.cases[card.key];
  const policy=spec.policy;
  const observed=sample?.status==='observed';
  return <div className="stocks-design">
    <p className="card-detail-provenance">{zh?'Stocks 独立爬虫设计 · 上游样本另列 · 后台采集未运行':'Stocks crawler design · upstream samples separate · no live collector'}</p>
    {operation ? <>
      <section><h3>{zh?'输入 · 同一次上游请求':'Input · paired upstream request'}</h3>
        <p><code>GET {operation.endpoint}</code> <a href={operation.documentation_url} target="_blank" rel="noreferrer">{zh?'官方说明':'Documentation'}</a></p>
        <pre>{JSON.stringify(sample?.request || operation.sample_request,null,2)}</pre>
        <p>{observed ? sample.url : zh?'以上为查询设计或失败请求，不能当作成功调用案例。':'Query design or failed request, not a successful observed call.'}</p>
      </section>
      <section><h3>{zh?'输出 · 上游响应':'Output · upstream response'}</h3>
        {sample && <p>{sample.observed_at} · {sample.status} {sample.http_status || ''}</p>}
        {observed ? <><p>{sample.response_excerpt ? (zh?`本次返回 ${sample.response_count} 条，保存前 ${sample.response.length} 条；不是全量数据。`:`Returned ${sample.response_count} rows; saved ${sample.response.length}, not full coverage.`) : zh?'保存本次完整返回；不代表完整市场覆盖。':'Complete response for this request, not full market coverage.'}</p><Rows key={node.id} value={sample.response} zh={zh}/></>
          : <p>{zh?'尚无本次成功返回；保留文档字段设计，权限／限流／请求失败见下方。':'No successful response captured; documented fields remain separate from access/rate-limit failures.'} {sample?.note || sample?.response || ''}</p>}
        <p>{zh?card.purpose_zh:card.purpose_en}</p>
        {observed && sample.response?.tokens?.length > 0 && <><h4>{zh?'本次返回的发行商代币版本':'Issuer-token versions in this response'}</h4><Rows value={sample.response.tokens} zh={zh}/></>}
      </section>
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
