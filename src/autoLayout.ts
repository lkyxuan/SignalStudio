import type { GraphNode, GraphEdge } from './contracts';
import { cardKind } from './cardModel';
export type LayoutNode = Pick<GraphNode, 'id' | 'name'> & { type: string; is_system_state?: number; kind?: string; workflow_lane?: string; reference_number?: number | null };
type LayoutEdge = Pick<GraphEdge, 'upstream_id' | 'downstream_id'>;
export type NodePosition = { id: string; position_x: number; position_y: number };
export type LayoutGroup = { key: string; title: string; titleEn: string; nodes: LayoutNode[]; flow: boolean };
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const nodeOrder = (a: LayoutNode, b: LayoutNode) => textOrder(a.workflow_lane || '', b.workflow_lane || '') || (a.reference_number ?? Infinity) - (b.reference_number ?? Infinity) || textOrder(a.name, b.name) || textOrder(a.id, b.id);
const isSource = (n: LayoutNode) => cardKind(n) === 'source';
const isLeaderboard = (n: LayoutNode) => ['leaderboard_warming', 'leaderboard_hottest', 'leaderboard_emerging'].includes(n.name);
const isFinal = (n: LayoutNode) => n.name === 'supabase_asset_scores';
// Explicitly approved shared lookup; resource type or fan-out alone is not enough.
export const isSharedSupport = (n?: LayoutNode) => n?.name === 'asset_identifiers';

export function layoutGroups(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutGroup[] {
  const ids = new Set(nodes.map(n => n.id));
  const connected = new Set(edges.filter(e => ids.has(e.upstream_id) && ids.has(e.downstream_id)).flatMap(e => [e.upstream_id, e.downstream_id]));
  const groups: LayoutGroup[] = [];
  const active = nodes.filter(n => connected.has(n.id)).sort(nodeOrder);
  if (active.length) groups.push({ key: 'flow', title: '数据流 · 从来源到输出', titleEn: 'Data flow · sources to outputs', nodes: active, flow: true });
  const buckets = new Map<string, LayoutNode[]>();
  for (const n of nodes.filter(n => !connected.has(n.id)).sort(nodeOrder)) {
    const key = isSource(n) ? `source:${n.name.split('.')[0]}` : 'unused';
    buckets.set(key, [...(buckets.get(key) || []), n]);
  }
  for (const [key, members] of [...buckets].sort(([a], [b]) => textOrder(a, b))) groups.push({ key, title: key === 'unused' ? '未连接辅助卡' : `未连接来源 · ${key.slice(7)}`, titleEn: key === 'unused' ? 'Unconnected auxiliary cards' : `Unconnected sources · ${key.slice(7)}`, nodes: members, flow: false });
  return groups;
}

// Build a presentation DAG without altering the saved graph. Reads are considered
// before writes, so a table that is both read and written can remain an input.
// Only a write that actually closes a cycle is excluded from forward layering.
// This is a drawing decision, never a claim about execution or temporal semantics.
export function forwardLayoutEdges(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutEdge[] {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const outgoing = new Map(nodes.map(n => [n.id, new Set<string>()]));
  const reaches = (start: string, end: string) => {
    const pending = [start], seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === end) return true;
      if (seen.has(id)) continue;
      seen.add(id); pending.push(...outgoing.get(id)!);
    }
    return false;
  };
  const weight = (e: LayoutEdge) => ['table', 'state'].includes(cardKind(byId.get(e.downstream_id)!)) ? 1 : 0;
  const valid = edges.filter(e => byId.has(e.upstream_id) && byId.has(e.downstream_id));
  valid.sort((a, b) => weight(a) - weight(b) || nodeOrder(byId.get(a.upstream_id)!, byId.get(b.upstream_id)!) || nodeOrder(byId.get(a.downstream_id)!, byId.get(b.downstream_id)!));
  const result: LayoutEdge[] = [];
  for (const e of valid) {
    if (isSource(byId.get(e.downstream_id)!) || outgoing.get(e.upstream_id)!.has(e.downstream_id) || reaches(e.downstream_id, e.upstream_id)) continue;
    outgoing.get(e.upstream_id)!.add(e.downstream_id); result.push(e);
  }
  return result;
}

