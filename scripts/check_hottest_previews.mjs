import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const graph=JSON.parse(readFileSync(process.argv[2],'utf8')),before=JSON.stringify(graph);
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {CardDetails}=await vite.ssrLoadModule('/src/CardDetails.jsx');
 const {hottestExample,hottestCases,hottestCard}=await vite.ssrLoadModule('/src/hottestDesign.js');
 const nodes=graph.nodes.filter(hottestCard);assert.equal(nodes.length,5);
 let fields=0;
 for(const [key] of hottestCases){
  const c=hottestExample(key);
  for(const n of nodes){
   const spec=hottestCard(n),rows=spec.key==='baseline'?[{...c.focus,...c.baseline}]:spec.key==='rvol'?[c.focus]:spec.key==='candidates'?c.current:c.batch.rows;
   for(const r of rows)for(const f of spec.fields){assert.notEqual(r[f.name],undefined,`${key}/${spec.key}/${f.name}`);fields++;}
  }
 }
 for(const node of nodes)for(const language of ['zh-CN','en']){
  const html=renderToStaticMarkup(createElement(CardDetails,{node,graph,language,openNode:()=>{},mutate:()=>{throw new Error('No write');},busy:false}));
  assert.match(html,/data-hottest-preview/);assert.ok(!html.includes('设计缺口'));assert.ok(html.includes('rvol_7d'));
  if(language==='zh-CN'){assert.ok(html.includes('虚构'));if(node.kind==='process')assert.ok(html.includes('何时运行'));}
  if(node.reference_number===3018){assert.ok(!html.includes('半衰期 30'));assert.ok(html.includes('z_clipped'));}
 }
 assert.equal(JSON.stringify(graph),before);
 console.log(JSON.stringify({cards:nodes.length,cases:hottestCases.length,fields,languages:2,read_only:true}));
}finally{await vite.close();}
