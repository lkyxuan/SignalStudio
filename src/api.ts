import { z } from 'zod';
import { graphSchema, sourceContractsSchema, sourceOperationSchema, type Graph, type SourceContracts } from './contracts';

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };
export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly path: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function request(path: '/graph', options?: RequestOptions): Promise<Graph>;
export function request(path: '/source-contracts/v1', options?: RequestOptions): Promise<SourceContracts>;
export function request(path: string, options?: RequestOptions): Promise<unknown>;
export async function request(path: string, options: RequestOptions = {}): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set('X-Card-Model', 'card-model.v1');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(`/api${path}`, {
    cache: 'no-store', ...options, headers,
    body: options.body === undefined || options.body === null ? undefined : JSON.stringify(options.body),
  });
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApiError('API returned invalid JSON', response.status, path); }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new ApiError(error.success ? error.data.error : 'Request failed', response.status, path);
  }
  if ((options.method ?? 'GET') === 'GET') {
    const schema = path === '/graph' ? graphSchema : path === '/source-contracts/v1' ? sourceContractsSchema
      : /^\/source-contracts\/v1\/(operations|resources)\/[^/]+$/.test(path) ? sourceOperationSchema : null;
    if (schema) {
      const result = schema.safeParse(data);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw new ApiError(`Invalid API response at ${path}: ${issue?.path.join('.') || 'root'} (${issue?.message || 'Invalid data'})`, response.status, path);
      }
      return result.data;
    }
  }
  return data;
}
