import React from 'react';
import { BusinessTableRows } from './BusinessTableRows';

// A display-only, hypothetical hold case. It creates no review, approval or database record.
export function AssetReviewCase({ node, graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const asset = { asset_id: 'case:asset-a', name: 'Example A', identity_status: 'pending_identity', asset_kind: 'social_account' };
  const identifier = { source_namespace: 'x_user_id', external_identifier: 'case:user-a', asset_id: asset.asset_id };
  const proposal = { asset_id: asset.asset_id, proposal_type: 'name_correction', proposed_name: 'Example Alpha', related_asset_id: null,
    evidence_summary: zh ? '假设发现名称差异；没有已核实的归属证据' : 'Assumed name difference; no verified ownership evidence' };
  const review = { asset_id: asset.asset_id, decision: 'hold', related_asset_id: null,
    review_note: zh ? '证据不足，暂缓修改' : 'Insufficient evidence; hold the change' };
  const isProposal = node.reference_number === 4002;
  const isReview = node.reference_number === 4003;
  const inputs = isProposal ? [[1001, asset], [1002, identifier]] : isReview ? [[4002, proposal]] : [[4003, review]];
  const output = isProposal ? proposal : isReview ? review : {
    asset_id: asset.asset_id, approved_change: null, review_id: null, change_evidence: null, apply_status: zh ? '不执行：暂缓决定不进入写表' : 'Not executed: a held decision cannot enter the write path',
  };
  const targetRef = isProposal ? 4003 : isReview ? 3003 : 1001;
  const table = row => ({ columns: Object.keys(row).map(name => ({ name, label_zh: name })), primary_key: ['asset_id'] });
  const link = reference => {
    const target = graph.nodes.find(item => item.reference_number === reference);
    return target && <button onClick={() => openNode(target.id)}>#{reference} {target.name}</button>;
  };
  return <div className="processing-review-case">
    <p className="processing-io-case-caption">{zh ? '演示案例 · 以下 ID、名称和决定均为假设，用同一条“证据不足 → 暂缓 → 不写表”的案例解释三步关系；没有实际 AI 建议、人工决定或执行结果。' : 'Illustrative case · IDs, names and decisions are hypothetical. One insufficient-evidence → hold → no-write case connects the three steps. No AI proposal, human decision or execution result has been observed.'}</p>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入案例' : 'Input case'}</h3>
        {inputs.map(([reference, row]) => <div className="processing-input-source" key={reference}>
          <div className="processing-input-source-heading"><span>{zh ? '来自' : 'From'}</span>{link(reference)}</div>
          <BusinessTableRows table={table(row)} rows={[row]} language={language} />
        </div>)}
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出案例' : 'Output case'}</h3>
        <BusinessTableRows table={table(output)} rows={[output]} language={language} />
        <div className="processing-input-source-heading"><span>{zh ? isProposal ? '交人工判断' : isReview ? '本例暂缓，不触发' : '本例不修改' : isProposal ? 'For human review' : isReview ? 'Held; does not trigger' : 'Unchanged in this case'}</span>{link(targetRef)}</div>
      </section>
    </div>
    <p className="processing-io-case-caption">{zh ? isProposal
      ? '这里假设 AI 提议把 Example A 改成 Example Alpha。proposed_name 只是建议，资产仍是 pending_identity，名称保持原值。'
      : isReview ? '输入提出新名称，但没有已核实证据；本例假设人工选择 hold。输出保留原 asset_id，不产生获批修改。'
      : '正常情况下 hold 不会送入本步骤；这里展示边界检查：即使收到暂缓决定，也不能写表。只有具体修改获批后才读取并核对目标当前行，本例没有这类读取或写入。'
      : isProposal ? 'Assume AI proposes Example Alpha for Example A. This is only a suggestion: the asset remains pending and its name is unchanged.'
        : isReview ? 'The proposed name has no verified evidence, so the hypothetical reviewer chooses hold. The asset ID is retained and no approved change is produced.'
        : 'Normally a held decision never reaches this step. This boundary example shows that even if received, it cannot write tables. Current target rows are read and checked only for a specifically approved change; no such read or write occurs here.'}</p>
  </div>;
}
