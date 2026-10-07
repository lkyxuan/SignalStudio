type Reference = { reference_number?: number | null } | null | undefined;
const number = (item: Reference, prefix: string, width = 3) => item?.reference_number == null
  ? '' : `${prefix}${String(item.reference_number).padStart(width, '0')}`;

export const nodeRef = (node: Reference) => number(node, '#', 4);
export const edgeRef = (edge: Reference) => number(edge, 'L');
export const usageRef = (usage: Reference) => number(usage, 'R');

export const IDENTITY_REFS = Object.freeze({
  assets: 1001,
  identifiers: 1002,
  source: 2030,
  lookup: 4001,
  create: 3002,
  review: 4003,
  matched: 3004,
});
