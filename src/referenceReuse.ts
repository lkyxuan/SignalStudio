// Reuse only equal JSON-shaped values. Call after validation, never instead of it.
// Neither input is mutated, including entities shared across reordered collections.
export function reuseValue<T>(next: T, previous: unknown): T {
  if (Object.is(next, previous)) return previous as T;
  if (!next || !previous || typeof next !== 'object' || typeof previous !== 'object' ||
      Array.isArray(next) !== Array.isArray(previous)) return next;
  const current = next as Record<string, unknown>, old = previous as Record<string, unknown>;
  const keys = Object.keys(current);
  let equal = keys.length === Object.keys(old).length;
  let result = current;
  for (const key of keys) {
    if (!Object.hasOwn(old, key)) { equal = false; continue; }
    const value = reuseValue(current[key], old[key]);
    if (value !== current[key]) {
      if (result === current) result = (Array.isArray(next) ? [...next] : { ...current }) as Record<string, unknown>;
      result[key] = value;
    }
    if (value !== old[key]) equal = false;
  }
  return equal ? previous as T : result as T;
}

export function reuseEntities<T extends { id: string }>(next: T[], previous: T[] = []): T[] {
  const byId = new Map(previous.map(item => [item.id, item]));
  const result = next.map(item => reuseValue(item, byId.get(item.id)));
  return result.length === previous.length && result.every((item, index) => item === previous[index]) ? previous : result;
}

// ReactFlow reports dimensions/selection through onNodesChange. Keep that local
// renderer state when a server update only changes another card's data.
export function reuseCanvasNodes<T extends { id: string }>(next: T[], previous: T[]): T[] {
  const byId = new Map(previous.map(item => [item.id, item]));
  return reuseEntities(next.map(item => {
    const old = byId.get(item.id) as Record<string, unknown> | undefined;
    if (!old) return item;
    const state = Object.fromEntries(['measured', 'selected', 'dragging', 'width', 'height']
      .filter(key => Object.hasOwn(old, key)).map(key => [key, old[key]]));
    return { ...state, ...item };
  }), previous);
}
