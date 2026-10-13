import { useState } from 'react';
import spec from '../catalog/search-preparation.v1.json';
import refresh from '../catalog/content-refresh.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import { buildDesignPipeline, type DesignScenario } from './contentRefreshDesign';
import type { Graph, GraphNode, Language } from './contracts';
export const searchPreparationCard = (name: string) => spec.nodes.some(n => n.name === name);
export function SearchPreparationCard({ node, graph, openNode, language }: {
  node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language;
}) {
  const zh = language === 'zh-CN';
  const [scenario, setScenario] = useState<DesignScenario>('check');
  const stage = spec.nodes.find(n => n.name === node.name)!;
  const flow = buildDesignPipeline(scenario);
  const outputs: Record<string, object[]> = {
    read: flow.preparations.map(p => p.read), gap: flow.preparations.map(p => p.decision),
    search: flow.preparations.flatMap(p => p.search), cache: flow.preparations.flatMap(p => p.cache),
    assemble: flow.preparations.map(p => p.assembled), decision: flow.eligible,
    asset_identifiers: flow.eligible.map(r => ({ asset_id: r.asset_id, source_namespace: 'synthetic', external_identifier: `synthetic/${r.asset_id}` })),
    asset_information_content: flow.before,
  };
  const fields = [...stage.fields, ...refresh.result.columns];
  const rows = (names: string[], values: object[]) => <BusinessTableRows table={{ primary_key: ['asset_id','information_key','task_version'],
    columns: names.map(name => fields.find(f => f.name === name) ?? { name, label_zh: name }) }} rows={values} language={language}/>;
  const name = (key: string) => spec.nodes.find(n => n.key === key)?.name ?? refresh.stages.find(n => n.key === key)?.name ?? key;
  const link = (key: string) => {
    const other = graph?.nodes.find(n => n.name === name(key));
    return other && openNode ? <button onClick={() => openNode(other.id)}>#{other.reference_number} {other.name}</button> : <span>{name(key)}</span>;
  };
  const selector = <section className="processing-goal-readonly">
    <h3>{zh ? '贯通设计案例 · 非实时搜索结果' : 'Through-line design case · not live search'}</h3>
    <label className="source-case-inspector-picker">{zh ? '选择案例' : 'Scenario'}<select value={scenario} onChange={e => setScenario(e.target.value as DesignScenario)}>
      <option value="check">{zh ? '当前默认 · 已有资料＋实时补搜' : 'Current default · stored data + fresh search'}</option>
      <option value="failure">{zh ? '搜索失败 · B保留旧成功内容' : 'Search failure · B keeps previous content'}</option>
      <option value="empty">{zh ? '成功空结果 · 必要证据不足' : 'Empty success · evidence insufficient'}</option>
      <option value="unconnected">{zh ? '工具未接通 · 阻塞生成' : 'Tools unconnected · generation blocked'}</option>
      <option value="enough">{zh ? '未来模式 · 资料足够免搜索' : 'Future mode · sufficient stored data'}</option>
    </select></label>
    <p>{zh ? '演算使用demo资产与example.invalid虚构来源。B到期、C首次；两个任务分别流转。当前默认策略即使已有资料够用也需要本次实时补搜。未来模式只在本案例切换，不修改保存的策略。'
      : 'Demo assets and example.invalid sources are fictional. B is due, C is new. Current policy requires a fresh search even with full coverage. The future-mode case does not change saved policy.'}</p>
  </section>;
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 输入输出契约与未接通点' : 'Other settings · contracts and unbound facilities'}</summary>
    <p><code>catalog/search-preparation.v1.json</code> · {spec.revision}</p>
    <pre>{JSON.stringify({ default_search_policy: spec.default_search_policy, bindings: spec.bindings }, null, 2)}</pre>
    <dl className="source-case-inspector-fields">{stage.fields.map(f => <div key={f.name}><dt><code>{f.name}</code></dt><dd>{zh ? f.label_zh : f.meaning_en} · {f.data_type}</dd></div>)}</dl>
    <a href={spec.rationale_url}>{zh ? 'SS-87 批准范围与交付' : 'SS-87 approved scope and delivery'}</a>
  </details>;
  const status = <p className="processing-io-case-caption">{zh ? spec.limitations_zh : 'Studio design and synthetic cases only. Data readers, search tools, storage and generators are not connected.'}</p>;
  if (stage.kind === 'table') return <div className="business-table-card">
    {rows(stage.output_fields, spec.observed_rows)}
    <p>{zh ? '搜索资料暂存 · 逻辑表。尚无真实回填，不代表线上存储为空。失败只记录尝试状态，保留上次成功资料及时间。资料有效期与保留期分别配置，实际时长未定。'
      : 'Logical search store. No imported observations; live storage is unverified. Failure preserves prior successful results and timestamps. Freshness and retention are separate and unbound.'}</p>
    {status}<details><summary>{zh ? '虚构暂存案例 · 非实际写入' : 'Synthetic cache case · no writes'}</summary>{selector}{rows(stage.output_fields, outputs.cache!)}</details>{settings}
  </div>;
  if (!graph || !openNode) return null;
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={stage.algorithm_zh}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 本步骤读取的资料' : 'Input · data used by this step'}</h3>
        {spec.connections.filter(e => e.target === stage.key).map(e => <div className="processing-input-source" key={e.source}>
          <div className="processing-input-source-heading">{link(e.source)}</div><p>{e.note_zh}</p>
          {rows(e.fields, e.source === 'cache' ? flow.preparations.map(p => p.cachedBefore) : outputs[e.source] ?? [])}
        </div>)}
        {stage.key === 'read' && <p>{zh ? '业务资料主路：接入已收集的业务表，不限爬虫数量。具体资料来源读取尚未绑定；图上的资产标识输入只证明身份关系，不代表已有新闻数据。'
          : 'Primary path reads collected business data, independent of crawler count. Readers are not bound; asset identifiers do not establish collected news.'}</p>}
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 本步骤结果' : 'Output · step result'}</h3>
        {rows(stage.output_fields, outputs[stage.key] ?? [])}
        {spec.connections.filter(e => e.source === stage.key).map(e => <div key={e.target} className="processing-input-source"><div className="processing-input-source-heading">{link(e.target)}</div><p>{e.note_zh}</p></div>)}
      </section>
    </div>
    <section className="execution-trigger"><h3>{zh ? '运行触发 · 已批准目标' : 'Execution triggers · approved requirements'}</h3><p>{stage.trigger_zh}</p></section>
    {selector}{status}{settings}
  </ProcessingCardFrame>;
}
