import React from 'react';
import { SOURCE_USAGE_DRAFTS } from './sourceUsageDrafts';
import { sourceCardSummary } from './sourceCardSummaries';
import './source-usage-guide.css';

export function sourcePurpose(name, language) {
  return sourceCardSummary(name, language);
}

export function SourceUsageGuide({ node, language }) {
  const guide = SOURCE_USAGE_DRAFTS[node.name];
  if (!guide) return null;
  const zh = language === 'zh-CN';
  const rows = [
    [zh ? '想回答' : 'Question', guide.ask],
    [zh ? '输入' : 'Input', guide.input],
    [zh ? '返回' : 'Returns', guide.output],
    [zh ? '建议用法' : 'Proposed use', guide.use],
    [zh ? '先核对' : 'Check first', guide.check],
  ];
  return <section className="source-usage-guide" aria-label={zh ? '待审核用法' : 'Usage draft for review'}>
    <div className="source-usage-heading"><strong>{zh ? '这个数据怎么用' : 'How to use this data'}</strong><span>{zh ? '待审核' : 'Draft'}</span></div>
    {rows.map(([label, value]) => <div className="source-usage-row" key={label}>
      <strong>{label}</strong><p>{value}</p>
    </div>)}
  </section>;
}
