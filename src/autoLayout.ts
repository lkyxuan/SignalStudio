import type { GraphNode, GraphEdge } from './contracts';
import { cardKind } from './cardModel';
export type LayoutNode = Pick<GraphNode, 'id' | 'name'> & { type: string; is_system_state?: number; kind?: string; workflow_lane?: string; reference_number?: number | null };
type LayoutEdge = Pick<GraphEdge, 'upstream_id' | 'downstream_id'>;
export type NodePosition = { id: string; position_x: number; position_y: number };

const NODE_WIDTH = 300;
const NODE_HEIGHT = 160;
const COLUMN_GAP = 132;
const ROW_GAP = 56;
const BLOCK_COLUMN_GAP = 32;
const BLOCK_ROW_GAP = 32;
const BLOCK_GAP = 80;
const MAX_ROW_WIDTH = 5400;
const TYPE_ORDER = ['Source', 'Raw Field', 'Evidence Check', 'asset_identifiers', 'assets',
  'Asset Resolution', 'Relationship Discovery', 'Review Decision', 'Derived Field',
  'Metric', 'Score', 'Redpanda Topic', 'Redis Window', 'asset_monitoring_rules', 'Rule Evaluation', 'asset_score_events', 'asset_scores_current', 'supabase_asset_scores', 'Flow Result', 'Signal Event',
  'asset_relationships', 'Relationship Lookup', 'Ranking', 'Ranking Table',
  'Product Module'];

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareNodes = (left: LayoutNode, right: LayoutNode) => {
  const typeDifference = TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type);
  return typeDifference || compareText(left.name, right.name) || compareText(left.id, right.id);
};

function layoutConnected(nodes: LayoutNode[], edges: LayoutEdge[]): NodePosition[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const incoming = new Map<string, string[]>(nodes.map(node => [node.id, []]));
  const outgoing = new Map<string, string[]>(nodes.map(node => [node.id, []]));
  for (const edge of edges) {
    if (!byId.has(edge.upstream_id) || !byId.has(edge.downstream_id)) continue;
    // A write back to a table affects later runs, not this run's dependency order.
    if (byId.get(edge.downstream_id)!.is_system_state) continue;
    incoming.get(edge.downstream_id)!.push(edge.upstream_id);
    outgoing.get(edge.upstream_id)!.push(edge.downstream_id);
  }

  const ordered = [...nodes].sort(compareNodes);
  const remaining = new Map(nodes.map(node => [node.id, incoming.get(node.id)!.length]));
  const depth = new Map(nodes.map(node => [node.id, 0]));
  const queue = ordered.filter(node => remaining.get(node.id) === 0);
  const visited = new Set<string>();
  while (queue.length) {
    const node = queue.shift()!;
    visited.add(node.id);
    for (const nextId of outgoing.get(node.id)!) {
      depth.set(nextId, Math.max(depth.get(nextId)!, depth.get(node.id)! + 1));
      remaining.set(nextId, remaining.get(nextId)! - 1);
      if (remaining.get(nextId) === 0) queue.push(byId.get(nextId)!);
    }
    queue.sort(compareNodes);
  }
  // Existing graphs are acyclic. Keep imported or malformed cyclic graphs usable too.
  for (const node of ordered) if (!visited.has(node.id)) depth.set(node.id, 0);

  const columns: LayoutNode[][] = [];
  for (const node of ordered) (columns[depth.get(node.id)!] ||= []).push(node);
  const sortByNeighbors = (columnIndex: number, neighborIndex: number, links: Map<string, string[]>) => {
    const neighborOrder = new Map((columns[neighborIndex] || []).map((node, index) => [node.id, index]));
    const score = (node: LayoutNode) => {
      const positions = links.get(node.id)!.map(id => neighborOrder.get(id)).filter(index => index !== undefined);
      return positions.length ? positions.reduce((sum, index) => sum + index, 0) / positions.length : Infinity;
    };
    columns[columnIndex]!.sort((a, b) => score(a) - score(b) || compareNodes(a, b));
  };
  for (let column = 1; column < columns.length; column++) sortByNeighbors(column, column - 1, incoming);
  for (let column = columns.length - 2; column >= 0; column--) sortByNeighbors(column, column + 1, outgoing);
  for (let column = 1; column < columns.length; column++) sortByNeighbors(column, column - 1, incoming);

  // Bound tall layers so a table-heavy flow does not become a long vertical strip.
  let left = 0;
  return columns.flatMap(column => {
    const rows = Math.min(4, column.length);
    const positions = column.map((node, index) => ({
      id: node.id,
      position_x: left + Math.floor(index / rows) * (NODE_WIDTH + COLUMN_GAP),
      position_y: (index % rows) * (NODE_HEIGHT + ROW_GAP),
    }));
    left += Math.ceil(column.length / rows) * (NODE_WIDTH + COLUMN_GAP);
    return positions;
  });
}

export type LayoutGroup = { key: string; title: string; titleEn: string; nodes: LayoutNode[]; flow: boolean };

