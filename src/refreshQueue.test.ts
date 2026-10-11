import test from 'node:test';
import assert from 'node:assert/strict';
import { RefreshQueue } from './refreshQueue';
import { commitURL, versionLabel, uiBuild } from './buildVersion';

test('reconnect reports queued/running immediately and joins a read behind a save', async () => {
  const queue = new RefreshQueue();
  let releaseWrite!: () => void, releaseRead!: () => void;
  const write = new Promise<void>(resolve => { releaseWrite = resolve; });
  const read = new Promise<void>(resolve => { releaseRead = resolve; });
  const phases: string[] = []; let requests = 0;
  const enqueue = (work: () => Promise<void>) => write.then(work);
  const work = async () => { requests++; await read; };
  const changed = () => phases.push(queue.phase);
  const first = queue.run(enqueue, work, changed);
  assert.equal(queue.phase, 'queued');
  assert.equal(first, queue.run(enqueue, work, changed));
  assert.equal(requests, 0);
  releaseWrite(); await write; await Promise.resolve();
  assert.equal(queue.phase, 'connecting'); assert.equal(requests, 1);
  assert.equal(first, queue.run(enqueue, work, changed));
  releaseRead(); await first;
  assert.equal(queue.phase, 'idle'); assert.equal(requests, 1);
  assert.ok(phases.includes('queued')); assert.ok(phases.includes('connecting'));
});
test('a failed read clears progress and permits another attempt', async () => {
  const queue = new RefreshQueue(); let requests = 0;
  const enqueue = (work: () => Promise<void>) => Promise.resolve().then(work);
  const fail = () => { requests++; return Promise.reject(new DOMException('timeout', 'TimeoutError')); };
  await assert.rejects(queue.run(enqueue, fail, () => {}), { name: 'TimeoutError' });
  assert.equal(queue.phase, 'idle');
  await queue.run(enqueue, async () => { requests++; }, () => {});
  assert.equal(requests, 2); assert.equal(queue.phase, 'idle');
});
test('version links require a full Git hash; labels retain unknown and dirty provenance', () => {
  const revision = 'a'.repeat(40);
  assert.equal(commitURL(revision), `https://github.com/lkyxuan/SignalStudio/commit/${revision}`);
  assert.equal(commitURL('latest'), null); assert.equal(commitURL('javascript:alert(1)'), null);
  assert.equal(versionLabel({ revision, dirty: true }, 'zh-CN'), 'aaaaaaa · 本地修改');
  assert.equal(versionLabel({ revision: null, dirty: false }, 'zh-CN'), '未知');
  assert.deepEqual(uiBuild, { revision: null, dirty: false });
});
