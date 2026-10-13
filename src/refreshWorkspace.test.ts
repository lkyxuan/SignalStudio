import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshWorkspace } from './refreshWorkspace';

function fixture(protocol = 'http:') {
  let state: 'safe' | 'draft' | 'busy' = 'safe';
  let reads = 0;
  const navigations: string[] = [];
  const health = { app: 'SignalStudio', mode: 'development', client_ready: true, project_root: '/workspace', database_path: '/workspace/data/logic.db' };
  const browser = {
    signalstudioQuitState: () => state,
    signalstudioWorkspace: { endpoint: 'http://100.123.241.60:15173', workspace: { project_root: health.project_root, database_path: health.database_path }, codeRevision: null },
    fetch: async () => { reads++; return new Response(JSON.stringify(health)); },
    location: { protocol, reload: () => navigations.push('reload'), assign: (url: string) => navigations.push(url) },
  };
  return { browser: browser as unknown as Window, health, navigations, setState: (value: typeof state) => { state = value; }, reads: () => reads };
}

test('online workspace reloads; bundled workspace navigates to the configured online entry', async () => {
  for (const protocol of ['http:', 'signalstudio:']) {
    const f = fixture(protocol);
    assert.equal(await refreshWorkspace(f.browser), 'refreshed');
    assert.deepEqual(f.navigations, [protocol === 'http:' ? 'reload' : 'http://100.123.241.60:15173/']);
  }
});

test('drafts, writes and missing editor state prevent even starting a refresh', async () => {
  for (const state of ['draft', 'busy', undefined] as const) {
    const f = fixture();
    if (state) f.setState(state);
    else delete f.browser.signalstudioQuitState;
    assert.equal(await refreshWorkspace(f.browser), 'blocked');
    assert.equal(f.reads(), 0);
    assert.deepEqual(f.navigations, []);
  }
});

test('an edit or write started during connection checking also prevents navigation', async () => {
  for (const state of ['draft', 'busy'] as const) {
    const f = fixture();
    const fetch = f.browser.fetch;
    f.browser.fetch = async () => { const response = await fetch(''); f.setState(state); return response; };
    assert.equal(await refreshWorkspace(f.browser), 'blocked');
    assert.deepEqual(f.navigations, []);
  }
});

test('unreachable, unready, invalid and different workspaces preserve the page', async () => {
  for (const scenario of ['offline', 'unready', 'identity', 'invalid', 'http-error']) {
    const f = fixture('signalstudio:');
    if (scenario === 'offline') f.browser.fetch = async () => { throw new TypeError('offline'); };
    if (scenario === 'unready') f.health.client_ready = false;
    if (scenario === 'identity') f.health.database_path = '/other/data/logic.db';
    if (scenario === 'invalid') f.browser.fetch = async () => new Response('<html>');
    if (scenario === 'http-error') f.browser.fetch = async () => new Response('{}', { status: 503 });
    assert.equal(await refreshWorkspace(f.browser), 'unavailable', scenario);
    assert.deepEqual(f.navigations, []);
  }
});

test('bundled pages require a configured HTTP workspace destination', async () => {
  for (const endpoint of ['', 'file:///tmp/index.html']) {
    const f = fixture('signalstudio:');
    f.browser.signalstudioWorkspace!.endpoint = endpoint;
    assert.equal(await refreshWorkspace(f.browser), 'unavailable');
    assert.deepEqual(f.navigations, []);
  }
});
