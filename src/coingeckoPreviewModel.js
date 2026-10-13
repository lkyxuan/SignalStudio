// Deterministic design cases. Reading a card never calls a business service.
import fixture from '../catalog/coingecko-design-preview.v1.json';
import candidateContracts from '../catalog/signal-contracts.v1.json';
import scoring from '../catalog/market-scoring.v1.json';
import signals from '../catalog/coingecko-indicator-signals.v1.json';
import business from '../catalog/business-tables.v1.json';
import { baseline7d } from './hottestDesign';
import { previewTrending } from './coingeckoTrendingDesign';

export const designCases = fixture.cases;
export const previewRefs = [1001,1002,1005,1006,1007,1013,1014,1020,1021,1022,2010,2039,3001,3005,3006,3007,3008,3009,3010,3011,3012,3013,3014,3015,3016,3028,3032,3033,3034,3035,3036,3037,3038,3039,3040,3041,3042,3043,5001,5004,5005,5006,5007,6001];
export const hasCoinGeckoPreview = node => previewRefs.includes(node.reference_number);
const shift = (stamp, minutes) => new Date(Date.parse(stamp) + minutes * 60000).toISOString();
const pick = (row, keys) => Object.fromEntries(keys.map(key => [key, row[key]]));
const tier = (rule, value) => value == null ? 0 : Math.max(0, ...rule.tiers.filter(([minimum]) => value >= minimum).map(([,points]) => points));
export const nullReason = (name, language) => ['rvol_7d','baseline_mean_volume_7d'].includes(name) ? (language==='zh-CN'?'7日历史不完整或均值无效；只影响新RVOL，不补零。':'Seven-day history is incomplete or its mean invalid; only new RVOL is unavailable, without zero filling.') : fixture.null_reasons[name]?.[language === 'zh-CN' ? 0 : 1];
export function previewColumns(node, graph) {
  const table = business.tables[node.name];
  return table ? table.columns.map(c => c.name) : graph.fields.filter(f => f.node_id === node.id).sort((a,b) => a.ordinal-b.ordinal).map(f => f.name);
}

