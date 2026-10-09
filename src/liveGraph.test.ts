import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveGraphState } from './liveGraph';
import type { Graph } from './contracts';
const graph = (revision: string) => ({ revision, nodes: [], edges: [], fields: [], field_usages: [], requirements: [], types: [] }) as Graph;
test('unchanged poll preserves the exact graph; clean detail accepts changes', () => {
  const live = new LiveGraphState();
  assert.equal(live.receive(graph('a')), true);
  const original = live.graph;
  assert.equal(live.receive(graph('a')), false);
  assert.equal(live.graph, original);
  assert.equal(live.receive(graph('b')), true);
});
test('draft survives external update; user must explicitly resolve each new revision', () => {
  const live = new LiveGraphState(); live.receive(graph('a')); live.dirty = true;
  assert.equal(live.receive(graph('b')), false);
  assert.equal(live.graph?.revision, 'a'); assert.equal(live.expected, 'a'); assert.equal(live.conflict, true);
  live.accept(); assert.equal(live.conflict, false); assert.equal(live.expected, 'b');
  live.receive(graph('c')); assert.equal(live.conflict, true);
  live.clear(); assert.equal(live.receive(live.pending!), true); assert.equal(live.graph?.revision, 'c');
});
test('drag holds poll results until persistence finishes', () => {
  const live = new LiveGraphState(); live.receive(graph('a')); live.dragging = true;
  assert.equal(live.receive(graph('b')), false); assert.equal(live.graph?.revision, 'a');
  live.dragging = false; assert.equal(live.receive(live.pending!), true);
});
