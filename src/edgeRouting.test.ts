import test from 'node:test';
import assert from 'node:assert/strict';
import { arcStyles, bezierControls, bezierRoute, type RouteLink } from './edgeRouting';
const card = (id: string, x: number, y: number) => ({ id, name: id, type: 'Metric', position_x: x, position_y: y });
const link = (overrides: Partial<RouteLink> = {}): RouteLink => ({ source: [150, 160], target: [150, 256], sourceSide: 'normal', targetSide: 'normal', parallelIndex: 0, dashed: false, ...overrides });
test('aligned forward endpoints visibly bow and keep one cubic with exact endpoints', () => {
  const e = link(), [a, c, d, b] = bezierControls(e);
  assert.deepEqual(a, e.source); assert.deepEqual(b, e.target);
  assert.ok(c[0] - a[0] >= 64 && d[0] - b[0] >= 64);
  assert.ok(c[1] > a[1] && d[1] < b[1]);
  assert.equal((bezierRoute(e).match(/C/g) || []).length, 1);
  assert.ok(!/[LQ]/.test(bezierRoute(e)));
  const [, longControl] = bezierControls(link({ target: [150, 3500] }));
  assert.ok(longControl[0] - a[0] >= 300, 'long aligned connections retain a visible broad bow');
});
test('horizontal facing endpoints bow instead of overlapping straight tracks', () => {
  const [a, c, d, b] = bezierControls(link({ source: [300, 70], target: [760, 70], sourceSide: 'right', targetSide: 'left' }));
  assert.ok(c[0] > a[0] && d[0] < b[0]);
  assert.ok(c[1] < a[1] && d[1] < b[1]);
});
test('parallel arcs are stable after input reorder and distinct even with identical endpoints', () => {
  const cards = [card('a', 0, 500), card('b', 0, 0)];
  const edges = ['z', 'a', 'm'].map(id => ({ id, upstream_id: 'a', downstream_id: 'b' }));
  const styles = arcStyles(cards, edges);
  assert.deepEqual(arcStyles([...cards].reverse(), [...edges].reverse()), styles);
  const paths = edges.map(e => bezierRoute(link({ ...styles.get(e.id)!, source: [300, 550], target: [300, 120] })));
  assert.equal(new Set(paths).size, 3);
  for (const style of styles.values()) assert.equal(style.sourceSide, style.targetSide);
});
test('self links use a single local outward arc, including overlapping unrelated cards', () => {
  const cards = [card('a', 0, 0)], edges = [{ id: 'self', upstream_id: 'a', downstream_id: 'a' }];
  const style = arcStyles(cards, edges).get('self')!;
  const e = link({ ...style, source: [300, 56], target: [300, 124] });
  const [, c, d] = bezierControls(e);
  assert.ok(c[0] > 300 && d[0] > 300);
  assert.deepEqual(arcStyles([...cards, card('overlap', 0, 0), card('far', 8000, 0)], edges).get('self'), style);
  assert.ok(!bezierRoute(e).includes('NaN'));
});
test('side support uses facing ports without obstacle routing or moving cards', () => {
  const cards = [{ ...card('support', 0, 0), name: 'asset_identifiers', type: 'asset_identifiers' }, card('consumer', 760, 500)];
  const edges = [{ id: 'read', upstream_id: 'support', downstream_id: 'consumer' }];
  const before = structuredClone(cards), style = arcStyles(cards, edges).get('read')!;
  assert.equal(style.sourceSide, 'right'); assert.equal(style.targetSide, 'left');
  assert.deepEqual(arcStyles([...cards, card('obstacle', 380, 250)], edges).get('read'), style);
  assert.deepEqual(cards, before);
});

test('opposite read arrows share parallel cubics in vertical, horizontal and diagonal layouts', () => {
  const edges = [
    { id: 'return', upstream_id: 'table', downstream_id: 'reader', relationship_id: 'read', presentation_role: 'response' },
    { id: 'request', upstream_id: 'reader', downstream_id: 'table', relationship_id: 'read', presentation_role: 'request' },
  ];
  const endpoint = (node: ReturnType<typeof card>, port: NonNullable<RouteLink['sourcePort']>): [number, number] => {
    const horizontal = port.position === 'left' || port.position === 'right';
    return horizontal
      ? [node.position_x + (port.position === 'right' ? 300 : 0), node.position_y + 180 * port.percent / 100 + port.offset]
      : [node.position_x + 300 * port.percent / 100 + port.offset, node.position_y + (port.position === 'bottom' ? 180 : 0)];
  };
  for (const [x, y] of [[0, 600], [0, -600], [900, 0], [-900, 0], [900, 700], [100, 700]] as const) {
    const a = card('table', 0, 0), b = card('reader', x, y), styles = arcStyles([a, b], edges);
    assert.deepEqual(arcStyles([b, a], [...edges].reverse()), styles);
    const response = styles.get('return')!, request = styles.get('request')!;
    assert.equal(response.sourcePort!.position, request.targetPort!.position);
    assert.equal(response.targetPort!.position, request.sourcePort!.position);
    const outgoing = bezierControls({ ...response, source: endpoint(a, response.sourcePort!), target: endpoint(b, response.targetPort!) });
    const incoming = bezierControls({ ...request, source: endpoint(b, request.sourcePort!), target: endpoint(a, request.targetPort!) }).reverse();
    const axis = response.sourceSide === 'normal' ? 0 : 1;
    // All four control points have the same translation. Thus the entire cubic
    // stays on a parallel track, rather than merely separating the labels.
    for (let i = 0; i < 4; i++) for (let coordinate = 0; coordinate < 2; coordinate++) {
      assert.ok(Math.abs(outgoing[i]![coordinate]! - incoming[i]![coordinate]! - (coordinate === axis ? 28 : 0)) < 1e-8);
    }
  }
});

test('multiple read pairs use adjacent ports per relationship and ignore unpaired lookalikes', () => {
  const cards = [card('table', 0, 0), card('one', 900, 0), card('two', 900, 600)];
  const edges = ['one', 'two'].flatMap(id => [
    { id: `${id}-return`, upstream_id: 'table', downstream_id: id, relationship_id: id, presentation_role: 'response' },
    { id: `${id}-request`, upstream_id: id, downstream_id: 'table', relationship_id: id, presentation_role: 'request' },
  ]);
  const styles = arcStyles(cards, edges);
  assert.notEqual(styles.get('one-return')!.sourcePort!.percent, styles.get('two-return')!.sourcePort!.percent);
  for (const id of ['one', 'two']) assert.equal(styles.get(`${id}-return`)!.sourcePort!.percent, styles.get(`${id}-request`)!.targetPort!.percent);
  const missing = arcStyles(cards, [edges[0]!]).get(edges[0]!.id)!;
  assert.equal(missing.sourcePort, undefined);
});
