import React, { useState } from 'react';
import pilot from '../catalog/identity-flow-case.v1.json';
import { displayCaseValue } from './smartFollowingCase';
import { NodeCaseExplanation } from './ProcessingIOCard';
import { nodeRef, IDENTITY_REFS } from './graphRefs';
import './source-case-inspector.css';
import './processing-io-card.css';

const NUMBER = index => String(index + 1).padStart(2, '0');
const findNode = (graph, reference) => graph.nodes.find(item => item.reference_number === reference);
const tableRow = (table, assetId) => pilot.tables[table].rows.find(row => row.asset_id === assetId);

function Fields({ rows }) {
  return <dl className="source-case-inspector-fields">{rows.map(([name, value], index) =>
    <div key={name}><dt><span className="source-case-field-number">{NUMBER(index)}</span><code>{name}</code></dt>
      <dd>{typeof value === 'string' && value.startsWith('https://') ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : displayCaseValue(value)}</dd></div>)}</dl>;
}

function Picker({ index, setIndex, zh }) {
  return <label className="source-case-inspector-picker">{zh ? '输入案例' : 'Input case'}
    <select value={index} onChange={event => setIndex(Number(event.target.value))}>{pilot.cases.map((item, position) =>
      <option value={position} key={item.lookup_key.external_identifier}>{position + 1} · {item.source_record.name} · @{item.source_record.username}</option>)}</select>
  </label>;
}

function Source({ source, openNode, language, caption, rows }) {
  const zh = language === 'zh-CN';
  return <div className="processing-input-source"><div className="processing-input-source-heading"><span>{zh ? '来自' : 'From'}</span>
    <button onClick={() => source && openNode(source.id)}>{source ? `${nodeRef(source)} ${source.name}` : '—'}</button></div>
    <p className="processing-io-case-caption">{caption}</p><Fields rows={rows} /></div>;
}

function Target({ target, openNode, language, caption, rows }) {
  const zh = language === 'zh-CN';
  return <div className="processing-input-source"><div className="processing-input-source-heading"><span>{zh ? '送往' : 'To'}</span>
    <button onClick={() => target && openNode(target.id)}>{target ? `${nodeRef(target)} ${target.name}` : '—'}</button></div>
    <p className="processing-io-case-caption">{caption}</p><Fields rows={rows} /></div>;
}

