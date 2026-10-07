import React from 'react';
import sync from '../catalog/supabase-score-sync.v1.json';
import tables from '../catalog/business-tables.v1.json';
import { BusinessTableRows } from './BusinessTableRows';

export function SupabaseScoreSyncCard({ graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const source = graph.nodes.find(node => node.name === sync.source_table);
  const target = graph.nodes.find(node => node.name === sync.target_table);
  const link = node => node && <button onClick={() => openNode(node.id)}>#{node.reference_number} {node.name}</button>;
  const sourceTable = { ...tables.tables[sync.source_table], columns: tables.tables[sync.source_table].columns.filter(column => sync.input_fields.includes(column.name)), primary_key: ['asset_id', 'score_key', 'calculated_at'] };
  return <div className="processing-card-frame">
    <p className="processing-io-case-caption">{zh ? '设计案例 · 尚未运行同步或写入 Supabase。覆盖所有有评分记录的资产，不限前 100。' : 'Design case · no synchronization or Supabase write has run. Covers all scored assets, not only the top 100.'}</p>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section">
        <div className="source-case-inspector-heading"><h3>{zh ? '输入 · 同一资产的连续变化' : 'Input · successive score changes'}</h3></div>
        <div className="processing-input-source-heading"><span>{zh ? '来自' : 'From'}</span>{link(source)}</div>
        <BusinessTableRows table={sourceTable} rows={sync.case.changes} language={language} />
        <p className="processing-io-case-caption">{zh ? '三行表示同一条 #1006 记录先后变成的值，不是同时存在的三条当前分。' : 'The three rows are successive values of one #1006 record, not three simultaneous current scores.'}</p>
        <p className="processing-io-case-caption">{zh ? '同步变更元数据（待实现）：三次变化的 source_version 分别为 1、2、3；它来自可靠变更通道，目前不在 #1006 快照字段中。完整源表可点击上方卡片查看。' : 'Proposed change metadata: source_version 1, 2 and 3 for these changes, supplied by a durable change stream. It is absent from current #1006 snapshots. Open the source card for its full schema.'}</p>
      </section>
      <section className="source-case-inspector-section">
        <div className="source-case-inspector-heading"><h3>{zh ? '输出 · 只写最新一次' : 'Output · latest version only'}</h3></div>
        <div className="processing-input-source-heading"><span>{zh ? '写入' : 'To'}</span>{link(target)}</div>
        <BusinessTableRows table={tables.tables[sync.target_table]} rows={sync.case.output} language={language} />
        <p className="processing-io-case-caption">{zh ? sync.case.note_zh : sync.case.note_en}</p>
      </section>
    </div>
    <section className="processing-goal-readonly execution-trigger">
      <h3>{zh ? '同步规则' : 'Synchronization rules'}</h3>
      <p>{zh ? '以 asset_id + score_key 为键，所有有评分记录的资产都可同步。只更新发生变化的资产，不写 rank 或名次；不为无评分记录的资产补零。' : 'Key by asset_id + score_key. All scored assets are eligible. Update changed assets only, without a rank field or zero filling for unscored assets.'}</p>
      <p>{zh ? `固定 ${sync.configuration.window_seconds_proposal} 秒合并窗口为试验建议，尚未部署；批量大小、总写入预算及延迟目标需容量测试后确定。` : `A fixed ${sync.configuration.window_seconds_proposal}-second coalescing window is a trial proposal, not deployed. Batch size, global write budget and latency targets await capacity tests.`}</p>
      <p>{zh ? '前端从 Supabase 按 score_value 降序、asset_id 升序取前 100；查询限制不限制同步资产数量。' : 'The frontend queries Supabase by score_value descending, then asset_id ascending, limiting results to 100. This does not limit the synchronization scope.'}</p>
      <details className="processing-technical"><summary>{zh ? '实现要求 · 待后端实现' : 'Implementation requirements · pending'}</summary>
        <ul>{sync.implementation_request[zh ? 'requirements_zh' : 'requirements_en'].map(text => <li key={text}>{text}</li>)}</ul>
        <p><code>catalog/supabase-score-sync.v1.json</code></p>
      </details>
    </section>
    <section className="processing-goal-readonly execution-trigger processing-algorithm">
      <h3>{zh ? '算法说明' : 'Algorithm'}</h3>
      <p>{zh ? '收到当前分变化后，按资产和评分维度放入待同步集合。同一个键再次变化时，只保留来源版本更高的完整结果。固定窗口结束，批量写入 Supabase；目标已有较新版本时跳过旧结果。同步成功后确认该版本，失败则保留并重试。' : 'Put score changes in a pending set keyed by asset and score dimension. Keep the full result with the highest source version for each key. At the fixed window boundary, batch writes to Supabase, rejecting results older than the target. Acknowledge the submitted version after success; retain and retry failures.'}</p>
      <p>{zh ? '本例 100 → 105 → 108 只写 108，不相加、不重新计算衰减，也不改其他资产的排名。calculated_at 沿用原计算时间，synced_at 记录同步成功时间。' : 'For 100 → 105 → 108, write 108 only. Do not sum snapshots, recalculate decay or rewrite other assets’ ranks. Preserve calculated_at and record successful synchronization as synced_at.'}</p>
    </section>
  </div>;
}