// Derive presentation groups from saved ownership and connectivity, never names.
export function layoutGroups(nodes: LayoutNode[], edges: LayoutEdge[]): LayoutGroup[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  const neighbors = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!byId.has(edge.upstream_id) || !byId.has(edge.downstream_id) || edge.upstream_id === edge.downstream_id) continue;
    neighbors.get(edge.upstream_id)!.add(edge.downstream_id);
    neighbors.get(edge.downstream_id)!.add(edge.upstream_id);
  }
  const groups: LayoutGroup[] = [];
  const buckets = new Map<string, LayoutNode[]>();
  const remaining = new Map<string, LayoutNode>();
  const bucket = (key: string, node: LayoutNode) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(node);
  };
  for (const node of [...nodes].sort(compareNodes)) {
    const kind = cardKind(node);
    if (!neighbors.get(node.id)!.size) {
      bucket(kind === 'source' ? `source:${node.name.split('.')[0]}` : `unused:${kind}`, node);
    } else if (node.workflow_lane === 'shared' && ['table', 'channel', 'state'].includes(kind)) {
      bucket('shared-resources', node);
    } else remaining.set(node.id, node);
  }
  // Explicit workflow ownership is the boundary. Missing ownership stays unassigned.
  const visited = new Set<string>();
  for (const root of remaining.values()) {
    if (visited.has(root.id)) continue;
    const lane = root.workflow_lane || 'unassigned';
    const members: LayoutNode[] = [];
    const queue = [root.id];
    const explored = new Set([root.id]);
    visited.add(root.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (remaining.has(id)) members.push(remaining.get(id)!);
      for (const next of [...neighbors.get(id)!].sort()) {
        const node = byId.get(next);
        if (!node || explored.has(next)) continue;
        const bridge = node.workflow_lane === 'shared' && ['table', 'channel', 'state'].includes(cardKind(node));
        if (!bridge && (visited.has(next) || (node.workflow_lane || 'unassigned') !== lane)) continue;
        explored.add(next);
        if (remaining.has(next)) visited.add(next);
        queue.push(next);
      }
    }
    members.sort(compareNodes);
    const reference = members.map(node => node.reference_number).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b)[0];
    const suffix = reference ? ` · #${reference}` : '';
    const titles: Record<string, [string, string]> = {
      signal: ['信号流程', 'Signal flow'], knowledge: ['资产知识流程', 'Asset knowledge flow'],
      shared: ['共用流程', 'Shared flow'], unassigned: ['待归属流程', 'Unassigned flow'],
    };
    const [title, titleEn] = titles[lane] || titles.unassigned!;
    groups.push({ key: `flow:${lane}:${root.id}`, title: title + suffix, titleEn: titleEn + suffix, nodes: members, flow: true });
  }
  const order = (group: LayoutGroup) => group.key.startsWith('flow:knowledge:') ? 0 : group.key.startsWith('flow:signal:') ? 1 : group.key.startsWith('flow:shared:') ? 2 : 3;
  groups.sort((a, b) => order(a) - order(b) || compareText(a.key, b.key));
  for (const [key, members] of [...buckets].sort(([a], [b]) => compareText(a, b))) {
    const kindNames: Record<string, [string, string]> = { table: ['数据表', 'Tables'], process: ['处理', 'Processes'], decision: ['判断', 'Decisions'], channel: ['通道', 'Channels'], state: ['缓存／窗口', 'State'] };
    const [title, titleEn] = key === 'shared-resources' ? ['共用资源', 'Shared resources']
      : key.startsWith('source:') ? [`来源库 · ${key.slice(7)}`, `Source library · ${key.slice(7)}`]
      : [`未连接 · ${(kindNames[key.slice(7)] || ['待归属', 'Unassigned'])[0]}`, `Unconnected · ${(kindNames[key.slice(7)] || ['待归属', 'Unassigned'])[1]}`];
    groups.push({ key, title: title!, titleEn: titleEn!, nodes: members, flow: false });
  }
  return groups;
}

function pack(nodes: LayoutNode[]): NodePosition[] {
  const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(nodes.length))));
  return [...nodes].sort(compareNodes).map((node, index) => ({
    id: node.id, position_x: (index % columns) * (NODE_WIDTH + BLOCK_COLUMN_GAP),
    position_y: Math.floor(index / columns) * (NODE_HEIGHT + BLOCK_ROW_GAP),
  }));
}

