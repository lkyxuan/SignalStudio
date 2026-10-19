import {createServer} from 'vite';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const vite=await createServer({server:{middlewareMode:true,hmr:false},optimizeDeps:{noDiscovery:true,include:[]},appType:'custom'});
try {
 const h=await vite.ssrLoadModule('/src/hottestDesign.js');
 const w=await vite.ssrLoadModule('/src/warmingDesign.js');
 const u=await vite.ssrLoadModule('/src/newUuidBoardDesign.ts');
 const {BusinessTableRows}=await vite.ssrLoadModule('/src/BusinessTableRows.jsx');
 const hc=h.hottestExample(),wc=w.warmingExample();
 const hottest=[],warming=[],history=[],assets=[];
 for(let i=0;i<55;i++){
  const asset_id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;
  const source_object_id=`synthetic-${i}`,observation_id=`synthetic-current-${i}`,metric_id=`synthetic-metric-${i}`;
  hottest.push({...hc.current[i%hc.current.length],asset_id,source_object_id,observation_id,metric_id});
  const template=wc.current[0];
  warming.push({...template,asset_id,source_object_id,observation_id,metric_id});
  for(const old of wc.history.filter(r=>r.asset_id===template.asset_id))history.push({...old,asset_id,source_object_id,observation_id:`${i}/${old.observation_id}`});
  assets.push({asset_id,name:`Synthetic ${i}`,asset_kind:'coin',identity_status:'confirmed',created_at:hc.calculatedAt,creation_origin:'discovery',source_refs_json:[]});
 }
 const hb=h.rankHottest(hottest,hc.calculatedAt),wb=w.rankWarming(warming,history,wc.calculatedAt),ub=u.selectNewUuidDesign(assets,hc.calculatedAt);
 for(const b of [hb,wb,ub]){assert.equal(b.rows.length,50);assert.equal(b.rows.at(-1).rank,50);}
 for(const n of [0,7,49,50,51]){
  assert.equal(h.rankHottest(hottest.slice(0,n),hc.calculatedAt).rows.length,Math.min(n,50));
  assert.equal(w.rankWarming(warming.slice(0,n),history,wc.calculatedAt).rows.length,Math.min(n,50));
  assert.equal(u.selectNewUuidDesign(assets.slice(0,n),hc.calculatedAt).rows.length,Math.min(n,50));
 }
 const py=spawnSync('python3',['-c',`import sys,json
from hottest_reference import board as hottest
from warming_reference import board as warming
x=json.load(sys.stdin)
print(json.dumps([hottest(x['h'],x['ht'])['rows'],warming(x['w'],x['history'],x['wt'])['rows']]))`],{encoding:'utf8',env:{...process.env,PYTHONPATH:'server'},input:JSON.stringify({h:hottest,ht:hc.calculatedAt,w:warming,history,wt:wc.calculatedAt})});
 assert.equal(py.status,0,py.stderr);
 const [hp,wp]=JSON.parse(py.stdout);
 assert.deepEqual(hp.map(r=>r.asset_id),hb.rows.map(r=>r.asset_id));
 assert.deepEqual(wp.map(r=>r.asset_id),wb.rows.map(r=>r.asset_id));
 const html=renderToStaticMarkup(createElement(BusinessTableRows,{table:{primary_key:['asset_id'],columns:[{name:'rank'},{name:'asset_id'}]},rows:hb.rows,language:'en',scrollRows:true}));
 assert.match(html,/board-result-scroll/);assert.match(html,/<code>50<\/code>/);assert.equal((html.match(/<tr>/g)||[]).length,51);
 console.log('Top-50 boundaries, stable order, Python/JS parity and all 50 rendered rows passed.');
}finally{await vite.close();}
