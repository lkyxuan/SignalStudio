import type { LayoutNode, NodePosition } from './autoLayout';

// Reviewed reading groups (SS-99), not execution stages or inferred dependencies.
const specs = [
  { key: 'base', title: '共用底座 · 行情、历史与指标', titleEn: 'Shared market data, history and metrics', names: [
    'coingecko.coins_markets', 'Few Understand · market.snapshot', 'coingecko_market_history', '归档 CoinGecko 行情',
    'Polars · 计算 CoinGecko 量价指标', 'Polars · 整理24h涨跌幅', 'Polars · 整理ATH百分比',
    'Polars · 计算成交额市值比', 'Polars · 计算绝对24h涨跌幅', 'Polars · 计算相对昨日放量倍数',
    'Polars · 计算7日成交额基线', 'Polars · 计算7日相对放量RVOL', 'Polars · 汇总指标并发布', 'Few Understand · indicator.data',
  ] },
  { key: 'hottest', title: '交易最热 · 候选、排序与榜单', titleEn: 'Trading heat · candidates, ranking and board', names: ['CoinGecko · 最热榜候选快照', '生成基础最热榜', 'leaderboard_hottest'] },
  { key: 'alerts', title: '异动提醒 · 条件触发的信号', titleEn: 'Market alerts · condition-triggered signals', names: ['市场交易活跃候选', 'CoinGecko · 24 小时大涨', 'CoinGecko · 24 小时大跌', 'CoinGecko · 成交量市值比偏高', 'CoinGecko · 接近历史高点', 'CoinGecko · 较历史高点深度回撤', 'Few Understand · signal.data'] },
  { key: 'discovery', title: '新资产发现 · 多渠道共用榜', titleEn: 'Asset discovery · shared across sources', names: ['CoinGecko · 筛选无UUID资产', 'CoinGecko · 核实并建档', 'CoinGecko · 首次收录新资产', '确定资产起始评分', '生成最新UUID榜', 'leaderboard_new_uuid'] },
  { key: 'warming', title: '升温方向 · 原有评分支撑（新算法待做）', titleEn: 'Warming · legacy scores (new algorithm pending)', names: ['量价评分 · 生成贡献', '量价评分 · 汇总Redis记分', 'market_scores_current', 'market_score_history', 'leaderboard_warming'] },
  { key: 'support', title: '共用支撑 · 评分、身份与覆盖', titleEn: 'Shared scoring, identity and coverage', names: [] as string[] },
];
const supportNames = new Set(['assets', 'asset_identifiers', 'leaderboard_coverage', 'asset_initial_score_sources']);
export const coinGeckoOutputNames = new Set(['leaderboard_hottest', 'leaderboard_warming', '生成最新UUID榜', 'leaderboard_new_uuid']);
const groupKey = (n: LayoutNode) => specs.find(s => s.names.includes(n.name))?.key || 'support';
const order = (a: LayoutNode, b: LayoutNode) => (a.reference_number ?? Infinity) - (b.reference_number ?? Infinity) || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en');

// The supplied edges are already a presentation DAG. Each band retains its
// internal dependency order, including when an entire band has no internal edge.
export function coinGeckoProductLayout(nodes: LayoutNode[], links: {upstream_id: string; downstream_id: string}[]): NodePosition[] {
  const result: NodePosition[] = [];
  const place = (members: LayoutNode[], x: number, top: number) => {
    const ids = new Set(members.map(n => n.id));
    const edges = links.filter(e => ids.has(e.upstream_id) && ids.has(e.downstream_id));
    const rank = new Map(members.map(n => [n.id, 0]));
    for (let i = 0; i < members.length; i++) for (const e of edges)
      rank.set(e.downstream_id, Math.max(rank.get(e.downstream_id)!, rank.get(e.upstream_id)! + 1));
    let y = top;
    for (const r of [...new Set(rank.values())].sort((a, b) => a - b)) {
      const row = members.filter(n => rank.get(n.id) === r).sort(order);
      row.forEach((n, i) => result.push({id: n.id, position_x: x + i % 3 * 600, position_y: y + Math.floor(i / 3) * 256}));
      y += Math.ceil(row.length / 3) * 256;
    }
    return y;
  };
  const baseBottom = place(nodes.filter(n => groupKey(n) === 'base'), 0, 96);
  let x = 0;
  let productBottom = baseBottom;
  for (const spec of specs.slice(1, -1)) {
    const members = nodes.filter(n => groupKey(n) === spec.key);
    if (!members.length) continue;
    productBottom = Math.max(productBottom, place(members, x, baseBottom + 128));
    const width = Math.max(300, ...result.filter(p => members.some(n => n.id === p.id)).map(p => p.position_x - x + 300));
    x += width + 360;
  }
  // Keep shared identity inputs in the established left corridor. Other shared
  // scoring processors have a separate block below the product lines.
  const support = nodes.filter(n => groupKey(n) === 'support');
  support.filter(n => supportNames.has(n.name)).sort(order).forEach((n, i) => result.push({id:n.id, position_x:-960, position_y:96 + i * 256}));
  place(support.filter(n => !supportNames.has(n.name)), 0, productBottom + 128);
  return result;
}

export function coinGeckoProductStages(rootName: string | undefined, nodes: (LayoutNode & {position_x:number; position_y:number})[]) {
  if (rootName !== 'coingecko.coins_markets' && rootName !== 'coingecko.search_trending') return null;
  const groups = rootName === 'coingecko.search_trending'
    ? [{key:'search', title:'搜索关注 · CoinGecko独立热搜', titleEn:'Search attention · independent CoinGecko trending', nodes}]
    : specs.map(s => ({...s, nodes:nodes.filter(n => groupKey(n) === s.key && !supportNames.has(n.name))})).concat([
      {key:'identity', title:'共用资产 · 身份与覆盖', titleEn:'Shared assets · identity and coverage', names:[], nodes:nodes.filter(n => supportNames.has(n.name))},
    ]);
  return groups.filter(g => g.nodes.length).map(g => ({id:`product:${g.key}`, title:g.title, titleEn:g.titleEn, count:g.nodes.length,
    x:Math.min(...g.nodes.map(n => n.position_x)), y:Math.min(...g.nodes.map(n => n.position_y)) - 64}));
}
