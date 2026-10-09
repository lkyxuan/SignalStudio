import assert from 'node:assert/strict';
import { test } from 'node:test';
import { neighborLayout, type PositionedCard } from './neighborLayout';
const card = (id: string, x: number, y: number, height = 104): PositionedCard =>
  ({ id, position: { x, y }, measured: { width: 208, height } });
const edge = (upstream_id: string, downstream_id: string) => ({ upstream_id, downstream_id });

test('moves direct neighbors to either side without changing the anchor or unrelated cards', () => {
  const cards = [card('focus', 500, 500), card('up', -4000, 0), card('down', 6000, 0), card('other', 5000, 900)];
  const before = structuredClone(cards);
  const result = neighborLayout(cards, [edge('up', 'focus'), edge('focus', 'down'), edge('down', 'other')], 'focus');
  assert.deepEqual(result, [{ id: 'up', position_x: 248, position_y: 500 }, { id: 'down', position_x: 752, position_y: 500 }]);
  assert.deepEqual(cards, before);
});

test('avoids collisions with stationary cards and measured tall neighbors', () => {
  const cards = [card('focus', 500, 500), card('obstacle', 248, 400, 300),
    card('up1', -3000, 0, 300), card('up2', -3000, 400, 180), card('down', 7000, 0)];
  const result = neighborLayout(cards, [edge('up1', 'focus'), edge('up2', 'focus'), edge('focus', 'down')], 'focus');
  const moved = new Map(result.map(item => [item.id, item]));
  const boxes = cards.map(item => ({ ...item, position: moved.has(item.id) ?
    { x: moved.get(item.id)!.position_x, y: moved.get(item.id)!.position_y } : item.position }));
  for (const item of boxes.filter(item => moved.has(item.id))) {
    for (const other of boxes.filter(other => other.id !== item.id)) {
      assert.ok(item.position.x + 208 <= other.position.x || other.position.x + 208 <= item.position.x ||
        item.position.y + item.measured!.height! <= other.position.y || other.position.y + other.measured!.height! <= item.position.y,
      `${item.id} overlaps ${other.id}`);
    }
  }
});

test('deduplicates bidirectional edges and excludes self and absent nodes', () => {
  const result = neighborLayout([card('focus', 0, 0), card('both', 3000, 0)],
    [edge('both', 'focus'), edge('both', 'focus'), edge('focus', 'both'), edge('focus', 'focus'), edge('missing', 'focus')], 'focus');
  assert.equal(result.length, 1);
  assert.equal(result[0]!.id, 'both');
  assert.ok(result[0]!.position_x < 0);
});

test('returns no positions for an isolated or missing anchor', () => {
  assert.deepEqual(neighborLayout([card('focus', 0, 0)], [], 'focus'), []);
  assert.deepEqual(neighborLayout([], [], 'missing'), []);
});