function contentBranchIds(nodes: LayoutNode[], edges: LayoutEdge[]): Set<string> {
  const sideIds = new Set<string>();
  const pending = nodes.filter(isLeaderboard).map(n => n.id);
  const activeById = new Map(nodes.map(n => [n.id, n]));
  while (pending.length) {
    const id = pending.pop()!;
    for (const e of edges) {
      const next = activeById.get(e.downstream_id);
      if (e.upstream_id !== id || !next || isSharedSupport(next) || isLeaderboard(next) || isFinal(next) || isSource(next) || sideIds.has(next.id)) continue;
      sideIds.add(next.id); pending.push(next.id);
    }
  }
  return sideIds;
}

export function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[]): NodePosition[] {
  const groups = layoutGroups(nodes, edges), active = groups.find(g => g.flow)?.nodes || [];
  // The approved output band anchors three real leaderboard cards. Their
  // downstream content-maintenance branch remains a single, connected side branch.
  const sideIds = contentBranchIds(active, edges);
  const main = active.filter(n => !sideIds.has(n.id) && !isSharedSupport(n));
  const links = forwardLayoutEdges(main, edges);
  const incoming = new Map(main.map(n => [n.id, [] as string[]]));
  const outgoing = new Map(main.map(n => [n.id, [] as string[]]));
  for (const e of links) { incoming.get(e.downstream_id)!.push(e.upstream_id); outgoing.get(e.upstream_id)!.push(e.downstream_id); }
  const byId = new Map(main.map(n => [n.id, n]));
  const remaining = new Map(main.map(n => [n.id, incoming.get(n.id)!.length]));
  const depth = new Map(main.map(n => [n.id, isSource(n) ? 0 : 1]));
  const queue = main.filter(n => !remaining.get(n.id)).sort(nodeOrder);
  while (queue.length) {
    const n = queue.shift()!;
    for (const id of outgoing.get(n.id)!) {
      depth.set(id, Math.max(depth.get(id)!, depth.get(n.id)! + 1));
      remaining.set(id, remaining.get(id)! - 1);
      if (!remaining.get(id)) queue.push(byId.get(id)!);
    }
    queue.sort(nodeOrder);
  }
  // Anchor actual endpoints and leaderboard outputs to the bottom band.
  // A visual output anchor does not assert that it has no downstream consumers.
  const last = Math.max(0, ...depth.values());
  const terminal = new Set(main.filter(n => !edges.some(e => e.upstream_id === n.id && byId.has(e.downstream_id)) && !isSource(n)).map(n => n.id));
  for (const n of main) if (isFinal(n) || isLeaderboard(n) || terminal.has(n.id)) depth.set(n.id, last);
  // Keep the final sync chain adjacent to its anchored output. Stop at a fork:
  // shared predecessors must continue to serve their real downstream branches.
  let endpoint = main.find(isFinal)?.id;
  while (endpoint && incoming.get(endpoint)!.length === 1) {
    const parent = incoming.get(endpoint)![0]!;
    if (outgoing.get(parent)!.length !== 1 || isSource(byId.get(parent)!)) break;
    depth.set(parent, depth.get(endpoint)! - 1); endpoint = parent;
  }
  const columns: LayoutNode[][] = Array.from({ length: last + 1 }, () => []);
  for (const n of main) columns[depth.get(n.id)!]!.push(n);
  // Reserve the left column for the longest real path ending at Supabase.
  const sourced = new Map(main.map(n => [n.id, isSource(n)]));
  for (const n of [...main].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)) {
    if (incoming.get(n.id)!.some(id => sourced.get(id))) sourced.set(n.id, true);
  }
  const spine = new Set<string>();
  let cursor = main.find(isFinal)?.id;
  while (cursor) {
    spine.add(cursor);
    cursor = [...incoming.get(cursor)!].sort((a, b) => Number(sourced.get(b)) - Number(sourced.get(a)) || depth.get(b)! - depth.get(a)! || nodeOrder(byId.get(a)!, byId.get(b)!))[0];
  }
  const rows = new Map<string, number>();
  const sweep = (reverse: boolean) => {
    const indices = columns.map((_, i) => i); if (reverse) indices.reverse();
    for (const i of indices) {
      const score = (n: LayoutNode) => {
        const neighbors = (reverse ? outgoing : incoming).get(n.id)!.filter(id => rows.has(id));
        return neighbors.length ? neighbors.reduce((sum, id) => sum + rows.get(id)!, 0) / neighbors.length : Infinity;
      };
      columns[i]!.sort((a, b) => Number(spine.has(b.id)) - Number(spine.has(a.id)) || Number(isFinal(b)) - Number(isFinal(a)) || score(a) - score(b) || nodeOrder(a, b));
      columns[i]!.forEach((n, row) => rows.set(n.id, row + (spine.size && !columns[i]!.some(n => spine.has(n.id)) ? 1 : 0)));
    }
  };
  sweep(false); sweep(true); sweep(false);
  // Keep the three boards contiguous, in warming/hottest/emerging order.
  const boardNames = ['leaderboard_warming', 'leaderboard_hottest', 'leaderboard_emerging'];
  columns[last]!.sort((a, b) => Number(isFinal(b)) - Number(isFinal(a)) || Number(isLeaderboard(a)) - Number(isLeaderboard(b)) || (isLeaderboard(a) && isLeaderboard(b) ? boardNames.indexOf(a.name) - boardNames.indexOf(b.name) : nodeOrder(a, b)));
  columns[last]!.forEach((n, index) => rows.set(n.id, index));
  const positions: NodePosition[] = main.map(n => ({ id: n.id, position_x: rows.get(n.id)! * 380, position_y: 96 + depth.get(n.id)! * 256 }));
  const mainRight = Math.max(300, ...positions.map(p => p.position_x + 300));
  const side = active.filter(n => sideIds.has(n.id));
  // Order the side branch with the same cycle-safe DAG and keep it above the footer.
  const sideLinks = forwardLayoutEdges(side, edges);
  const sideDepth = new Map(side.map(n => [n.id, 0]));
  for (let i = 0; i < side.length; i++) for (const e of sideLinks)
    sideDepth.set(e.downstream_id, Math.max(sideDepth.get(e.downstream_id)!, sideDepth.get(e.upstream_id)! + 1));
  const sideLevels = Math.max(0, ...sideDepth.values()) + 1;
  const sidePitch = 224;
  const sideTop = Math.max(96, 96 + last * 256 - sideLevels * sidePitch);
  const sideRows = new Map<number, number>();
  for (const n of side.sort((a, b) => sideDepth.get(a.id)! - sideDepth.get(b.id)! || nodeOrder(a, b))) {
    const level = sideDepth.get(n.id)!, slot = sideRows.get(level) || 0;
    positions.push({ id: n.id, position_x: mainRight + 180 + slot * 380, position_y: sideTop + level * sidePitch });
    sideRows.set(level, slot + 1);
  }
  // Keep the shared lookup beside its users, outside the processing layers.
  const positioned = new Map(positions.map(p => [p.id, p]));
  for (const n of active.filter(isSharedSupport)) {
    const users = new Set(edges.flatMap(e => e.upstream_id === n.id ? [e.downstream_id] : e.downstream_id === n.id ? [e.upstream_id] : []));
    const ys = [...users].flatMap(id => positioned.has(id) ? [positioned.get(id)!.position_y] : []).sort((a, b) => a - b);
    const middle = ys.length ? ys[Math.floor(ys.length / 2)]! : 96;
    positions.push({ id: n.id, position_x: -640, position_y: middle });
  }
  // The unused library stays beside the tree and outside its initial fit viewport.
  const libraryLeft = Math.max(300, ...positions.map(p => p.position_x + 300)) + 280;
  let top = 96;
  for (const g of groups.filter(g => !g.flow)) {
    const count = Math.min(2, Math.ceil(Math.sqrt(g.nodes.length)));
    g.nodes.forEach((n, i) => positions.push({ id: n.id, position_x: libraryLeft + (i % count) * 380, position_y: top + Math.floor(i / count) * 224 }));
    top += Math.ceil(g.nodes.length / count) * 224 + 80;
  }
  return positions.sort((a, b) => textOrder(a.id, b.id));
}