export function IdentityPilotStep({ node, graph, openNode, language, purpose }) {
  const zh = language === 'zh-CN';
  const [index, setIndex] = useState(0);
  const selected = pilot.cases[index];
  const record = selected.source_record;
  const accountRows = [['id', record.id], ['name', record.name]];
  const step44 = node.reference_number === IDENTITY_REFS.lookup;
  const asset = tableRow('assets', selected.create_result.asset_id);
  const identifier = tableRow('asset_identifiers', selected.create_result.asset_id);
  const initialScore = pilot.initial_score_policy;
  const lookupRows = [...Object.entries(selected.lookup_key), ['row_count', selected.lookup_result.row_count],
    ['asset_id', selected.lookup_result.asset_id], ['asset_name', selected.lookup_result.asset_name]];
  const output44 = [...accountRows, ['asset_id', null], ['asset_name', null], ['match_status', 'unmatched']];
  return <><Picker index={index} setIndex={setIndex} zh={zh} />
    <div className="source-case-inspector processing-io-case" aria-label={zh ? '输入与输出' : 'Input and output'}>
      <section className="source-case-inspector-section"><div className="source-case-inspector-heading"><h3>{zh ? '输入' : 'Input'}</h3><span>{step44 ? 2 : 1} {zh ? '个来源' : 'sources'}</span></div>
        {step44 ? <>
          <Source source={findNode(graph, IDENTITY_REFS.source)} openNode={openNode} language={language}
            caption={zh ? `真实 Kaito MCP 返回；100 条中的第 ${index + 1} 条，保存其中 2 条。未验证 Redpanda 消费。` : `Actual Kaito MCP response; row ${index + 1} of 100, two saved. Redpanda consumption unverified.`} rows={accountRows} />
          <Source source={findNode(graph, IDENTITY_REFS.identifiers)} openNode={openNode} language={language}
            caption={zh ? '此案例设定 #1002 暂无该 X ID；0 行是判断分支的预期查表结果，尚未连接后台表。' : 'This case assumes #1002 has no such X ID. Zero rows specifies the expected lookup result; no backend table is connected.'} rows={lookupRows} />
        </> : <Source source={findNode(graph, IDENTITY_REFS.lookup)} openNode={openNode} language={language}
          caption={zh ? `#4001 对真实账号 ${record.name} 的未命中分支，以下是规定的输入格式。` : `The unmatched branch for real account ${record.name}; this specifies its input format.`} rows={[...accountRows, ['match_status', 'unmatched']]} />}
      </section>
      <section className="source-case-inspector-section"><div className="source-case-inspector-heading"><h3>{zh ? '输出' : 'Output'}</h3><span>{zh ? '规定的目标结果' : 'Specified target result'}</span></div>
        {step44 ? <><p className="processing-io-case-caption">{zh ? '若 X ID 未命中，asset_id 为空，转 #3002；同一账号后续再进入时，应走 #3004 命中分支。' : 'If the X ID is missing, asset_id is empty and the row goes to #3002. A later pass of the same account should follow #3004.'}</p><Fields rows={output44} /></> : <>
          <Source source={findNode(graph, IDENTITY_REFS.assets)} openNode={openNode} language={language}
            caption={zh ? '规定写入 #1001 的资产行：内部 ID 稳定，名称暂用 X 名称，身份仍待确认。' : 'Specified #1001 asset row: stable internal ID, provisional X name, identity still pending.'} rows={Object.entries(asset)} />
          <Source source={findNode(graph, IDENTITY_REFS.identifiers)} openNode={openNode} language={language}
            caption={zh ? '规定同一次操作写入 #1002 的标识行：X 用户 ID 指向 #1001 刚创建的同一个 UUIDv7 asset_id。' : 'Specified #1002 identifier row in the same operation: the X ID points to the same UUIDv7 asset_id created in #1001.'} rows={Object.entries(identifier)} />
          <Target target={findNode(graph, 3009)} openNode={openNode} language={language}
            caption={zh ? '首次建档结果交 #3009 处理起始评分；#3002 本身不生成评分事件。这里是目标交接格式，尚未执行。' : 'Pass the first-creation result to #3009 for initial scoring. #3002 does not generate the score event itself. This is a planned handoff.'} rows={[["asset_id", selected.create_result.asset_id], ["asset_name", selected.create_result.asset_name], ["action", "created"]]} />
        </>}
      </section>
    </div>
    {step44 && <section className="identity-branch-summary" aria-label={zh ? '判断后的三条路' : 'Decision routes'}>
      <h3>{zh ? '判断后的三条路' : 'Decision routes'}</h3>
      <div><strong>{zh ? '已有 X ID' : 'X ID exists'}</strong><span>{zh ? '沿用 #1002 指向的 asset_id → #3004；待识别资产也算已有映射。' : 'Reuse the mapped asset_id → #3004, including pending identities.'}</span></div>
      <div><strong>{zh ? '查无 X ID' : 'X ID missing'}</strong><span>{zh ? '交 #3002，一次操作写 #1001 与 #1002；本案例规定这一路的目标结果。' : 'Send to #3002 for paired #1001/#1002 writes; this case specifies that route.'}</span></div>
      <div><strong>{zh ? '映射冲突' : 'Mapping conflict'}</strong><span>{zh ? '停止自动创建，交 #4003 审核。' : 'Stop automatic creation and send to #4003 for review.'}</span></div>
    </section>}
    <NodeCaseExplanation language={language} purpose={purpose || node.definition}
      caseSummary={zh ? step44
        ? `真实账号 ${record.name} 提供输入；若 #1002 查不到它的 X ID，#4001 应转 #3002。#3002 建档后再次收到同一 X ID，应复用原 asset_id。查表和写入尚未实际执行。`
        : `按此规则，#3002 应给 ${record.name} 建立 ${asset.asset_id}、写入 #1002，再交 #3009 判断起始 ${initialScore.score_delta} 分；再次收到这个 X ID，应复用原 ID。这里展示的是目标结果。`
        : step44 ? `The observed account ${record.name} supplies input. A missing X ID should route to #3002; later passes should reuse the asset ID. Table operations have not run.` : `#3002 should create ${asset.asset_id} and its X mapping. A later pass should reuse that ID; these are specified outcomes.`}
      recordGuide={zh ? step44
        ? '这里只展示外部 ID、供后续建档使用的名称与匹配结果，透传的其他账号字段去来源卡片查看；未命中时 asset_id 为 NULL；已有映射才返回内部 asset_id，项目名可能仍未知。'
        : 'asset_id 是内部主键；name 暂用 X 名称，pending_identity 表示尚未确认它代表哪个对象。#3002 只交付新建事实；#3009 再决定是否发起始评分。'
        : step44 ? 'This view shows the external ID, provisional name and match result; other pass-through fields belong on the source card. The first output has no asset_id; a repeat can reuse a pending internal ID.' : 'asset_id is the stable internal key; name uses the X label provisionally, pending_identity means the represented object is unresolved, and #1002 stores only the external-to-internal ID mapping.'} />
  </>;
}

