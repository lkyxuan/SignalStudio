import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMaterials, preparationCase } from './searchPreparationDesign';
import { buildDesignPipeline } from './contentRefreshDesign';
const now = '2026-10-13T05:00:00Z';
const example = () => preparationCase('bitcoin-design','news',1,'2026-10-13T05:05:00Z',now);

test('default requests current search even with complete stored coverage and preserves both sources', () => {
  const p = example();
  assert.equal(p.result.route,'need_search');
  assert.deepEqual(p.result.coverage_gaps,[]);
  assert.deepEqual(p.result.gaps,['news']);
  assert.equal(p.result.ready,true);
  assert.equal(p.result.materials.length,2);
  assert.equal(p.result.data_as_of,null);
  assert.equal(p.search.length,1);
});
test('only future coverage policy can bypass search; stale records return to search at expiry', () => {
  const input = { ...example().input, policy: 'coverage_based' as const, search: { status: 'unconnected' as const, results: [] } };
  assert.equal(prepareMaterials(input).route,'enough');
  assert.equal(prepareMaterials(input).ready,true);
  const expired = { ...input, existing: input.existing.map(m => ({ ...m, expires_at: now })) };
  assert.equal(prepareMaterials(expired).route,'need_search');
  assert.equal(prepareMaterials(expired).ready,false);
});
test('failed, empty and unconnected searches cannot masquerade as successful current evidence', () => {
  for (const status of ['failed','empty','unconnected'] as const) {
    const input = { ...example().input, search: { status, results: example().input.search.results } };
    const result = prepareMaterials(input);
    assert.equal(result.ready,false);
    assert.equal(result.materials.length,1); // stored data retained
    assert.equal(result.searched.length,0);
  }
  const p = preparationCase('bitcoin-design','news',1,'2026-10-13T05:05:00Z',now,'failure');
  assert.equal(p.cache[0]?.fetched_at,p.input.existing[0]?.fetched_at);
  assert.equal(p.cache[0]?.expires_at,p.input.existing[0]?.expires_at);
});
test('wrong-asset, stale, missing-provenance and future-time records cannot satisfy a requirement', () => {
  const input = example().input;
  for (const change of [{ asset_id: 'other' }, { source_ref: '' }, { expires_at: now }, { fetched_at: 'invalid' },
    { published_at: '2026-10-14T00:00:00Z' }]) {
    const result = prepareMaterials({ ...input, search: { status:'success',results: input.search.results.map(m => ({ ...m,...change })) } });
    assert.equal(result.ready,false);
  }
  assert.equal(prepareMaterials({ ...input, lease_until: now }).route,'blocked');
});
test('current search cannot erase a separate missing category; assembly keeps provenance and rejects incomplete evidence', () => {
  const input = example().input;
  const result = prepareMaterials({ ...input,required_keys:['news','chain'] });
  assert.deepEqual(result.missing,['chain']);
  assert.equal(result.ready,false);
  const same = prepareMaterials({ ...input, existing: input.search.results });
  assert.equal(same.materials.length,1);
});
test('through-line preparation failures reach save without producing new content; other keys remain independent', () => {
  const flow=buildDesignPipeline('failure');
  assert.equal(flow.preparations.find(p=>p.read.asset_id==='demo-B')?.result.ready,false);
  assert.equal(flow.attempts.find(p=>p.asset_id==='demo-B')?.candidate_content_json,null);
  assert.equal(flow.after.find(p=>p.asset_id==='demo-B')?.last_success_at,flow.before.find(p=>p.asset_id==='demo-B')?.last_success_at);
  assert.equal(flow.after.find(p=>p.asset_id==='demo-C')?.last_success_at,flow.now);
  assert.ok(buildDesignPipeline('enough').preparations.every(p=>p.result.route==='enough' && p.search.length===0));
  assert.ok(buildDesignPipeline('unconnected').attempts.every(p=>p.candidate_content_json===null));
});
