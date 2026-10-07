import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { graphSchema, sourceContractsSchema } from './contracts';
import { serverGraph } from './testFixtures';

const graph = serverGraph();
test('accepts the real Python graph, including fields, mappings, needs and system tables', () => {
  assert.equal(graph.nodes.length, 8);
  assert.equal(graph.field_usages.length, 1);
  assert.equal(graph.requirements[0]?.source_field_id, null);
  assert.deepEqual(graphSchema.parse(graph), graph);
});
test('accepts every operation and resource in the saved source contract', () => {
  const saved: unknown = JSON.parse(readFileSync(new URL('../catalog/source-contracts.v1.json', import.meta.url), 'utf8'));
  const contract = sourceContractsSchema.parse(saved);
  assert.equal(contract.operations.length, contract.operation_count);
  assert.equal(contract.resources.length, contract.resource_count);
});
test('rejects malformed types, missing collections and nonfinite coordinates', () => {
  const node = graph.nodes[0]!;
  for (const patch of [{ type: 'invented' }, { position_x: NaN }, { position_y: Infinity }, { reference_number: '1234' }]) {
    assert.equal(graphSchema.safeParse({ ...graph, nodes: [{ ...node, ...patch }] }).success, false);
  }
  assert.equal(graphSchema.safeParse({ nodes: [], edges: [] }).success, false);
});
test('rejects duplicate IDs, orphan references and mappings to the wrong node', () => {
  assert.equal(graphSchema.safeParse({ ...graph, nodes: [...graph.nodes, graph.nodes[0]] }).success, false);
  const edge = graph.edges[0]!;
  assert.equal(graphSchema.safeParse({ ...graph, edges: [{ ...edge, downstream_id: 'missing' }] }).success, false);
  const usage = graph.field_usages[0]!;
  assert.equal(graphSchema.safeParse({ ...graph, field_usages: [{ ...usage, target_field_id: usage.source_field_id }] }).success, false);
  assert.equal(graphSchema.safeParse({ ...graph, requirements: [{ ...graph.requirements[0], source_field_id: 'missing' }] }).success, false);
});
test('preserves additional server metadata without claiming its type', () => {
  const result = graphSchema.parse({ ...graph, future_revision: 'v2' });
  assert.equal(result.future_revision, 'v2');
});
