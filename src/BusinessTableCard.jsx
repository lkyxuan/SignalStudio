import initialSources from '../catalog/asset-initial-score-sources.v1.json';
import { initialScorePolicy } from './initialScoreDesign';
import React, { useState } from 'react';
import contract from '../catalog/business-tables.v1.json';
import tableCases from '../catalog/business-table-cases.v1.json';
import identityCase from '../catalog/identity-flow-case.v1.json';
import supabaseSync from '../catalog/supabase-score-sync.v1.json';
import scoreRollup from '../catalog/score-rollup.v1.json';
import './processing-io-card.css';
import { ScoreFreshnessRule } from './ScoreFreshnessRule';
import { BusinessTableRows } from './BusinessTableRows';
import { TableBackfillCard } from './TableBackfillCard';
import weightDesign from '../catalog/dynamic-weights.v1.json';
import { DynamicWeightsNotes } from './DynamicWeightsNotes';
import currentPages from '../catalog/asset-pages.v1.json';

const number = index => String(index + 1).padStart(2, '0');

const notes = {
  supabase_asset_scores: '演算案例，非 Supabase 实际记录。仅在资产自身得分变化且当前位于前 100 时写入，不补位；已有则更新，没有则新增，不存排名。旧资产出榜后不删、不更新，总行数可超过 100。本例新增 KASUN 的 55，保留 Stake | Bonus 的旧分 50。来源版本和同步时间属于待实现的同步协议。',
  assets: '前 2 行来自真实 #2030 账号输入的目标建档案例；Bitcoin 等为原有资产格式案例。名称含“示例”的人物、项目、主题币和账号均为假设，confirmed 也只是示例状态，不代表实际审核。不同对象各有 asset_id，用 asset_kind 分类；人物无需另建主表。尚无后台写入结果。',
  asset_identifiers: '一条对象可有多行标识。前 2 个 X 用户 ID 来自真实 #2030 返回；Bitcoin 的来源 ID、中文名和简称指向同一对象。case: 开头的范围均为假设：人物别名指向人物，账号 ID 指向账号，链及合约地址指向代币。核心为三项字段，后台可保留必要辅助字段；歧义别名不能强行唯一绑定。尚无后台写入结果。',
  asset_relationships: '这 10 行全部是假设案例：人物投资项目、账号属于人物、代币以人物为主题，以及同一项目的两个独立账号，并各列反向关系。每行有独立 row_id，不共用关系 ID；主题关系不等于官方发行或背书。证据及审核引用均为示例。created_at 只表示系统记录时间；关系不自动传分。历史修订与撤销尚未实现。',
  asset_monitoring_rules: '这 3 行用于说明监控规则的目标表格式；阈值、状态和审核记录尚未执行。',
  asset_score_events: '规划为各程序先保存详细判定，再将加分事件送入 Redpanda；Redis 保留近期窗口，Delta/Parquet 归档完整流水，二者独立消费。decision_ref 用于回查判定过程。尚无真实写入。',
  asset_scores_current: '以下 5 行为模拟计算案例，时间均为假设，并非后台写入结果。当前分由 #3005 在新贡献进入缓存后立即更新受影响资产，并每 60 秒刷新事件资产衰减；本次 Demo 只使用 total_heat 全量热度。#3005 将新资产的起始 +100 按 7 天半衰期衰减，后续贡献可各按自己的规则汇总。默认排名读取最近一轮保存的分数。实际回填见下方独立模块。',
};

const notesEn = {
  supabase_asset_scores: 'Illustrative, not observed Supabase records. Upsert only an asset whose own score changed and is currently top 100; no backfill, without a stored rank. Retain old rows after exit, so the target can exceed 100 rows. This case writes KASUN at 55 and keeps Stake | Bonus at its old 50. Version and sync time belong to the proposed protocol.',
  assets: 'The first two target rows use observed #2030 accounts and remain pending. Bitcoin and peers are existing format cases. All objects named 示例, their identities and confirmed statuses are fictional, not real approvals. People, projects, tokens and accounts have distinct asset_ids in one registry, classified by asset_kind. No backend write is claimed.',
  asset_identifiers: 'An object may have multiple identifiers. The first two X IDs were observed in #2030; Bitcoin IDs and aliases map to one object. All case: namespaces are fictional: a person alias maps to the person, an account ID to the account, and a chain-scoped contract to the token. These are three core fields, not a limit on physical auxiliary fields. Ambiguous aliases cannot force a unique identity. No backend writes are claimed.',
  asset_relationships: 'All ten rows are fictional: a person invests in a project, an account belongs to a person, and a token is themed after a person, plus two separate accounts of one project, each with a reverse row. Every row has its own row_id, without a shared relationship ID. A theme does not establish issuance or endorsement. Evidence and reviews are placeholders. created_at is system entry time only; relationships do not propagate scores. Historical revisions and revocations are not implemented.',
  asset_monitoring_rules: 'These rows specify the target rule format; thresholds and reviews have not been executed.',
  asset_score_events: 'Programs save detailed decisions, then send score events to Redpanda. Independent consumers maintain a recent Redis window and the full Delta/Parquet archive. decision_ref locates the decision. No running write has been observed.',
  asset_scores_current: 'These five rows are illustrative calculations with assumed timestamps, not backend writes. Current scores are updated by #3005 immediately for affected assets after new contributions and every 60 seconds for event-asset decay. This demo uses only total_heat. #3005 decays the initial +100 contribution with a seven-day half-life; future contributions may have their own rules. Default rankings read the latest stored cycle. Actual backfills appear in the separate module below.',
};

