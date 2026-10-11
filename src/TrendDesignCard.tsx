import catalog from '../catalog/leaderboard-foundation.v1.json';
import scoring from '../catalog/market-scoring.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import type { Graph, GraphNode, Language } from './contracts';

export const trendDesign = (name: string) => catalog.nodes.find(item => item.name === name);
type Props = { node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language };

export function TrendDesignCard({ node, graph, openNode, language }: Props) {
  const spec = trendDesign(node.name);
  if (!spec) return null;
  const zh = language === 'zh-CN';
  const board = catalog.boards.find(item => item.key === spec.board);
  const fields = graph?.fields.filter(field => field.node_id === node.id) || [];
  const schema = { columns: fields.length ? fields.map(field => ({ name: field.name, label_zh: field.definition })) : spec.columns,
    primary_key: spec.primary_key };
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 初版规则与实现要求' : 'Other settings · implementation requirements'}</summary>
    {catalog.rules.map(rule => <p key={rule}>{rule}</p>)}
    <p>{catalog.execution.trigger_requirement}</p>
    <strong>{zh ? 'market_v1 · 初版记分规则' : 'market_v1 · initial scoring rules'}</strong>
    <p>{zh ? '每5分钟最多贡献一次，每项只取最高档；分数由Redis事件随时间衰减后汇总。' : 'At most one contribution per factor per 5-minute slot, highest tier only; Redis events decay before aggregation.'}</p>
    <dl className="source-case-inspector-fields">{scoring.rules.map(rule => <div key={rule.key}>
      <dt>{zh ? rule.label_zh : rule.key}</dt>
      <dd>{'tiers' in rule ? rule.tiers?.map(([threshold, points]) => `≥${threshold!.toLocaleString('en-US')} → +${points}`).join(' / ') : `+${rule.points}`}
        {zh ? `；半衰期 ${rule.half_life_minutes} 分钟` : `; half-life ${rule.half_life_minutes} min`}</dd>
    </div>)}</dl>
    <p>{zh ? 'USD；市值≥1000万美元、24h成交额≥100万美元、价格>0；行情≤15分钟，Redis投影≤120秒，每榜最多20项。升温需放量≥1.5倍、|24h涨跌|≥5%及60分钟分数正增长；新榜限基线后7天内真正首次发现。' : 'USD; market cap ≥$10m, 24h volume ≥$1m, positive price. Source age ≤15min, projection age ≤120s, top 20. Warming needs ≥1.5× volume, ≥5% absolute price move and positive 60min score growth. New: genuine discoveries within 7 days after baseline.'}</p>
    <strong>{zh ? '后续验证' : 'Further validation'}</strong>
    {catalog.pending.map(item => <p key={item}>{item}</p>)}
    <p>{zh ? 'Few Understand负责后续实现；本卡无运行结果，不使用旧规则作为默认值。' : 'Few Understand owns implementation. No observed runtime results or fallback to old formulas.'}</p>
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '本轮确认的需求' : 'Accepted requirements'}</a>
  </details>;
  const status = <p className="processing-io-case-caption">{zh ? '量价基础表、market_v1记分与Redis连线已定义 · Few采集/写入待实现' : 'Market tables, market_v1 scoring and Redis connections defined · backend collection/writes pending'}</p>;
  const description = <><p>{spec.description}</p>{board && <p>{zh ? `首页位置 ${board.slot} · ${board.label_zh}榜` : `Homepage slot ${board.slot} · ${board.key}`}</p>}</>;
  if (spec.role !== 'process') return <div className="business-table-card">
    <BusinessTableRows table={schema} rows={[]} language={language}/>{status}{description}
    <p>{zh ? '以下字段说明格式；未回填真实记录，不放虚构分数。' : 'Declared schema; no imported records or invented scores.'}</p>
    <dl className="source-case-inspector-fields">{schema.columns.map(field => <div key={field.name}><dt><code>{field.name}</code></dt><dd>{field.label_zh}</dd></div>)}</dl>
    {settings}
  </div>;
  if (!graph || !openNode) return <>{status}{description}{settings}</>;
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={spec.algorithm}>
    {status}{description}
    {spec.key === 'score_contributions' && <section className="source-case-inspector-section">
      <h3>{zh ? '假设案例 · 单次贡献，非真实榜单' : 'Hypothetical examples · contribution per slot'}</h3>
      {scoring.examples.map(example => <p key={example.label}>{example.label} · V=${example.volume.toLocaleString('en-US')} · M=${example.market_cap.toLocaleString('en-US')} · {example.price_pct}% · V/B={(example.volume/example.baseline_volume).toFixed(2)} · {Object.entries(example.expected).map(([key,value]) => `${key} +${value}`).join(' / ')} → +{example.total_per_slot}</p>)}
    </section>}
    <section className="source-case-inspector-section"><h3>{zh ? '输出 · 待实现的结构' : 'Output · required schema'}</h3>
      <BusinessTableRows table={schema} rows={[]} language={language}/>
      <dl className="source-case-inspector-fields">{schema.columns.map(field => <div key={field.name}><dt><code>{field.name}</code></dt><dd>{field.label_zh}</dd></div>)}</dl>
    </section>{settings}
  </ProcessingCardFrame>;
}
