import type { GraphNode, GraphEdge } from './contracts';
import { cardKind } from './cardModel';
export type LayoutNode = Pick<GraphNode, 'id' | 'name'> & { type: string; is_system_state?: number; kind?: string; workflow_lane?: string; reference_number?: number | null };
type LayoutEdge = Pick<GraphEdge, 'upstream_id' | 'downstream_id'>;
export type NodePosition = { id: string; position_x: number; position_y: number };
export type LayoutGroup = { key: string; title: string; titleEn: string; nodes: LayoutNode[]; flow: boolean };
const textOrder = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const nodeOrder = (a: LayoutNode, b: LayoutNode) => textOrder(a.workflow_lane || '', b.workflow_lane || '') || (a.reference_number ?? Infinity) - (b.reference_number ?? Infinity) || textOrder(a.name, b.name) || textOrder(a.id, b.id);
const isSource = (n: LayoutNode) => cardKind(n) === 'source';
const isFinal = (n: LayoutNode) => n.name === 'supabase_asset_scores';

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

export function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[]): NodePosition[] {
  const groups = layoutGroups(nodes, edges), active = groups.find(g => g.flow)?.nodes || [];
  const links = forwardLayoutEdges(active, edges);
  const incoming = new Map(active.map(n => [n.id, [] as string[]]));
  const outgoing = new Map(active.map(n => [n.id, [] as string[]]));
  for (const e of links) { incoming.get(e.downstream_id)!.push(e.upstream_id); outgoing.get(e.upstream_id)!.push(e.downstream_id); }
  const byId = new Map(active.map(n => [n.id, n]));
  const remaining = new Map(active.map(n => [n.id, incoming.get(n.id)!.length]));
  const depth = new Map(active.map(n => [n.id, isSource(n) ? 0 : 1]));
  const queue = active.filter(n => !remaining.get(n.id)).sort(nodeOrder);
  while (queue.length) {
    const n = queue.shift()!;
    for (const id of outgoing.get(n.id)!) {
      depth.set(id, Math.max(depth.get(id)!, depth.get(n.id)! + 1));
      remaining.set(id, remaining.get(id)! - 1);
      if (!remaining.get(id)) queue.push(byId.get(id)!);
    }
    queue.sort(nodeOrder);
  }
  // Keep Supabase at the far right; other endpoints retain their own depth. No new card
  // is invented for a frontend that has no saved node/binding.
  const last = Math.max(0, ...depth.values());
  for (const n of active) if (isFinal(n)) depth.set(n.id, last);
  const columns: LayoutNode[][] = Array.from({ length: last + 1 }, () => []);
  for (const n of active) columns[depth.get(n.id)!]!.push(n);
  // Reserve the top row for the longest real path ending at Supabase.
  const sourced = new Map(active.map(n => [n.id, isSource(n)]));
  for (const n of [...active].sort((a, b) => depth.get(a.id)! - depth.get(b.id)!)) {
    if (incoming.get(n.id)!.some(id => sourced.get(id))) sourced.set(n.id, true);
  }
  const spine = new Set<string>();
  let cursor = active.find(isFinal)?.id;
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
  const positions: NodePosition[] = active.map(n => ({ id: n.id, position_x: depth.get(n.id)! * 432, position_y: 56 + rows.get(n.id)! * 224 }));
  // Leave a separate band for feedback routes before the unused source library.
  let top = Math.max(56, ...positions.map(p => p.position_y + 160)) + 240;
  for (const g of groups.filter(g => !g.flow)) {
    const count = Math.min(4, Math.ceil(Math.sqrt(g.nodes.length)));
    g.nodes.forEach((n, i) => positions.push({ id: n.id, position_x: (i % count) * 432, position_y: top + Math.floor(i / count) * 224 }));
    top += Math.ceil(g.nodes.length / count) * 224 + 80;
  }
  return positions.sort((a, b) => textOrder(a.id, b.id));
}

// Render backward or same-column links below the affected cards. Coordinates
// are read on every graph refresh, so this also works after manual arrangement.
export function feedbackRoutes(nodes: (LayoutNode & { position_x: number; position_y: number })[], edges: (LayoutEdge & { id: string })[]): Map<string, number> {
  const byId = new Map(nodes.map(n => [n.id, n]));
  const result = new Map<string, number>();
  const connected = new Set(edges.flatMap(link => [link.upstream_id, link.downstream_id]));
  for (const e of [...edges].sort((a, b) => textOrder(a.id, b.id))) {
    const a = byId.get(e.upstream_id), b = byId.get(e.downstream_id);
    if (!a || !b || a.position_x < b.position_x) continue;
    const between = nodes.filter(n => n.position_x >= Math.min(a.position_x, b.position_x) && n.position_x <= Math.max(a.position_x, b.position_x));
    // Unconnected library cards are excluded from the routing envelope.
    result.set(e.id, Math.max(...between.filter(n => connected.has(n.id)).map(n => n.position_y + 160)) + 40 + result.size * 12);
  }
  return result;
}