export function buildCoinGeckoCase(key = 'up') {
  const sample = designCases.find(c => c.key === key);
  if (!sample) throw new Error(`Unknown design case: ${key}`);
  const offset = sample.offset_minutes || 0;
  const at = name => shift(fixture[name], offset);
  const resolved = sample.identity === 'resolved';
  const valid = resolved || sample.identity === 'source_only';
  const asset = resolved ? fixture.asset_id : null;
  const observation = `design:ss83:${key}:observation`;
  const run = `design:ss83:${key}:run`;
  const snapshot = `design:ss83:${key}:snapshot`;
  const coverage = 'design:ss83:coingecko:usd:universe-v1';
  const price = 2;
  const ath = price / (1 + sample.ath_pct / 100);
  const oldPrice = price / (1 + sample.price_pct / 100);
  const raw = {
    id: fixture.coin_id, symbol: fixture.symbol, name: fixture.asset_name,
    image: 'https://example.invalid/design-coin.png', current_price: price,
    market_cap: 100000000, market_cap_rank: 500, fully_diluted_valuation: 200000000,
    total_volume: sample.volume, high_24h: Math.max(price, oldPrice) + .1,
    low_24h: Math.min(price, oldPrice) - .1, price_change_24h: price-oldPrice,
    price_change_percentage_24h: sample.price_pct, market_cap_change_24h: (price-oldPrice)*50000000,
    market_cap_change_percentage_24h: sample.price_pct, circulating_supply: 50000000,
    total_supply: 100000000, max_supply: null, ath, ath_change_percentage: sample.ath_pct,
    ath_date: '2026-09-01T00:00:00Z', atl: .5, atl_change_percentage: 300,
    atl_date: '2026-01-01T00:00:00Z', roi: null,
    last_updated: at('requested_at'), collected_at: at('collected_at'),
    'sparkline_in_7d.price': null, price_change_percentage_1h_in_currency: null,
    price_change_percentage_24h_in_currency: sample.price_pct,
    ...Object.fromEntries(['7d','14d','30d','200d','1y'].map(p => [`price_change_percentage_${p}_in_currency`,null])),
    'meta.operation_id': 'coingecko.coins_markets', 'meta.source_run_id': run,
    'meta.source_observation_id': observation, 'meta.collected_at': at('collected_at'),
    'meta.requested_at': at('requested_at'), 'meta.snapshot_ref': snapshot,
    'meta.quote_currency': 'usd', 'meta.coverage_key': coverage, 'meta.quality_status': 'healthy',
  };
  const shared = {
    observation_id: observation, object_key: `coingecko.coins_markets/${fixture.coin_id}`,
    asset_id: asset, asset_name: resolved ? fixture.asset_name : null,
    object_kind: resolved ? 'asset' : 'unknown', identity_status: sample.identity,
    source_id: 'coingecko.coins_markets', source_object_id: fixture.coin_id, source_name: fixture.asset_name,
    snapshot_ref: snapshot, run_id: run, window_label: null, window_start: null, window_end: null,
    observed_at: raw.last_updated, collected_at: raw.collected_at, requested_at: at('requested_at'),
    quality_status: 'healthy', coverage_key: coverage, current_price: price,
    price_change_percentage_24h: sample.price_pct, ath_change_percentage: sample.ath_pct,
    total_volume: sample.volume, market_cap: raw.market_cap, quote_currency: 'usd', symbol: fixture.symbol,
    metric_version: 'market_indicators_v2', slot_start: at('requested_at'),
  };
  const baseline = sample.baseline_volume == null ? null : {
    ...shared, observation_id: 'design:ss83:baseline:observation', snapshot_ref: 'design:ss83:baseline:snapshot',
    run_id: 'design:ss83:baseline:run', requested_at: fixture.baseline_requested_at,
    collected_at: fixture.baseline_collected_at, observed_at: fixture.baseline_requested_at,
    total_volume: sample.baseline_volume,
  };
  const metrics = {...shared, volume_to_market_cap: sample.volume/raw.market_cap,
    abs_price_pct: Math.abs(sample.price_pct), volume_ratio: baseline ? sample.volume/baseline.total_volume : null,
    baseline_observation_id: baseline?.observation_id ?? null,
    baseline_requested_at: baseline?.requested_at ?? null, baseline_volume: baseline?.total_volume ?? null,
    metric_id: `${observation}/market_indicators_v2`, calculated_at: at('calculated_at')};
  // Explicitly fictional seven-day inputs for the v2 extension; never infer observed coverage.
  const sevenDays = sample.baseline_volume == null ? [] : Array.from({length:7},(_,i)=>{
    const target=Date.parse(shared.requested_at)-(i+1)*86400000;
    return {...shared,observation_id:`design:ss95:${key}:day-${i+1}`,requested_at:new Date(target-60000).toISOString(),collected_at:new Date(target-59000).toISOString(),observed_at:new Date(target-60000).toISOString(),total_volume:sample.baseline_volume};
  });
  const extension=baseline7d(shared,sevenDays);
  Object.assign(shared,extension);Object.assign(metrics,extension);
  const coverageRow = {coverage_key:coverage, source_id:shared.source_id, run_id:run, snapshot_ref:snapshot,
    requested_at:shared.requested_at, completed_at:shared.collected_at, status:'healthy', baseline_status: key==='new'?'baseline':'tracking', record_count:1, reason:null};
  const mapping = {source_namespace:'coingecko_coin_id', external_identifier:fixture.coin_id, asset_id:fixture.asset_id};
  const assetRow = {asset_id:fixture.asset_id, name:fixture.asset_name, identity_status:'confirmed', asset_kind:'token',
    created_at:['new','next'].includes(key) ? '2026-10-13T00:00:04Z' : '2026-10-01T00:00:00Z'};
  const created = key === 'new';
  const creation = {...metrics, ...mapping, asset_name:fixture.asset_name, identity_status:'resolved',
    action:'created', decision_ref:`design:ss83:creation/${fixture.coin_id}`};
  const confidences = [Math.min(.95,.6+(Math.abs(sample.price_pct)-10)*.01), Math.min(.95,.6+(Math.abs(sample.price_pct)-10)*.01),
    Math.min(.95,Math.max(.6,.6+metrics.volume_to_market_cap-.2)), Math.min(.95,.7+(sample.ath_pct+5)*.02), Math.min(.95,.65+(-80-sample.ath_pct)*.015)];
  const triggered = [sample.price_pct>=10,sample.price_pct<=-10,metrics.volume_to_market_cap>=.2,sample.ath_pct>=-5,sample.ath_pct<=-80];
  const alertRows = signals.cards.map((card,i) => resolved && triggered[i] ? [{
    ...card.output, asset_id:asset, observed_at:shared.observed_at,
    confidence: Number(confidences[i].toFixed(3)), metric_id:metrics.metric_id, metric_version:metrics.metric_version,
    observation_id:observation, evidence:pick(metrics,card.input_fields),
  }] : []);
  const discovery = created ? [{signal_type:'new_asset_discovered',rule_id:'coingecko_discovery.trusted_source',rule_version:'1.0.0',
    asset_id:fixture.asset_id,risk_level:'info',confidence:.99,observed_at:shared.observed_at,
    evidence:pick(creation,['action','source_namespace','external_identifier','decision_ref','snapshot_ref']),
    metric_id:metrics.metric_id,metric_version:metrics.metric_version,observation_id:observation}] : [];
  const fullSignals = [...alertRows.flat(),...discovery].map(row => {
    const label = row.signal_type;
    return {...row, source:'coingecko', timestamp:shared.observed_at, strategy_id:row.signal_type==='new_asset_discovered'?'coingecko_discovery':'coingecko_market',
      signal_name:label, symbol:fixture.symbol,coin_id:fixture.coin_id,trigger_reason:`设计案例 ${key}: ${label}`,
      title:label,title_zh:`示例币 · ${label}`,title_en:`Example coin · ${label}`,
      summary:`设计预览 ${label}`,summary_zh:`设计预览 ${label}`,summary_en:`Design preview ${label}`,
      generated_at:at('accepted_at'),source_topic:'indicator.data',output_topic:'signal.data',
      schema_version:created?'coingecko-discovery-signal/v1':'coingecko-market-signal/v1',asset_type:'token',
      tradability_status:'unknown',name:created?fixture.asset_name:null};
  });
  const decisions = resolved ? scoring.rules.map(rule => ({asset_id:asset, asset_name:fixture.asset_name, score_key:scoring.scoring.score_key,
    score_delta:tier(rule,metrics[rule.metric]), decision_ref:`market_v1/${asset}/${rule.key}/${shared.slot_start.replace('.000Z','+00:00')}`,
    decay_policy_ref:`market_v1/${rule.key}`,half_life_minutes:rule.half_life_minutes,
    evidence_refs_json:[metrics.metric_id,observation,...(baseline?[baseline.observation_id]:[])]})).filter(r=>r.score_delta>0) : [];
  const events = decisions.map(row => ({...row,event_key:`design:ss83:event/${row.decision_ref}`,created_at:at('accepted_at')}));
  const elapsed = (Date.parse(at('projection_at'))-Date.parse(at('accepted_at')))/60000;
  const components = Object.fromEntries(scoring.rules.map(rule=>[rule.key,events.filter(e=>e.decay_policy_ref===`market_v1/${rule.key}`).reduce((sum,e)=>sum+e.score_delta*2**(-elapsed/e.half_life_minutes),0)]));
  const score = Object.values(components).reduce((sum,v)=>sum+v,0);
  const projection = {asset_id:asset,asset_name:fixture.asset_name,activity_score:score,
    score_components_json:components,score_event_refs_json:events.map(e=>e.event_key),calculated_at:at('projection_at'),
    algorithm_version:scoring.version,coverage_key:coverage,quality_status:'healthy',input_records_json:[metrics.metric_id]};
  const trendInput = {coin_id:fixture.coin_id,source_rank_zero_based:0,slot_start:fixture.requested_at,
    collected_at:fixture.collected_at,run_id:`design:ss83:${key}:trending-run`,snapshot_ref:`design:ss83:${key}:trending-snapshot`,
    listed:true,source_ok:true,identity:resolved?'unique':sample.identity==='conflict'?'conflict':'missing',asset_id:asset,asset_name:shared.asset_name};
  const trendResult = previewTrending(trendInput);
  const trendRaw = {coins:[{item:{id:fixture.coin_id,name:fixture.asset_name,symbol:fixture.symbol,score:0}}],
    slot_start:trendInput.slot_start,collected_at:trendInput.collected_at,run_id:trendInput.run_id,snapshot_ref:trendInput.snapshot_ref,
    request_started_at:trendInput.slot_start,status:'healthy'};
  const candidateContract = candidateContracts.signals[0];
  const candidate = {signal_key:candidateContract.signal_key,version:candidateContract.version,
    coin_id:fixture.coin_id,last_updated:raw.last_updated,total_volume_usd_24h:raw.total_volume,
    market_cap_usd:raw.market_cap,turnover_ratio_24h:metrics.volume_to_market_cap,
    source_observation_id:observation,source_run_id:run};
  const candidateMatches = candidateContract.processing.trigger.conditions.every(rule=>candidate[rule.field]>=rule.value);
  const synced = {asset_id:asset,asset_name:fixture.asset_name,score_key:'total_heat',score_value:score,
    calculated_at:at('projection_at'),source_version:1,synced_at:shift(at('projection_at'),1/60)};
  const rows = {
    3001:candidateMatches?[candidate]:[],3010:events.length?[synced]:[],1007:events.length?[synced]:[],
    2010:[raw],5004:[raw],1014:[coverageRow],3034:[shared],1013:[...(baseline?[baseline]:[]),shared],
    3035:[shared],3041:valid?[metrics]:[],5007:valid?[metrics]:[],3042:created?[metrics]:[],3043:created?[creation]:[],
    1001:valid?[assetRow]:[],1002:valid?[mapping]:[],1020:[],3009:[],
    5005:fullSignals,3016:discovery,3032:decisions,3006:events,5001:events,3007:events,6001:events,3008:events,1005:events,
    3033:events.length?[projection]:[],1021:events.length?[projection]:[],1022:events.length?[projection]:[],
    3005:events.length?[{asset_id:asset,asset_name:fixture.asset_name,score_key:'total_heat',score_value:score,calculated_at:at('projection_at')}]:[],
    1006:events.length?[{asset_id:asset,asset_name:fixture.asset_name,score_key:'total_heat',score_value:score,calculated_at:at('projection_at')}]:[],
    2039:[trendRaw],5006:[trendRaw],3028:trendResult.decision?[trendResult.decision]:[],
  };
  signals.cards.forEach((card,i)=>{rows[card.reference_number]=alertRows[i];});
  [3036,3037,3038,3039,3040].forEach(ref=>{rows[ref]=valid?[metrics]:[];});
  // History is archived without claiming it has been resolved by the metric module.
  if (!valid) { rows[3034]=[]; rows[1013]=[]; }
  if (valid) rows[1013]=[...(baseline?[baseline]:[]),shared];
  return {sample,raw,shared,metrics,baseline,creation,coverageRow,mapping,assetRow,decisions,events,rows,trendInput,elapsed,components,score};
}

