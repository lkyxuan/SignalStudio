import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorDraft} from './editorDraft';

test('save before blur reads the latest typed and composed characters',()=>{
  const original={id:'card',notes:'base',formula:'x'};
  const draft=new EditorDraft<typeof original>();draft.reset(original);
  for(const value of ['base你','base你好','base你好，策略'])draft.edit('notes',value);
  assert.equal(draft.value?.notes,'base你好，策略');
  assert.deepEqual(original,{id:'card',notes:'base',formula:'x'});
});
test('independent fields and auxiliary writes retain the complete current draft',()=>{
  const d=new EditorDraft();d.reset({id:'card',notes:'',formula:'a'});
  d.edit('notes','unsaved');d.edit('formula','b');
  assert.deepEqual(d.value,{id:'card',notes:'unsaved',formula:'b'});
  const snapshot=d.value;d.edit('formula','c');assert.equal(snapshot?.formula,'b');
});
test('discard, save acknowledgement and switching cards replace buffered values',()=>{
  const d=new EditorDraft();d.reset({id:'a',notes:'old'});d.edit('notes','unsaved');
  d.reset({id:'a',notes:'server'});assert.equal(d.value?.notes,'server');
  d.reset({id:'b',notes:'other'});assert.equal(d.value?.id,'b');
  d.reset(null);d.edit('notes','late blur');assert.equal(d.value,null);
});
