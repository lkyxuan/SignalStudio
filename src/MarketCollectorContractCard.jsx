import React, {useState} from 'react';
import spec from '../catalog/market-collector-routing.v1.json';
import './source-case-inspector.css';
import './stocks-design.css';

export const collectorRoutingCard = node => [5004,3035,3041].includes(node.reference_number) && Boolean(node.card_contract?.config.resource?.collector_routing_contract);
const display = value => value === undefined ? '—' : value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value);
const get = (obj,path) => path.split('.').reduce((value,key)=>value?.[key],obj);
const provenanceFirst = rows => {
  const order=['meta.collector_id','collector_id','meta.collection_scope','collection_scope','meta.operation_id','source_id','meta.round_id','round_id','meta.source_run_id','run_id','meta.source_observation_id','observation_id','meta.coverage_key','coverage_key'];
  const rank = key => { const index=order.indexOf(key); return index<0?order.length:index; };
  return [...rows].sort((a,b)=>rank(a[0])-rank(b[0]));
};
function Fields({rows}) {
  return <dl className="source-case-inspector-fields">{rows.map(([path,value],i)=><div key={path}><dt><span className="source-case-field-number">{String(i+1).padStart(2,'0')}</span><code>{path}</code></dt><dd>{display(value)}</dd></div>)}</dl>;
}
function MessageFields({message}) {
  return <Fields rows={provenanceFirst(spec.fields.map(field=>[field.path,get(message,field.path)]))}/>;
}
export function CollectorPublisherContract({node,graph,language,openNode}) {
  const producer=spec.producers.find(item=>item.reference===node.reference_number);
  if(!producer || !node.card_contract?.config.resource?.collector_routing_contract) return null;
  const zh=language==='zh-CN',example=spec.examples.find(item=>item.reference===producer.reference).message;
  const target=graph.nodes.find(item=>item.reference_number===5004);
  return <section className="collector-publisher-contract">
    <h3>{zh?'爬虫采集后如何发布':'How the collector publishes after collection'}</h3>
    <p>{zh?'下面是采集器附加的发布合同，不是CoinGecko接口原生返回。字段生成规则见Topic卡。':'Collector-added publication metadata, not native CoinGecko response fields. See the Topic card for generation rules.'}</p>
    <Fields rows={spec.fields.filter(f=>f.owner==='collector').map(field=>[field.path,get(example,field.path)])}/>
    <p>{zh?producer.note_zh:producer.note_en}</p>
    <p className="card-detail-provenance">{zh?'假设消息格式，不是实际发送记录；原始调用成功/失败证据仍以上方为准。':'Hypothetical message format, not an emitted record. Observed API status remains separate above.'}</p>
    {target&&<button type="button" onClick={()=>openNode(target.id)}>#5004 market.snapshot · {zh?'两路消息、Headers与字段规则':'Both producers, Headers and field rules'}</button>}
  </section>;
}
export function MarketCollectorContractCard({node,graph,language,openNode}) {
  const zh=language==='zh-CN',ref=node.reference_number;
  const [selected,setSelected]=useState(2051);
  const producer=spec.producers.find(p=>p.reference===selected),raw=spec.examples.find(e=>e.reference===selected).message;
  const normalized=Object.fromEntries(spec.fields.map(field=>[field.normalized,get(raw,field.path)]));
  const result={...normalized,asset_id:null,identity_status:'source_only',metric_version:'market_indicators_v2',
    volume_to_market_cap:raw.total_volume/raw.market_cap,abs_price_pct:Math.abs(raw.price_change_percentage_24h),rvol_7d:null,rvol_7d_status:'missing_history'};
  const text=(a,b)=>zh?a:b;
  const open=number=>{const target=graph.nodes.find(n=>n.reference_number===number);if(target)openNode(target.id);};
  const rules=spec[zh?'rules_zh':'rules_en'];
  return <section className="collector-routing-card" aria-label={text('两路行情消息合同','Two-collector market contract')}>
    <p className="card-detail-provenance">{text('已批准的字段设计 · 以下全部是假设消息，不是爬虫运行或已写入证据。','Approved field design · all messages below are hypothetical, not collector execution or persisted data.')}</p>
    {ref===5004 ? <>
      <h3>{text('共用Topic：market.snapshot','Shared Topic: market.snapshot')}</h3>
      <p>{text('Message Key取稳定coin ID（id）；Value根层是一条代币行情，meta保存采集出处。两路共用接口语义与Header，靠meta.collector_id区分采集任务。','Key = stable coin ID (id). Value is one market record at the root, with provenance in meta. Headers route the same API semantics; meta.collector_id distinguishes collector tasks.')}</p>
      <h4>Headers</h4><Fields rows={Object.entries(spec.headers)}/>
      <p>{text('这些是本合同要求复用的兼容路由值；Few注册及真实发送未核验。它们不区分2010/2051，也不是Stocks筛选标签。','Required compatible route values; Few registration and actual emission remain unverified. Headers neither distinguish these collectors nor define Stocks membership.')}</p>
      <div className="source-case-inspector">
        {spec.examples.map(example=><section className="source-case-inspector-section" key={example.reference}>
          <h3>#{example.reference} {example.reference===2010?text('默认行情任务','Default-market task'):text('股票代币任务','Stock-token task')}</h3>
          <button type="button" onClick={()=>open(example.reference)}>{text('查看爬虫来源卡','Open collector source')}</button>
          <MessageFields message={example.message}/>
        </section>)}
        <section className="source-case-inspector-explanation source-case-inspector-purpose"><h3>{text('同一个代币，两份采集出处','One token, two collection origins')}</h3><p>{text('这里故意用同一个假设coin ID展示重叠发现：operation_id相同，collector_id、运行ID、观测ID和coverage_key不同；round_id相同。2010也可能发现股票代币，不能把“来自2010”当成“不是股票”。','The same fictional coin deliberately demonstrates overlap: shared operation_id and round_id, distinct collector/run/observation IDs and coverage_key. Collector 2010 can also discover stock tokens; its origin does not prove an asset is not a stock token.')}</p></section>
      </div>
      <h4>{text('订阅、留存与运行边界','Subscriptions, retention and runtime boundary')}</h4><p>{text('沿用现有独立消费者；同一Polars程序读取两路。当前消息保留期、真实归档绑定、生产者/消费者部署未核验，本批不创建Topic或新消费组。','Retain existing independent consumers; the shared Polars program reads both producers. Retention, archival binding and deployed producers/consumers remain unverified. No Topic or consumer group is created.')}</p>
    </> : <>
      <label className="source-case-inspector-picker">{text('选择假设来源','Hypothetical collector')} <select aria-label={text('选择行情采集任务','Select market collector')} value={selected} onChange={e=>setSelected(Number(e.target.value))}>{spec.producers.map(p=><option key={p.reference} value={p.reference}>#{p.reference} · {p.name}</option>)}</select></label>
      <div className="source-case-inspector processing-io-case">
        <section className="source-case-inspector-section"><h3>{text('输入 · 本步骤使用的字段','Input · fields used by this step')}</h3>
          <button type="button" onClick={()=>open(ref===3035?5004:3035)}>#{ref===3035?5004:3035} {ref===3035?'market.snapshot':'Polars'}</button>
          <Fields rows={provenanceFirst(ref===3035?spec.fields.map(field=>[field.path,get(raw,field.path)]):Object.entries({...normalized,asset_id:null,identity_status:'source_only'}))}/>
          {ref===3041&&<p>{text('同一程序内各子指标的假设结果：涨幅12%、绝对涨幅12、成交额市值比0.15；缺历史的RVOL保持null。','Hypothetical child results in the same program: price change 12%, absolute change 12, turnover 0.15; RVOL remains null without history.')}</p>}
        </section>
        <section className="source-case-inspector-section"><h3>{text('输出 · 规范化与追溯字段','Output · normalized data and provenance')}</h3>
          <Fields rows={provenanceFirst(Object.entries(ref===3035?{...normalized,asset_id:null,identity_status:'source_only'}:result))}/>
          <p>{text('仅列本合同使用/新增或需要说明的字段；既有指标完整结构、metric_id及版本规则仍沿用原合同，不因这张示例省略而删除。','Focused fields used/added by this contract; the full metric schema, metric_id and version rules remain unchanged despite omissions in this example.')}</p>
        </section>
      </div>
      <h3>{text('何时运行','When it runs')}</h3><p>{text('由现有Polars消费者接到本轮行情触发；这是同一程序的入口/汇总步骤，不为2010和2051另起两套引擎。这里只展示设计，不启动执行。','The existing Polars consumer handles current-round records. Entry and assembly are steps inside one program, not separate engines per collector. This inspector does not execute them.')}</p>
      <h3>{text('怎么处理','How it works')}</h3><p>{ref===3035?text('先校验任务/范围/轮次与质量，再按规范来源和稳定coin ID查询已有资产身份。按coverage_key选择本范围历史，共用指标函数计算；不串用两路历史补RVOL。未知身份保留source_only与空UUID。','Validate provenance and quality, resolve existing identity by canonical source and stable coin ID, then select history within the coverage_key and reuse metric functions. Do not fill Stocks RVOL from another scope; retain source_only and null UUID for unknown identity.'):text('按同一observation_id汇总子指标，并核对任务、轮次、范围和身份快照一致。把collector_id、round_id、collection_scope、coverage_ref随指标带到5007；不按空asset_id合并不同代币。缺失指标保留null。','Assemble by observation_id and verify collector, round, scope and identity consistency. Carry collector_id, round_id, collection_scope and coverage_ref to 5007; never join unrelated tokens on null asset_id. Preserve missing metrics as null.')}</p>
      <p>{zh?producer.note_zh:producer.note_en}</p>
    </>}
    <section><h3>{text('完整、重复与失败怎么判断','Completeness, duplicates and failures')}</h3>{rules.slice(2,9).map((rule,i)=><p key={i}>{rule}</p>)}<p>{text(spec.overlap_rules_zh,'Conflicting shared quote fields under the same semantic event key are quarantined; optional unrequested fields are excluded from this comparison. Publication retries still freeze the entire original message.')}</p></section>
    <details className="processing-advanced"><summary>{text('其他设置 · 完整字段与覆盖报告定义','Other settings · full field and coverage-report definitions')}</summary>
      <h4>{text('消息字段 · 必填键，缺值依nullable规则','Message fields · required keys, nullability explicit')}</h4>
      <Fields rows={spec.fields.map(field=>[field.path,`${field.type}${field.nullable?' | null':''} · ${field.owner} · ${field[zh?'rule_zh':'rule_en']}`])}/>
      <h4>{text('#1014采集轮次覆盖报告 · 逻辑设计','Collector-run coverage report in #1014 · logical design')}</h4>
      <Fields rows={spec.coverage_fields.map(field=>[field.path,`${field.type} · ${field[zh?'rule_zh':'rule_en']}`])}/>
      {rules.map((rule,i)=><p key={i}>{i+1}. {rule}</p>)}
      <a href={spec.rationale_url} target="_blank" rel="noreferrer">SS-139</a>
    </details>
  </section>;
}
