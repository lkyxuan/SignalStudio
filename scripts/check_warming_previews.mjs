import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const graph=JSON.parse(readFileSync(process.argv[2],'utf8')),before=JSON.stringify(graph);
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
  const {CardDetails}=await vite.ssrLoadModule('/src/CardDetails.jsx');
  const {selectWarmingCase}=await vite.ssrLoadModule('/src/WarmingDesignPreview.jsx');
  const {warmingCases,warmingCard,warmingExample}=await vite.ssrLoadModule('/src/warmingDesign.js');
  const nodes=graph.nodes.filter(warmingCard);assert.equal(nodes.length,4);
  let fields=0;
  for(const [key] of warmingCases){
    const c=warmingExample(key);selectWarmingCase(key);
    for(const node of nodes){
      const entry=warmingCard(node),rows=entry.key==='baseline'?[{...c.focus,...c.baseline}]:entry.key==='candidates'?c.current:c.batch.rows;
      for(const row of rows)for(const f of entry.fields){assert.notEqual(row[f.name],undefined,`${key}/${entry.key}/${f.name}`);fields++;}
      for(const language of ['zh-CN','en']){
        const html=renderToStaticMarkup(createElement(CardDetails,{node,graph,language,openNode:()=>{},mutate:()=>{throw Error('No write');},busy:false}));
        assert.ok(html.includes('data-warming-preview'));assert.ok(!html.includes('设计缺口'));
        if(language==='zh-CN'){
          assert.ok(html.includes('虚构'));assert.ok(!html.includes('60分钟评分正增量'));
          assert.ok(!html.includes('半衰期 30'));
          if(entry.key==='rank')assert.ok(html.includes('何时运行'));
          if(['rank','result'].includes(entry.key))assert.ok(html.includes('假设已在最热榜'));
          if(c.batch.warming_warmup&&['rank','result'].includes(entry.key))assert.ok(html.includes('升温预热'));
        }
      }
    }
  }
  assert.equal(JSON.stringify(graph),before);selectWarmingCase('normal');
  console.log(JSON.stringify({cards:nodes.length,cases:warmingCases.length,fields,languages:2,read_only:true}));
}finally{await vite.close();}