// Backward/same-row links detour to the right of the connected graph.
// The unused library does not contribute to the routing envelope.
export function feedbackRoutes(nodes: (LayoutNode & { position_x: number; position_y: number })[], edges: (LayoutEdge & { id: string })[]): Map<string, number> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const result = new Map<string, number>();
  const connected = new Set(edges.flatMap(link => [link.upstream_id, link.downstream_id]));
  const right = Math.max(0, ...nodes.filter(n => connected.has(n.id)).map(n => n.position_x + 300));
  for (const e of [...edges].sort((a, b) => textOrder(a.id, b.id))) {
    const a = byId.get(e.upstream_id), b = byId.get(e.downstream_id);
    if (!a || !b || isSharedSupport(a) || isSharedSupport(b) || a.position_y < b.position_y) continue;
    result.set(e.id, right + 40 + result.size * 16);
  }
  return result;
}

// Shared reads/writes use their own left-side corridor, independent of DAG feedback.
export function supportRoutes(nodes: (LayoutNode & { position_x: number; position_y: number })[], edges: (LayoutEdge & { id: string })[]) {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const result = new Map<string, { routeX: number; sourceShared: boolean }>();
  const connected = new Set(edges.flatMap(e => [e.upstream_id, e.downstream_id]));
  const left = Math.min(0, ...nodes.filter(n => connected.has(n.id) && !isSharedSupport(n)).map(n => n.position_x));
  for (const e of [...edges].sort((a, b) => textOrder(a.id, b.id))) {
    const a = byId.get(e.upstream_id), b = byId.get(e.downstream_id);
    if (!a || !b || (!isSharedSupport(a) && !isSharedSupport(b))) continue;
    result.set(e.id, { routeX: left - 180 - result.size * 16, sourceShared: isSharedSupport(a) });
  }
  return result;
}