// Resources stay visible once in their own area. Contract paths through them
// for ordering only; never add these synthetic dependencies to the saved graph.
function groupEdges(group: LayoutGroup, nodes: LayoutNode[], edges: LayoutEdge[]): LayoutEdge[] {
  const members = new Set(group.nodes.map(node => node.id));
  const byId = new Map(nodes.map(node => [node.id, node]));
  const outgoing = new Map(nodes.map(node => [node.id, new Set<string>()]));
  for (const edge of edges) {
    if (!byId.has(edge.upstream_id) || !byId.has(edge.downstream_id) || byId.get(edge.downstream_id)!.is_system_state) continue;
    outgoing.get(edge.upstream_id)!.add(edge.downstream_id);
  }
  const result: LayoutEdge[] = [];
  for (const source of group.nodes) {
    const visited = new Set([source.id]);
    const queue = [...outgoing.get(source.id)!].sort();
    while (queue.length) {
      const target = queue.shift()!;
      if (visited.has(target)) continue;
      visited.add(target);
      if (members.has(target)) result.push({ upstream_id: source.id, downstream_id: target });
      else {
        const node = byId.get(target)!;
        if (node.workflow_lane === 'shared' && ['table', 'channel', 'state'].includes(cardKind(node))) queue.push(...[...outgoing.get(target)!].sort());
      }
    }
  }
  return result;
}

// Refine ordering against every visible connection, including cross-region links.
// Swaps stay inside a region and dependency column, so geometry and order survive.
function reduceCrossings(positions: NodePosition[], groups: LayoutGroup[], edges: LayoutEdge[]) {
  const byId = new Map(positions.map(position => [position.id, position]));
  const links = edges.filter(edge => edge.upstream_id !== edge.downstream_id && byId.has(edge.upstream_id) && byId.has(edge.downstream_id));
  // Bound refinement work for larger imported graphs; base layout is always usable.
  if (links.length > 250 || positions.length > 250) return positions;
  const pairs: [LayoutEdge, LayoutEdge][] = [];
  for (let i = 0; i < links.length; i++) for (let j = i + 1; j < links.length; j++) {
    const a = links[i]!, b = links[j]!;
    if (new Set([a.upstream_id, a.downstream_id, b.upstream_id, b.downstream_id]).size === 4) pairs.push([a, b]);
  }
  const orient = (a: NodePosition, b: NodePosition, c: NodePosition) =>
    (b.position_x - a.position_x) * (c.position_y - a.position_y) - (b.position_y - a.position_y) * (c.position_x - a.position_x);
  const score = () => {
    let crossings = 0;
    for (const [a, b] of pairs) {
      const u = byId.get(a.upstream_id)!, v = byId.get(a.downstream_id)!;
      const w = byId.get(b.upstream_id)!, z = byId.get(b.downstream_id)!;
      if (orient(u, v, w) * orient(u, v, z) < 0 && orient(w, z, u) * orient(w, z, v) < 0) crossings++;
    }
    const length = links.reduce((sum, edge) => {
      const a = byId.get(edge.upstream_id)!, b = byId.get(edge.downstream_id)!;
      return sum + Math.hypot(a.position_x - b.position_x, a.position_y - b.position_y);
    }, 0);
    return [crossings, length];
  };
  let best = score();
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const group of groups) {
      const members = group.nodes.map(node => byId.get(node.id)!);
      for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!, b = members[j]!;
        if (group.flow && a.position_x !== b.position_x) continue;
        const swap = () => {
          [a.position_x, b.position_x] = [b.position_x, a.position_x];
          [a.position_y, b.position_y] = [b.position_y, a.position_y];
        };
        swap();
        const candidate = score();
        if (candidate[0]! < best[0]! || (candidate[0] === best[0] && candidate[1]! < best[1]! - 0.01)) {
          best = candidate; improved = true;
        } else swap();
      }
    }
    if (!improved) break;
  }
  return positions;
}

export function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[]): NodePosition[] {
  const positions: NodePosition[] = [];
  let shelfX = 0, shelfTop = 56, shelfHeight = 0;
  let wasFlow = true;
  const groups = layoutGroups(nodes, edges);
  // Put the common hub beside knowledge and shared processing, before signal outputs.
  const rank = (g: LayoutGroup) => g.key.startsWith('flow:knowledge') ? 0 : g.key === 'shared-resources' ? 1 : g.key.startsWith('flow:shared') ? 2 : g.flow ? 3 : 4;
  groups.sort((a,b) => rank(a)-rank(b));
  for (const group of groups) {
    const local = group.flow ? layoutConnected(group.nodes, groupEdges(group, nodes, edges)) : pack(group.nodes);
    const width = Math.max(...local.map(item => item.position_x)) + NODE_WIDTH;
    const height = Math.max(...local.map(item => item.position_y)) + NODE_HEIGHT;
    if (shelfX && (shelfX + width > MAX_ROW_WIDTH || (wasFlow && !group.flow && group.key !== 'shared-resources'))) {
      shelfTop += shelfHeight + BLOCK_GAP + 48; shelfX = 0; shelfHeight = 0;
    }
    positions.push(...local.map(item => ({ ...item, position_x: item.position_x + shelfX, position_y: item.position_y + shelfTop })));
    shelfX += width + BLOCK_GAP;
    shelfHeight = Math.max(shelfHeight, height);
    wasFlow = group.flow;
  }
  return reduceCrossings(positions, groups, edges);
}
