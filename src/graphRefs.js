const number = (item, prefix) => item?.reference_number == null
  ? '' : `${prefix}${String(item.reference_number).padStart(3, '0')}`;

export const nodeRef = node => number(node, '#');
export const edgeRef = edge => number(edge, 'L');
export const usageRef = usage => number(usage, 'R');
