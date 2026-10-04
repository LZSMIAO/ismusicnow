import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotDispatch } from '../src/lib/server/bot-dispatch.js';
test('long downloads never block the polling caller; normal requests drain in order within bounded capacity', async () => {
  const queue = new BotDispatch(1, 1), events: string[] = [];
  let finish!: () => void;
  assert.equal(queue.run(async () => { events.push('download'); await new Promise<void>(resolve => finish = resolve); }), true);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(queue.run(async () => { events.push('queued-message'); }), true);
  assert.equal(queue.run(async () => { events.push('overflow'); }), false);
  events.push('inline-can-answer');
  assert.deepEqual(events, ['download', 'inline-can-answer']);
  finish(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(events, ['download', 'inline-can-answer', 'queued-message']);
  assert.equal(queue.run(async () => { events.push('next'); }), true);
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(events.at(-1), 'next');
});
