import test from 'node:test';
import assert from 'node:assert/strict';
import { labels, progressStatus } from './cardProgressModel';
import { cardProgressSchema } from './contracts';

test('new card and stale verified history cannot show passed',()=>{
  assert.equal(progressStatus(), 'unknown');
  const p=cardProgressSchema.parse({definition_revision:'new',stale:true,report:null,
    status:'passed',history:[{id:'old',definition_revision:'old',code_revision:'old',status:'passed'}]});
  assert.equal(progressStatus(p),'unknown');
  assert.equal(p.history?.[0]?.status,'passed');
});
test('legacy verified is awaiting review, never review passed',()=>{
  const p=cardProgressSchema.parse({definition_revision:'current',stale:false,
    report:{package_revision:'package',code_revision:'old',evidence_ref:'fixture',observations:{implementation:'verified'}}});
  assert.equal(progressStatus(p),'pending_review');
});
test('server conflict status takes precedence over representative passed report',()=>{
  const p=cardProgressSchema.parse({definition_revision:'current',stale:false,status:'discussion',conflict:true,
    report:{package_revision:'package',code_revision:'a'.repeat(40),evidence_ref:'fixture',observations:{implementation:'passed'}}});
  assert.equal(progressStatus(p),'discussion');
  assert.deepEqual(Object.values(labels).map(v=>v[0]),['待核实','未完成','待核验','已通过','有偏差','待讨论']);
});
