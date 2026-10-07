export const SMART_FOLLOWING_OPERATION = 'kaito.mcp.kaito_smart_following_market';

export function flattenAccount(record: Record<string, unknown> | null | undefined) {
  const result: [string, unknown][] = [];
  const visit = (path: string, value: unknown) => {
    if (value && !Array.isArray(value) && typeof value === 'object') {
      Object.entries(value).forEach(([key, child]) => visit(`${path}.${key}`, child));
    } else {
      result.push([path, value]);
    }
  };
  Object.entries(record || {}).forEach(([key, value]) => visit(key, value));
  return result;
}

export const displayCaseValue = (value: unknown) => value == null ? 'null' : typeof value === 'string' ? value : JSON.stringify(value);
