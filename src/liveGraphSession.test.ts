import test from 'node:test';
import assert from 'node:assert/strict';
import { GraphCache } from './graphCache';
import { LiveGraphSession } from './liveGraphSession';
import { serverGraph } from './testFixtures';
const workspace = { project_root: '/test', database_path: '/test/data/logic.db' };
const graph = (revision: string) => ({ ...serverGraph(), workspace, revision });
const storage = () => { const map = new Map<string, string>(); return {
  getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); },
}; };
test('cache is isolated by endpoint, project/database, format and validated graph; quota is optional', () => {
  const store = storage(), cache = new GraphCache(store, 'http://host');
  assert.equal(cache.save(workspace, graph('a'), new Date().toISOString()), true);
  assert.equal(cache.read()?.graph.revision, 'a');
  assert.equal(new GraphCache(store, 'http://other').read(), null);
  assert.equal(cache.read({ ...workspace, database_path: '/other.db' }), null);
  assert.equal(cache.save(workspace, { ...graph('b'), nodes: [{ id: 'invalid' }] } as never, new Date().toISOString()), false);
  assert.equal(cache.save(workspace, { ...graph('b'), workspace: { ...workspace, project_root: '/other' } }, new Date().toISOString()), false);
  const blocked = new GraphCache({ getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); }, removeItem() {} }, 'http://host');
  assert.equal(blocked.read(), null); assert.equal(blocked.save(workspace, graph('a'), new Date().toISOString()), false);
  store.setItem(`signalstudio:graph:v2:${JSON.stringify(['http://host', workspace.project_root, workspace.database_path])}`, 'corrupt');
  assert.equal(cache.read(), null);
});
test('offline cache blocks writes; 304 confirms it without losing pending conflict; failure revokes writes', async context => {
  const cache = new GraphCache(storage(), 'host'); cache.save(workspace, graph('a'), new Date().toISOString());
  const state = new LiveGraphSession(cache);
  assert.equal(state.status, 'cached');
  await assert.rejects(state.write('/nodes', 'POST', {}), /只读/);
  let current = graph('a'); let fail = false; const calls: string[] = [];
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls.push(url); if (fail) throw Error('offline');
    if (url.endsWith('desktop-health')) return Response.json({ ...workspace, app: 'SignalStudio', client_ready: true });
    if (url.endsWith('/graph')) {
      assert.deepEqual(JSON.parse(new Headers(options.headers).get('X-Workspace-Identity')!), workspace);
      return new Headers(options.headers).get('If-None-Match') === `"${current.revision}"` ? new Response(null, { status: 304 }) : Response.json(current);
    }
    throw Error('Unexpected mutation');
  });
  await state.refresh(); assert.equal(state.writable, true);
  state.dirty = true; current = graph('b'); await state.refresh();
  assert.equal(state.graph?.revision, 'a'); assert.equal(state.pending?.revision, 'b'); assert.equal(state.conflict, true);
  await state.refresh(); assert.equal(state.conflict, true); assert.equal(state.pending?.revision, 'b');
  fail = true; await assert.rejects(state.refresh()); assert.equal(state.writable, false);
  const before = calls.length; await assert.rejects(state.write('/nodes', 'POST', {}), /只读/); assert.equal(calls.length, before);
});
test('health and graph identity changes are rejected; no cache is written for another workspace', async context => {
  const cache = new GraphCache(storage(), 'host'); const state = new LiveGraphSession(cache, workspace);
  let changeHealth = true;
  context.mock.method(globalThis, 'fetch', async (url: string) => url.endsWith('desktop-health')
    ? Response.json({ ...workspace, ...(changeHealth ? { project_root: '/wrong' } : {}), app: 'SignalStudio', client_ready: true })
    : Response.json({ ...graph('a'), workspace: { ...workspace, database_path: '/wrong.db' } }));
  await assert.rejects(state.refresh(), /身份/); assert.equal(state.status, 'identity-error'); assert.equal(state.writable, false);
  changeHealth = false; await assert.rejects(state.refresh(), /身份/); assert.equal(cache.read(), null);
});
test('ambiguous write failure is never replayed and disables further writes until a read confirms state', async context => {
  const state = new LiveGraphSession(null, workspace); let writes = 0;
  context.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    if (options.method === 'POST') { writes++; throw new DOMException('timeout', 'TimeoutError'); }
    return Response.json(url.endsWith('desktop-health') ? { ...workspace, app: 'SignalStudio', client_ready: true } : graph('a'));
  });
  await state.refresh(); await assert.rejects(state.write('/nodes', 'POST', {}));
  assert.equal(writes, 1); assert.equal(state.writable, false);
  await assert.rejects(state.write('/nodes', 'POST', {})); assert.equal(writes, 1);
  await state.refresh(); assert.equal(state.writable, true);
});


test('same-revision review metadata upgrade appears on the first refresh and preserves drafts', async context => {
  const old={...graph('same'),card_progress:{card:{definition_revision:'design',report:null,stale:true}}};
  const current={...old,card_progress:{card:{...old.card_progress.card,schema_version:'card-review.v1',
    status:'unknown',history:[{id:'history',code_revision:'legacy'}]}}};
  context.mock.method(globalThis,'fetch',async (url:string)=>Response.json(url.endsWith('desktop-health')
    ? {...workspace,app:'SignalStudio',client_ready:true}:current));
  for(const dirty of [false,true]) {
    const cache=new GraphCache(storage(),'host');cache.save(workspace,old,new Date().toISOString());
    const state=new LiveGraphSession(cache);state.dirty=dirty;
    assert.equal(await state.refresh(),!dirty);
    if(dirty) {
      assert.equal(state.graph?.card_progress?.card?.history,undefined);
      assert.equal(state.pending?.card_progress?.card?.history?.length,1);
      state.clear();assert.equal(state.receive(state.pending!),true);
    }
    assert.equal(state.graph?.card_progress?.card?.history?.length,1);
  }
});
