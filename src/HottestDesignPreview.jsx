import React, { useSyncExternalStore } from 'react';
import spec from '../catalog/coingecko-hottest.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { hottestCard, hottestCases, hottestExample } from './hottestDesign';

let selected='normal';
const listeners=new Set();
const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
const select=key=>{selected=key;listeners.forEach(f=>f());};
const text=v=>v===null?'NULL':typeof v==='object'?JSON.stringify(v):typeof v==='number'?String(Number(v.toPrecision(8))):String(v);
const context=['observation_id','asset_id','source_id','source_object_id','quote_currency','coverage_key','requested_at','total_volume'];
function Values({rows,fields,zh}) {
  if(!rows.length)return <p>{zh?'0条设计输出；不是线上空表。':'No design output; not evidence of empty live storage.'}</p>;
  return rows.map((r,i)=><dl className="source-case-inspector-fields" key={i}>{fields.map((f,j)=><div key={f}><dt><span className="source-case-field-number">{String(j+1).padStart(2,'0')}</span><code>{f}</code></dt><dd><code>{r[f]===undefined?(zh?'设计缺口':'Design gap'):text(r[f])}</code>{r[f]===null&&<small> · {zh?'不可用或本例不适用；参见状态与规则。':'Unavailable or not applicable; see status and rules.'}</small>}</dd></div>)}</dl>);
}
export function HottestDesignPreview({node,graph,language,openNode}) {
  const key=useSyncExternalStore(subscribe,()=>selected,()=>selected),c=hottestExample(key),entry=hottestCard(node),zh=language==='zh-CN';
  if(!entry)return null;
  const link=name=>{const n=graph.nodes.find(n=>n.name===name);return n?<button type="button" onClick={()=>openNode(n.id)}>#{n.reference_number} {n.name}</button>:<code>{name}</code>;};
  const schema={primary_key:['asset_id'],columns:entry.fields.map(f=>({name:f.name,label_zh:zh?f.label_zh:f.name}))};
  const group=(title,source,rows,fields)=><section className="source-case-inspector-section"><h3>{title}</h3>{source&&link(source)}<Values rows={rows} fields={fields} zh={zh}/></section>;
  const baselineOutput={...c.focus,...c.baseline};
  const output=entry.key==='baseline'?[baselineOutput]:entry.key==='rvol'?[c.focus]:entry.key==='candidates'?c.current:c.batch.rows;
  const inputFields=['asset_name','total_volume','market_cap','volume_to_market_cap','rvol_7d','abs_price_pct','rvol_7d_status'];
  return <section className="coingecko-design-preview" data-hottest-preview={entry.key}>
    <label className="source-case-inspector-picker">{zh?'交易最热榜 · 贯通设计案例':'Trading heat · through-line design case'}
      <select aria-label={zh?'最热榜设计案例':'Hottest design case'} value={key} onChange={e=>select(e.target.value)}>{hottestCases.map(([id,cn,en])=><option key={id} value={id}>{zh?cn:en}</option>)}</select>
    </label>
    <p className="card-detail-provenance">{zh?'纯虚构输入与演算 · 六个假设币，不是真实行情或已写入榜单。打开卡片不采集、不加分、不执行后台。':'Synthetic inputs and pure evaluation · six fictional assets, not observed markets or stored ranks. Opening the card does not collect, award or execute.'}</p>
    {['baseline','rvol'].includes(entry.key)?<>
      <p>{zh?'以下基线与RVOL示例聚焦假设币A；排名卡使用完整六币样本。':'Baseline and RVOL focus on Example A; ranking uses the full six-asset cohort.'}</p>
      <div className="source-case-inspector processing-io-case">
        <div>{group(zh?'输入 · 当前观测':'Input · current observation','Polars · 计算 CoinGecko 量价指标',[c.focus],context)}
          {entry.key==='baseline'?group(zh?'输入 · 7个历史日目标':'Input · seven historical targets','coingecko_market_history',c.histories[0],['observation_id','requested_at','collected_at','total_volume','source_object_id','coverage_key']):group(zh?'输入 · 基线结果':'Input · baseline result','Polars · 计算7日成交额基线',[c.baseline],spec.cards[0].output_fields)}</div>
        {group(zh?'输出 · 计算结果':'Output · calculated result',null,output,entry.output_fields)}
      </div>
    </>:<>
      {entry.key==='rank'&&<section className="source-case-inspector-section"><h3>{zh?'输入 · 同批完整候选':'Input · frozen candidate cohort'}</h3>{link('CoinGecko · 最热榜候选快照')}
        <BusinessTableRows table={{primary_key:['asset_id'],columns:inputFields.map(name=>({name,label_zh:name}))}} rows={c.current} language={language}/>
        <p>{zh?'本例覆盖状态：':'Example coverage: '}<code>{key==='partial'?'partial':'healthy'}</code> · {link('leaderboard_coverage')}</p>
      </section>}
      <h3>{zh?entry.key==='candidates'?'保存的候选 · 设计值':'输出 · 排名设计值':entry.key==='candidates'?'Candidate state · design values':'Output · designed ranks'}</h3>
      <BusinessTableRows table={entry.key==='rank'?{primary_key:['asset_id'],columns:schema.columns.filter(f=>['rank','asset_name','score','direction','reason'].includes(f.name))}:schema} rows={output} language={language}/>
      {entry.key==='rank'&&<details className="processing-advanced"><summary>{zh?'完整输出字段与追溯记录':'Complete output fields and lineage'}</summary><BusinessTableRows table={schema} rows={output} language={language}/></details>}
      <p>{zh?'批次状态':'Batch status'}: <code>{c.batch.status}</code> · <code>{c.batch.reason||'complete'}</code> · N={c.batch.sample_count}</p>
      {c.batch.excluded.length>0&&<p>{zh?'未入榜及原因：':'Excluded and reasons: '}<code>{JSON.stringify(c.batch.excluded)}</code></p>}
    </>}
    {['rank','result'].includes(entry.key)&&<>
      <h3>{zh?'分数怎么算出来 · 以本例第一名为例':'Score derivation · first ranked asset'}</h3>
      {c.batch.rows.length?<><p>{c.batch.rows[0].asset_name} · <strong>{c.batch.rows[0].score.toFixed(6)}</strong></p>
        <BusinessTableRows table={{primary_key:['metric'],columns:['metric','value','log1p','z_raw','z_clipped','weight','contribution','status'].map(name=>({name,label_zh:name}))}}
          rows={Object.entries(c.batch.rows[0].score_components_json).map(([metric,r])=>({metric,...r}))} language={language}/></>:<p>{zh?'本例没有可发布排名，不制造第一名。':'No publishable ranks in this case; no fabricated first place.'}</p>}
      <details className="processing-advanced"><summary>{zh?'本批中位数、MAD和尺度':'Batch medians, MAD and scales'}</summary>
        <BusinessTableRows table={{primary_key:['metric'],columns:['metric','median','mad','scale','status'].map(name=>({name,label_zh:name}))}} rows={Object.entries(c.batch.normalization_json).map(([metric,n])=>({metric,...n}))} language={language}/>
      </details>
    </>}
    {['result','candidates'].includes(entry.key)&&<p>{zh?entry.algorithm_zh:entry.algorithm_en}</p>}
    <details className="processing-advanced"><summary>{zh?'其他设置 · 算法与数据契约':'Other settings · algorithm and data contract'}</summary>
      <p>{zh?entry.trigger_zh:'Execution is a planned contract only; no runtime binding is established.'}</p>
      {['baseline','rvol'].includes(entry.key)&&<><p>{zh?'所属模块':'Owning module'} {link('Polars · 计算 CoinGecko 量价指标')}</p><p>{zh?'Polars计算方式：同一程序内先匹配7个有效日目标，再计算均值及比值；缺失值保持null。':'Polars expression: select seven valid daily targets before calculating mean and ratio; missing values stay null.'}</p></>}
      <p>{zh?'先ln(1+x)，再稳健Z，截断至−3/+3；分数允许为负，不是概率。':'Apply log1p, robust Z, clip to −3/+3. Scores can be negative and are not probabilities.'}</p>
      <p>{zh?'成交额单位USD，换手率用小数，价格涨跌用百分数点。MAD尺度≤1e−12记0并显示退化；全部退化不可发布。':'Units: USD volume, fractional turnover, percentage-point price moves. Scale ≤1e−12 contributes zero and is flagged; all-degenerate batches cannot publish.'}</p>
      <p>{zh?'v2才支持7日RVOL；旧提醒/评分明确兼容v1/v2，不改旧事件。不额外设置市值/成交额门槛；本版未增加稳定币分类排除。':'Only v2 supplies seven-day RVOL. Legacy alert/scoring adapters accept v1/v2 without changing old events. No extra size gates or stablecoin classification exclusions.'}</p>
      <pre>{JSON.stringify(spec.parameters,null,2)}</pre>
      <p>{zh?spec.limitations_zh:'Studio design and synthetic evaluation only. Live historical coverage, consumer adaptation, physical storage and ranking quality remain unverified.'}</p>
      <a href={spec.rationale_url} target="_blank" rel="noreferrer">SS-95</a>
    </details>
  </section>;
}
