import test from 'node:test';
import assert from 'node:assert/strict';
import { retryGraphConnection } from './graphRecovery';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

test('confirmed workspace has no timed graph reads', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let reads = 0;
  const stop = retryGraphConnection(() => false, () => true, async () => { reads++; });
  t.mock.timers.tick(60_000); await flush();
  assert.equal(reads, 0); stop();
});
test('failed connection retries and stops immediately after confirmation', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let reads = 0, disconnected = true;
  const stop = retryGraphConnection(() => disconnected, () => true, async () => {
    reads++; if (reads === 2) disconnected = false;
  });
  t.mock.timers.tick(4999); await flush(); assert.equal(reads, 0);
  t.mock.timers.tick(1); await flush(); assert.equal(reads, 1);
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 2);
  t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 2); stop();
});
test('hidden workspace waits; overlapping recovery reads are serialized', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let visible = false, reads = 0;
  let finish!: () => void;
  const stop = retryGraphConnection(() => true, () => visible, async () => {
    reads++; await new Promise<void>(resolve => { finish = resolve; });
  });
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 0);
  visible = true;
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 1);
  t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 1);
  finish(); await flush();
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 2);
  stop(); finish(); await flush();
  t.mock.timers.tick(60_000); await flush(); assert.equal(reads, 2);
});
test('cleanup cancels queued recovery and a focus recovery can stop a pending timer', async t => {
  t.mock.timers.enable({apis:['setTimeout']});
  let reads = 0, disconnected = true;
  const stop = retryGraphConnection(() => disconnected, () => true, async () => { reads++; });
  disconnected = false;
  t.mock.timers.tick(5000); await flush(); assert.equal(reads, 0);
  const cancel = retryGraphConnection(() => true, () => true, async () => { reads++; });
  cancel(); t.mock.timers.tick(5000); await flush(); assert.equal(reads, 0); stop();
});
