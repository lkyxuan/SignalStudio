import test from 'node:test';
import assert from 'node:assert/strict';
import { graphEmphasis } from './graphEmphasis';
const nodes = ['a', 'b', 'c', 'shared', 'other'].map(id => ({ id, name: id, type: 'Metric' }));
const edges = [['a', 'b'], ['b', 'c'], ['shared', 'b'], ['shared', 'other']].map(([a, b]) => ({ id: `${a}-${b}`, upstream_id: a!, downstream_id: b! }));
test('details emphasize exactly one step, ignoring unrelated hovered edges and fork siblings', () => {
  const result = graphEmphasis(nodes, edges, { detailNodeId: 'shared', hoveredEdgeId: 'a-b' });
  assert.equal(result.active, true);
  assert.deepEqual([...result.nodeIds].sort(), ['b', 'other', 'shared']);
  assert.deepEqual([...result.edgeIds].sort(), ['shared-b', 'shared-other']);
  const middle = graphEmphasis(nodes, edges, { detailNodeId: 'b' });
  assert.deepEqual([...middle.nodeIds].sort(), ['a', 'b', 'c', 'shared']);
  assert.deepEqual([...middle.edgeIds].sort(), ['a-b', 'b-c', 'shared-b']);
});
test('one-step details handle cycles, self links, neighbor-only links and dangling edges', () => {
  const extra = [
    { id: 'b-a', upstream_id: 'b', downstream_id: 'a' },
    { id: 'a-a', upstream_id: 'a', downstream_id: 'a' },
    { id: 'a-missing', upstream_id: 'a', downstream_id: 'missing' },
  ];
  const result = graphEmphasis(nodes, [...edges, ...extra], { detailNodeId: 'a' });
  assert.deepEqual([...result.nodeIds].sort(), ['a', 'b']);
  assert.deepEqual([...result.edgeIds].sort(), ['a-a', 'a-b', 'b-a']);
});
test('isolated details emphasize only the card and clearing removes emphasis', () => {
  const isolated = [...nodes, { id: 'isolated', name: 'isolated', type: 'Metric' }];
  const result = graphEmphasis(isolated, edges, { detailNodeId: 'isolated' });
  assert.equal(result.active, true); assert.deepEqual([...result.nodeIds], ['isolated']);
  assert.equal(result.edgeIds.size, 0);
  assert.equal(graphEmphasis(isolated, edges, { detailNodeId: 'missing' }).active, false);
  assert.equal(graphEmphasis(isolated, edges, {}).active, false);
});
test('explicit double-click route remains complete and clearing restores normal graph', () => {
  const route = graphEmphasis(nodes, edges, { routeNodeId: 'b' });
  assert.equal(route.active, true); assert.deepEqual([...route.nodeIds].sort(), ['a', 'b', 'c', 'shared']); assert.equal(route.edgeIds.size, 3);
  assert.equal(graphEmphasis(nodes, edges, {}).active, false);
  assert.equal(graphEmphasis(nodes, edges, { routeNodeId: 'missing' }).active, false);
});
test('edge navigation still emphasizes only its endpoints', () => {
  const route = graphEmphasis(nodes, edges, { selectedEdgeId: 'a-b' });
  assert.deepEqual([...route.nodeIds].sort(), ['a', 'b']); assert.equal(route.edgeIds.size, 1);
});
