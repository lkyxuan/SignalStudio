const number = (item, prefix, width = 3) => item?.reference_number == null
  ? '' : `${prefix}${String(item.reference_number).padStart(width, '0')}`;

export const nodeRef = node => number(node, '#', 4);
export const edgeRef = edge => number(edge, 'L');
export const usageRef = usage => number(usage, 'R');

export const IDENTITY_REFS = Object.freeze({
  assets: 1001,
  identifiers: 1002,
  source: 2030,
  lookup: 4001,
  create: 3002,
  review: 4003,
  matched: 3004,
});