export function BusinessTableCard({ node, language }) {
  const zh = language === 'zh-CN';
  const [caseIndex, setCaseIndex] = useState(0);
  const pageVersions = currentPages;
  const pageHistory = node.name === pageVersions.table.name;
  const table = pageHistory ? pageVersions.table : contract.tables[node.name];
  const caseRows = ['assets', 'asset_identifiers'].includes(node.name) ? identityCase.tables[node.name].rows : [];
  const sourceConfig = node.name === initialSources.table_name;
  const weightTable = weightDesign.tables[node.name];
  const rows = pageHistory ? pageVersions.example_rows : weightTable ? weightTable.rows : sourceConfig ? initialSources.rows : node.name === supabaseSync.target_table ? [...supabaseSync.case.output, ...supabaseSync.case.retained_output] : [...caseRows, ...(tableCases.tables[node.name] || [])];
  const scoreAssumptions = node.name === 'asset_scores_current' ? tableCases.score_case_assumptions : null;
  const scoringTable = ['asset_score_events', 'asset_scores_current'].includes(node.name);
  const scoreCase = identityCase.cases[caseIndex];
  const policy = initialScorePolicy;
  const assetId = scoreCase.create_result.asset_id;
  const decisionRef = policy.decision_ref_template.replace('{asset_id}', assetId);
  const plannedFields = node.name === 'asset_score_events'
    ? [['asset_id', assetId], ['asset_name', scoreCase.create_result.asset_name], ['event_key', zh ? '待 #3006 稳定生成' : 'To be generated by #3006'],
      ['score_key', policy.input_score_key], ['decision_ref', decisionRef], ['score_delta', `+${policy.score_delta}`],
      ['created_at', zh ? '待评分事件首次接受时确定' : 'To be set on first score-event acceptance'],
      ['decay_policy_ref', policy.decay_policy_ref], ['half_life_minutes', policy.decay.half_life_minutes]]
    : [['asset_id', assetId], ['asset_name', scoreCase.create_result.asset_name], ['score_key', policy.current_score_key],
      ['score_value', zh ? '100 × 2^(-实际经过分钟数 / 10080)，显示两位小数' : '100 × 2^(-actual_elapsed_minutes / 10080), display to two decimals'],
      ['calculated_at', zh ? '待 #3005 首次实际计算时确定' : 'To be set by #3005 on first calculation']];
  return <div className="business-table-card">
    <BusinessTableRows table={table} rows={rows} language={language} />
    <div className="business-table-afterword">
      {['assets', 'asset_identifiers', 'asset_relationships'].includes(node.name) && <p>{zh ? table.purpose_zh : table.purpose_en}</p>}
      {scoreAssumptions && <p className="processing-io-case-caption">{zh ? '模拟案例 · 假设每个资产仅收到一次 +100，半衰期 7 天，统一在 2026-10-15 00:00 UTC 计算；不是实际评分。' : 'Illustrative cases · assume one +100 event per asset, a seven-day half-life, and a common calculation time of 2026-10-15 00:00 UTC. These are not actual scores.'}</p>}
      <p><strong>{rows.length} {sourceConfig ? zh ? '行规则配置' : 'configuration rows' : zh ? scoreAssumptions ? '行设计案例' : '行产品案例' : scoreAssumptions ? 'design case rows' : 'product case rows'}</strong> · {pageHistory ? zh ? pageVersions.provenance_zh : pageVersions.provenance_en : weightTable ? zh ? weightDesign.provenance_zh : weightDesign.provenance_en : sourceConfig ? zh ? initialSources.provenance_zh : initialSources.provenance_en : zh ? notes[node.name] : notesEn[node.name]}</p>
      {pageHistory && <>
        <p>{zh ? pageVersions.table.purpose_zh : pageVersions.table.purpose_en}</p>
        <p className="processing-io-case-caption">{zh ? pageVersions.case_note_zh : pageVersions.case_note_en}</p>
        <ul>{(zh ? pageVersions.rules_zh : pageVersions.rules_en).map(rule => <li key={rule}>{rule}</li>)}</ul>
      </>}
      {weightTable && <DynamicWeightsNotes name={node.name} language={language} />}
        {scoreAssumptions && <p className="processing-io-case-caption">{zh ? '假设的事件入账时间：' : 'Assumed event entry times: '}{scoreAssumptions.events.map(event => `${event.asset_name}: ${event.assumed_created_at}`).join('；')}</p>}
      {node.name === supabaseSync.target_table && <p>{zh ? '案例只列两行，省略另 99 行。#3010 只判断本次变化资产是否前 100，不补位，旧记录保留；前端按 Supabase 已存分数降序、asset_id 升序分页读，例如首屏 20、最多 100；先过滤最近 3 分钟的 calculated_at，再排序分页；不回查源榜单校正。' : 'Only two illustrative rows are shown; 99 are omitted. #3010 evaluates only the changed asset, without backfilling, and retains old rows. The frontend pages by stored score descending then asset ID ascending, e.g. 20 initially and up to 100 displayed; filter calculated_at to the last three minutes before ordering and pagination, without source reconciliation.'}</p>}
      {node.name === supabaseSync.target_table && <ScoreFreshnessRule language={language} />}
      {scoringTable && <div className="processing-input-source">
        <label className="source-case-inspector-picker">{zh ? '贯通案例 · 目标表行' : 'Through-line case · intended table row'}
          <select value={caseIndex} onChange={event => setCaseIndex(Number(event.target.value))}>{identityCase.cases.map((item, index) =>
            <option value={index} key={item.source_record.id}>{index + 1} · {item.source_record.name} · @{item.source_record.username}</option>)}</select></label>
        <p className="processing-io-case-caption">{zh ? node.name === 'asset_score_events'
          ? `#2030 实际返回 ${scoreCase.source_record.name}；若它首次建档，#3008 应将 #5001 的一次 +100 事件归档为下列八项字段，包括 10080 分钟半衰期。当前没有真实 #1005 行，event_key 与入账时间未生成。`
          : `#2030 实际返回 ${scoreCase.source_record.name}；若它首次建档并收到起始 +100，#3005 应写下列当前分。半衰期为 7 天（10080 分钟）；事件入账时间和计算时间尚未确定，所以还没有数值分或真实 #1006 行。`
          : node.name === 'asset_score_events'
            ? `#2030 returned ${scoreCase.source_record.name}. If first created, #3008 should archive one +100 event with all eight fields, including the 10,080-minute half-life. No real #1005 row, event key, or entry time exists.`
            : `#2030 returned ${scoreCase.source_record.name}. If first created and awarded +100, #3005 should write this current-score record. The half-life is seven days (10,080 minutes), but the timestamps are unknown, so there is no numeric value or real #1006 row.`}</p>
        <dl className="source-case-inspector-fields">{plannedFields.map(([name, value], index) => <div key={name}>
          <dt><span className="source-case-field-number">{number(index)}</span><code>{name}</code></dt><dd>{value}</dd>
        </div>)}</dl>
      </div>}
      {scoreAssumptions && <p>{zh ? `目标更新来源：#3005 · 新贡献入 #6001 后立即重算受影响资产，另每 ${scoreRollup.configuration.schedule.interval_seconds} 秒刷新事件资产衰减；不补无事件资产的零分。这里的固定快照按取样与 Git 同步更新。` : `Target producer: #3005 immediately recomputes affected assets after new contributions in #6001 and refreshes event-asset decay every ${scoreRollup.configuration.schedule.interval_seconds} seconds; no zero filling for eventless assets. This fixed snapshot changes through sampling and Git synchronization.`}</p>}
      {node.name === 'asset_scores_current' && <TableBackfillCard table={table} language={language} />}
      <details className="business-table-technical"><summary>{zh ? '其他设置 · 字段说明' : 'Other settings · field definitions'}</summary>
        <div className="business-table-schema-scroll"><table>
          <thead><tr><th>#</th><th>{zh ? '字段名' : 'Field name'}</th><th>{zh ? '含义' : 'Meaning'}</th><th>{zh ? '类型' : 'Type'}</th><th>{zh ? '约束' : 'Constraint'}</th></tr></thead>
          <tbody>{table.columns.map((column, index) => {
            const primary = table.primary_key.includes(column.name);
            const unique = table.unique_keys?.find(key => key.includes(column.name));
            const keyLabel = primary ? table.primary_key.length > 1 ? zh ? '联合主键' : 'composite PK' : 'PK'
              : unique ? unique.length > 1 ? zh ? '组合唯一' : 'composite UQ' : 'UQ' : null;
            return <tr key={column.name}><td>{number(index)}</td><td><code>{column.name}</code></td><td>{zh ? column.label_zh : column.name.replaceAll('_', ' ')}</td><td>{column.type}{column.format ? ` · ${column.format.toUpperCase()}` : ''}</td>
              <td>{[keyLabel, column.required ? zh ? '必填' : 'required' : zh ? '可空' : 'nullable'].filter(Boolean).join(' · ')}</td></tr>;
          })}</tbody>
        </table></div>
      </details>
    </div>
  </div>;
}
