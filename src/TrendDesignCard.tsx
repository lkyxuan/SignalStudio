import catalog from '../catalog/leaderboard-trends.v1.json';
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
    primary_key: ['asset_id'] };
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 实现要求与未决参数' : 'Other settings · implementation requirements'}</summary>
    {catalog.rules.map(rule => <p key={rule}>{rule}</p>)}
    <p>{catalog.execution.trigger_requirement}</p>
    <strong>{zh ? '待确定后才能执行的参数' : 'Parameters requiring a decision before execution'}</strong>
    {catalog.pending.map(item => <p key={item}>{item}</p>)}
    <p>{zh ? 'Few Understand负责后续实现；本卡无运行结果，不使用旧规则作为默认值。' : 'Few Understand owns implementation. No observed runtime results or fallback to old formulas.'}</p>
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '本轮确认的需求' : 'Accepted requirements'}</a>
  </details>;
  const status = <p className="processing-io-case-caption">{zh ? '三榜设计已更新 · 公式与参数待定 · Few后端实现待核实' : 'Three-board design updated · parameters pending · backend unverified'}</p>;
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
    <section className="source-case-inspector-section"><h3>{zh ? '输出 · 待实现的结构' : 'Output · required schema'}</h3>
      <BusinessTableRows table={schema} rows={[]} language={language}/>
      <dl className="source-case-inspector-fields">{schema.columns.map(field => <div key={field.name}><dt><code>{field.name}</code></dt><dd>{field.label_zh}</dd></div>)}</dl>
    </section>{settings}
  </ProcessingCardFrame>;
}
