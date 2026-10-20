import React, { useSyncExternalStore } from 'react';
import spec from '../catalog/coingecko-warming.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { warmingCard, warmingCases, warmingExample, warmingBaselineLabel } from './warmingDesign';

let selected='normal';
const listeners=new Set();
const subscribe=f=>{listeners.add(f);return()=>listeners.delete(f);};
export const selectWarmingCase=key=>{selected=key;listeners.forEach(f=>f());};
const rawColumns=['asset_name','total_volume','requested_at','observed_at','coverage_key'];
const statuses={accelerating:['增长加快','Accelerating'],steady:['增长速度稳定','Steady growth'],slowing:['增长放缓','Slowing'],unknown:['解释历史不足','Explanation unavailable']};
const labels={baseline_hours:['基准时长','Baseline history'],is_new:['新币','New asset'],asset_name:['币','Asset'],rank:['排名','Rank'],total_volume:['当前24h成交额 USD','Current 24h volume USD'],growth_1h:['近1h目标增长率','1h target growth'],warming_multiple:['7日常态倍数','Hourly baseline multiple'],growth_change_pp:['增长率变化（百分点）','Growth change (pp)'],growth_change_status:['是否进一步加快','Growth change'],price_direction:['24h价格方向','24h price direction'],hottest_overlap:['假设已在最热榜','Assumed hottest overlap'],warming_status:['指标状态','Metric status'],history_1h_volume:['1h目标24h成交额','1h target 24h volume'],history_2h_volume:['2h目标24h成交额','2h target 24h volume']};
const pretty=(r,zh)=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v===null?'—':k==='baseline_hours'?warmingBaselineLabel(v,zh):k==='is_new'?(v?(zh?'新币':'New asset'):'—'):k==='growth_1h'||k==='previous_growth_1h'?`${(v*100).toFixed(2)}%`:k==='warming_multiple'?`${v.toFixed(2)}×`:k==='growth_change_pp'?`${v>=0?'+':''}${v.toFixed(2)} pp`:k==='growth_change_status'?statuses[v]?.[zh?0:1]??v:typeof v==='number'?Number(v.toPrecision(8)):v]));
export function WarmingDesignPreview({node,graph,language,openNode}) {
  const selectedKey=useSyncExternalStore(subscribe,()=>selected,()=>selected);
  const key=node.kind==='table'?'normal':selectedKey,c=warmingExample(key),entry=warmingCard(node),zh=language==='zh-CN';
  if(!entry)return null;
  const link=name=>{const n=graph.nodes.find(n=>n.name===name);return n?<button type="button" onClick={()=>openNode(n.id)}>#{n.reference_number} {n.name}</button>:<code>{name}</code>;};
  const table=(rows,fields)=> <BusinessTableRows scrollRows table={{primary_key:['asset_id'],columns:fields.map(name=>({name,label_zh:labels[name]?.[zh?0:1]??name}))}} rows={rows.map(r=>pretty(r,zh))} language={language}/>;
  const outputs=entry.key==='baseline'?[{...c.focus,...c.baseline}]:entry.key==='candidates'?c.current:c.batch.rows;
  return <section className="coingecko-design-preview" data-warming-preview={entry.key}>
    {node.kind!=='table' && <label className="source-case-inspector-picker">{zh?'升温榜 · 贯通设计案例':'Warming · through-line design case'}
      <select aria-label={zh?'升温榜设计案例':'Warming design case'} value={key} onChange={e=>selectWarmingCase(e.target.value)}>{warmingCases.map(([id,cn,en])=><option key={id} value={id}>{zh?cn:en}</option>)}</select>
    </label>}
    <p className="card-detail-provenance">{zh?'纯虚构输入与演算 · 不是采集行情或已写入榜单。打开卡片不执行后台、评分或提醒。':'Synthetic inputs and evaluation · not observed markets or stored ranks. Opening the card runs no backend, score ledger or alerts.'}</p>
    {entry.key==='baseline'?<>
      <h3>{zh?'输入 · 请求观测与历史小时目标':'Input · request context and hourly targets'}</h3>
      {link('CoinGecko · 升温候选快照')}{table([c.focus],rawColumns)}
      {link('coingecko_market_history')}{table(c.baseline.warming_baseline_refs_json,['target_at','requested_at','collected_at','total_volume','observation_id'])}
      <h3>{zh?'输出 · 小时样本基准':'Output · hourly sample baseline'}</h3>
      {table(outputs,['warming_baseline_at','warming_baseline_mean_7d','baseline_hours','warming_baseline_status'])}
      <p>{zh?'每次请求重算：最近7天每个整点取前30分钟内最新健康样本，跳过最近75分钟，至少1条且均值>0。167条及以上按满一周显示；迟到数据仅影响后续计算，不改已发布快照。':'Recompute per request from hourly samples in the last seven days, excluding the latest 75 minutes. At least one sample and a positive mean; 167+ samples represent a full week. Published snapshots stay unchanged.'}</p>
    </>:entry.key==='candidates'?<>
      <h3>{zh?'输入来源 · 当前行情指标':'Input source · current market metrics'}</h3>{link('Few Understand · indicator.data')}
      <h3>{zh?'保存的候选 · 最新观测设计值':'Candidate state · latest designed observations'}</h3>{table(c.current,rawColumns)}
      <p>{zh?'由升温程序更新和冻结一轮候选；此处没有真实持久化数据。':'The warming program owns candidate updates and round freezing; no live persisted data is shown.'}</p>
    </>:<>
      {entry.key==='rank'&&<>
        <h3>{zh?'输入 · 当前量、基准与近期历史':'Input · current volume, baseline and recent history'}</h3>
        {link('CoinGecko · 升温候选快照')}{link('CoinGecko · 计算升温小时基准')}{link('coingecko_market_history')}
        {table(c.batch.candidates,['asset_name','total_volume','history_1h_volume','history_2h_volume','warming_multiple','growth_1h','growth_change_status','warming_status'])}
        <p>{zh?'本例覆盖：':'Example coverage: '}<code>{key==='partial'?'partial':'healthy'}</code> · {link('leaderboard_coverage')}</p>
      </>}
      <h3>{zh?'输出 · 按增长速度排名':'Output · ranked by growth rate'}</h3>
      {table(c.batch.rows.map(r=>({...r,hottest_overlap:c.hottestAssetIds.includes(r.asset_id)?zh?'是':'Yes':zh?'否':'No'})),['rank','asset_name','growth_1h','warming_multiple','growth_change_status','growth_change_pp','price_direction','baseline_hours','is_new','hottest_overlap'])}
      <p>{zh?'“新币”按资产档案建档时间距请求不足7天标记；照常排名，不单独排、不加分。':'New assets were registered less than seven days before the request; no ranking bonus or separate board.'}</p>
      <p>{zh?'“已在最热榜”是本例假设：A、B已有最热名次，用于说明双榜允许重叠；最热结果不作为升温的计算输入。':'Hottest overlap is assumed for A/B in this synthetic case, illustrating allowed overlap. Hottest results are not a warming calculation input.'}</p>
      <p>{zh?'批次状态':'Batch status'}: <code>{c.batch.status}</code> · <code>{c.batch.reason??'complete'}</code> · N={c.batch.sample_count}</p>
      {c.batch.warming_warmup&&<p className="card-detail-provenance">{zh?'升温预热 · 基准或1h比较历史不足，暂不排名':'Warming up · baseline or 1h history unavailable; no ranks'}</p>}
      {c.batch.excluded.length>0&&<p>{zh?'未入榜及原因：':'Not ranked and reasons: '}<code>{JSON.stringify(c.batch.excluded)}</code></p>}
      <h3>{zh?'怎么算 · 以假设币A为例':'Derivation · Example A'}</h3>
      <p>{zh?'常态倍数 R = 当前24h成交额 ÷ 最近7天可用小时均值；增长率 G = 当前24h成交额 ÷ 1h前24h成交额 − 1。R>1且G>0才入榜。':'Baseline multiple R = current 24h volume / available hourly mean over the last seven days. Growth G = current 24h volume / 1h historical 24h volume − 1. Require R>1 and G>0.'}</p>
      {table([c.metrics],['warming_baseline_mean_7d','history_1h_volume','history_2h_volume','warming_multiple','growth_1h','previous_growth_1h','growth_change_pp','growth_change_status'])}
      <p>{zh?'增长加快 =（本段增长率 − 前段增长率）×100，单位百分点；仅作解释，不参与排序。100→120→144两段都是20%，仍可升温；缺2h历史仍可排名。历史目标允许最多15分钟采样偏差，实际时间保留在完整引用中。':'Growth change = (current growth − previous growth) ×100 percentage points. Explanation only, never a ranking weight. 100→120→144 remains eligible at steady 20% growth; missing 2h history does not exclude it. Historical samples allow at most 15-minute target skew; actual times remain in the references.'}</p>
    </>}
    <details className="processing-advanced"><summary>{zh?'完整输出字段与追溯':'Complete output fields and lineage'}</summary>{table(outputs,entry.fields.map(f=>f.name))}</details>
    <details className="processing-advanced"><summary>{zh?'其他设置 · 规则、触发与限制':'Other settings · rules, trigger and limits'}</summary>
      <p>{zh?entry.algorithm_zh:entry.algorithm_en}</p><p>{zh?entry.trigger_zh:'One calculation per complete healthy crawler round; baseline is recomputed per request. No separate hourly scheduler.'}</p>
      <p>{zh?'主排序：增长率降序 → 常态倍数降序 → asset_id升序；最多50名，不凑榜，不排除最热币。':'Order by growth descending, baseline multiple descending, then asset ID ascending. At most 50; no padding or hottest exclusions.'}</p>
      <p>{zh?'比较的是滚动24h成交额变化，不能还原新增1h/4h成交额，不能证明巨鲸或内幕。24h价格方向单独展示。连续在榜是一段持续状态；再入榜与事件扩散另行定义。':'Rolling-24h changes cannot reconstruct new 1h/4h volume or prove whales or insider trades. Show 24h price direction separately. Continuous membership is one state; reentry and event diffusion remain separate work.'}</p>
      <pre>{JSON.stringify(spec.parameters,null,2)}</pre><p>{zh?spec.limitations_zh:'Studio design only. Live consumers, physical storage, historical coverage, long-tail coverage and predictive quality remain unverified.'}</p>
      <a href={spec.rationale_url} target="_blank" rel="noreferrer">SS-102</a>
    </details>
  </section>;
}
