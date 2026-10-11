// Presentation-only orthogonal routing. Coordinates share graph-card.css geometry.
export type Point = [number, number];
export type RouteSide = 'left' | 'right' | 'normal';
export type RouteCard = { id: string; position_x: number; position_y: number; width?: number; height?: number };
export type RouteLink = { id: string; source: Point; target: Point; sourceSide: RouteSide; targetSide: RouteSide };
const clearance = 24;

export function portPoint(card: RouteCard, side: RouteSide, output: boolean, index: number, count: number): Point {
  const w = card.width ?? 300, h = card.height ?? 160, fraction = (index + 1) / (count + 1);
  return side === 'normal' ? [card.position_x + fraction * w, card.position_y + (output ? h : 0)]
    : [card.position_x + (side === 'left' ? 0 : w), card.position_y + h * (output ? .15 + fraction * .4 : .65 + fraction * .25)];
}
function escape(p: Point, side: RouteSide, output: boolean): Point {
  return side === 'normal' ? [p[0], p[1] + (output ? 36 : -36)] : [p[0] + (side === 'left' ? -36 : 36), p[1]];
}
class Heap {
  values: [number, number][] = [];
  push(item: [number, number]) {
    let i = this.values.length; this.values.push(item);
    while (i > 0) { const parent = (i - 1) >> 1; if (this.values[parent]![0] <= item[0]) break; this.values[i] = this.values[parent]!; i = parent; }
    this.values[i] = item;
  }
  pop() {
    const first = this.values[0]!, last = this.values.pop()!;
    if (this.values.length) {
      let i = 0;
      while (i * 2 + 1 < this.values.length) {
        let child = i * 2 + 1;
        if (child + 1 < this.values.length && this.values[child + 1]![0] < this.values[child]![0]) child++;
        if (last[0] <= this.values[child]![0]) break;
        this.values[i] = this.values[child]!; i = child;
      }
      this.values[i] = last;
    }
    return first;
  }
}

// A compressed visibility grid supplies local lanes around every card. A* charges
// length, turns and occupied segments, allowing reuse only when detours cost more.
// All edges share one grid; stable edge order makes refresh/reorder deterministic.
export function routeDetours(cards: RouteCard[], links: RouteLink[]): Map<string, Point[]> {
  const result = new Map<string, Point[]>();
  if (!links.length) return result;
  const rects = cards.map(c => ({ l: c.position_x - clearance, r: c.position_x + (c.width ?? 300) + clearance,
    t: c.position_y - clearance, b: c.position_y + (c.height ?? 160) + clearance }));
  const xs = new Set<number>(), ys = new Set<number>();
  for (const r of rects) for (const offset of [0, 16, 32]) {
    xs.add(r.l - offset); xs.add(r.r + offset); ys.add(r.t - offset); ys.add(r.b + offset);
  }
  const ends = new Map(links.map(e => [e.id, [escape(e.source, e.sourceSide, true), escape(e.target, e.targetSide, false)] as const]));
  for (const [a, b] of ends.values()) { xs.add(a[0]); xs.add(b[0]); ys.add(a[1]); ys.add(b[1]); }
  const xx = [...xs].sort((a, b) => a - b), yy = [...ys].sort((a, b) => a - b), nx = xx.length, ny = yy.length, size = nx * ny;
  const xi = new Map(xx.map((x, i) => [x, i])), yi = new Map(yy.map((y, i) => [y, i]));
  const blocked = new Uint8Array(size), rightBlocked = new Uint8Array(size), downBlocked = new Uint8Array(size);
  // Include both endpoints and the entire segment, not just grid vertices: narrow
  // cards or manually moved obstacles must not disappear between coordinates.
  for (const r of rects) {
    const xRange = xx.map((x, i) => i).filter(i => xx[i]! > r.l && xx[i]! < r.r);
    const yRange = yy.map((y, i) => i).filter(i => yy[i]! > r.t && yy[i]! < r.b);
    for (const y of yRange) for (const x of xRange) blocked[y * nx + x] = 1;
    for (const y of yRange) for (let x = 0; x < nx - 1; x++) if (xx[x]! < r.r && xx[x + 1]! > r.l) rightBlocked[y * nx + x] = 1;
    for (const x of xRange) for (let y = 0; y < ny - 1; y++) if (yy[y]! < r.b && yy[y + 1]! > r.t) downBlocked[y * nx + x] = 1;
  }
  const rightUse = new Uint16Array(size), downUse = new Uint16Array(size);
  for (const link of [...links].sort((a, b) => a.id.localeCompare(b.id))) {
    const [a, b] = ends.get(link.id)!;
    const start = yi.get(a[1])! * nx + xi.get(a[0])!, finish = yi.get(b[1])! * nx + xi.get(b[0])!;
    if (blocked[start] || blocked[finish]) continue; // Overlapping cards have no safe escape; do not invent a path.
    const dist = new Float64Array(size * 2).fill(Infinity), previous = new Int32Array(size * 2).fill(-1), heap = new Heap();
    const heuristic = (p: number) => Math.abs(xx[p % nx]! - b[0]) + Math.abs(yy[Math.floor(p / nx)]! - b[1]);
    const sourceAxis = link.sourceSide === 'normal' ? 1 : 0;
    dist[start * 2 + sourceAxis] = 0; heap.push([heuristic(start), start * 2 + sourceAxis]);
    let goal = -1;
    while (heap.values.length) {
      const [priority, state] = heap.pop(), p = state >> 1, axis = state % 2;
      if (priority > dist[state]! + heuristic(p)) continue;
      if (p === finish) { goal = state; break; }
      const x = p % nx, y = Math.floor(p / nx);
      const steps: [number, number, number, number][] = [];
      if (x + 1 < nx && !rightBlocked[p]) steps.push([p + 1, 0, xx[x + 1]! - xx[x]!, rightUse[p]!]);
      if (x > 0 && !rightBlocked[p - 1]) steps.push([p - 1, 0, xx[x]! - xx[x - 1]!, rightUse[p - 1]!]);
      if (y + 1 < ny && !downBlocked[p]) steps.push([p + nx, 1, yy[y + 1]! - yy[y]!, downUse[p]!]);
      if (y > 0 && !downBlocked[p - nx]) steps.push([p - nx, 1, yy[y]! - yy[y - 1]!, downUse[p - nx]!]);
      for (const [q, nextAxis, length, occupied] of steps) {
        if (blocked[q]) continue;
        const next = q * 2 + nextAxis, cost = dist[state]! + length * (1 + occupied * 3) + (axis === nextAxis ? 0 : 24);
        if (cost >= dist[next]!) continue;
        dist[next] = cost; previous[next] = state; heap.push([cost + heuristic(q), next]);
      }
    }
    if (goal < 0) continue;
    const path: number[] = [];
    for (let state = goal; state >= 0; state = previous[state]!) path.push(state >> 1);
    path.reverse();
    for (let i = 1; i < path.length; i++) {
      const p = path[i - 1]!, q = path[i]!, key = Math.min(p, q);
      if (Math.abs(p - q) === 1) rightUse[key] = rightUse[key]! + 1; else downUse[key] = downUse[key]! + 1;
    }
    const points: Point[] = [link.source, ...path.map(p => [xx[p % nx]!, yy[Math.floor(p / nx)]!] as Point), link.target];
    const simplified: Point[] = [];
    for (const point of points) {
      if (simplified.at(-1)?.[0] === point[0] && simplified.at(-1)?.[1] === point[1]) continue;
      while (simplified.length > 1) {
        const p = simplified.at(-2)!, q = simplified.at(-1)!;
        if ((p[0] === q[0] && q[0] === point[0]) || (p[1] === q[1] && q[1] === point[1])) simplified.pop(); else break;
      }
      simplified.push(point);
    }
    result.set(link.id, simplified);
  }
  return result;
}

