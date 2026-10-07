import type { Language } from './contracts';
import React from 'react';
import './source-provenance.css';

export function SourceProvenance({ provenance, operationNames = [], language }: { language: Language; operationNames?: string[]; provenance?: { scope_zh: string; scope_en: string; coverage_zh: string; coverage_en: string; upstream_url: string; crawler_url: string } | null }) {
  if (!provenance) return null;
  const zh = language === 'zh-CN';
  const say = (cn: string, en: string) => zh ? cn : en;
  return <section className="source-provenance" aria-label={say('字段依据', 'Field basis')}>
    <strong>{say('字段依据与范围', 'Field basis and scope')}</strong>
    <p>{zh ? provenance.scope_zh : provenance.scope_en}</p>
    <p>{zh ? provenance.coverage_zh : provenance.coverage_en}</p>
    {operationNames.length > 0 && <p className="source-provenance-operations">{say('对应功能', 'Operation')}: <code>{operationNames.join('、')}</code></p>}
    <div className="source-provenance-links">
      <a href={provenance.upstream_url} target="_blank" rel="noopener noreferrer">{say('上游文档或网站', 'Upstream reference')} ↗</a>
      <a href={provenance.crawler_url} target="_blank" rel="noopener noreferrer">{say('爬虫实现', 'Crawler code')} ↗</a>
    </div>
  </section>;
}
