import test from 'node:test';
import assert from 'node:assert/strict';
import { createCardClickDispatcher } from './cardClicks';

test('single click opens details only after the double-click window', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clicks = createCardClickDispatcher(), events: string[] = [];
  clicks.single(() => events.push('details'));
  t.mock.timers.tick(349); assert.deepEqual(events, []);
  t.mock.timers.tick(1); assert.deepEqual(events, ['details']);
});

test('double click cancels both click events without flashing details', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clicks = createCardClickDispatcher(), events: string[] = [];
  clicks.single(() => events.push('details'));
  t.mock.timers.tick(200);
  clicks.single(() => events.push('details'), 2);
  clicks.double(() => events.push('route'));
  t.mock.timers.tick(1000); assert.deepEqual(events, ['route']);
});

test('a newer card replaces pending details; drag/pane/context cleanup cancels', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clicks = createCardClickDispatcher(), events: string[] = [];
  clicks.single(() => events.push('old'));
  t.mock.timers.tick(100);
  clicks.single(() => events.push('new'));
  t.mock.timers.tick(350); assert.deepEqual(events, ['new']);
  clicks.single(() => events.push('cancelled'));
  clicks.cancel(); clicks.cancel();
  t.mock.timers.tick(1000); assert.deepEqual(events, ['new']);
});
