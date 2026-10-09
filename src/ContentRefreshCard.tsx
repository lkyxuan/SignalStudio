import { useState } from 'react';
import catalog from '../catalog/content-refresh.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import { buildDesignPipeline, type DesignScenario } from './contentRefreshDesign';
import type { Graph, GraphNode, Language } from './contracts';

type Props = { node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language };
export const contentRefreshCard = (name: string) =>
  name === catalog.result.name || catalog.stages.some(stage => stage.name === name);
const resultColumns = (names: string[]) => catalog.result.columns.filter(column => names.includes(column.name));

function FieldRows({ rows }: { rows: [string, string][] }) {
  return <dl className="source-case-inspector-fields">{rows.map(([name, value], index) => <div key={name}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{name}</code></dt><dd>{value}</dd>
  </div>)}</dl>;
}

export function ContentRefreshCard({ node, graph, openNode, language }: Props) {
  const zh = language === 'zh-CN';
  const [scenario, setScenario] = useState<DesignScenario>('check');
  const pipeline = buildDesignPipeline(scenario);
  const stage = catalog.stages.find(item => item.name === node.name);
  const status = <p className="processing-io-case-caption">{zh ? catalog.limitations_zh
    : 'Studio design and synthetic cases only. Real types, fetchers, generators, storage, frontend and task facilities remain unconnected.'}</p>;
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 契约与验收' : 'Other settings · contract and acceptance'}</summary>
    <p><code>catalog/content-refresh.v1.json</code> · {catalog.revision}</p>
    <p>{zh ? '内容唯一键' : 'Content key'}: <code>{catalog.result.primary_key.join(' + ')}</code></p>
    <p>{catalog.configuration.variant_policy}</p>
    {stage ? <FieldRows rows={stage.fields.map(column => [column.name, `${column.data_type} · ${zh ? column.label_zh : column.meaning_en}`])} />
      : <FieldRows rows={catalog.result.columns.map(column => [column.name, `${column.data_type} · ${zh ? column.label_zh : column.meaning_en}`])} />}
    <pre>{JSON.stringify(catalog.configuration, null, 2)}</pre>
    {catalog.requirements_zh.map(rule => <p key={rule}>{rule}</p>)}
    <h4>{zh ? '完成检查' : 'Acceptance'}</h4>{catalog.acceptance_zh.map(rule => <p key={rule}>{rule}</p>)}
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '已批准方案与实施记录' : 'Approved plan and implementation record'}</a>
  </details>;
  const bindings = <details className="processing-advanced"><summary>{zh ? '外部接点 · 未接通' : 'External bindings · unconnected'}</summary>
    {catalog.bindings.map(binding => <p key={binding.key}><code>{binding.key}</code> · {binding.description_zh}</p>)}
  </details>;
  const table = (names: string[], rows: object[]) => <BusinessTableRows
    table={{ columns: stage ? names.map(name => stage.fields.find(column => column.name === name)!) : resultColumns(names), primary_key: catalog.result.primary_key }}
    rows={rows} language={language} />;
  if (node.name === catalog.result.name) return <div className="business-table-card">
    <BusinessTableRows table={catalog.result} rows={catalog.result.observed_rows} language={language} />
    <p>{zh ? '代币信息内容与生成状态 · 逻辑表格式；没有可展示的实际观察记录，不代表线上表为空。物理存储优先复用已有结构。'
      : 'Logical content and task-state schema. No observed records; this does not establish that live storage is empty. Reuse existing storage when bound.'}</p>
    {status}
    <details className="processing-advanced"><summary>{zh ? '虚构设计例 · B失败后保留成功内容' : 'Synthetic case · B retains successful content after failure'}</summary>
      <BusinessTableRows table={catalog.result} rows={buildDesignPipeline('failure').after} language={language} />
      <p>{zh ? 'B保留09:00的成功内容与成功时间，10:00失败后安排10:01重试；C成功保存。以下行未写入实际内容表。' : 'B retains its 09:00 content and retries at 10:01; C saves independently. These rows were not written to real content storage.'}</p>
    </details>{bindings}{settings}
  </div>;
  if (!stage || !graph || !openNode) return null;
  const dependencies = catalog.connections.filter(edge => edge.target === stage.key);
  const outputs: Record<string, object[]> = {
    candidates: pipeline.candidates, decision: pipeline.decisions,
    generate: pipeline.attempts, save: pipeline.after.filter(row => pipeline.eligible.some(item => item.asset_id === row.asset_id)),
  };
  const inputRows = (source: string): object[] => {
    if (source === 'candidates') return pipeline.candidates;
    if (source === 'decision') return pipeline.eligible;
    if (source === 'generate') return pipeline.attempts;
    if (source === catalog.result.name) return stage.key === 'save' ? pipeline.claimed : pipeline.before;
    if (source === 'asset_identifiers') return pipeline.eligible.map(row => ({ asset_id: row.asset_id,
      source_namespace: 'synthetic', external_identifier: `synthetic/${row.asset_id}` }));
    const board = catalog.boards.find(item => item.table_name === source);
    return catalog.case.board_snapshots.find(item => item.key === board?.key)?.rows ?? [];
  };
  const sourceName = (key: string) => catalog.stages.find(item => item.key === key)?.name ?? key;
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={stage.algorithm_zh}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 本步骤消费的字段' : 'Input · fields consumed by this step'}</h3>
        {dependencies.map(dependency => {
          const source = graph.nodes.find(item => item.name === sourceName(dependency.source));
          return <div className="processing-input-source" key={dependency.source}>
            <div className="processing-input-source-heading">{source ? <button onClick={() => openNode(source.id)}>#{source.reference_number} {source.name}</button> : <span>{sourceName(dependency.source)}</span>}</div>
            <FieldRows rows={dependency.fields.map(name => [name, stage.fields.find(field => field.name === name)?.label_zh ?? name])} />
            <p>{dependency.note_zh}</p>
            <h4>{zh ? '虚构输入例' : 'Synthetic input'}</h4>{table(dependency.fields, inputRows(dependency.source))}
          </div>;
        })}
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 本步骤的结果' : 'Output · this step’s result'}</h3>
        <FieldRows rows={stage.output_fields.map(name => [name, stage.fields.find(field => field.name === name)?.label_zh ?? name])} />
        <h4>{zh ? '虚构输出例 · 非运行结果' : 'Synthetic output · not observed execution'}</h4>
        {table(stage.output_fields, outputs[stage.key]!)}
        {catalog.connections.filter(edge => edge.source === stage.key).map(edge => {
          const target = graph.nodes.find(item => item.name === sourceName(edge.target));
          return <div className="processing-input-source-heading" key={edge.target}>
            <span>{zh ? '交给' : 'Next'}:</span>{target && <button onClick={() => openNode(target.id)}>#{target.reference_number} {target.name}</button>}
            <p>{edge.note_zh}</p>
          </div>;
        })}
        {stage.key === 'decision' && <p>{zh ? '这里只交付首次生成或到期刷新项；skip / wait / blocked 分支不进入生成卡。默认阈值30分钟，按信息类型独立判断。' : 'Only first-generation or expired items proceed. Skip, wait and blocked decisions do not generate. Default interval: 30 minutes per information type.'}</p>}
        {stage.key === 'generate' && <p>{zh ? '这里的生成内容、身份映射及5分钟租约均为虚构案例假设。实际采集、生成器和任务设施未接通；真正租约时长尚未绑定。输出还未保存。' : 'Content, identities and the five-minute lease are fictional assumptions. Fetchers, generators and task facilities are unconnected. Output is not saved yet.'}</p>}
        {stage.key === 'save' && <p>{zh ? '案例假设类型输出验证通过；本地演算只展示状态替换与失败保留，不证明真实验证器、事务或原子认领已实现。' : 'The case assumes valid type output; the evaluator illustrates replacement and failure preservation, not deployed validation or transactions.'}</p>}
      </section>
    </div>
    <section className="execution-trigger"><h3>{zh ? '运行触发 · 已批准目标' : 'Execution triggers · approved requirements'}</h3><p>{stage.trigger_zh}</p></section>
    <section className="processing-goal-readonly"><h3>{zh ? '贯通案例 · 选择同一分支可逐卡查看' : 'Through-line case · follow one scenario across cards'}</h3>
      <label className="source-case-inspector-picker">{zh ? '选择分支' : 'Scenario'}<select value={scenario} onChange={event => setScenario(event.target.value as DesignScenario)}>
        <option value="check">{zh ? '10:00 · 首次、到期与跳过' : '10:00 · first, due and fresh'}</option>
        <option value="failure">{zh ? '10:00 · B失败保留与退避' : '10:00 · B failure and backoff'}</option>
        <option value="boundary">{zh ? '10:10 · A到期边界补查' : '10:10 · A expiry boundary'}</option>
      </select></label>
      <p>{catalog.case.caption_zh}</p><p>UTC <code>{pipeline.now}</code> · <code>{catalog.case.information_key}</code></p>
      <p>{zh ? '最热A、B；升温A、C → 候选A、B、C。10:00判断：A年龄20分钟跳过，B年龄60分钟刷新，C首次生成。10:10时A恰好30分钟，进入刷新。' : 'Hottest A/B and warming A/C merge to A/B/C. At 10:00, A skips (20 minutes), B refreshes (60 minutes), C generates first. At 10:10, A reaches 30 minutes.'}</p>
      {scenario === 'failure' && <p>{zh ? 'B失败后保留09:00成功内容与时间，10:01才可重试；C独立成功。再次检查时B为retry_backoff，C为fresh。' : 'B retains its 09:00 success and waits until 10:01; C succeeds independently. Rechecking yields retry_backoff for B and fresh for C.'}</p>}
    </section>{status}{bindings}{settings}
  </ProcessingCardFrame>;
}
