import { sideLayoutGroups, type LayoutNode } from './autoLayout';
export type Point = [number, number];
export type RouteSide = 'left' | 'right' | 'normal';
export type RouteCard = { id: string; position_x: number; position_y: number; width?: number; height?: number };
type Edge = { id: string; upstream_id: string; downstream_id: string };
export type ArcStyle = { sourceSide: RouteSide; targetSide: RouteSide; parallelIndex: number; dashed: boolean };
export type RouteLink = ArcStyle & { source: Point; target: Point };

// Geometry depends on the two endpoints only. No obstacle search or corridor fallback.
export function arcStyles(cards: (RouteCard & LayoutNode)[], edges: Edge[]): Map<string, ArcStyle> {
  const byId = new Map(cards.map(c => [c.id, c]));
  const sides = new Map(sideLayoutGroups(cards, edges).flatMap(g => g.nodes.map(n => [n.id, g.side] as const)));
  const counts = new Map<string, number>(), result = new Map<string, ArcStyle>();
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    const a = byId.get(edge.upstream_id), b = byId.get(edge.downstream_id);
    if (!a || !b) continue;
    const key = JSON.stringify([a.id, b.id].sort()), parallelIndex = counts.get(key) || 0;
    counts.set(key, parallelIndex + 1);
    let sourceSide: RouteSide = 'normal', targetSide: RouteSide = 'normal';
    const backward = b.position_y <= a.position_y, boundary = sides.get(a.id) !== sides.get(b.id);
    if (backward || boundary) {
      const dx = b.position_x + (b.width ?? 300) / 2 - a.position_x - (a.width ?? 300) / 2;
      if (Math.abs(dx) < 300) sourceSide = targetSide = sides.get(a.id) === 'left' ? 'left' : 'right';
      else { sourceSide = dx > 0 ? 'right' : 'left'; targetSide = dx > 0 ? 'left' : 'right'; }
    }
    result.set(edge.id, { sourceSide, targetSide, parallelIndex, dashed: backward && !sides.has(a.id) && !sides.has(b.id) });
  }
  return result;
}

export function bezierControls(link: RouteLink): [Point, Point, Point, Point] {
  const { source: a, target: b, sourceSide, targetSide, parallelIndex } = link;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const reach = Math.max(64, Math.min(320, Math.hypot(dx, dy) * .42)) + parallelIndex * 24;
  const verticalReach = Math.abs(dx) >= 180 ? reach : Math.min(reach, Math.max(24, Math.abs(dy) * .4));
  const control = (p: Point, side: RouteSide, output: boolean): Point => side === 'normal'
    ? [p[0], p[1] + (output ? verticalReach : -verticalReach)]
    : [p[0] + (side === 'left' ? -reach : reach), p[1]];
  const c = control(a, sourceSide, true), d = control(b, targetSide, false);
  // Aligned endpoints still bow visibly, rather than disguising a straight line as C.
  if (sourceSide === 'normal' && targetSide === 'normal' && Math.abs(dx) < 180) {
    const bow = Math.max(64, Math.min(320, Math.abs(dy) * .2)) + parallelIndex * 24; c[0] += bow; d[0] += bow;
  } else if (sourceSide !== 'normal' && targetSide !== 'normal' && sourceSide !== targetSide && Math.abs(dy) < 180) {
    const bow = Math.max(64, Math.min(320, Math.abs(dx) * .2)) + parallelIndex * 24; c[1] -= bow; d[1] -= bow;
  }
  return [a, c, d, b];
}
export function bezierRoute(link: RouteLink): string {
  const [a, c, d, b] = bezierControls(link);
  return `M ${a[0]} ${a[1]} C ${c[0]} ${c[1]} ${d[0]} ${d[1]} ${b[0]} ${b[1]}`;
}
