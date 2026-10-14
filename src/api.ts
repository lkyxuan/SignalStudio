import { z } from 'zod';
import { cachedSourceContracts } from './sourceContractCache';
import { decodeGraph } from './graphTransport';
import type { Workspace } from './graphCache';
import { graphSchema, sourceContractsSchema, sourceOperationSchema, type Graph, type SourceContracts } from './contracts';

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown; timeoutMs?: number };
export const NOT_MODIFIED = Symbol('not-modified');
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
  if (path === '/source-contracts/v1' && (options.method ?? 'GET') === 'GET') {
    let storage: Pick<Storage, 'getItem'|'setItem'> | undefined;
    try { storage = typeof window !== 'undefined' ? window.signalstudioStorage ?? window.localStorage : undefined; } catch { /* Storage optional. */ }
    return cachedSourceContracts(route => requestData(route, options), storage);
  }
  return requestData(path, options);
}
async function requestData(path: string, options: RequestOptions = {}, conditional = false, base?: Graph | null): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set('X-Card-Model', 'card-model.v1');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const { timeoutMs = 15000, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(`/api${path}`, {
    cache: 'no-store', ...init, headers, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    body: options.body === undefined || options.body === null ? undefined : JSON.stringify(options.body),
  });
  if (conditional && response.status === 304 && path === '/graph' && headers.has('If-None-Match')) return NOT_MODIFIED;
  let data: unknown;
  try { data = await response.json(); }
  catch { throw new ApiError('API returned invalid JSON', response.status, path); }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(data);
    throw new ApiError(error.success ? error.data.error : 'Request failed', response.status, path);
  }
  if ((options.method ?? 'GET') === 'GET') {
    if (path === '/graph') {
      try { return decodeGraph(data, base); }
      catch (error) {
        if ((data as Record<string, unknown>)?.transport === 'delta.v1') throw error;
        throw new ApiError(`Invalid API response at ${path}: ${error instanceof Error ? error.message : 'Invalid data'}`, response.status, path);
      }
    }
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

export async function requestGraph(revision?: string, workspace?: Workspace, base?: Graph | null): Promise<Graph | typeof NOT_MODIFIED> {
  // Older clients may have cached this server revision after stripping new
  // review fields. A 304/delta cannot restore fields missing from that base.
  if (base?.card_progress && Object.values(base.card_progress).some(progress =>
    progress.schema_version !== 'card-review.v1' || !Array.isArray(progress.history))) revision = undefined;
  const headers = { 'X-Graph-Transport': 'canvas.v1', ...(revision ? { 'If-None-Match': `"${revision}"` } : {}),
    ...(base?.transport === 'canvas.v1' && revision ? { 'X-Graph-Base': revision } : {}),
    ...(workspace ? { 'X-Workspace-Identity': JSON.stringify(workspace) } : {}) };
  try { return await requestData('/graph', { headers }, true, base) as Graph | typeof NOT_MODIFIED; }
  catch (error) {
    // A malformed/outdated delta never reaches the editor/cache. Re-read once without a base.
    if (!('X-Graph-Base' in headers) || error instanceof ApiError || error instanceof TypeError || error instanceof DOMException) throw error;
    return await requestData('/graph', {headers: { 'X-Graph-Transport': 'canvas.v1',
      ...(workspace ? {'X-Workspace-Identity':JSON.stringify(workspace)} : {}) }}) as Graph;
  }
}
