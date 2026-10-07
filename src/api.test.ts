import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, request } from './api';
import { serverGraph } from './testFixtures';

test('validates graph reads and preserves caller headers', async context => {
  const graph = serverGraph();
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, '/api/graph');
    const headers = new Headers(options.headers);
    assert.equal(headers.get('X-Project'), 'example');
    assert.equal(headers.get('Content-Type'), 'application/json');
    return Response.json(graph);
  });
  assert.deepEqual(await request('/graph', { headers: { 'X-Project': 'example' } }), graph);
});
test('rejects invalid successful responses before they reach the graph', async context => {
  context.mock.method(globalThis, 'fetch', async () => Response.json({ nodes: [] }));
  await assert.rejects(request('/graph'), error => error instanceof ApiError && error.path === '/graph' && /Invalid API response/.test(error.message));
});
test('reports server errors and non-JSON responses', async context => {
  const fetch = context.mock.method(globalThis, 'fetch', async () => Response.json({ error: 'Name is required' }, { status: 400 }));
  await assert.rejects(request('/nodes', { method: 'POST', body: {} }), error => error instanceof ApiError && error.status === 400 && error.message === 'Name is required');
  fetch.mock.mockImplementation(async () => new Response('<html>Failure</html>', { status: 502 }));
  await assert.rejects(request('/graph'), error => error instanceof ApiError && error.status === 502 && /invalid JSON/.test(error.message));
});
test('serializes mutation payloads without treating the response as a graph read', async context => {
  context.mock.method(globalThis, 'fetch', async (_url: string, options: RequestInit) => {
    assert.equal(options.method, 'PATCH');
    assert.equal(options.body, '{"definition":"updated"}');
    return Response.json({ id: 'node-1' });
  });
  assert.deepEqual(await request('/nodes/node-1', { method: 'PATCH', body: { definition: 'updated' } }), { id: 'node-1' });
});
