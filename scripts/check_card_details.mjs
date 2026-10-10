// Render-only coverage check. Fetches saved definitions; never starts a graph action.
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const input=process.argv[2];
if (!input) throw new Error('Usage: node scripts/check_card_details.mjs <saved graph JSON path or graph API URL>');
const graph=/^https?:/.test(input) ? await (await fetch(input)).json() : JSON.parse(readFileSync(input,'utf8'));
const before=JSON.stringify(graph);
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {CardDetails}=await vite.ssrLoadModule('/src/CardDetails.jsx');
  const counts={};
  const verify=(node,language)=>{
    const html=renderToStaticMarkup(createElement(CardDetails,{node,graph,language,openNode:()=>{},mutate:()=>{throw new Error('Render must not mutate');},busy:false,onOpenSource:()=>{}}));
    const kind=['source','process','decision','table','channel','state'].includes(node.kind) ? node.kind : 'unknown';
    assert.ok(html.includes(`data-card-detail-kind="${kind}"`),`#${node.reference_number} incorrect template`);
    if (language==='zh-CN' && kind!=='unknown') {
      assert.ok(html.includes('数据流向'),`#${node.reference_number} lacks connections`);
      if (kind==='decision') assert.ok(html.includes('判断分支与去向'));
      if (['process','decision'].includes(kind)) assert.ok(html.includes('何时运行'));
    }
    return html;
  };
  for (const node of graph.nodes) { verify(node,'zh-CN'); verify(node,'en');counts[node.kind]=(counts[node.kind]||0)+1; }
  for (const kind of ['source','process','decision','table','channel','state','future']) {
    verify({id:`test-${kind}`,kind,type:'Score',name:'Generic test card',definition:'Undefined draft',notes:'bad-json',card_contract:{config:{resource:{},branches:[],read_only:kind==='future'}}},'zh-CN');
  }
  assert.equal(JSON.stringify(graph),before,'Rendering mutated saved graph');
  console.log(JSON.stringify({cards:graph.nodes.length,languages:2,counts,generic_templates:6,unknown_read_only:1,graph_unchanged:true}));
} finally { await vite.close(); }
