import assert from 'node:assert/strict';
import test from 'node:test';
import {decideCurrentPages} from './assetWebpageDesign';

const page={asset_id:'asset-a',page_ref:'example-page.html',updated_at:'2026-10-18T00:00:00Z'};
test('one-row page reads distinguish missing pages from failed or unknown reads',()=>{
  assert.equal(decideCurrentPages(['asset-a'],[],'2026-10-19T00:00:00Z',null)[0]!.action,'generate');
  assert.equal(decideCurrentPages(['asset-a'],[],'2026-10-19T00:00:00Z',null,false)[0]!.action,'blocked');
  assert.equal(decideCurrentPages(['asset-a'],[{...page,updated_at:null}],'2026-10-19T00:00:00Z',86400)[0]!.reason,'unknown_or_invalid_page_time');
  assert.equal(decideCurrentPages(['asset-a'],[page,page],'2026-10-19T00:00:00Z',86400)[0]!.reason,'duplicate_current_rows');
});
test('daily and three-day boundaries are parameters; no interval means no expired conclusion',()=>{
  const at='2026-10-19T00:00:00Z';
  assert.equal(decideCurrentPages(['asset-a'],[page],at,null)[0]!.reason,'page_interval_unconfigured');
  assert.equal(decideCurrentPages(['asset-a'],[page],at,86400)[0]!.action,'refresh');
  assert.equal(decideCurrentPages(['asset-a'],[page],at,3*86400)[0]!.action,'skip');
  assert.equal(decideCurrentPages(['asset-a'],[page],'2026-10-21T00:00:00Z',3*86400)[0]!.action,'refresh');
  assert.equal(decideCurrentPages(['asset-a'],[page],'2026-10-17T00:00:00Z',86400)[0]!.action,'blocked');
});
