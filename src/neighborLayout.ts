import type { GraphEdge } from './contracts';
import type { NodePosition } from './autoLayout';

export type PositionedCard = {
  id: string;
  position: { x: number; y: number };
  measured?: { width?: number; height?: number };
};
type Box = { x: number; y: number; width: number; height: number };
const GAP = 44;
const CLEARANCE = 24;
const box = (node: PositionedCard): Box => ({
  ...node.position,
  width: node.measured?.width || 208,
  height: node.measured?.height || 184,
});
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width + CLEARANCE && a.x + a.width + CLEARANCE > b.x &&
  a.y < b.y + b.height + CLEARANCE && a.y + a.height + CLEARANCE > b.y;

/** Move only direct neighbors; the anchor and all unrelated cards stay in place. */
export function neighborLayout(
  cards: PositionedCard[],
  edges: Pick<GraphEdge, 'upstream_id' | 'downstream_id'>[],
  anchorId: string,
): NodePosition[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const anchor = byId.get(anchorId);
  if (!anchor) return [];
  const inputs = new Set(edges.filter(edge => edge.downstream_id === anchorId).map(edge => edge.upstream_id));
  const outputs = new Set(edges.filter(edge => edge.upstream_id === anchorId).map(edge => edge.downstream_id));
  inputs.delete(anchorId);
  outputs.delete(anchorId);
  // A bidirectional neighbor is one card, placed on the input side.
  for (const id of inputs) outputs.delete(id);
  const moving = new Set([...inputs, ...outputs]);
  const occupied = cards.filter(card => !moving.has(card.id)).map(box);
  const center = box(anchor);
  const result: NodePosition[] = [];
  for (const [ids, direction] of [[inputs, -1], [outputs, 1]] as const) {
    const neighbors = [...ids].map(id => byId.get(id)).filter((card): card is PositionedCard => !!card)
      .sort((a, b) => a.position.y - b.position.y || a.id.localeCompare(b.id));
    const totalHeight = neighbors.reduce((sum, card) => sum + box(card).height, 0) + Math.max(0, neighbors.length - 1) * CLEARANCE;
    let y = center.y + center.height / 2 - totalHeight / 2;
    for (const card of neighbors) {
      const dimensions = box(card);
      const x = direction < 0 ? center.x - GAP - dimensions.width : center.x + center.width + GAP;
      const desiredY = y;
      y += dimensions.height + CLEARANCE;
      const candidates: Box[] = [];
      // Find the nearest free position on the proper side without moving other cards.
      // There are more rows than existing obstacles, so at least one must be free.
      const stepY = Math.max(dimensions.height, ...occupied.map(item => item.height)) + CLEARANCE;
      for (let column = 0; column < 4; column++) {
        for (let row = -occupied.length - 1; row <= occupied.length + 1; row++) {
          candidates.push({ ...dimensions, x: x + direction * column * (dimensions.width + GAP), y: desiredY + row * stepY });
        }
      }
      candidates.sort((a, b) => Math.hypot(a.x - x, a.y - desiredY) - Math.hypot(b.x - x, b.y - desiredY));
      const placed = candidates.find(candidate => occupied.every(item => !overlaps(candidate, item)))!;
      occupied.push(placed);
      result.push({ id: card.id, position_x: placed.x, position_y: placed.y });
    }
  }
  return result;
}
