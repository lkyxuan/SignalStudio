import type { LayoutNode } from './autoLayout';
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, layoutGroups } from './autoLayout';

test('arranges dependencies left to right without overlapping cards', () => {
  const nodes: LayoutNode[] = [
    { id: 'a', name: 'Source A', type: 'Source' },
    { id: 'b', name: 'Source B', type: 'Source' },
    { id: 'c', name: 'Count', type: 'Raw Field' },
    { id: 'd', name: 'Heat', type: 'Metric' },
    { id: 'e', name: 'Product', type: 'Product Module' },
    { id: 'f', name: 'Other', type: 'Metric' },
  ];
  const edges = [
    { upstream_id: 'a', downstream_id: 'c' },
    { upstream_id: 'b', downstream_id: 'c' },
    { upstream_id: 'c', downstream_id: 'd' },
    { upstream_id: 'd', downstream_id: 'e' },
  ];
  const layout = autoLayout(nodes, edges);
  const byId = new Map(layout.map(position => [position.id, position]));
  assert.deepEqual(autoLayout([...nodes].reverse(), [...edges].reverse()), layout);
  for (const edge of edges) assert.ok(byId.get(edge.upstream_id)!.position_x < byId.get(edge.downstream_id)!.position_x);
  for (let left = 0; left < layout.length; left++) for (let right = left + 1; right < layout.length; right++) {
    const a = layout[left]!, b = layout[right]!;
    assert.ok(Math.abs(a.position_x - b.position_x) >= 300 || Math.abs(a.position_y - b.position_y) >= 160);
  }
});

test('packs unconnected record types into multi-column source blocks', () => {
  const nodes: LayoutNode[] = [
    ...Array.from({ length: 19 }, (_, index) => ({ id: `k${index}`, name: `kaito-social-spider.record_${index}`, type: 'Source' })),
    ...Array.from({ length: 8 }, (_, index) => ({ id: `b${index}`, name: `binance-futures.record_${index}`, type: 'Source' })),
    ...['assets', 'asset_identifiers', 'asset_relationships', 'asset_monitoring_rules',
      'asset_score_events', 'asset_scores_current']
      .map(name => ({ id: name, name, type: name, is_system_state: 1 })),
  ];
  const layout = autoLayout(nodes, []);
  const byId = new Map(layout.map(item => [item.id, item]));
  const binance = nodes.filter(node => node.name.startsWith('binance-futures.')).map(node => byId.get(node.id)!);
  const kaito = nodes.filter(node => node.name.startsWith('kaito-social-spider.')).map(node => byId.get(node.id)!);
  const tables = nodes.filter(node => node.is_system_state).map(node => byId.get(node.id)!);
  assert.equal(new Set(binance.map(item => item.position_x)).size, 3);
  assert.equal(new Set(kaito.map(item => item.position_x)).size, 4);
  assert.equal(new Set(tables.map(item => item.position_x)).size, 3);
  assert.deepEqual(autoLayout([...nodes].reverse(), []), layout);
  for (let left = 0; left < layout.length; left++) for (let right = left + 1; right < layout.length; right++) {
    const a = layout[left]!, b = layout[right]!;
    assert.ok(Math.abs(a.position_x - b.position_x) >= 300 || Math.abs(a.position_y - b.position_y) >= 160);
  }
});

test('lays out an asset-table read and later write without losing processor order', () => {
  const nodes: LayoutNode[] = [
    { id: 'table', name: 'assets', type: 'assets', is_system_state: 1 },
    { id: 'group', name: 'Register asset', type: 'Asset Resolution' },
    { id: 'review', name: 'Review asset', type: 'Review Decision' },
  ];
  const edges = [
    { upstream_id: 'table', downstream_id: 'group' },
    { upstream_id: 'group', downstream_id: 'table' },
    { upstream_id: 'group', downstream_id: 'review' },
  ];
  const byId = new Map(autoLayout(nodes, edges).map(position => [position.id, position]));
  assert.ok(byId.get('table')!.position_x < byId.get('group')!.position_x);
  assert.ok(byId.get('group')!.position_x < byId.get('review')!.position_x);
});

