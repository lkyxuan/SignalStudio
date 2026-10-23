import React from 'react';
import spec from '../catalog/xpro-feed-source.v1.json';

export const xproSourceCard = node => node.kind === 'source' && node.name === spec.name &&
  node.card_contract?.config.definition_refs?.some(ref => ref.path === 'catalog/xpro-feed-source.v1.json');

// Static, attributed source definition; opening this card never calls X.
export function XproSourceCard({language}) {
  const zh = language === 'zh-CN';
  const say = (a,b) => zh ? a : b;
  const lang = zh ? 'zh' : 'en';
  return <div className="source-case-inspector xpro-source-inspector" data-xpro-source="definition-only">
    <section className="source-case-inspector-section">
      <h3>{say('这张爬虫卡做什么','What this collector reads')}</h3>
      <p>{spec[`purpose_${lang}`]}</p>
      <p className="card-detail-provenance">{say('代码支持的字段 · 不代表本项目已采集','Code-supported fields · no project collection verified')}</p>
    </section>
    <section className="source-case-inspector-section">
      <h3>{say('输入与采集范围','Inputs and collection scope')}</h3>
      <dl className="source-case-inspector-fields">{spec.inputs.map(input => <div key={input.path}>
        <dt>{input[`label_${lang}`]} <code>{input.path}</code></dt><dd>{input[`description_${lang}`]}</dd>
      </div>)}</dl>
    </section>
    <section className="source-case-inspector-section">
      <h3>{say('能读取哪些数据','Available data')}</h3>
      <p>{say('以下路径对应 tweet 事件，data 内是推文；点击展开各组查看字段及原生类型。可空不等于每条记录一定有值。','Paths below describe a tweet event; data contains the post. Expand each group for fields and native types. Nullable does not guarantee a value in every record.')}</p>
      {spec.groups.map(group => <details key={group.id} open={['content','metrics'].includes(group.id)}>
        <summary>{group[`label_${lang}`]} · {spec.fields.filter(f=>f.group===group.id).length}</summary>
        <dl className="source-case-inspector-fields">{spec.fields.filter(f=>f.group===group.id).map(field=><div key={field.path}>
          <dt>{field[`label_${lang}`]} <code>{field.path}</code></dt>
          <dd><code>{field.type}</code>{field.nullable && say(' · 可空',' · nullable')}<p>{field[`description_${lang}`]}</p></dd>
        </div>)}</dl>
      </details>)}
    </section>
    <section className="source-case-inspector-section">
      <h3>{say('采集限制','Collection limits')}</h3><ul>{spec.limits.map((limit,index)=><li key={index}>{limit[lang]}</li>)}</ul>
    </section>
    <section className="source-case-inspector-section">
      <h3>{say('依据与真实数据','Evidence and observed data')}</h3><p>{spec[`evidence_${lang}`]}</p>
      <a href={spec.upstream.url} target="_blank" rel="noopener noreferrer">{say('查看固定版本的爬虫代码','Pinned collector code')} · {spec.upstream.commit.slice(0,7)}</a>
    </section>
  </div>;
}
