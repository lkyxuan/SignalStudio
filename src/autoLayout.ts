import type { GraphNode, GraphEdge } from './contracts';
export type LayoutNode = Pick<GraphNode, 'id' | 'name'> & { type: string; is_system_state?: number };
type LayoutEdge = Pick<GraphEdge, 'upstream_id' | 'downstream_id'>;
export type NodePosition = { id: string; position_x: number; position_y: number };

const NODE_WIDTH = 208;
const NODE_HEIGHT = 184;
const COLUMN_GAP = 132;
const ROW_GAP = 56;
const BLOCK_COLUMN_GAP = 32;
const BLOCK_ROW_GAP = 32;
const BLOCK_GAP = 80;
const MAX_ROW_WIDTH = 1800;
const TYPE_ORDER = ['Source', 'Raw Field', 'Evidence Check', 'asset_identifiers', 'assets',
  'Asset Resolution', 'Relationship Discovery', 'Review Decision', 'Derived Field',
  'Metric', 'Score', 'Redpanda Topic', 'Redis Window', 'asset_monitoring_rules', 'Rule Evaluation', 'asset_score_events', 'asset_scores_current', 'supabase_asset_scores', 'Flow Result', 'Signal Event',
  'asset_relationships', 'Relationship Lookup', 'Ranking', 'Ranking Table',
  'Product Module'];

const compareNodes = (left: LayoutNode, right: LayoutNode) => {
  const typeDifference = TYPE_ORDER.indexOf(left.type) - TYPE_ORDER.indexOf(right.type);
  return typeDifference || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
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

  return columns.flatMap((column, layer) => column.map((node, row) => ({
    id: node.id,
    position_x: layer * (NODE_WIDTH + COLUMN_GAP),
    position_y: row * (NODE_HEIGHT + ROW_GAP),
  })));
}

function isolatedGroupKey(node: LayoutNode) {
  if (node.type === 'Source') return `source:${node.name.split('.')[0]}`;
  if (node.is_system_state) return 'tables';
  return `type:${node.type}`;
}

function layoutIsolated(nodes: LayoutNode[]): NodePosition[] {
  const groups = new Map<string, LayoutNode[]>();
  for (const node of nodes) {
    const key = isolatedGroupKey(node);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(node);
  }
  const blocks = [...groups].map(([key, members]) => {
    members.sort(compareNodes);
    const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(members.length))));
    const rows = Math.ceil(members.length / columns);
    return {
      key, members, columns,
      width: columns * NODE_WIDTH + (columns - 1) * BLOCK_COLUMN_GAP,
      height: rows * NODE_HEIGHT + (rows - 1) * BLOCK_ROW_GAP,
    };
  }).sort((a, b) => b.members.length - a.members.length || a.key.localeCompare(b.key));

  const positions: NodePosition[] = [];
  let rowX = 0, rowY = 0, rowHeight = 0;
  for (const block of blocks) {
    if (rowX && rowX + block.width > MAX_ROW_WIDTH) {
      rowY += rowHeight + BLOCK_GAP;
      rowX = 0;
      rowHeight = 0;
    }
    block.members.forEach((node, index) => positions.push({
      id: node.id,
      position_x: rowX + (index % block.columns) * (NODE_WIDTH + BLOCK_COLUMN_GAP),
      position_y: rowY + Math.floor(index / block.columns) * (NODE_HEIGHT + BLOCK_ROW_GAP),
    }));
    rowX += block.width + BLOCK_GAP;
    rowHeight = Math.max(rowHeight, block.height);
  }
  return positions;
}

export function autoLayout(nodes: LayoutNode[], edges: LayoutEdge[]): NodePosition[] {
  if (!nodes.length) return [];
  const ids = new Set(nodes.map(node => node.id));
  const connectedIds = new Set<string>();
  const validEdges = edges.filter(edge => ids.has(edge.upstream_id) && ids.has(edge.downstream_id));
  for (const edge of validEdges) {
    connectedIds.add(edge.upstream_id);
    connectedIds.add(edge.downstream_id);
  }
  const connected = nodes.filter(node => connectedIds.has(node.id));
  const isolated = nodes.filter(node => !connectedIds.has(node.id));
  const flow = layoutConnected(connected, validEdges);
  const blocks = layoutIsolated(isolated);
  const flowHeight = flow.length ? Math.max(...flow.map(item => item.position_y)) + NODE_HEIGHT + BLOCK_GAP : 0;
  return [...flow, ...blocks.map(item => ({ ...item, position_y: item.position_y + flowHeight }))];
}
