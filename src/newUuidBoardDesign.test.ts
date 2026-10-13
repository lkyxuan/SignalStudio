import test from 'node:test';
import assert from 'node:assert/strict';
import spec from '../catalog/new-uuid-board.v1.json';
import {selectNewUuidDesign} from './newUuidBoardDesign';
import {selectCandidates, type Snapshot} from './contentRefreshDesign';
import refresh from '../catalog/content-refresh.v1.json';

test('new UUID means first registration, not project age, market activity or repeated source discovery', () => {
  const result = selectNewUuidDesign(spec.case.rows, spec.case.now);
  assert.deepEqual(result.rows.map(row => row.asset_id), ['demo-person','demo-C','demo-A']);
  const changed = spec.case.rows.map(row => row.asset_id === 'demo-A'
    ? {...row, source_refs_json:[...row.source_refs_json,'synthetic/new-channel']} : row);
  assert.deepEqual(selectNewUuidDesign(changed,spec.case.now).rows.map(row => row.asset_id), result.rows.map(row => row.asset_id));
  assert.equal(result.rows.find(row => row.asset_id === 'demo-A')?.created_at, '2026-10-12T00:00:00Z');
  const migrated = spec.case.rows.map(row => ({...row,creation_origin:'migration'}));
  assert.equal(selectNewUuidDesign(migrated,spec.case.now).rows.length,0);
  assert.equal(selectNewUuidDesign(spec.case.rows,spec.case.now,false).available,false);
});

test('invalid times, future times, duplicates and import markers cannot fabricate new UUIDs', () => {
  const row=spec.case.rows[0]!;
  for (const created_at of ['', 'invalid', '2099-01-01T00:00:00Z'])
    assert.equal(selectNewUuidDesign([{...row,created_at}],spec.case.now).rows.length,0);
  assert.equal(selectNewUuidDesign([row,row],spec.case.now).available,false);
  assert.equal(selectNewUuidDesign([{...row,creation_origin:'unknown'}],spec.case.now).available,false);
  const rows=[{...row,asset_id:'z'},{...row,asset_id:'a'}];
  assert.equal(selectNewUuidDesign(rows,spec.case.now,true,1).rows[0]?.asset_id,'a');
});

test('token filtering precedes per-board limit; missing boards do not prevent another board contributing', () => {
  const snapshot: Snapshot={key:'new_uuid',available:true,complete:true,valid:true,
    rows:selectNewUuidDesign(spec.case.rows,spec.case.now).rows};
  const boards=refresh.boards.map(board=>({...board,top_n:1}));
  assert.deepEqual(selectCandidates([snapshot],spec.case.now,boards),['demo-C']);
  assert.deepEqual(selectCandidates([{...snapshot,available:false}],spec.case.now),[]);
  const old={...snapshot,rows:snapshot.rows.map(row=>({...row,calculated_at:'2026-10-13T03:45:00Z'}))};
  assert.deepEqual(selectCandidates([old],spec.case.now),[]);
});
