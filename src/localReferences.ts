import { neighborLayout } from './neighborLayout';

type Position = { position_x: number; position_y: number };
type Card = Position & { id: string; logicalId: string; referenceAnchor?: string };
type Link = { upstream_id: string; downstream_id: string };
export const localReferenceId = (anchor: string, logicalId: string) =>
  `local-reference:${encodeURIComponent(JSON.stringify([anchor, logicalId]))}`;
export function parseLocalReference(id: string): [string, string] | null {
  if (!id.startsWith('local-reference:')) return null;
  try {
    const pair: unknown = JSON.parse(decodeURIComponent(id.slice('local-reference:'.length)));
    return Array.isArray(pair) && pair.length === 2 && pair.every(value => typeof value === 'string' && value.length > 0)
      ? pair as [string, string] : null;
  } catch { return null; }
}
export const directlyLinked = (edges: Link[], a: string, b: string) => a !== b && edges.some(e =>
  e.upstream_id === a && e.downstream_id === b || e.upstream_id === b && e.downstream_id === a);

// A card used by multiple steps gets a local display at distant use sites.
// The threshold controls visual placement only; it does not define a business module.
export function automaticReferencePlan(cards: (Card & {towerId:string|null})[], edges: Link[]) {
  const incoming = new Map<string,Set<string>>(), outgoing = new Map<string,Set<string>>();
  for (const e of edges) {
    incoming.set(e.downstream_id,new Set([...(incoming.get(e.downstream_id)||[]),e.upstream_id]));
    outgoing.set(e.upstream_id,new Set([...(outgoing.get(e.upstream_id)||[]),e.downstream_id]));
  }
  const uses = (id:string)=>Math.max(incoming.get(id)?.size||0,outgoing.get(id)?.size||0);
  const groups = new Map<string,Link[]>();
  for (const e of edges) {
    const sources=cards.filter(c=>c.logicalId===e.upstream_id),targets=cards.filter(c=>c.logicalId===e.downstream_id);
    let pairs=sources.flatMap(a=>targets.filter(b=>a.towerId===b.towerId).map(b=>[a,b] as const));
    if (!pairs.length && sources[0] && targets[0]) pairs=[[sources[0],targets[0]]];
    for (const [a,b] of pairs) {
      if (Math.hypot(a.position_x-b.position_x,a.position_y-b.position_y)<=1800) continue;
      const shared=uses(a.logicalId)>=uses(b.logicalId)?a:b;
      if (uses(shared.logicalId)<2) continue;
      const anchor=shared===a?b:a;
      groups.set(anchor.id,[...(groups.get(anchor.id)||[]),e]);
    }
  }
  const occupied=[...cards], result:ReturnType<typeof localReferencePlan>=[];
  for (const anchor of [...groups.keys()].sort()) {
    const additions=localReferencePlan(occupied,groups.get(anchor)!,anchor);
    for (const item of additions) {
      const parent=cards.find(c=>c.id===anchor)!;
      occupied.push({...item,logicalId:item.node_id,towerId:parent.towerId,referenceAnchor:anchor});
      result.push(item);
    }
  }
  return result;
}

// Only create displays of saved neighbors. Existing cards and saved displays do not move.
export function localReferencePlan(cards: Card[], edges: Link[], anchorId: string) {
  const byId = new Map(cards.map(card => [card.id, card]));
  const anchor = byId.get(anchorId);
  if (!anchor) return [];
  const ancestors = new Set<string>();
  let parent: Card | undefined = anchor;
  while (parent && !ancestors.has(parent.logicalId)) {
    ancestors.add(parent.logicalId);
    parent = parent.referenceAnchor ? byId.get(parent.referenceAnchor) : undefined;
  }
  const neighbors = [...new Set(edges.flatMap(e => e.upstream_id === anchor.logicalId ? [e.downstream_id]
    : e.downstream_id === anchor.logicalId ? [e.upstream_id] : []))].sort();
  const additions = neighbors.filter(id => !ancestors.has(id) && !byId.has(localReferenceId(anchorId, id)) && cards.some(c => c.logicalId === id));
  const links = edges.flatMap(e => additions.includes(e.upstream_id) && e.downstream_id === anchor.logicalId
    ? [{upstream_id:localReferenceId(anchorId,e.upstream_id),downstream_id:anchorId}]
    : additions.includes(e.downstream_id) && e.upstream_id === anchor.logicalId
      ? [{upstream_id:anchorId,downstream_id:localReferenceId(anchorId,e.downstream_id)}] : []);
  const placed = neighborLayout([...cards.map(c=>({id:c.id,position:{x:c.position_x,y:c.position_y}})),
    ...additions.map(id=>({id:localReferenceId(anchorId,id),position:{x:anchor.position_x,y:anchor.position_y}}))],links,anchorId);
  return placed.map(p=>({...p,node_id:parseLocalReference(p.id)![1]}));
}
