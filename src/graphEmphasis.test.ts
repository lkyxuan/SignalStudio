import test from 'node:test';
import assert from 'node:assert/strict';
import { graphEmphasis } from './graphEmphasis';
const nodes = ['a', 'b', 'c', 'shared', 'other'].map(id => ({ id, name: id, type: 'Metric' }));
const edges = [['a', 'b'], ['b', 'c'], ['shared', 'b'], ['shared', 'other']].map(([a, b]) => ({ id: `${a}-${b}`, upstream_id: a!, downstream_id: b! }));
test('details never highlight the recursive route, even with a lingering edge hover', () => {
  for (const id of ['b', 'shared']) {
    const result = graphEmphasis(nodes, edges, { detailNodeId: id, hoveredEdgeId: 'a-b' });
    assert.equal(result.active, false); assert.equal(result.nodeIds.size, 0); assert.equal(result.edgeIds.size, 0);
  }
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