test('separates workflow ownership, shared resources and unused sources without mutating the graph', () => {
  const nodes: LayoutNode[] = [
    { id: 's', name: 'Signal input', type: 'Metric', workflow_lane: 'signal' },
    { id: 'out', name: 'Signal result', type: 'Metric', workflow_lane: 'signal' },
    { id: 'k', name: 'Knowledge input', type: 'Metric', workflow_lane: 'knowledge' },
    { id: 'shared', name: 'Bus', type: 'Redpanda Topic', kind: 'channel', workflow_lane: 'shared' },
    { id: 'source', name: 'platform.unused', type: 'Source', kind: 'source', workflow_lane: 'shared' },
    { id: 'unknown', name: 'No ownership', type: 'Metric' },
  ];
  const edges = [
    { upstream_id: 's', downstream_id: 'shared' },
    { upstream_id: 'shared', downstream_id: 'out' },
    { upstream_id: 'k', downstream_id: 'shared' },
    { upstream_id: 'unknown', downstream_id: 's' },
  ];
  const before = structuredClone({ nodes, edges });
  const groups = layoutGroups(nodes, edges);
  assert.equal(groups.find(group => group.key === 'shared-resources')!.nodes[0]!.id, 'shared');
  assert.equal(groups.find(group => group.key === 'source:platform')!.nodes[0]!.id, 'source');
  assert.ok(groups.some(group => group.key.startsWith('flow:unassigned:')));
  assert.equal(groups.flatMap(group => group.nodes).length, nodes.length);
  assert.ok(groups.filter(group => group.flow).every(group => new Set(group.nodes.map(node => node.workflow_lane)).size === 1));
  const positions = autoLayout(nodes, edges);
  const byId = new Map(positions.map(position => [position.id, position]));
  assert.ok(byId.get('s')!.position_x < byId.get('out')!.position_x, 'order through a shared channel is retained');
  assert.deepEqual(autoLayout([...nodes].reverse(), [...edges].reverse()), positions);
  assert.deepEqual({ nodes, edges }, before);
  for (const a of positions) for (const b of positions) if (a.id !== b.id) {
    assert.ok(Math.abs(a.position_x - b.position_x) >= 300 || Math.abs(a.position_y - b.position_y) >= 160);
  }
});

test('handles duplicate, self, dangling and cyclic links deterministically', () => {
  const nodes = ['a', 'b', 'c'].map(id => ({ id, name: id, type: 'Metric', workflow_lane: 'signal' }));
  const edges = [
    { upstream_id: 'a', downstream_id: 'b' }, { upstream_id: 'b', downstream_id: 'a' },
    { upstream_id: 'b', downstream_id: 'c' }, { upstream_id: 'a', downstream_id: 'b' },
    { upstream_id: 'c', downstream_id: 'c' }, { upstream_id: 'missing', downstream_id: 'a' },
  ];
  const positions = autoLayout(nodes, edges);
  assert.equal(new Set(positions.map(node => node.id)).size, 3);
  assert.ok(positions.every(node => Number.isFinite(node.position_x) && Number.isFinite(node.position_y)));
  assert.deepEqual(autoLayout([...nodes].reverse(), [...edges].reverse()), positions);
  assert.deepEqual(autoLayout([], edges), []);
});

test('wraps tall dependency layers while keeping branches before their join', () => {
  const nodes = [...Array.from({ length: 12 }, (_, index) => ({ id: `input-${index}`, name: `Input ${index}`, type: 'Source' })),
    { id: 'join', name: 'Join', type: 'Metric' }];
  const edges = nodes.slice(0, -1).map(node => ({ upstream_id: node.id, downstream_id: 'join' }));
  const positions = autoLayout(nodes, edges);
  const join = positions.find(node => node.id === 'join')!;
  assert.ok(positions.filter(node => node.id !== 'join').every(node => node.position_x < join.position_x));
  assert.equal(new Set(positions.filter(node => node.id !== 'join').map(node => node.position_y)).size, 4);
});
