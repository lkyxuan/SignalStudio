import React, { useState } from 'react';
import pilot from '../catalog/identity-flow-case.v1.json';
import catalog from '../catalog/asset-initial-score-sources.v1.json';
import { previewInitialScore } from './initialScoreDesign';
import { nodeRef } from './graphRefs';
import { displayNodeName } from './i18n';

const statuses = {
  accepted: ['生成首次评分决定（演算）', 'Initial decision (preview)'],
  reused: ['已有资产，跳过首次奖励', 'Existing asset: skip'],
  retry: ['复用已保存决定，不新增贡献', 'Reuse saved decision: no new contribution'],
  pending_configuration: ['缺少有效评分配置，待处理', 'Valid configuration missing: pending'],
};
function Rows({ rows }) {
  return <dl className="source-case-inspector-fields">{rows.map(([key, value], index) => <div key={key}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{key}</code></dt>
    <dd>{value == null ? 'NULL' : String(value)}</dd>
  </div>)}</dl>;
}

export function InitialScoreCard({ graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const [accountIndex, setAccountIndex] = useState(0);
  const [branch, setBranch] = useState('created');
  const selected = pilot.cases[accountIndex];
  const created = selected.create_result;
  const input = branch === 'reused' ? selected.repeat_result : { ...created,
    source_id: branch === 'unknown' ? null : created.source_id };
  const saved = branch === 'retry' ? [previewInitialScore(created).decision] : [];
  const result = previewInitialScore(input, catalog.rows, saved);
  const config = branch === 'retry' ? saved[0]?.configuration : catalog.rows.find(row => row.source_id === input.source_id);
  const link = (match) => {
    const node = graph.nodes.find(match);
    return <button disabled={!node} onClick={() => node && openNode(node.id)}>{node ? `${nodeRef(node)} ${displayNodeName(language, node.name)}` : '—'}</button>;
  };
  const decision = result.decision;
  return <>
    <label className="source-case-inspector-picker">{zh ? '真实上游账号 · 目标分支' : 'Observed account · planned branch'}
      <select value={accountIndex} onChange={e => setAccountIndex(Number(e.target.value))}>{pilot.cases.map((item, index) =>
        <option key={item.source_record.id} value={index}>{item.source_record.name}</option>)}</select>
    </label>
    <label className="source-case-inspector-picker">{zh ? '演算分支（非后台结果）' : 'Preview branch (not runtime)'}
      <select value={branch} onChange={e => setBranch(e.target.value)}>
        <option value="created">{zh ? '首次建档 · 来源配置命中' : 'Created · configured source'}</option>
        <option value="reused">{zh ? '已有资产 · 跳过' : 'Existing · skip'}</option>
        <option value="unknown">{zh ? '首次建档 · 来源缺配置' : 'Created · source unconfigured'}</option>
        <option value="retry">{zh ? '同一决定重试 · 不重复加分' : 'Retry · no duplicate award'}</option>
      </select>
    </label>
    <div className="source-case-inspector processing-io-case" aria-label={zh ? '输入与输出' : 'Input and output'}>
      <section className="source-case-inspector-section">
        <div className="source-case-inspector-heading"><h3>{zh ? '输入' : 'Input'}</h3><span>{zh ? '仅列本步骤使用字段' : 'Consumed fields only'}</span></div>
        <div className="processing-input-source">
          <div className="processing-input-source-heading">{link(n => n.reference_number === (branch === 'reused' ? 3004 : 3002))}</div>
          <p className="processing-io-case-caption">{zh ? '建档结果为规定格式；source_id 由采集链路传递，不从账号身份猜测。' : 'Planned handoff; the collection route supplies source_id, not the account identity.'}</p>
          <Rows rows={Object.entries(input).filter(([key]) => ['asset_id', 'asset_name', 'action', 'source_id'].includes(key))} />
        </div>
        <div className="processing-input-source">
          <div className="processing-input-source-heading">{link(n => n.name === catalog.table_name)}</div>
          <p className="processing-io-case-caption">{branch === 'retry'
            ? zh ? '重试展示已保存决定的配置快照，直接复用，不重新取当前配置。' : 'A retry displays the saved configuration snapshot, without reading current configuration.'
            : zh ? '独立配置表按 source_id 查询；完整横表及字段约束请打开表卡。已有资产直接跳过。' : 'Look up the independent table by source_id; open its card for the full table. Existing assets skip lookup.'}</p>
          <Rows rows={branch === 'reused' ? [['lookup', zh ? '跳过' : 'Skipped']] : config
            ? [['source_id', config.source_id], ['initial_score', config.initial_score], ['rule_version', config.rule_version], ['half_life_minutes', config.half_life_minutes]]
            : [['matched_rows', 0]]} />
        </div>
      </section>
      <section className="source-case-inspector-section">
        <div className="source-case-inspector-heading"><h3>{zh ? '输出' : 'Output'}</h3><span>{statuses[result.status]?.[zh ? 0 : 1] || result.status}</span></div>
        {decision ? <div className="processing-input-source">
          <div className="processing-input-source-heading">{link(n => n.reference_number === 3006)}</div>
          <Rows rows={Object.entries(decision).filter(([key]) => !['source_id', 'configuration'].includes(key))} />
          <p className="processing-io-case-caption">{zh ? 'source_id 与配置快照保存在详细评分决定中，由 decision_ref 回查；后续统一事件格式不增加来源字段。重试沿用原决定，不新发奖励。' : 'Retain source_id and the configuration snapshot in the detailed decision, reachable through decision_ref. The common event schema is unchanged; retries reuse the decision.'}</p>
        </div> : <p>{zh ? '本分支不向 #3006 提交首次评分事件。缺配置保留待处理资格；补配置后重试，不重新建档。' : 'No initial event is submitted. Missing configuration remains pending and can be retried after configuration is added, without recreating the asset.'}</p>}
        <Rows rows={[[zh ? '本次新增贡献' : 'New contribution', result.added]]} />
      </section>
    </div>
    <section className="source-case-inspector-explanation node-case-explanation">
      <h3>{zh ? '记录依据' : 'Provenance'}</h3>
      <p>{zh ? `账号 ${selected.source_record.name} 来自真实 #2030 返回；建档、配置查询、评分决定和发布仍是规定结果。以上只是可执行演算，不证明后台已经运行。` : `The account ${selected.source_record.name} was observed in #2030. Creation, configuration lookup, decisions and publication remain specified outcomes; this preview is not backend execution.`}</p>
      <p>{zh ? '首次建档按来源奖励一次；群讨论、新进展和召回交由各自信号规则，分别定义加分。' : 'Award creation once by source. Group discussion, new developments and recalls belong to independent signal rules.'}</p>
    </section>
  </>;
}