export function curvedRoute(points: Point[]): string {
  if (!points.length) return '';
  let path = `M ${points[0]![0]} ${points[0]![1]}`;
  let current = points[0]!;
  const connect = (end: Point) => {
    path += ` C ${current[0]} ${current[1]} ${end[0]} ${end[1]} ${end[0]} ${end[1]}`;
    current = end;
  };
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]!, [px, py] = points[i - 1]!, [nx, ny] = points[i + 1]!;
    // A wide quadratic-equivalent cubic cuts the corner by at most radius/4,
    // within the 24px obstacle margin even at the maximum 80px bend radius.
    const radius = Math.min(80, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const entry: Point = [x - Math.sign(x - px) * radius, y - Math.sign(y - py) * radius];
    const exit: Point = [x + Math.sign(nx - x) * radius, y + Math.sign(ny - y) * radius];
    connect(entry);
    path += ` C ${entry[0] + (x - entry[0]) * 2 / 3} ${entry[1] + (y - entry[1]) * 2 / 3} ${exit[0] + (x - exit[0]) * 2 / 3} ${exit[1] + (y - exit[1]) * 2 / 3} ${exit[0]} ${exit[1]}`;
    current = exit;
  }
  connect(points.at(-1)!);
  return path;
}

export function bezierControls(link: RouteLink): [Point, Point, Point, Point] {
  const { source: a, target: b } = link;
  const reach = Math.max(64, Math.min(320, Math.hypot(b[0] - a[0], b[1] - a[1]) * .5));
  const control = (p: Point, side: RouteSide, output: boolean): Point => side === 'normal'
    ? [p[0], p[1] + (output ? reach : -reach)] : [p[0] + (side === 'left' ? -reach : reach), p[1]];
  return [a, control(a, link.sourceSide, true), control(b, link.targetSide, false), b];
}
export function bezierRoute(link: RouteLink): string {
  const [a, c, d, b] = bezierControls(link);
  return `M ${a[0]} ${a[1]} C ${c[0]} ${c[1]} ${d[0]} ${d[1]} ${b[0]} ${b[1]}`;
}

// Use the ordinary single curve whenever it is clear. Recursive convex-hull
// subdivision is conservative; uncertain near-touches use the obstacle route.
export function directCurveIsClear(cards: RouteCard[], link: RouteLink): boolean {
  const controls = bezierControls(link);
  const midpoint = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  function hits(points: [Point, Point, Point, Point], card: RouteCard, depth = 0): boolean {
    const l = card.position_x, t = card.position_y, r = l + (card.width ?? 300), b = t + (card.height ?? 160);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    if (Math.max(...xs) <= l || Math.min(...xs) >= r || Math.max(...ys) <= t || Math.min(...ys) >= b) return false;
    if (depth === 16) return true;
    const [a, c, d, end] = points, ac = midpoint(a, c), cd = midpoint(c, d), de = midpoint(d, end);
    const left = midpoint(ac, cd), right = midpoint(cd, de), mid = midpoint(left, right);
    return hits([a, ac, left, mid], card, depth + 1) || hits([mid, right, de, end], card, depth + 1);
  }
  return cards.every(card => !hits(controls, card));
}
