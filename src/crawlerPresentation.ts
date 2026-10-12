import { crawlerLayout, type LayoutNode } from './autoLayout';

type PositionedNode = LayoutNode & { position_x: number; position_y: number };
type Edge = { id: string; upstream_id: string; downstream_id: string; relationship_id?: string };

// Keep presentation identity separate from the IDs accepted by mutation APIs.
// Positions of mirrors follow the saved logical card, with deterministic offsets.
export function crawlerPresentation<N extends PositionedNode, E extends Edge>(nodes: N[], savedEdges: E[], displayEdges: E[] = savedEdges) {
  const plan = crawlerLayout(nodes, savedEdges);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const canonical = new Map(plan.positions.map(p => [p.id, p]));
  const cards = plan.occurrences.map(p => {
    const node = byId.get(p.logicalId)!, base = canonical.get(p.logicalId)!;
    return { ...node, id: p.id, logicalId: p.logicalId, towerId: p.towerId, shared: p.shared,
      position_x: node.position_x + p.position_x - base.position_x,
      position_y: node.position_y + p.position_y - base.position_y };
  });
  const occurrences = new Map<string, typeof cards>();
  for (const n of cards) occurrences.set(n.logicalId, [...(occurrences.get(n.logicalId) || []), n]);
  const edges: (E & { logicalEdgeId: string; relationship_id?: string })[] = [];
  for (const edge of displayEdges) {
    const sources = occurrences.get(edge.upstream_id) || [], targets = occurrences.get(edge.downstream_id) || [];
    let pairs = sources.flatMap(a => targets.filter(b => a.towerId === b.towerId).map(b => [a, b] as const));
    if (!pairs.length && sources.length && targets.length) {
      // Final projections collect the tower endpoints. Maintenance references
      // keep one connection to the canonical occurrence instead of a fan-out.
      const output = targets[0]!.name === 'supabase_asset_scores' || targets[0]!.name.startsWith('leaderboard_');
      pairs = output && targets[0]!.towerId === null ? sources.map(a => [a, targets[0]!] as const) : [[sources[0]!, targets[0]!]];
    }
    for (const [a, b] of pairs) {
      const original = a.id === a.logicalId && b.id === b.logicalId;
      const id = original ? edge.id : `occurrence-edge:${encodeURIComponent(JSON.stringify([edge.id, a.id, b.id]))}`;
      const pairKey = a.towerId || b.towerId;
      edges.push({ ...edge, id, upstream_id: a.id, downstream_id: b.id, logicalEdgeId: edge.id,
        ...(edge.relationship_id ? { relationship_id: `occurrence-relation:${encodeURIComponent(JSON.stringify([edge.relationship_id, pairKey]))}` } : {}) });
    }
  }
  return { nodes: cards, edges };
}
