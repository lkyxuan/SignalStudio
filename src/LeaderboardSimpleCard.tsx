import catalog from '../catalog/leaderboard-simple.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import type { Graph, GraphNode, Language } from './contracts';

type Props = { node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language };
type Column = { name: string; label_zh: string };
export const simpleLeaderboardCard = (name: string) => catalog.boards.find(board =>
  [board.cache_name, board.calculator_name, board.table_name].includes(name)) ||
  [catalog.history.name, catalog.history.processor_name].includes(name);

function Fields({ columns, values }: { columns: Column[]; values: Record<string, unknown> }) {
  return <dl className="source-case-inspector-fields">{columns.map((field, index) => <div key={field.name}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{field.name}</code></dt>
    <dd>{String(values[field.name] ?? '—')}</dd>
  </div>)}</dl>;
}

export function LeaderboardSimpleCard({ node, graph, openNode, language }: Props) {
  const zh = language === 'zh-CN';
  const status = <p className="processing-io-case-caption">{zh
    ? '简版契约已定义 · 尚未验证真实计算；原热榜保持现状'
    : 'Simple contract defined · execution unverified; existing hot board preserved'}</p>;
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置' : 'Other settings'}</summary>
    <p>{catalog.rules_zh}</p><p>{catalog.comparison_zh}</p><p>{catalog.opinion_rule_zh}</p><p>{catalog.limitations_zh}</p>
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '本次决定与实施记录' : 'Decision and implementation record'}</a>
  </details>;
  const board = catalog.boards.find(item => [item.cache_name, item.calculator_name, item.table_name].includes(node.name));
  if (!board) {
    const history = catalog.history;
    if (node.name === history.name) return <div className="business-table-card">
      <BusinessTableRows table={history} rows={[]} language={language} />{status}
      <p>{history.description}</p><p>{zh ? '没有连续历史快照可展示，单次热榜回填不构成历史。' : 'No continuous history observed.'}</p>{settings}
    </div>;
    if (!graph || !openNode) return null;
    const input = { asset_id: 'demo-asset', asset_name: '示例资产', score_key: 'total_heat', score_value: 100, calculated_at: '2026-10-08T23:00:00Z' };
    const output = { ...input, hottest_rank: 1 };
    const inputColumns = history.columns.filter(column => column.name !== 'hottest_rank');
    return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={history.description}>
      <p>{zh ? '虚构数值案例：该批次只有一个资产，排名为1。非真实快照写入。' : 'Synthetic one-asset snapshot case; rank is 1.'}</p>
      <div className="source-case-inspector processing-io-case">
        <section className="source-case-inspector-section"><h3>输入 · asset_scores_current</h3><Fields columns={inputColumns} values={input} />
          <BusinessTableRows table={{ columns: inputColumns, primary_key: ['asset_id'] }} rows={[input]} language={language} /></section>
        <section className="source-case-inspector-section"><h3>输出 · {history.name}</h3><Fields columns={history.columns} values={output} />
          <BusinessTableRows table={history} rows={[output]} language={language} /></section>
      </div>{status}{settings}
    </ProcessingCardFrame>;
  }
  if (node.name === board.table_name) return <div className="business-table-card">
    <BusinessTableRows table={catalog} rows={[]} language={language} />{status}
    <p>{board.description}</p><p>{zh ? '当前只定义表格式，没有本榜实际运行记录。' : 'Schema only; no observed runtime records.'}</p>{settings}
  </div>;
  if (node.name === board.cache_name) return <div className="processing-card-frame">
    <BusinessTableRows table={{ columns: board.input_schema, primary_key: ['asset_id'] }} rows={[]} language={language} />{status}
    <p>{zh ? '保存本榜消费的输入摘要；缺失数据不补零。' : 'Cache the consumed summaries; missing data is not zero.'}</p>
    {board.sources.map(name => {
      const source = graph?.nodes.find(item => item.name === name);
      return <p key={name}>{source && openNode ? <button onClick={() => openNode(source.id)}>#{source.reference_number} {name}</button> : <code>{name}</code>}</p>;
    })}<p>{board.eligibility}</p>{settings}
  </div>;
  if (!graph || !openNode) return null;
  const input = board.case.input;
  const result = { asset_id: input.asset_id, asset_name: input.asset_name, score: board.case.score,
    calculated_at: board.case.calculated_at, algorithm_version: board.algorithm_version };
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={board.description}>
    <p className="processing-io-case-caption">{zh ? '虚构数值案例 · 非实际采集或运行' : 'Synthetic numeric case · not observed execution'}</p>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 本榜消费的摘要' : 'Input · consumed summaries'}</h3>
        <Fields columns={board.input_schema} values={input} />
        <BusinessTableRows table={{ columns: board.input_schema, primary_key: ['asset_id'] }} rows={[input]} language={language} />
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 本榜得分' : 'Output · board score'}</h3>
        <Fields columns={catalog.columns} values={result} /><BusinessTableRows table={catalog} rows={[result]} language={language} />
      </section>
    </div><p><code>{board.formula} = {board.case.score}</code></p><p>{board.eligibility}</p>{status}{settings}
  </ProcessingCardFrame>;
}
