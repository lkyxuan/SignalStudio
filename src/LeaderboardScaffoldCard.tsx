import catalog from '../catalog/leaderboard-scaffolds.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import type { Graph, GraphNode, Language } from './contracts';
import './processing-io-card.css';

type Column = { name: string; data_type: string; label_zh: string; meaning_en: string };
type Props = { node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language };
export const leaderboardCard = (name: string) => catalog.boards.find(board =>
  [board.cache_name, board.calculator_name, board.table_name].includes(name)) ||
  catalog.data_nodes.find(item => item.name === name) || catalog.preprocessors.find(item => item.name === name);

function Fields({ columns, values }: { columns: Column[]; values?: Record<string, unknown> }) {
  return <dl className="source-case-inspector-fields">{columns.map((column, index) => <div key={column.name}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{column.name}</code></dt>
    <dd>{values ? (typeof values[column.name] === 'object' ? JSON.stringify(values[column.name]) : String(values[column.name] ?? '—')) : column.label_zh}</dd>
  </div>)}</dl>;
}

export function LeaderboardScaffoldCard({ node, graph, openNode, language }: Props) {
  const zh = language === 'zh-CN';
  const status = zh ? 'v1 设计已定义 · 尚无真实采集与计算验证' : 'v1 design defined · no verified collection or execution';
  const dataset = catalog.data_nodes.find(item => item.name === node.name);
  const prep = catalog.preprocessors.find(item => item.name === node.name);
  const board = catalog.boards.find(item => [item.cache_name, item.calculator_name, item.table_name].includes(node.name));
  const provenance = <p className="processing-io-case-caption">{status}</p>;
  const commonSettings = <>
    <p>{catalog.common.quality_zh}</p><p>{catalog.common.evidence_rule_zh}</p>
    <p>{catalog.common.result_rule_zh}</p><p>{catalog.common.retention_zh}</p>
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '研究与决定依据' : 'Research and decision rationale'}</a>
  </>;
  if (dataset) return <div className="business-table-card">
    <BusinessTableRows table={dataset} rows={[]} language={language} />
    {provenance}<p>{dataset.description}</p>
    <p>{zh ? '当前没有实际记录可展示；此空表只描述格式，不代表运行中的表为空。' : 'No observed records to display. This empty table specifies the schema, not live storage.'}</p>
    <details className="processing-advanced"><summary>{zh ? '其他设置' : 'Other settings'}</summary>
      <p>Primary key: {dataset.primary_key.join(' + ')}</p><Fields columns={dataset.columns} />{commonSettings}
    </details>
  </div>;
  if (prep) {
    const target = catalog.data_nodes.find(item => item.key === prep.output_dataset);
    if (!target || !graph || !openNode) return null;
    const inputFields = graph.field_usages.filter(usage => graph.edges.some(edge =>
      edge.id === usage.edge_id && edge.downstream_id === node.id)).map(usage => graph.fields.find(field => field.id === usage.source_field_id));
    return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={prep.algorithm_zh}>
      <p className="processing-io-case-caption">{zh ? '虚构分支设计例 · 非实际采集或运行' : 'Synthetic branch design case · not observed execution'}</p>
      <div className="source-case-inspector processing-io-case">
        <section className="source-case-inspector-section"><h3>{zh ? '输入 · 消费字段' : 'Input · consumed fields'}</h3>
          <BusinessTableRows table={{ columns: prep.case.input_columns, primary_key: [prep.case.input_columns[0]?.name || 'asset_id'] }} rows={prep.case.input_rows} language={language} />
          <dl className="source-case-inspector-fields">{inputFields.map((field, index) => field && <div key={`${field.id}-${index}`}>
            <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{field.name}</code></dt><dd>{field.definition}</dd>
          </div>)}</dl>
        </section>
        <section className="source-case-inspector-section"><h3>{zh ? '输出 · 目标格式' : 'Output · target format'}</h3><code>{target.name}</code>
          <BusinessTableRows table={target} rows={prep.case.output_rows} language={language} />
          {!prep.case.output_rows.length && <p>{zh ? '此分支不写合格记录' : 'This branch writes no qualifying record'}</p>}<Fields columns={target.columns} /></section>
      </div><p>{prep.case.caption_zh}</p>{provenance}
      <p>{zh ? '这是处理契约，尚无配对运行记录。采集服务元数据、资产关联、转载识别和观点标注需实现并核验。' : 'Processing contract without paired runtime records. Collection metadata, identity, deduplication and annotation need implementation and verification.'}</p>
      <details className="processing-advanced"><summary>{zh ? '其他设置' : 'Other settings'}</summary>{commonSettings}</details>
    </ProcessingCardFrame>;
  }
  if (!board) return null;
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 实现要求与验收' : 'Other settings · implementation and acceptance'}</summary>
    <p><code>{board.algorithm.version}</code> · {board.algorithm.status}</p>
    <pre>{JSON.stringify(board.algorithm.parameters, null, 2)}</pre>
    <p>{board.validation_zh}</p>
    {board.implementation_request.requirements_zh.map(rule => <p key={rule}>{rule}</p>)}
    {board.implementation_request.acceptance_zh.map(rule => <p key={rule}>{rule}</p>)}
    {commonSettings}
  </details>;
  if (node.name === board.table_name) return <div className="business-table-card">
    <BusinessTableRows table={catalog} rows={[]} language={language} />{provenance}
    <p>{board.algorithm.description_zh}</p><p>{catalog.common.result_rule_zh}</p>
    <p>{zh ? '没有可展示的实际运行记录；表格式与设计案例不证明榜单已上线。' : 'No observed runtime records. The schema and design cases do not establish a live board.'}</p>
    {settings}
  </div>;
  if (node.name === board.cache_name) return <div className="processing-card-frame">
    <BusinessTableRows table={{ columns: board.cache_schema, primary_key: ['asset_id'] }} rows={[]} language={language} />
    {provenance}<p>{board.cache_rule_zh}</p>
    <p>Redis Hash · <code>{board.key_prefix}</code> · {zh ? '一个共享服务，尚未创建实际 key。' : 'One shared service; no live keys created.'}</p>
    <p>{zh ? '完整记录请到数据卡片查看：' : 'Full records are on data cards:'}</p>
    {board.input_datasets.map(key => {
      const source = graph?.nodes.find(item => item.name === `leaderboard_${key}`);
      return <p key={key}>{source && openNode ? <button onClick={() => openNode(source.id)}>#{source.reference_number} {source.name}</button> : <code>leaderboard_{key}</code>}</p>;
    })}
    <details className="processing-advanced"><summary>{zh ? '其他设置' : 'Other settings'}</summary><Fields columns={board.cache_schema} />{commonSettings}</details>
  </div>;
  if (!graph || !openNode) return null;
  const values: Record<string, unknown> = { ...board.case.input };
  const result = { asset_id: values.asset_id, asset_name: values.asset_name, score: board.case.score,
    calculated_at: board.case.calculated_at, algorithm_version: board.algorithm.version,
    cycle_id: 'demo-cycle', coverage_key: values.coverage_key,
    evidence_refs_json: JSON.stringify(values.evidence_refs_json), details_json: JSON.stringify({
      case: 'synthetic_design_case', formula: board.algorithm.formula,
      event_kind: values.event_kind, topic_key: values.topic_key, horizon: values.horizon,
    }) };
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={board.algorithm.explanation_zh}>
    <p className="processing-io-case-caption">{zh ? '以下为虚构输入的数值设计例，输出由这些输入推导；不是采集记录或实际运行。' : 'Synthetic numeric design case; derived output, not collection or execution evidence.'}</p>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 计算用摘要' : 'Input · calculation summaries'}</h3>
        <p>{zh ? '由本榜缓存的证据与历史记录推导；案例假设身份、去重、时间及所需覆盖检查均通过。' : 'Derived from cached records; this case assumes identity, deduplication, timestamps and coverage checks pass.'}</p>
        <Fields columns={board.input_schema} values={values} />
        <BusinessTableRows table={{ columns: board.input_schema, primary_key: ['asset_id'] }} rows={[Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value]))]} language={language} />
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 推导结果' : 'Output · derived result'}</h3>
        <Fields columns={catalog.columns} values={result} />
        <BusinessTableRows table={catalog} rows={[result]} language={language} />
      </section>
    </div>
    <p>{board.case.explanation_zh}</p><p>{board.algorithm.eligibility_zh}</p>
    {provenance}
    <section className="execution-trigger"><h3>{zh ? '运行触发 · 目标要求' : 'Execution trigger · required behavior'}</h3>
      <p>{zh ? '每5分钟一个UTC完整批次；先最热，再积累与验证其他榜。此配置不启动定时器。' : 'One complete UTC cycle every five minutes; start with hottest, then validate the other boards. This configuration starts no timer.'}</p>
      <code>{board.algorithm.formula}</code>
    </section>{settings}
  </ProcessingCardFrame>;
}
