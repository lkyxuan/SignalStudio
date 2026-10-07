import React from 'react';

const algorithms = {
  3001: ['用 24 小时成交额除以市值得到换手比例，市值必须大于零。把比例与设计阈值比较，只有满足条件且资产标识和数据时间齐全，才生成候选。价格不参与这个计算。', 'Divide 24-hour volume by a positive market cap. Compare the ratio with the design threshold; emit a candidate only when the condition is met and identity and timestamp are present. Price is not used.'],
  3002: ['仅处理未命中的稳定外部 ID。幂等创建内部资产，用账号名作为暂定名称，并把外部 ID 映射到同一个内部 ID；身份保持待确认。两张表写入成功后，交付新建结果给起始评分步骤。重复请求复用已有 ID。', 'For an unmatched stable external ID, idempotently create an internal asset with a provisional account name and map the external ID to it. Keep identity pending. After both writes succeed, pass the created result to initial scoring; retries reuse the ID.'],
  3003: ['核对人工批准的具体修改与当前表行。只有批准有效、目标行未变化且约束通过，才执行批准的修改并保留审核依据；暂缓、驳回、目标变化或冲突都不写表。', 'Compare an approved change with current rows. Apply only a valid approval whose target is unchanged and whose constraints pass, retaining review evidence. Hold, reject, changed targets and conflicts cause no write.'],
  3004: ['读取命中结果中的内部资产 ID 和名称，原样交给起始评分步骤，并标明这是已有资产。这个步骤不新建资产、不查询当前分，也不重复加分。', 'Read the matched internal asset ID and name, pass them to initial scoring and mark the asset as reused. Do not create an asset, read current scores or award points here.'],
  3006: ['校验评分决定及其半衰期规则，按资产、评分维度和判定引用生成稳定事件键。首次接受时记录入账时间，补齐事件后发布；重试沿用原事件键、时间和衰减参数。', 'Validate the score decision and half-life policy. Derive a stable event key from asset, score dimension and decision reference, assign the entry time on first acceptance and publish the completed event. Retries retain the key, time and decay parameters.'],
  3007: ['独立读取评分消息，校验后按事件键去重，把九项原始事件字段保存到 Redis，成功后才提交本组消费进度。本步骤不计算衰减分；事件触发计算仍是待实现要求。', 'Independently read and validate score messages, deduplicate by event key and store all nine original fields in Redis before committing this group’s progress. This step does not calculate decay; event-triggered calculation remains requested work.'],
  3008: ['独立读取评分消息，按事件键幂等归档九项原始字段。保留原入账时间和衰减参数，持久写入成功后才提交本组消费进度，归档不阻塞评分计算。', 'Independently read score messages and idempotently archive all nine original fields by event key. Preserve original entry time and decay parameters; commit this group’s progress only after persistence. Archival does not block scoring.'],
  3009: ['检查输入的新建或已有标记。只有首次成功建档才保存评分判定，向 total_heat 提交一次 +100，半衰期为 10080 分钟；已有资产不提交起始贡献。事件键和入账时间由后续发布步骤生成。', 'Inspect the created/reused flag. Only first successful creation saves a decision and submits one +100 contribution to total_heat with a 10,080-minute half-life. Reused assets receive no initial contribution. The publisher generates the event key and entry time.'],
  4001: ['用来源命名空间和稳定外部 ID 查询标识表。唯一有效映射返回已有内部 ID；零条映射返回未命中并交给建档；冲突映射转人工审核。账号名称、粉丝数和热度不作为匹配依据。', 'Look up the source namespace and stable external ID in the identifier table. A unique valid mapping returns the existing internal ID; zero mappings route to creation; conflicting mappings route to review. Names, follower counts and heat are not matching keys.'],
  4002: ['读取新增或变化的资产与标识，用稳定 ID、别名及检索缩小候选范围，再让 AI 检查候选组。相同证据版本不重复检查；只输出带证据和不确定性的建议，交人工审核，不直接修改资产。', 'Read new or changed assets and identifiers. Narrow candidates using stable IDs, aliases and retrieval before AI review. Skip unchanged evidence versions. Output evidence-backed proposals with uncertainty for human review, without changing assets.'],
  4003: ['人核对建议、证据和受影响的表行，决定批准、暂缓或驳回。只有批准且明确了具体修改才交给执行步骤；暂缓和驳回都不触发写表。', 'A person checks the proposal, evidence and affected rows, then approves, holds or rejects it. Only an approval with a specific change routes to execution; hold and reject never write tables.'],
};

export function ProcessingCardFrame({ node, graph, openNode, language, children }) {
  const zh = language === 'zh-CN';
  const sources = graph.nodes.filter(source => graph.edges.some(edge => edge.downstream_id === node.id && edge.upstream_id === source.id));
  const algorithm = algorithms[node.reference_number]?.[zh ? 0 : 1] || node.formula;
  return <div className="processing-card-frame">
    {children}
    <div className="processing-input-source-heading processing-source-links"><span>{zh ? '完整输入字段请到来源卡片查看：' : 'Full input fields are on the source cards:'}</span>
      {sources.map(source => <button key={source.id} onClick={() => openNode(source.id)}>#{source.reference_number} {source.name}</button>)}
      {!sources.length && <span>{zh ? '尚未连接来源' : 'No source connected'}</span>}
    </div>
    <section className="processing-goal-readonly execution-trigger processing-algorithm">
      <h3>{zh ? '算法说明' : 'Algorithm'}</h3>
      <p>{algorithm || (zh ? '这一步尚未定义计算或判断规则，暂时无法给出可验证的推导。' : 'No calculation or decision rule is defined yet, so no verifiable derivation is available.')}</p>
    </section>
  </div>;
}
