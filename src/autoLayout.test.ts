import type { LayoutNode } from './autoLayout';
import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout } from './autoLayout';

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