// Focused fields, grouped by their actual producer; full records stay on source/storage cards.
export function previewInputs(ref, c) {
  const group = (source, rows, fields) => ({source, rows:rows.map(row=>pick(row,fields)), fields});
  const metricContext=['observation_id','asset_id'];
  if(ref===3001)return [group(5004,[c.raw],['id','last_updated','total_volume','market_cap','meta.source_observation_id','meta.source_run_id'])];
  if(ref===3010)return [group(1006,c.rows[1006],['asset_id','asset_name','score_key','score_value','calculated_at']),group(null,[{changed_asset:true,current_total_heat_rank:1,source_version:1}],['changed_asset','current_total_heat_rank','source_version'])];
  if(ref===2010) return [group(null,[{vs_currency:'usd',ids:fixture.coin_id,sparkline:false,price_change_percentage:'24h'}],['vs_currency','ids','sparkline','price_change_percentage'])];
  if(ref===2039) return [group(null,[{method:'GET',path:'/search/trending'}],['method','path'])];
  if(ref===3035) return [group(5004,[c.raw],['id','name','symbol','current_price','market_cap','total_volume','price_change_percentage_24h','ath_change_percentage','last_updated','meta.requested_at','meta.collected_at','meta.operation_id','meta.source_observation_id','meta.source_run_id','meta.snapshot_ref','meta.quote_currency','meta.coverage_key','meta.quality_status']),
    group(1002,c.sample.identity==='resolved'?[c.mapping]:[],['source_namespace','external_identifier','asset_id'])];
  const childFields={3036:['price_change_percentage_24h'],3037:['ath_change_percentage'],3038:['total_volume','market_cap'],3039:['price_change_percentage_24h'],3040:['total_volume','requested_at','source_id','source_object_id','quote_currency','coverage_key']};
  if(childFields[ref]) return [group(3035,[c.shared],[...childFields[ref],...metricContext]),...(ref===3040?[group(1013,c.baseline?[c.baseline]:[],['observation_id','asset_id','source_id','source_object_id','quote_currency','coverage_key','requested_at','collected_at','total_volume'])]:[])];
  if(ref===3041) return [group(3035,[c.shared],['observation_id','asset_id','identity_status','source_id','source_object_id']),
    ...[3036,3037,3038,3039,3040].map(source=>group(source,c.rows[source],source===3040?['observation_id','volume_ratio','baseline_observation_id','baseline_requested_at','baseline_volume']:['observation_id',({3036:'price_change_percentage_24h',3037:'ath_change_percentage',3038:'volume_to_market_cap',3039:'abs_price_pct'})[source]]))];
  const alert=signals.cards.find(card=>card.reference_number===ref);
  if(alert)return [group(5007,c.rows[5007],[...alert.input_fields,'asset_id','identity_status','metric_id','metric_version','observation_id','observed_at','quality_status','source_id','source_object_id','quote_currency','coverage_key','requested_at','collected_at','calculated_at'])];
  if(ref===3042)return [group(5007,c.rows[5007],['asset_id','identity_status','metric_id','source_id','source_object_id','quality_status'])];
  if(ref===3043)return [group(3042,c.rows[3042],['asset_id','identity_status','source_id','source_object_id','source_name','market_cap','metric_id','observation_id','snapshot_ref']),group(1002,[],['source_namespace','external_identifier','asset_id'])];
  if(ref===3016||ref===3009)return [group(3043,c.rows[3043],['action','asset_id','asset_name','source_id','source_object_id','decision_ref','metric_id','observation_id']),...(ref===3009?[group(1020,[],['source_id','initial_score','rule_version','half_life_minutes'])]:[])];
  if(ref===3032)return [group(5007,c.rows[5007],['asset_id','identity_status','total_volume','market_cap','current_price','volume_to_market_cap','abs_price_pct','volume_ratio','metric_id','slot_start','coverage_key']),group(1014,[c.coverageRow],['status','baseline_status','coverage_key','requested_at'])];
  if([3006,3007,3008,3005,3033].includes(ref))return [group(({3006:3032,3007:5001,3008:5001,3005:6001,3033:6001})[ref],ref===3006?c.decisions:c.events,['asset_id','asset_name','score_key','decision_ref','score_delta','decay_policy_ref','half_life_minutes',...(ref===3006?[]:['event_key','created_at'])])];
  if(ref===3034)return [group(5004,[c.raw],['id','name','symbol','current_price','market_cap','total_volume','price_change_percentage_24h','last_updated','meta.operation_id','meta.source_observation_id','meta.source_run_id','meta.requested_at','meta.collected_at','meta.snapshot_ref','meta.quote_currency','meta.coverage_key','meta.quality_status'])];
  if(ref===3028)return [group(5006,c.rows[5006],['coins','slot_start','collected_at','run_id','snapshot_ref','request_started_at','status']),group(1002,c.sample.identity==='resolved'?[c.mapping]:[],['source_namespace','external_identifier','asset_id'])];
  return [];
}
export function previewNote(ref,c,zh) {
  if(ref===3001)return zh?'独立行情候选分支：成交额/市值≥0.2、成交额≥100万USD、市值≥1000万USD才输出；阈值仍是未验证设计选择，无需内部UUID。不是已验证信号。':'Independent candidate branch: ratio ≥0.2, volume ≥USD1m and cap ≥USD10m. Unvalidated design thresholds; no internal UUID required. Not a validated signal.';
  if([3010,1007].includes(ref))return zh?'假设本资产分数发生变化、当前total_heat排名第1且同步成功，源版本为1。仅同步该变化资产；这不是实际Supabase写入。读取时仍须按源calculated_at执行180秒有效期过滤。':'Assume this changed asset ranks first in total_heat, source version 1, and sync succeeds. Only this changed asset is projected; no real Supabase write. Reads must apply 180-second freshness using source calculated_at.';
  if(ref===3009||ref===1020)return zh?'CoinGecko起始分未配置：查询返回0条匹配配置，保持待处理，不产生评分决定。已配置的Kaito规则见其他设置。':'CoinGecko has no initial-score configuration: pending, no score decision. Existing Kaito configuration is separate.';
  if(ref===3043)return c.sample.key==='new'?(zh?'假设权威复查无映射、可信来源准入通过且事务成功：创建UUID并原子写1001/1002。更新身份缓存，后续新观测使用UUID；原空UUID指标不改写。':'Assume no mapping, trusted-source admission and atomic writes succeed. Refresh the identity cache for subsequent observations; keep the original null-UUID metric.'):(zh?'本案例没有通过3042的新资产输入，不执行建档、不生成created。':'No new-asset input passed 3042; no creation.');
  if(ref===3042)return zh?'仅source_only且asset_id=null进入建档；已有UUID、查询失败和冲突均不进入。':'Only source_only with null asset_id enters creation; resolved, failed and conflicting lookups do not.';
  if(ref===3016)return zh?'只对成功created发一次发现通知；reused/pending/conflict/error不通知。':'Notify once for successful created; never for reused/pending/conflict/error.';
  if([1001,1002].includes(ref))return zh?'已有UUID案例假设这条映射已存在；首次无UUID案例展示3043事务成功后的目标行，不能反写原冻结指标。':'Resolved cases assume the mapping exists. The null-UUID case shows intended rows after creation, without rewriting frozen metrics.';
  if(ref===3040)return zh?'基线目标是请求时间前24小时，选目标前最近且≤30分钟、接收时间不晚于目标的同来源/coin ID/USD/覆盖记录；没有基线时输出null。':'Select a same-source/coin/USD/coverage baseline before the 24-hour target within 30 minutes, received no later than the target; otherwise null.';
  if([3032,3006,5001,3007,6001,3008,1005].includes(ref))return zh?'四项量价贡献走market_v1，取各项最高档；本案例仅首次有效槽、无重复决定。event_key和created_at为假设首次接受值，重试须复用。起始分与热榜+10不计入本行情案例。':'Highest tier per market rule, assuming a first eligible slot without duplicate decisions. Event keys and entry times are assumed first-acceptance values reused on retry. Initial and trending scores are excluded from this market case.';
  if([3005,1006,3033,1021,1022].includes(ref))return zh?`假设仅有本案例四项量价事件；入账后${c.elapsed}分钟计算，逐笔按半衰期衰减，合计${c.score.toFixed(6)}。无事件时不补零行。`:`Assume only this case's market events; project ${c.elapsed} minutes after acceptance, sum each decayed contribution: ${c.score.toFixed(6)}. No zero rows for eventless assets.`;
  if([2039,5006,3028].includes(ref))return zh?'独立热榜分支：假设前15名中的第1名，已唯一映射时+10，半衰期30分钟；没有唯一身份不建档、不加分。此分支未并入本行情评分事件。':'Separate trending branch: assume rank 1 of 15; unique identity earns +10 with a 30-minute half-life. Missing identity produces no creation or score. Excluded from the market events shown here.';
  if(c.sample.identity==='lookup_error'||c.sample.identity==='conflict')return zh?'身份失败/冲突停止此指标与建档分支；空输出表示本设计案例未产出记录，不能当成无映射或0分。':'Identity failure/conflict stops this metric and creation branch. Empty output is no designed record, never a missing mapping or zero score.';
  return zh?'固定假设输入，按当前契约演算；0条输出表示本案例未触发该步骤，不表示线上没有数据。字段复制与计算保持同一观测身份。':'Fixed hypothetical inputs evaluated under the current contract. Empty output means no record for this case, not empty live storage. Copied and calculated fields retain the same observation identity.';
}