// Traverse each direction independently: walking back to a fork must not pull
// every sibling branch into the selected route. Cycles are visited once.
export function traceRoute(nodes: LayoutNode[], edges: (LayoutEdge & { id: string })[], focus: string) {
  const valid = new Set(nodes.map(n => n.id));
  const nodeIds = new Set<string>(), edgeIds = new Set<string>();
  if (!valid.has(focus)) return { nodeIds, edgeIds };
  nodeIds.add(focus);
  for (const reverse of [true, false]) {
    const visited = new Set<string>(), pending = [focus];
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of edges) {
        if (!valid.has(edge.upstream_id) || !valid.has(edge.downstream_id)) continue;
        if ((reverse ? edge.downstream_id : edge.upstream_id) !== id) continue;
        const next = reverse ? edge.upstream_id : edge.downstream_id;
        nodeIds.add(next); edgeIds.add(edge.id); pending.push(next);
      }
    }
  }
  return { nodeIds, edgeIds };
}

export function layoutStages(nodes: (LayoutNode & { position_x: number; position_y: number })[], edges: LayoutEdge[]) {
  const active = layoutGroups(nodes, edges).find(g => g.flow)?.nodes || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  const sideIds = contentBranchIds(active, edges);
  const support = active.filter(isSharedSupport);
  const main = active.filter(n => !sideIds.has(n.id) && !isSharedSupport(n));
  const ys = [...new Set(main.map(n => byId.get(n.id)!.position_y))].sort((a, b) => a - b);
  const left = Math.min(...[...main, ...support].map(n => byId.get(n.id)!.position_x)) - 320;
  const stages = ys.map((y, i) => ({ id: `stage:${i}`, x: left, y,
    title: i === 0 ? '爬虫入口' : i === ys.length - 1 ? '榜单与输出' : `第 ${i} 步`,
    titleEn: i === 0 ? 'Crawler inputs' : i === ys.length - 1 ? 'Leaderboards & outputs' : `Step ${i}`,
    count: main.filter(n => byId.get(n.id)!.position_y === y).length }));
  const side = active.filter(n => sideIds.has(n.id));
  if (side.length) stages.push({ id: 'stage:content', x: Math.min(...side.map(n => byId.get(n.id)!.position_x)), y: Math.min(...side.map(n => byId.get(n.id)!.position_y)) - 48, title: '榜单后续 · 内容维护', titleEn: 'Content maintenance', count: side.length });
  if (support.length) stages.push({ id: 'stage:support', x: Math.min(...support.map(n => byId.get(n.id)!.position_x)), y: Math.min(...support.map(n => byId.get(n.id)!.position_y)) - 48, title: '公共支撑 · 跨步骤查询', titleEn: 'Shared support · cross-step lookup', count: support.length });
  return stages;
}
