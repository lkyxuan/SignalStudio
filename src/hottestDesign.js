// Pure, synthetic SS-95 evaluator. No network, persistence, score events or scheduling.
import spec from '../catalog/coingecko-hottest.v1.json';
export const weights = spec.parameters.weights;
const finite = (v, positive=false) => typeof v === 'number' && Number.isFinite(v) && (positive ? v>0 : v>=0);
const stamp = v => typeof v==='string' && /(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v)) ? Date.parse(v) : NaN;
export const median = values => {const a=[...values].sort((x,y)=>x-y);const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;};
export function baseline7d(current, history) {
  const result={baseline_mean_volume_7d:null,baseline_days_7d:0,baseline_refs_7d_json:[],rvol_7d:null,rvol_7d_status:'invalid_context'};
  const anchor=stamp(current.requested_at), context=['source_id','source_object_id','quote_currency','coverage_key'];
  if(!Number.isFinite(anchor)||!context.every(k=>current[k])||current.quote_currency!=='usd')return result;
  const used=new Set();
  for(let day=1;day<=7;day++) {
    const target=anchor-day*86400000;
    const valid=history.filter(r=>context.every(k=>r[k]===current[k])&&r.quality_status==='healthy'&&finite(r.total_volume)&&r.observation_id&&!used.has(r.observation_id)
      &&stamp(r.observed_at)<=stamp(r.collected_at)&&stamp(r.requested_at)<=stamp(r.collected_at)&&stamp(r.collected_at)<=target
      &&stamp(r.requested_at)<=target&&stamp(r.requested_at)>=target-1800000);
    if(!valid.length)continue;
    const seen=new Map();
    for(const r of valid){const signature=JSON.stringify([...context,'requested_at','collected_at','observed_at','total_volume'].map(k=>r[k]));if(seen.has(r.observation_id)&&seen.get(r.observation_id)!==signature){result.rvol_7d_status='conflicting_history';return result;}seen.set(r.observation_id,signature);}
    valid.sort((a,b)=>stamp(b.requested_at)-stamp(a.requested_at)||a.observation_id.localeCompare(b.observation_id));
    const chosen=valid[0];used.add(chosen.observation_id);
    result.baseline_refs_7d_json.push({day,target_at:new Date(target).toISOString(),observation_id:chosen.observation_id,requested_at:chosen.requested_at,collected_at:chosen.collected_at,total_volume:chosen.total_volume});
  }
  result.baseline_days_7d=used.size;
  if(used.size!==7){result.rvol_7d_status='missing_history';return result;}
  const mean=result.baseline_refs_7d_json.reduce((s,r)=>s+r.total_volume/7,0);
  if(!finite(mean,true)){result.rvol_7d_status='zero_baseline';return result;}
  result.baseline_mean_volume_7d=mean;
  if(!finite(current.total_volume)){result.rvol_7d_status='invalid_current_volume';return result;}
  const ratio=current.total_volume/mean;
  if(!finite(ratio)){result.rvol_7d_status='nonfinite_rvol';return result;}
  return {...result,rvol_7d:ratio,rvol_7d_status:'complete'};
}
export function normalize(values) {
  const transformed=values.map(Math.log1p),center=median(transformed),mad=median(transformed.map(v=>Math.abs(v-center))),scale=1.4826*mad;
  const degenerate=scale<=spec.parameters.scale_epsilon;
  const raw=transformed.map(v=>degenerate?0:(v-center)/scale);
  if(!raw.every(Number.isFinite))throw new Error('nonfinite normalization');
  return {median:center,mad,scale,status:degenerate?'normalization_degenerate':'ok',transformed,z_raw:raw,z_clipped:raw.map(v=>Math.max(-3,Math.min(3,v)))};
}
export const rvolAvailable = row => row.rvol_7d_status==='complete' && row.baseline_days_7d===7 && finite(row.rvol_7d) && finite(row.baseline_mean_volume_7d,true);
export function normalizeOptional(values) {
  const valid=values.filter(v=>v!==null);
  const stats=valid.length?normalize(valid):{median:null,mad:null,scale:null,status:'unavailable',transformed:[],z_raw:[],z_clipped:[]};
  const arrays={transformed:[],z_raw:[],z_clipped:[]};let cursor=0;
  for(const value of values){for(const key of Object.keys(arrays))arrays[key].push(value===null?(key==='transformed'?null:0):stats[key][cursor]);if(value!==null)cursor++;}
  return {...stats,...arrays};
}
export function rankHottest(rows,calculatedAt,coverage='healthy') {
  const now=stamp(calculatedAt),context=['source_id','source_object_id','quote_currency','coverage_key'];
  const result={algorithm_version:spec.version,calculated_at:calculatedAt,status:'unavailable',rows:[],excluded:[],sample_count:0,rvol_warmup:false,normalization_json:{}};
  if(!Number.isFinite(now)||coverage!=='healthy')return {...result,reason:Number.isFinite(now)?'coverage_unavailable':'invalid_calculation_time'};
  const latest=new Map(),identities=new Map();
  for(const row of rows) {
    const requested=stamp(row.requested_at),collected=stamp(row.collected_at),observed=stamp(row.observed_at);
    let reason=null;
    if(row.identity_status!=='resolved'||!row.asset_id||row.object_kind!=='coin')reason='identity_unresolved';
    else if(row.metric_version!==spec.metric_version)reason='unsupported_metric_version';
    else if(row.quality_status!=='healthy'||row.quote_currency!=='usd'||!context.every(k=>row[k]))reason='invalid_quality_or_context';
    else if(!(requested<=collected&&collected<=now&&observed<=collected&&observed>=now-900000))reason='invalid_or_stale_time';
    else if(!finite(row.current_price,true)||!finite(row.market_cap,true)||!finite(row.total_volume)||!finite(row.abs_price_pct))reason='invalid_numeric';
    else if(!row.observation_id||!row.metric_id)reason='missing_observation_identity';
    if(reason){result.excluded.push({asset_id:row.asset_id??null,reason});continue;}
    const source=JSON.stringify([row.source_id,row.source_object_id]);
    if(identities.has(source)&&identities.get(source)!==row.asset_id)return {...result,reason:'conflicting_identity'};
    identities.set(source,row.asset_id);
    const old=latest.get(row.asset_id);
    if(old&&context.some(k=>old[k]!==row[k]))return {...result,reason:'conflicting_asset_source'};
    if(old&&old.observation_id===row.observation_id&&JSON.stringify(old)!==JSON.stringify(row))return {...result,reason:'conflicting_observation'};
    if(!old||requested>stamp(old.requested_at)||(requested===stamp(old.requested_at)&&row.observation_id>old.observation_id))latest.set(row.asset_id,{...row});
  }
  const selected=[];
  for(const row of [...latest.values()].sort((a,b)=>a.asset_id.localeCompare(b.asset_id))) {
    const turnover=row.total_volume/row.market_cap;
    if(!finite(turnover)){result.excluded.push({asset_id:row.asset_id,reason:'invalid_turnover'});continue;}
    selected.push({...row,rvol_7d:rvolAvailable(row)?row.rvol_7d:null,volume_to_market_cap:turnover});
  }
  result.sample_count=selected.length;
  if(!selected.length)return {...result,status:'success',reason:'empty_qualified_batch',excluded_count:result.excluded.length};
  result.rvol_warmup=selected.every(r=>r.rvol_7d===null);
  let stats;
  try{stats=Object.fromEntries(Object.keys(weights).map(k=>[k,normalizeOptional(selected.map(r=>r[k]))]));}catch{return {...result,reason:'nonfinite_normalization'};}
  result.normalization_json=Object.fromEntries(Object.entries(stats).map(([k,n])=>[k,{median:n.median,mad:n.mad,scale:n.scale,status:n.status}]));
  if(Object.values(stats).every(n=>n.status!=='ok'))return {...result,reason:'incomparable_batch'};
  const scored=selected.map((row,i)=>{
    const components=Object.fromEntries(Object.entries(stats).map(([k,n])=>[k,{value:row[k],log1p:n.transformed[i],z_raw:n.z_raw[i],z_clipped:n.z_clipped[i],weight:weights[k],contribution:weights[k]*n.z_clipped[i],status:row[k]===null?'unavailable_neutral':n.status}]));
    return {...row,rvol_warmup:result.rvol_warmup,score:Object.values(components).reduce((s,c)=>s+c.contribution,0),score_components_json:components,algorithm_version:spec.version,calculated_at:calculatedAt,direction:row.price_change_percentage_24h>0?'up':row.price_change_percentage_24h<0?'down':'flat'};
  }).sort((a,b)=>b.score-a.score||a.asset_id.localeCompare(b.asset_id));
  return {...result,status:'success',reason:null,excluded_count:result.excluded.length,rows:scored.slice(0,20).map((r,i)=>({...r,rank:i+1}))};
}
export const hottestCases=[['normal','完整7日 · 六币排序','Complete seven days · six assets'],['missing','缺一天历史','One historical day missing'],['warmup','全部缺历史 · 三项排序','All history missing · three metrics'],['one_valid','仅一币有历史','Only one valid RVOL'],['zero','当前成交额与涨跌为0','Zero current volume and move'],['baseline_zero','历史成交额全为0','Zero historical baseline'],['degenerate','MAD全部为0','All MAD scales zero'],['partial','采集覆盖不完整','Partial source coverage'],['stale','一币来源过期','One stale observation'],['empty','成功空批次','Successful empty batch']];
export function hottestExample(key='normal') {
  const calculatedAt='2026-10-13T00:05:00.000Z',anchor='2026-10-13T00:04:00.000Z';
  const inputs=[[30e6,100e6,12,10e6],[100e6,300e6,-18,20e6],[8e6,80e6,2,8e6],[500e6,20e9,-1,450e6],[1e6,15e6,0,2e6],[40e6,200e6,7,15e6]];
  const histories=[];
  const current=inputs.map(([volume,cap,change,base],i)=>{
    const at=new Date(Date.parse(anchor)-1200000).toISOString();
    const r={observation_id:`design:ss95:${key}:${i}`,asset_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,asset_name:`假设币 ${String.fromCharCode(65+i)} / Example ${String.fromCharCode(65+i)}`,identity_status:'resolved',object_kind:'coin',source_id:'coingecko.coins_markets',source_object_id:`design-coin-${i}`,quote_currency:'usd',coverage_key:'design:ss95:complete-universe',requested_at:anchor,collected_at:'2026-10-13T00:04:01.000Z',observed_at:anchor,quality_status:'healthy',total_volume:volume,current_price:2,market_cap:cap,volume_to_market_cap:volume/cap,abs_price_pct:Math.abs(change),price_change_percentage_24h:change,metric_id:`design:ss95:${key}:${i}/market_indicators_v2`,metric_version:spec.metric_version,snapshot_ref:`design:ss95:${key}:raw:${i}`};
    if(key==='zero'&&i===0)Object.assign(r,{total_volume:0,abs_price_pct:0,price_change_percentage_24h:0,volume_to_market_cap:0});
    if(key==='degenerate')Object.assign(r,{total_volume:10e6,market_cap:100e6,abs_price_pct:5,price_change_percentage_24h:5});
    if(key==='stale'&&i===0)r.observed_at=at;
    const history=Array.from({length:7},(_,j)=>{const target=Date.parse(anchor)-(j+1)*86400000;return {...r,observation_id:`design:ss95:history:${i}:${j}`,requested_at:new Date(target-60000).toISOString(),collected_at:new Date(target-59000).toISOString(),observed_at:new Date(target-60000).toISOString(),total_volume:key==='baseline_zero'&&i===0?0:key==='degenerate'?10e6:base};}).filter((_,j)=>!((key==='missing'&&i===0&&j===6)||key==='warmup'||(key==='one_valid'&&i!==0)));
    histories.push(history);return {...r,...baseline7d(r,history)};
  });
  const batch=rankHottest(key==='empty'?[]:current,calculatedAt,key==='partial'?'partial':'healthy');
  const focus=current[0];
  const rows=batch.rows.map(r=>({...r,object_key:`asset/${r.asset_id}`,calculation_status:'success',source_as_of:calculatedAt,snapshot_id:`design:ss95:${key}:batch`,sample_count:batch.sample_count,excluded_count:batch.excluded_count,excluded_reasons_json:batch.excluded,normalization_json:batch.normalization_json,reason:`RVOL ${r.rvol_7d===null?'—':`${r.rvol_7d.toFixed(2)}×`}; turnover ${(r.volume_to_market_cap*100).toFixed(2)}%; 24h ${r.price_change_percentage_24h}%`,observation_refs_json:[r.observation_id,...r.baseline_refs_7d_json.map(h=>h.observation_id)],trend_status:'trading_activity',run_id:`design:ss95:${key}:run`,window_label:'rolling_24h',window_start:null,window_end:null}));
  return {key,current: key==='empty'?[]:current,focus,histories,baseline:baseline7d(focus,histories[0]),batch:{...batch,rows},calculatedAt};
}
export const hottestCard = node => spec.cards.find(c=>c.key===node.card_contract?.config.resource?.hottest_key);
