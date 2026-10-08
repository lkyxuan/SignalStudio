import React from 'react';
import catalog from '../catalog/leaderboard-scaffolds.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import './processing-io-card.css';

export const leaderboardCard = name => catalog.boards.find(board =>
  [board.cache_name, board.calculator_name, board.table_name].includes(name));

export function LeaderboardScaffoldCard({ node, graph, openNode, language }) {
  const board = leaderboardCard(node.name);
  const zh = language === 'zh-CN';
  const pending = zh ? '待定义' : 'Pending';
  const status = zh ? '设计骨架 · 尚未接入数据或运行' : 'Design scaffold · no data connected or execution observed';
  const schema = { columns: catalog.columns, primary_key: catalog.primary_key };
  const settings = <details className="processing-advanced"><summary>{zh ? '其他设置' : 'Other settings'}</summary>
    <p>{zh ? '逻辑表主键：asset_id。五榜分别保存结果；物理数据库部署方式待定。' : 'Logical primary key: asset_id. Each board stores its own results; physical database deployment is pending.'}</p>
    {catalog.columns.map(field => <p key={field.name}><code>{field.name}</code> · {field.data_type} · {zh ? field.label_zh : field.meaning_en}</p>)}
    <p>{zh ? '数据来源、入榜资格、排序方向、展示数量、更新频率与有效期后续逐榜确定。' : 'Sources, eligibility, sort direction, display limit, cadence and freshness will be defined per board.'}</p>
  </details>;
  if (node.name === board.table_name) return <div className="business-table-card">
    <BusinessTableRows table={schema} rows={[]} language={language} />
    <p className="processing-io-case-caption">{status}</p>
    <p>{zh ? `${board.label_zh}榜结果表：预留本榜资产得分与计算版本。当前没有可展示的运行记录，不代表已部署的表为空。` : `${board.label_en} results: reserved fields for asset scores and calculation versions. No observed records are available; this does not claim a deployed table is empty.`}</p>
    {settings}
  </div>;
  if (node.name === board.cache_name) return <div className="processing-card-frame">
    <h3>{zh ? `${board.label_zh}榜数据区` : `${board.label_en} data area`}</h3>
    <p>{status}</p>
    <p>{zh ? '预留本榜所需的数据；具体字段在确定输入和算法后补充。' : 'Reserve data needed by this board; fields will follow input and algorithm decisions.'}</p>
    <dl className="source-case-inspector-fields">
      {[[zh ? 'Redis 服务' : 'Redis service', zh ? '五榜共用一个服务的设计' : 'One shared service design'],
        ['key prefix', board.key_prefix],
        [zh ? 'Redis 数据类型' : 'Redis data type', pending],
        [zh ? '数据字段 / 保留时间 / 重建来源' : 'Schema / retention / rebuild source', pending]].map(([name, value]) => <div key={name}><dt>{name}</dt><dd><code>{value}</code></dd></div>)}
    </dl>
    <p>{zh ? '这是逻辑 key 前缀，不是五个 Redis 实例，也不要求五种不同的 Redis 类型。尚未创建实际 key。' : 'These are logical key prefixes, not five Redis instances or five required data types. No live keys have been created.'}</p>
  </div>;
  const fields = catalog.columns.map(field => <div key={field.name}><dt><span className="source-case-field-number">{String(catalog.columns.indexOf(field) + 1).padStart(2, '0')}</span><code>{field.name}</code></dt><dd>{zh ? field.label_zh : field.meaning_en}</dd></div>);
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language}
    algorithm={zh ? '本榜独立算法待定义。先确定输入和评分规则，再补充可核对的计算案例；当前不计算分数，也不自动从 total_heat 推导。各榜可以分别使用新资产条件，分值尚未确定。' : 'This board’s independent algorithm is pending. Define inputs and scoring rules before adding a verifiable case. No score is calculated or automatically derived from total_heat. Boards may each use the new-asset condition; points remain undecided.'}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 待定义字段' : 'Input · fields pending'}</h3><p>{board.cache_name}</p><p>{zh ? '来源和消费字段尚未确定。' : 'Sources and consumed fields are not yet defined.'}</p></section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 预留格式' : 'Output · reserved format'}</h3><code>{board.table_name}</code><dl className="source-case-inspector-fields">{fields}</dl></section>
    </div>
    <p className="processing-io-case-caption">{status}</p>
    {settings}
  </ProcessingCardFrame>;
}
