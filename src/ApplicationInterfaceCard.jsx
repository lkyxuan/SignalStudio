import React from 'react';
import sync from '../catalog/supabase-score-sync.v1.json';
import homepage from '../catalog/homepage-layout.v1.json';

export function ApplicationInterfaceCard(props) {
  const {node, language} = props, zh = language === 'zh-CN';
  const ui = node.card_contract?.config.interface || {};
  const list = key => Array.isArray(ui[key]) ? ui[key].filter(item => typeof item === 'string') : [];
  const localized = key => list(`${key}_${zh ? 'zh' : 'en'}`);
  const hasReadContract = ui.read_contract_ref === 'catalog/supabase-score-sync.v1.json#/frontend_read' &&
    node.card_contract?.config.definition_refs?.some(ref => ref.path === 'catalog/supabase-score-sync.v1.json');
  const section = (key, title) => <section><h3>{title}</h3>{localized(key).length
    ? <ul>{localized(key).map(text => <li key={text}>{text}</li>)}</ul>
    : <p>{zh ? '尚未定义。' : 'Not defined yet.'}</p>}</section>;
  return <div className="application-interface-card">
    <p className="card-detail-provenance">{zh ? '应用界面交付定义 · 页面与 API 尚未核验' : 'Application interface definition · page and API unverified'}</p>
    <section><h3>{zh ? '谁使用、用来做什么' : 'Users and purpose'}</h3><p>{ui[zh ? 'purpose_zh' : 'purpose_en'] || node.definition}</p></section>
    {props.connections}
    {ui.homepage_layout_ref === 'catalog/homepage-layout.v1.json' && <section>
      <h3>{zh ? '六框结构预览' : 'Six-position structure preview'}</h3>
      <p>{zh ? '前三框：榜单 · 后三框：信号。仅示意位置，没有真实记录。' : 'First three: boards. Last three: signals. Structure only, no real records.'}</p>
      <div className="homepage-layout-preview">{homepage.slots.map(slot => <article key={slot.key} data-homepage-slot={slot.position}>
        <small>{zh ? `位置 ${slot.position} · ${slot.kind === 'board' ? '榜单' : '信号'}` : `Position ${slot.position} · ${slot.kind}`}</small>
        <h4>{slot[zh ? 'label_zh' : 'label_en']}</h4>
        <p>{slot.source_name ? <code>{slot.source_name}</code> : (zh ? '来源待定义' : 'Source undefined')}</p>
        <p>{slot.status === 'defined_generator_shelved' ? (zh ? '规则已定义 · 生成卡已收起' : 'Rules defined · generator shelved') : (zh ? '内容待定义' : 'Content undefined')}</p>
        <small>{zh ? '读取 API：待绑定' : 'Read API: unbound'}</small>
      </article>)}</div>
    </section>}
    <section><h3>{zh ? '需要展示的内容' : 'Required content'}</h3>{list('display_fields').length
      ? <p className="interface-field-list">{list('display_fields').map(field => <code key={field}>{field}</code>)}</p>
      : <p>{zh ? '展示字段尚未定义。' : 'Display fields are undefined.'}</p>}
      <p>{zh ? '这里列出交付要求，不代表已连接真实记录或已有 API 响应。' : 'Delivery requirements, not observed records or an existing API response.'}</p>
    </section>
    {section('display', zh ? '读取与展示规则' : 'Read and display rules')}
    {hasReadContract && <section className="interface-read-contract"><h3>{zh ? '沿用 #1007 读取契约' : '#1007 read contract'}</h3>
      <p><code>{sync.frontend_read.score_key}</code> · {zh ? '有效期' : 'Validity'} {sync.frontend_read.freshness_seconds}s · {zh ? '最多' : 'Limit'} {sync.frontend_read.display_limit}</p>
      <p><code>{sync.frontend_read.freshness_filter}</code></p>
      <p><code>{sync.frontend_read.order_by.join(', ')}</code></p>
      <p>{zh ? '过滤先于排序和分页；同步算法不应用此展示过滤，旧行不删除。' : 'Filter before ordering/pagination. The synchronizer does not apply this display filter or delete old rows.'}</p>
    </section>}
    {section('actions', zh ? '用户操作及后续处理' : 'User actions and subsequent processing')}
    {section('limitations', zh ? '待实现与待核验' : 'Implementation and verification gaps')}
    {!ui.endpoint && <p>{zh ? '实际页面地址：待绑定。' : 'Deployed page URL: unbound.'}</p>}
    {!ui.api_endpoint && <p>{zh ? '实际 API：待绑定。打开这张设计卡不会读取业务数据、提交审核或执行纠错。' : 'API: unbound. Opening this definition never reads business records, submits reviews or executes corrections.'}</p>}
    <details><summary>{zh ? '交付验收要求' : 'Delivery acceptance criteria'}</summary><ul>{list('acceptance').map(text => <li key={text}><code>{text}</code></li>)}</ul></details>
  </div>;
}
