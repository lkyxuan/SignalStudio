import React from 'react';
import { cardPresentation } from './cardPresentation';
import { cardRelations } from './cardDetailModel';
import { nodeRef } from './graphRefs';
import { displayNodeName } from './i18n';

export function CardPresentationDetails({node,graph,language,openNode}) {
  const meta=cardPresentation(node,language);
  const zh=language==='zh-CN';
  const inputs=cardRelations(node,graph).filter(item=>item.incoming && item.other &&
    item.bindings.some(binding=>['data','read','reference','consume','write','publish'].includes(binding.kind)));
  return <section className="card-presentation-details" aria-label={zh?'卡片用途与来源':'Card purpose and origin'}>
    <strong>{meta.label}</strong><span>{meta.originText}</span>
    <details><summary>{zh?'上游与引用字段':'Upstream cards and referenced fields'} · {inputs.length}</summary>
      {inputs.map(({edge,other,bindings})=>{
        const fieldNames=(graph.field_usages || []).filter(usage=>usage.edge_id===edge.id).flatMap(usage=>{
          const source=(graph.fields || []).find(field=>field.id===usage.source_field_id && field.node_id===other.id);
          const target=!usage.target_field_id || (graph.fields || []).some(field=>field.id===usage.target_field_id && field.node_id===node.id);
          return source && target ? [source.name] : [];
        });
        const reference=bindings.some(binding=>binding.kind==='reference');
        const delivery=bindings.some(binding=>['write','publish'].includes(binding.kind));
        return <div className="card-presentation-input" key={edge.id}>
          <button type="button" className="card-detail-link" onClick={()=>openNode(other.id)}>{nodeRef(other)} {displayNodeName(language,other.name)}</button>
          <small>{reference ? zh?'引用连接':'Reference connection' : delivery ? zh?'写入／发布定义':'Write / publish definition' : zh?'输入定义':'Input definition'} · {fieldNames.length ? [...new Set(fieldNames)].join(', ') : zh?'具体引用字段未绑定':'Referenced fields not bound'}</small>
        </div>;
      })}
      {!inputs.length && <p>{zh?'暂无绑定的数据输入；来源说明不代表已采集记录。':'No bound data inputs; the origin label does not establish collected records.'}</p>}
      {inputs.length>0 && <p>{zh?'以上为已保存的依赖定义；引用连接不代表已自动读取或同步。':'Saved dependencies; reference connections do not establish automatic reads or synchronization.'}</p>}
    </details>
  </section>;
}
