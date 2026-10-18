import spec from '../catalog/asset-webpage-flow.v1.json';
import pages from '../catalog/asset-pages.v1.json';
import {BusinessTableRows} from './BusinessTableRows';
import {ProcessingCardFrame} from './ProcessingCardFrame';
import {decideCurrentPages, type CurrentPage} from './assetWebpageDesign';
import type {Graph, GraphNode, Language} from './contracts';

export const currentWebpageCard=(node:GraphNode)=>Boolean((node.card_contract?.config.resource as Record<string,unknown>|undefined)?.asset_webpage_flow) && spec.cards.some(c=>c.name===node.name);
export function AssetWebpageFlowCard({node,graph,openNode,language}:{node:GraphNode;graph?:Graph;openNode?:(id:string)=>void;language:Language}) {
  const card=spec.cards.find(c=>c.name===node.name);
  if(!card || !graph || !openNode)return null;
  const zh=language==='zh-CN';
  const examples=spec.example_rows as Record<string, object[]>;
  const candidates=examples['候选代币筛选'] as {asset_id:string}[];
  const decisions=decideCurrentPages(candidates.map(r=>r.asset_id),examples.asset_pages as CurrentPage[],spec.example_clock,spec.page_refresh_interval_seconds);
  const sourceRows=(name:string)=>name==='刷新判断'?decisions.filter(r=>r.action==='generate'||r.action==='refresh'):examples[name]??[];
  const rows=(names:string[], values:object[])=> <BusinessTableRows language={language}
    table={{primary_key:['asset_id'],columns:names.map(name=>({name,label_zh:card.fields.find(f=>f.name===name)?.label_zh??pages.table.columns.find(f=>f.name===name)?.label_zh??name}))}} rows={values}/>;
  const link=(name:string)=>{
    const other=graph.nodes.find(n=>n.name===name);
    return other?<button onClick={()=>openNode(other.id)}>#{other.reference_number} {name==='asset_pages'?(zh?pages.table.label_zh:'Current asset webpages'):other.name}</button>:<span>{name}</span>;
  };
  const inputs=[...spec.connections,...spec.candidate_sources].filter(e=>e.target===node.name);
  const outputs=spec.connections.filter(e=>e.source===node.name);
  const provenance=<p className="processing-io-case-caption">{zh?spec.provenance_zh:spec.provenance_en}</p>;
  const settings=<details className="processing-advanced"><summary>{zh?'其他设置 · 字段与契约':'Other settings · fields and contract'}</summary>
    <p><code>catalog/asset-webpage-flow.v1.json</code></p>
    <dl className="source-case-inspector-fields">{card.fields.map(f=><div key={f.name}><dt><code>{f.name}</code></dt><dd>{f.label_zh} · {f.type}</dd></div>)}</dl>
  </details>;
  if(card.kind==='table')return <div className="business-table-card">
    {rows(card.output_fields,[])}{provenance}
    <details><summary>{zh?'假设素材记录 · 非实际写入':'Fictional materials · not observed writes'}</summary>{rows(card.output_fields,examples[node.name]??[])}</details>{settings}
  </div>;
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language} algorithm={card.algorithm_zh}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh?'输入 · 本步骤需要的资料':'Input · data used by this step'}</h3>
        {inputs.map(e=><div className="processing-input-source" key={e.source}><div className="processing-input-source-heading">{link(e.source)}</div>
          <p>{e.note_zh}</p>{rows(e.fields,sourceRows(e.source))}</div>)}
      </section>
      <section className="source-case-inspector-section"><h3>{zh?'输出 · 本步骤结果':'Output · this step’s result'}</h3>
        {rows(card.output_fields,card.key==='decision'?decisions:examples[node.name]??[])}
        {outputs.map(e=><div className="processing-input-source" key={e.target}><div className="processing-input-source-heading">{link(e.target)}</div><p>{e.note_zh}</p></div>)}
        {card.key==='decision'&&<p>{zh?'示例假设网页查询完整成功：无网页的资产进入首次制作；已有网页因更新周期未定而待配置；时间未知的不猜测过期。一天或三天尚未选定。':'The example assumes complete successful reads: missing pages proceed, existing pages wait for an interval, and unknown times need review. Daily versus three-day timing is undecided.'}</p>}
        {card.key==='assemble'&&<p>{zh?'到这里资料已准备好。后续 Grokbot 网页制作卡尚未创建，当前没有自动生成或回写。':'Materials are ready here. The Grokbot webpage step has not been created; generation and write-back are unconnected.'}</p>}
      </section>
    </div>{provenance}
    <section className="execution-trigger"><h3>{zh?'何时处理':'When to process'}</h3><p>{card.trigger_zh}</p></section>{settings}
  </ProcessingCardFrame>;
}
