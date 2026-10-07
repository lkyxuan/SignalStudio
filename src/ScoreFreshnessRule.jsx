import React from 'react';
import sync from '../catalog/supabase-score-sync.v1.json';

export function ScoreFreshnessRule({ language }) {
  const zh = language === 'zh-CN';
  const minutes = sync.frontend_read.freshness_seconds / 60;
  return <section className="processing-goal-readonly execution-trigger">
    <h3>{zh ? `读取规则 · #1007 → 前端 · ${minutes} 分钟` : `Read rule · #1007 → frontend · ${minutes} minutes`}</h3>
    <p>{zh ? '筛选发生在 #1007 → 前端：前端或读取接口带上条件，由 Supabase 查询先过滤，再排序、分页。#3010 → #1007 只负责实时同步，不判断这项有效期。' : 'Filtering belongs to #1007 → frontend: the frontend or read API supplies the conditions, and Supabase filters before ordering and pagination. #3010 → #1007 handles immediate synchronization without this freshness check.'}</p>
    <p>{zh ? `先筛选 calculated_at 在最近 ${minutes} 分钟内的 total_heat 记录，再按 score_value 降序、asset_id 升序分页；例如先加载 20 条，最多展示 100 条。这个值可配置，同步仍立即触发。` : `First filter total_heat rows whose calculated_at is within the last ${minutes} minutes, then order by score_value descending and asset_id ascending and paginate, e.g. 20 initially and up to 100 displayed. This value is configurable; synchronization still triggers immediately.`}</p>
    <p>{zh ? '例如最后计算于 00:00:00，00:02:59 仍可展示，到 00:03:00 就不再展示；Supabase 旧行不删除。已打开的页面也要按时移除过期行。' : 'A row calculated at 00:00:00 is eligible at 00:02:59 and expires at 00:03:00. Keep the stored Supabase row; already-open pages must expire it too.'}</p>
    <p>{zh ? '使用来源 calculated_at，不用重试写入时间 synced_at 续期。前提是榜内资产持续重算并同步；分数不变而跳过写入或链路故障可能误隐藏，稳定分数如何续期待实现时明确，本次未增加心跳写入。' : 'Use source calculated_at, never retry-time synced_at, for freshness. Ongoing in-list recalculation and delivery are required. Unchanged-score skips or failures may falsely hide rows; stable-score renewal remains to be resolved, with no heartbeat writes added here.'}</p>
    <details className="processing-technical"><summary>{zh ? '前端读取实现要求 · 待实现' : 'Frontend read requirements · pending'}</summary>
      <ul>{sync.frontend_read[zh ? 'requirements_zh' : 'requirements_en'].map(text => <li key={text}>{text}</li>)}</ul>
      <p><code>catalog/supabase-score-sync.v1.json → frontend_read</code></p>
    </details>
  </section>;
}