export function MatchedIdentityResult({ node, graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const [index, setIndex] = useState(0);
  const selected = pilot.cases[index];
  const account = selected.source_record;
  const existing = selected.repeat_result;
  const accountRows = [ ['asset_id', existing.asset_id], ['asset_name', existing.asset_name],
    ['match_status', existing.match_status]];
  return <><Picker index={index} setIndex={setIndex} zh={zh} />
    <div className="source-case-inspector processing-io-case" aria-label={zh ? '输入与输出' : 'Input and output'}>
      <section className="source-case-inspector-section"><div className="source-case-inspector-heading"><h3>{zh ? '输入' : 'Input'}</h3><span>{zh ? '同一账号再次送入' : 'Same account, second pass'}</span></div>
        <Source source={findNode(graph, IDENTITY_REFS.lookup)} openNode={openNode} language={language}
          caption={zh ? '把同一条真实 #2030 输入再次送入时，规定 #1002 应返回已有映射；这里没有第二次 API 调用或实际查表。' : 'If the same observed #2030 input arrives again, #1002 should return the existing mapping. No second API call or table lookup occurred here.'} rows={accountRows} />
      </section>
      <section className="source-case-inspector-section"><div className="source-case-inspector-heading"><h3>{zh ? '输出' : 'Output'}</h3><span>{zh ? '复用同一资产 ID' : 'Reused asset ID'}</span></div>
        <p className="processing-io-case-caption">{zh ? '规定的命中结果：复用已有映射，并把已有资产交 #3009 检查评分；#3004 不负责加分。项目身份仍待识别。' : 'Specified matched result: reuse the mapping and pass the existing asset to #3009 for score handling. #3004 does not award points.'}</p>
        <Fields rows={accountRows} />
        <Target target={findNode(graph, 3009)} openNode={openNode} language={language}
          caption={zh ? '已有资产交 #3009 跳过起始加分；当前分留在 #1006，本步骤不查询它。' : 'Pass the existing asset to #3009 to skip the initial award. Its current score stays in #1006 and is not read by this step.'} rows={[["asset_id", existing.asset_id], ["asset_name", existing.asset_name], ["action", "reused"]]} />
      </section>
    </div>
    <NodeCaseExplanation language={language} purpose={node.definition}
      caseSummary={zh ? `若再次处理 ${account.name}，应复用 ${existing.asset_id} 并交 #3009；#1001、#1002 和 #1005 都不新增行。这是重复输入的目标行为。` : `A later pass of ${account.name} should reuse ${existing.asset_id} and go to #3009, without new #1001, #1002, or #1005 rows. This specifies the intended behavior.`}
      recordGuide={zh ? 'matched 只表示稳定 X ID 在 #1002 已有映射；identity_status=pending_identity 表示项目身份尚未确认。' : 'matched means the X ID already maps to an internal asset; pending_identity means project identity is unconfirmed.'} />
  </>;
}
