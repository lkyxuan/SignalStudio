import test from 'node:test';
import assert from 'node:assert/strict';
import { portPoint, routeDetours, curvedRoute, bezierRoute, directCurveIsClear, type Point, type RouteCard, type RouteLink } from './edgeRouting';
const card = (id: string, x: number, y: number): RouteCard => ({ id, position_x: x, position_y: y });
function clear(points: Point[], cards: RouteCard[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    assert.ok(a[0] === b[0] || a[1] === b[1], 'orthogonal segment');
    for (const c of cards) {
      const l = c.position_x, r = l + (c.width ?? 300), t = c.position_y, bottom = t + (c.height ?? 160);
      assert.ok(!(a[0] === b[0] ? a[0] > l && a[0] < r && Math.max(a[1], b[1]) > t && Math.min(a[1], b[1]) < bottom
        : a[1] > t && a[1] < bottom && Math.max(a[0], b[0]) > l && Math.min(a[0], b[0]) < r), `segment crosses ${c.id}`);
    }
  }
}
test('back link stays beside its column rather than visiting unrelated far-right cards', () => {
  const cards = [card('target', 0, 0), card('source', 0, 512), card('unrelated', 4000, 0)];
  const e: RouteLink = { id: 'return', source: [150, 672], target: [150, 0], sourceSide: 'normal', targetSide: 'normal' };
  const p = routeDetours(cards, [e]).get(e.id)!;
  clear(p, cards); assert.deepEqual(p[0], e.source); assert.deepEqual(p.at(-1), e.target);
  assert.ok(p.every(([x]) => x >= -100 && x <= 400));
  assert.ok(!curvedRoute(p).includes('NaN'));
});
test('local route avoids manually moved obstacles and is deterministic', () => {
  const cards = [card('a', 0, 300), card('b', 760, 0), { ...card('obstacle', 370, 150), width: 250, height: 400 }];
  const e: RouteLink = { id: 'side', source: [300, 356], target: [760, 124], sourceSide: 'right', targetSide: 'left' };
  const routes = routeDetours(cards, [e]); clear(routes.get(e.id)!, cards);
  assert.deepEqual(routeDetours([...cards].reverse(), [e]), routes);
});
test('parallel returns choose separate lanes and per-edge ports without dropping directions', () => {
  const cards = [card('source', 0, 600), card('target', 0, 0)];
  const edges: RouteLink[] = [0, 1, 2].map(i => ({ id: `edge${i}`, source: portPoint(cards[0]!, 'right', true, i, 3), target: portPoint(cards[1]!, 'right', false, i, 3), sourceSide: 'right', targetSide: 'right' }));
  const routes = routeDetours(cards, edges);
  assert.equal(routes.size, edges.length);
  const verticalX = new Set<number>();
  for (const e of edges) {
    const p = routes.get(e.id)!; clear(p, cards); assert.deepEqual(p[0], e.source); assert.deepEqual(p.at(-1), e.target);
    for (let i = 1; i < p.length; i++) if (Math.abs(p[i]![1] - p[i - 1]![1]) > 300) verticalX.add(p[i]![0]);
  }
  assert.equal(verticalX.size, 3);
  assert.deepEqual(routeDetours(cards, [...edges].reverse()), routes);
});
test('self returns route outside their own card and impossible escapes fall back explicitly', () => {
  const cards = [card('one', 0, 0)];
  const e: RouteLink = { id: 'self', source: [150, 160], target: [150, 0], sourceSide: 'normal', targetSide: 'normal' };
  clear(routeDetours(cards, [e]).get('self')!, cards);
  assert.equal(routeDetours([...cards, card('overlap', 0, 170)], [e]).size, 0);
  assert.equal(routeDetours([], []).size, 0);
});

test('clear connections use one cubic curve; blocked ones use smooth bends without line commands', () => {
  const cards = [card('left', 0, 300), card('right', 760, 300)];
  const e: RouteLink = { id: 'curve', source: [300, 356], target: [760, 424], sourceSide: 'right', targetSide: 'left' };
  assert.equal(directCurveIsClear(cards, e), true);
  assert.equal((bezierRoute(e).match(/C/g) || []).length, 1);
  const blocked = [...cards, card('obstacle', 370, 300)];
  assert.equal(directCurveIsClear(blocked, e), false);
  const path = curvedRoute(routeDetours(blocked, [e]).get(e.id)!);
  assert.ok(!/[LQ]/.test(path));
  assert.ok(path.includes(' C '));
  const commands = [...path.matchAll(/([MC])\s*([^MC]+)/g)];
  let current: Point = [0, 0];
  for (const match of commands) {
    const values = match[2]!.trim().split(/\s+/).map(Number);
    if (match[1] === 'M') { current = [values[0]!, values[1]!]; continue; }
    const end: Point = [values[4]!, values[5]!];
    for (let i = 1; i <= 200; i++) {
      const t = i / 200, u = 1 - t;
      const x = u ** 3 * current[0] + 3 * u ** 2 * t * values[0]! + 3 * u * t ** 2 * values[2]! + t ** 3 * end[0];
      const y = u ** 3 * current[1] + 3 * u ** 2 * t * values[1]! + 3 * u * t ** 2 * values[3]! + t ** 3 * end[1];
      for (const c of blocked) assert.ok(!(x > c.position_x + .01 && x < c.position_x + 299.99 && y > c.position_y + .01 && y < c.position_y + 159.99), 'curve must not cut through a card');
    }
    current = end;
  }
});
