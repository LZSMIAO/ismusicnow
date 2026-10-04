import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioRange } from '../src/lib/server/audio-range.js';

test('audio seeking accepts bounded, open-ended and suffix ranges', () => {
  assert.deepEqual(audioRange('bytes=100-199', 1000), { start: 100, end: 199 });
  assert.deepEqual(audioRange('bytes=500-', 1000), { start: 500, end: 999 });
  assert.deepEqual(audioRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(audioRange('bytes=-2000', 1000), { start: 0, end: 999 });
  assert.deepEqual(audioRange('bytes=100-2000', 1000), { start: 100, end: 999 });
});
test('malformed and unsatisfiable audio ranges return no range', () => {
  for (const header of ['bytes=-', 'bytes=-0', 'bytes=1000-', 'bytes=20-10', 'bytes=0-1,3-4', 'items=0-10', 'bytes=9007199254740992-', 'bytes=0-9007199254740992']) assert.equal(audioRange(header, 1000), null, header);
  assert.equal(audioRange('bytes=0-', 0), null);
});
