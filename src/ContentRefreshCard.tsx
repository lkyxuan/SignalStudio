import { useState } from 'react';
import catalog from '../catalog/content-refresh.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import { planDesignRefresh, selectCandidates, settleDesignAttempt, type ContentState } from './contentRefreshDesign';
import type { Graph, GraphNode, Language } from './contracts';

type Props = { node: GraphNode; graph?: Graph; openNode?: (id: string) => void; language: Language };
export const contentRefreshCard = (name: string) => [catalog.node.name, catalog.result.name].includes(name);
const columns = (names: string[]) => catalog.result.columns.filter(column => names.includes(column.name));
const actions: Record<string, [string, string]> = {
  first_generation: ['首次生成', 'First generation'], expired: ['到期刷新', 'Refresh due'],
  fresh: ['未到期，跳过', 'Fresh, skip'], retry_backoff: ['重试等待', 'Retry backoff'],
  active_task: ['已有任务，合并', 'Active task, merge'], binding_unconnected: ['未接通', 'Unconnected'],
};

function FieldRows({ rows }: { rows: [string, string][] }) {
  return <dl className="source-case-inspector-fields">{rows.map(([name, value], index) => <div key={name}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{name}</code></dt><dd>{value}</dd>
  </div>)}</dl>;
}

export function ContentRefreshCard({ node, graph, openNode, language }: Props) {
  const zh = language === 'zh-CN';
  const [scenario, setScenario] = useState('check');
  const demo = catalog.case;
  const now = scenario === 'boundary' ? '2026-10-10T02:10:00Z' : demo.now;
  const b = demo.states.find(item => item.asset_id === 'demo-B')!;
  const failed = settleDesignAttempt({ ...b, status: 'running', lease_until: '2026-10-10T02:05:00Z' }, {
    task_version: b.task_version, lease_until: '2026-10-10T02:05:00Z', now: demo.now, error: 'demo_fetch_timeout',
  });
  const states: ContentState[] = scenario === 'failure' ? [demo.states[0]!, failed] : demo.states;
  const ids = selectCandidates(demo.board_snapshots, now);
  const decisions = planDesignRefresh(ids, [{ key: demo.information_key, enabled: true, binding_ready: true }], states, now);
  const status = <p className="processing-io-case-caption">{zh ? catalog.limitations_zh
    : 'Approved Studio design only. No runtime generation records; information registry, generators, storage, frontend reader, notifications and task facilities are unconnected.'}</p>;
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置 · 契约与验收' : 'Other settings · contract and acceptance'}</summary>
    <p><code>catalog/content-refresh.v1.json</code> · {catalog.revision}</p>
    <p>{zh ? '唯一键' : 'Primary key'}: <code>{catalog.result.primary_key.join(' + ')}</code></p>
    <p>{catalog.configuration.variant_policy}</p>
    <FieldRows rows={catalog.result.columns.map(column => [column.name, `${column.data_type} · ${zh ? column.label_zh : column.meaning_en}`])} />
    <pre>{JSON.stringify(catalog.configuration, null, 2)}</pre>
    {catalog.requirements_zh.map(rule => <p key={rule}>{rule}</p>)}
    <h4>{zh ? '完成检查' : 'Acceptance'}</h4>{catalog.acceptance_zh.map(rule => <p key={rule}>{rule}</p>)}
    <a href={catalog.rationale_url} target="_blank" rel="noreferrer">{zh ? '已批准方案与实施记录' : 'Approved plan and implementation record'}</a>
  </details>;
  const bindings = <section className="execution-trigger"><h3>{zh ? '外部接点 · 未接通' : 'External bindings · unconnected'}</h3>
    {catalog.bindings.map(binding => <p key={binding.key}><code>{binding.key}</code> · {binding.description_zh}</p>)}
  </section>;
  if (node.name === catalog.result.name) return <div className="business-table-card">
    <BusinessTableRows table={catalog.result} rows={catalog.result.observed_rows} language={language} />
    <p>{zh ? '代币信息内容与生成状态 · 逻辑表格式；没有可展示的实际观察记录，不代表线上表为空。物理存储优先复用已有结构。'
      : 'Logical content and task-state schema. No observed records to display; this does not mean live storage is empty. Reuse existing storage when bound.'}</p>
    {status}
    <details className="processing-advanced"><summary>{zh ? '虚构设计例 · B失败后保留成功内容' : 'Synthetic case · B retains successful content after failure'}</summary>
      <BusinessTableRows table={catalog.result} rows={[failed]} language={language} />
      <p>{zh ? '09:00的成功内容与成功时间不变；10:00失败后安排10:01重试。此行没有写入实际结果表。' : 'Keep the 09:00 content and success time; a 10:00 failure schedules 10:01 retry. Not an actual stored row.'}</p>
    </details>{bindings}{settings}
  </div>;
  if (!graph || !openNode) return null;
  const outputColumns = [
    { name: 'asset_id', label_zh: '内部资产ID' }, { name: 'information_key', label_zh: '信息类型' },
    { name: 'age_minutes', label_zh: '内容年龄（分钟）' }, { name: 'action', label_zh: '检查动作' }, { name: 'reason', label_zh: '原因' },
  ];
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={catalog.node.algorithm_zh}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 各榜前N及内容状态' : 'Input · board candidates and content state'}</h3>
        {catalog.boards.map(board => {
          const source = graph.nodes.find(item => item.name === board.table_name);
          return <div className="processing-input-source" key={board.key}>
            <div className="processing-input-source-heading">{source && <button onClick={() => openNode(source.id)}>#{source.reference_number} {source.name}</button>}</div>
            <FieldRows rows={board.consumed_fields.map(name => [name, name === board.score_field ? `${board.label_zh} · ${zh ? '未舍入分数降序，再按asset_id升序，取前' : 'score descending, asset ID ascending, take top'} ${board.top_n}` : name === 'score_key' ? 'total_heat' : name])} />
          </div>;
        })}
        <h4>{zh ? '内容状态输入 · 仅本次判断所用字段' : 'Content-state inputs · fields consumed by this check'}</h4>
        <FieldRows rows={columns(['asset_id', 'information_key', 'last_success_at', 'status', 'next_retry_at', 'lease_until']).map(column => [column.name, zh ? column.label_zh : column.meaning_en])} />
        <p>{zh ? '另读取成功内容是否存在；完整内容在结果表查看。类型注册表与来源身份映射未接通时，该项不生成。' : 'Also check whether successful content exists; inspect full content on the result card. Unbound types or source identities block that item.'}</p>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 检查动作与成功保存规则' : 'Output · decisions and persistence rules'}</h3>
        <FieldRows rows={[
          ['asset_id + information_key', zh ? '同键仅一个活动任务，跨榜共用内容' : 'One active task per key; content shared across boards'],
          ['content_json / last_success_at', zh ? '校验成功并保存后才替换；失败保留旧值' : 'Replace only after validation and successful persistence; preserve on failure'],
          ['source_refs_json / data_as_of', zh ? '真实来源引用和数据时间；未知时间为空' : 'Traceable inputs and source time; unknown time is null'],
          ['status / next_retry_at', zh ? '单项执行状态和退避时间，不影响其他内容' : 'Per-item state and backoff; independent of other content'],
        ]} />
        <div className="processing-input-source-heading"><span>{zh ? '结果逻辑表' : 'Logical result'}:</span> <button onClick={() => { const result = graph.nodes.find(item => item.name === catalog.result.name); if (result) openNode(result.id); }}>{catalog.result.name}</button></div>
        <p>{zh ? '来源身份通过asset_identifiers映射；已有采集/生成器、物理保存和前端读取待绑定。' : 'Use asset_identifiers for source identities; existing fetchers, generators, storage and frontend reads remain unbound.'}</p>
      </section>
    </div>
    <section className="execution-trigger"><h3>{zh ? '运行触发 · 已批准目标' : 'Execution triggers · approved requirements'}</h3>
      <p>{zh ? '业务表成功提交后检查，启动时检查，并每60秒补查；检查不等于每次生成。每榜前20，内容默认30分钟到期，并发2；每个信息类型可单独设置。此卡不启动定时器。'
        : 'Check after committed updates, at startup and every 60 seconds. Each board contributes top 20; content expires after 30 minutes by default, with concurrency 2. Per-type intervals may differ. This card starts no timer.'}</p>
    </section>
    <section className="processing-goal-readonly"><h3>{zh ? '虚构贯通案例 · 非实际生成' : 'Synthetic through-line case · not observed generation'}</h3>
      <label className="source-case-inspector-picker">{zh ? '选择分支' : 'Scenario'}<select value={scenario} onChange={event => setScenario(event.target.value)}>
        <option value="check">{zh ? '10:00 · 首次、到期与跳过' : '10:00 · first, due and fresh'}</option>
        <option value="failure">{zh ? '10:00 · B失败保留与退避' : '10:00 · B failure and backoff'}</option>
        <option value="boundary">{zh ? '10:10 · A到期边界补查' : '10:10 · A expiry boundary'}</option>
      </select></label>
      <p>{demo.caption_zh}</p><p>{zh ? '最热：A、B；升温：A、C → 合并后A、B、C。以下演算假设接点均可用；不使用生产信息类型清单。' : 'Hottest A/B plus warming A/C merge to A/B/C. Bindings are assumed ready only for this design example.'}</p>
      <p>UTC <code>{now}</code> · <code>{demo.information_key}</code></p>
      <BusinessTableRows table={{ columns: columns(['asset_id', 'information_key', 'last_success_at', 'status', 'next_retry_at']), primary_key: catalog.result.primary_key }} rows={[...states, { asset_id: 'demo-C', information_key: demo.information_key, last_success_at: null, status: 'idle', next_retry_at: null }]} language={language} />
      <h4>{zh ? '输出 · 推导的检查动作' : 'Output · derived decisions'}</h4>
      <BusinessTableRows table={{ columns: outputColumns, primary_key: catalog.result.primary_key }} rows={decisions} language={language} />
      {decisions.map(decision => <p key={decision.asset_id}>{decision.asset_id} · {actions[decision.reason]?.[zh ? 0 : 1] || decision.reason}</p>)}
      {scenario === 'failure' && <p>{zh ? 'B的content_json和09:00成功时间原样保留，next_retry_at为10:01；C仍可首次生成。' : 'B retains content_json and its 09:00 success time, retrying at 10:01. C remains eligible for first generation.'}</p>}
    </section>{status}{bindings}{settings}
  </ProcessingCardFrame>;
}
