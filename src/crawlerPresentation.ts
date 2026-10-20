import { crawlerLayout, type LayoutNode } from './autoLayout';
import { automaticReferencePlan, directlyLinked, parseLocalReference } from './localReferences';

type Position = { position_x: number; position_y: number };
type PositionedNode = LayoutNode & Position & { display_positions?: Record<string, Position> };
type Edge = { id: string; upstream_id: string; downstream_id: string; relationship_id?: string };

// Keep presentation identity separate from the IDs accepted by mutation APIs.
// Legacy positions retain their offsets until a display gets its own saved position.
export function crawlerPresentation<N extends PositionedNode, E extends Edge>(nodes: N[], savedEdges: E[], displayEdges: E[] = savedEdges, options: {automaticReferences?:boolean} = {}) {
  const plan = crawlerLayout(nodes, savedEdges);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const canonical = new Map(plan.positions.map(p => [p.id, p]));
  const cards = plan.occurrences.map(p => {
    const node = byId.get(p.logicalId)!, base = canonical.get(p.logicalId)!;
    return { ...node, id: p.id, logicalId: p.logicalId, towerId: p.towerId, shared: p.shared, referenceAnchor: undefined as string | undefined,
      position_x: node.display_positions?.[p.id]?.position_x ?? node.position_x + p.position_x - base.position_x,
      position_y: node.display_positions?.[p.id]?.position_y ?? node.position_y + p.position_y - base.position_y };
  });
  // Explicit local references are saved display positions, never logical nodes.
  // Resolve parents first so a shared process can be expanded one step at a time.
  // Membership depends on standard layout, never on a user's drag coordinates.
  // Otherwise moving a card could silently add/remove displays and their edges.
  const automatic = (options.automaticReferences===false?[]:automaticReferencePlan(plan.occurrences,savedEdges)).map(item=>{
    const anchor=parseLocalReference(item.id)![0], original=plan.occurrences.find(n=>n.id===anchor)!, current=cards.find(n=>n.id===anchor)!;
    return {id:item.id,node:byId.get(item.node_id)!, anchor,
      position:byId.get(item.node_id)!.display_positions?.[item.id] || {
        position_x:item.position_x+current.position_x-original.position_x,
        position_y:item.position_y+current.position_y-original.position_y}};
  });
  const pending = [...automatic, ...nodes.flatMap(node => Object.entries(node.display_positions || {}).flatMap(([id, position]) => {
    const pair = parseLocalReference(id);
    return pair && pair[1] === node.id ? [{id, node, position, anchor:pair[0]}] : [];
  }))].sort((a,b)=>a.id.localeCompare(b.id));
  const displays = new Map(cards.map(card=>[card.id,card]));
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of pending) {
      if (displays.has(item.id)) continue;
      const anchor = displays.get(item.anchor);
      if (!anchor || !directlyLinked(savedEdges, anchor.logicalId, item.node.id)) continue;
      const card = {...item.node, ...item.position, id:item.id, logicalId:item.node.id, towerId:anchor.towerId,
        shared:true, referenceAnchor:item.anchor};
      cards.push(card); displays.set(card.id,card); changed = true;
    }
  }
  const counts = new Map<string,number>();
  for (const card of cards) counts.set(card.logicalId,(counts.get(card.logicalId)||0)+1);
  for (const card of cards) card.shared = counts.get(card.logicalId)! > 1;
  const occurrences = new Map<string, typeof cards>();
  for (const n of cards) occurrences.set(n.logicalId, [...(occurrences.get(n.logicalId) || []), n]);
  const edges: (E & { logicalEdgeId: string; relationship_id?: string })[] = [];
  for (const edge of displayEdges) {
    const sources = (occurrences.get(edge.upstream_id) || []).filter(n=>!n.referenceAnchor), targets = (occurrences.get(edge.downstream_id) || []).filter(n=>!n.referenceAnchor);
    let pairs = sources.flatMap(a => targets.filter(b => a.towerId === b.towerId).map(b => [a, b] as const));
    if (!pairs.length && sources.length && targets.length) {
      // Final projections collect the tower endpoints. Maintenance references
      // keep one connection to the canonical occurrence instead of a fan-out.
      const output = targets[0]!.name === 'supabase_asset_scores' || targets[0]!.name.startsWith('leaderboard_');
      pairs = output && targets[0]!.towerId === null ? sources.map(a => [a, targets[0]!] as const) : [[sources[0]!, targets[0]!]];
    }
    // Replace a distant endpoint at this use site while retaining other uses.
    pairs = pairs.filter(([a,b]) => !cards.some(n=>n.referenceAnchor===b.id && n.logicalId===a.logicalId ||
      n.referenceAnchor===a.id && n.logicalId===b.logicalId));
    for (const card of cards.filter(n=>n.referenceAnchor)) {
      const anchor = displays.get(card.referenceAnchor!)!;
      const pair = card.logicalId === edge.upstream_id && anchor.logicalId === edge.downstream_id ? [card,anchor] as const
        : anchor.logicalId === edge.upstream_id && card.logicalId === edge.downstream_id ? [anchor,card] as const : null;
      if (pair && !pairs.some(([a,b])=>a.id===pair[0].id && b.id===pair[1].id)) pairs.push(pair);
    }
    for (const [a, b] of pairs) {
      const original = a.id === a.logicalId && b.id === b.logicalId;
      const id = original ? edge.id : `occurrence-edge:${encodeURIComponent(JSON.stringify([edge.id, a.id, b.id]))}`;
      const pairKey = a.referenceAnchor || b.referenceAnchor ? [a.id,b.id].sort().join('|') : a.towerId || b.towerId;
      edges.push({ ...edge, id, upstream_id: a.id, downstream_id: b.id, logicalEdgeId: edge.id,
        ...(edge.relationship_id ? { relationship_id: `occurrence-relation:${encodeURIComponent(JSON.stringify([edge.relationship_id, pairKey]))}` } : {}) });
    }
  }
  return { nodes: cards, edges };
}

// Freeze siblings at their current coordinates so even the canonical display
// can move independently. The backend only seeds positions that are not saved.
export function displayPositionUpdate<N extends PositionedNode & { logicalId: string }>(cards: N[], id: string, position: { x: number; y: number }) {
  const card = cards.find(n => n.id === id);
  if (!card) throw Error('Display not found');
  return { initial_positions: cards.filter(n => n.logicalId === card.logicalId).map(n => ({
    id: n.id, position_x: n.position_x, position_y: n.position_y,
  })), position: { id, position_x: position.x, position_y: position.y } };
}

// ReactFlow's local edge state can lag one render behind a replaced graph.
// Do not interpret a removed occurrence using the new graph's relationship map.
export function currentPresentationEdges<E extends { id: string }>(
  edges: E[], visualEdges: ReadonlyMap<string, { logicalEdgeId: string }>, meanings: ReadonlyMap<string, unknown>,
) {
  return edges.filter(edge => {
    const current = visualEdges.get(edge.id);
    return current !== undefined && meanings.has(current.logicalEdgeId);
  });
}
