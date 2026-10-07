import React from 'react';
import sync from '../catalog/supabase-score-sync.v1.json';
import tables from '../catalog/business-tables.v1.json';
import { BusinessTableRows } from './BusinessTableRows';

export function SupabaseScoreSyncCard({ graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const source = graph.nodes.find(node => node.name === sync.source_table);
  const target = graph.nodes.find(node => node.name === sync.target_table);
  const link = node => node && <button onClick={() => openNode(node.id)}>#{node.reference_number} {node.name}</button>;
  const sourceTable = { ...tables.tables[sync.source_table], columns: tables.tables[sync.source_table].columns.filter(column => sync.input_fields.includes(column.name)) };
  return <div className="processing-card-frame">
    <p className="processing-io-case-caption">{zh ? '演算案例 · 尚未运行同步或写入 Supabase。#1006 变化即处理，只写当前前 100 名；出榜旧行保留。' : 'Illustrative, not deployed. Process #1006 changes immediately; write current top-100 candidates only and retain old rows after exit.'}</p>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section">
        <h3>{zh ? '输入 · #1006 榜单边界变化' : 'Input · source leaderboard boundary'}</h3>
        <div className="processing-input-source-heading"><span>{zh ? '来自' : 'From'}</span>{link(source)}</div>
        <h4>{zh ? '变化前' : 'Before'}</h4>
        <BusinessTableRows table={sourceTable} rows={sync.case.before} language={language} />
        <h4>{zh ? '变化后' : 'After'}</h4>
        <BusinessTableRows table={sourceTable} rows={sync.case.changes} language={language} />
        <p className="processing-io-case-caption">{zh ? '另有 99 个资产高于 55 分且不变，此处省略。KASUN 原来榜外，升至 55 后进入前 100。来源快照版本假设从 1 变为 2，版本通道仍待实现。' : '99 unchanged assets above 55 are omitted. KASUN enters the top 100 at 55. Assume snapshot version advances from 1 to 2; version transport remains unimplemented.'}</p>
      </section>
      <section className="source-case-inspector-section">
        <h3>{zh ? '输出 · 本次只写 KASUN' : 'Output · write KASUN only'}</h3>
        <div className="processing-input-source-heading"><span>{zh ? '写入' : 'To'}</span>{link(target)}</div>
        <BusinessTableRows table={tables.tables[sync.target_table]} rows={sync.case.output} language={language} />
        <p className="processing-io-case-caption">{zh ? '已有 asset_id + score_key：更新这一行；不存在：新增这一行。' : 'Existing asset_id + score_key: update that row. Missing key: insert that row.'}</p>
        <h4>{zh ? '保留旧行 · 本次不写、不删' : 'Retained old row · no write or delete'}</h4>
        <BusinessTableRows table={tables.tables[sync.target_table]} rows={sync.case.retained_output} language={language} />
        <p className="processing-io-case-caption">{zh ? sync.case.note_zh : sync.case.note_en}</p>
      </section>
    </div>
    <section className="processing-goal-readonly execution-trigger">
      <h3>{zh ? '同步规则' : 'Synchronization rules'}</h3>
      <p>{zh ? '触发：#1006 得分变化立即处理，无定时窗口。选取：total_heat 按完整精度得分降序、asset_id 升序取前 100。写入：只新增缺失行或更新变化分数，不存排名。' : 'Trigger: process source changes immediately without a timed window. Select: top 100 total_heat scores by full precision descending, asset_id ascending. Write: insert missing rows or update changed scores; no stored rank.'}</p>
      <p>{zh ? '保留：出榜资产停止更新，旧行继续存在。前 100 是每次写入的范围，不是 Supabase 总行数上限。' : 'Retention: stop updating exits but keep their old rows. Top 100 limits each write’s candidates, not the target table size.'}</p>
      <p>{zh ? '目标会保留旧分，因此直接对目标所有行排序不一定等于 #1006 此刻的前 100；本次不增加清理或成员标记。' : 'Old scores remain, so sorting all target rows may differ from the current source top 100. No cleanup or membership flag is introduced.'}</p>
      <details className="processing-technical"><summary>{zh ? '实现要求 · 待后端实现' : 'Implementation requirements · pending'}</summary>
        <ul>{sync.implementation_request[zh ? 'requirements_zh' : 'requirements_en'].map(text => <li key={text}>{text}</li>)}</ul>
        <p><code>catalog/supabase-score-sync.v1.json</code></p>
      </details>
    </section>
    <section className="processing-goal-readonly execution-trigger processing-algorithm">
      <h3>{zh ? '算法说明' : 'Algorithm'}</h3>
      <p>{zh ? '每当后端得分变化，就读取当前前 100 名。逐个用资产 ID 和评分维度查 Supabase：找不到就新增，找到且分数变化就更新，相同则跳过。榜外资产不写也不删。处理成功后确认来源版本；失败恢复重试，旧任务不得覆盖新结果。' : 'Whenever backend scores change, read the current top 100. For each asset and score key, insert if missing, update if its score changed, otherwise skip. Neither write nor delete outsiders. Acknowledge the source version after success; retry recoverably and prevent stale overwrites.'}</p>
      <p>{zh ? '本例只把新入榜 KASUN 的 55 分写过去，Stake | Bonus 原来的 50 分留着。没有 5 秒等待，也不会把分数相加或重新计算。' : 'Here only KASUN’s new 55 is written. Stake | Bonus keeps its old 50. There is no five-second wait, summation or score recalculation.'}</p>
    </section>
  </div>;
}
