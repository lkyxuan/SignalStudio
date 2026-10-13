import business from '../catalog/business-tables.v1.json';
import React, { useSyncExternalStore } from 'react';
import { BusinessTableRows } from './BusinessTableRows';
import { buildCoinGeckoCase, designCases, previewColumns, previewInputs, previewNote, nullReason } from './coingeckoPreviewModel';

let selected = 'up';
const listeners = new Set();
const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const selectCase = key => { selected=key; listeners.forEach(listener=>listener()); };
const valueText = value => value === null ? 'NULL' : typeof value === 'object' ? JSON.stringify(value) : String(value);
function Fields({ rows, columns, language }) {
  const zh=language==='zh-CN';
  if (!rows.length) return <p>{zh?'0条设计记录 · 此案例没有该分支的输出。':'0 design records · no output for this branch.'}</p>;
  return rows.map((row,i)=><dl className="source-case-inspector-fields" key={i}>{columns.map((name,index)=><div key={name}>
    <dt><span className="source-case-field-number">{String(index+1).padStart(2,'0')}</span><code>{name}</code></dt>
    <dd>{row[name]===undefined ? <strong>{zh?'设计缺口：未填示例值':'Design gap: example missing'}</strong> : <><code>{valueText(row[name])}</code>{row[name]===null&&<small> · {nullReason(name,language)|| (zh?'本分支不适用，参见案例说明。':'Not applicable; see case explanation.')}</small>}</>}</dd>
  </div>)}</dl>);
}
export function CoinGeckoDesignPreview({node,graph,language,openNode}) {
  const key=useSyncExternalStore(subscribe,()=>selected,()=>selected);
  const c=buildCoinGeckoCase(key);
  const zh=language==='zh-CN';
  const ref=node.reference_number;
  let columns=previewColumns(node,graph);
  // Source cards own complete response records, including optional upstream keys.
  if(ref===2010)columns=Object.keys(c.raw).filter(name=>!name.startsWith('meta.')&&name!=='collected_at');
  // #3005 has no graph output fields: its output is the #1006 table contract.
  if(ref===3005)columns=previewColumns(graph.nodes.find(n=>n.reference_number===1006),graph);
  const rows=c.rows[ref];
  const inputs=previewInputs(ref,c);
  const tableKind=node.kind==='table';
  const processKind=['process','decision','source'].includes(node.kind);
  const table=business.tables[node.name] || {columns:columns.map(name=>({name,label_zh:name})),primary_key:columns};
  const open=source=>{const target=graph.nodes.find(n=>n.reference_number===source);if(target)openNode(target.id);};
  const output=tableKind?<BusinessTableRows table={table} rows={rows} language={language}/>:<Fields rows={rows} columns={columns} language={language}/>;
  return <section className="coingecko-design-preview" data-design-preview={ref}>
    <label className="source-case-inspector-picker">{zh?'设计预览 · 贯通案例':'Design preview · through-line case'}
      <select aria-label={zh?'CoinGecko贯通案例':'CoinGecko through-line case'} value={key} onChange={event=>selectCase(event.target.value)}>
        {designCases.map(item=><option key={item.key} value={item.key}>{zh?item.zh:item.en}</option>)}
      </select>
    </label>
    {processKind?<div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh?'输入 · 具体设计值':'Input · concrete design values'}</h3>
        {inputs.map((input,i)=><div className="processing-input-source" key={i}>
          {input.source&&<div className="processing-input-source-heading"><button onClick={()=>open(input.source)}>#{input.source} {graph.nodes.find(n=>n.reference_number===input.source)?.name}</button></div>}
          <Fields rows={input.rows} columns={input.fields} language={language}/>
        </div>)}
      </section>
      <section className="source-case-inspector-section"><h3>{zh?'输出 · 预期设计值':'Output · expected design values'}</h3>{output}</section>
    </div>:output}
    <p className="card-detail-provenance">{zh?'设计示例 · 来源记录、UUID、映射、时间、建档成功和消息均为假设；不代表真实采集、审批、运行或已写入。真实样本保留在下方独立参考中。':'Design example · source records, UUID, mapping, timestamps, successful creation and messages are hypothetical. No observed collection, approval, execution or writes. Saved evidence remains separate below.'}</p>
    <p>{previewNote(ref,c,zh)}</p>
    {!rows.length&&<p>{zh?'0条预期输出；字段结构保留：':'No expected output; declared fields: '}<code>{columns.join(', ')}</code></p>}
    {tableKind&&rows.length>0&&<p>{[...new Set(rows.flatMap(row=>columns.filter(name=>row[name]===null)))].map(name=><span key={name}><code>{name}=NULL</code> · {nullReason(name,language)}<br/></span>)}</p>}
    {tableKind&&[1013].includes(ref)&&<p>{zh?'首行（如有）是历史基线，末行是当前观测；来源范围与覆盖一致。':'First row, when present, is the historical baseline; last is the current observation with matching source and coverage.'}</p>}
    {ref===2010&&<p>{zh?'image、roi、ath、atl是上游字段，当前爬虫删除；collected_at及meta.*为采集端补充，见#5004。可选周期未请求则明确NULL。':'image, roi, ath and atl are upstream fields dropped by the crawler. Collection metadata belongs to #5004. Unrequested optional intervals are explicitly NULL.'}</p>}
    {[3005,3033,1006,1021,1022].includes(ref)&&rows.length>0&&<p><code>{JSON.stringify(c.components)}</code> · {zh?'按原精度计算，显示分数可保留两位小数。':'Compute at full precision; scores may be displayed to two decimals.'}</p>}
  </section>;
}
