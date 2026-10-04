import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DownloadStore } from '../src/lib/server/downloads.js';
import type { Track } from '../src/lib/types.js';

const track: Track = { id: '123', provider: 'netease', title: 'Fixture', artists: ['Test'], album: '', cover: '', durationMs: 2000, sourceUrl: 'https://music.163.com/song?id=123' };
function wav(seconds: number): Buffer {
  const size = 8000 * 2 * seconds;
  const b = Buffer.alloc(44 + size);
  b.write('RIFF'); b.writeUInt32LE(36 + size, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(size, 40);
  return b;
}
async function waitForJob(store: DownloadStore, owner: string) {
  for (let i = 0; i < 100; i++) {
    const job = (await store.list(owner))[0]!;
    if (['failed', 'completed'].includes(job.status)) return job;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('Queue did not finish');
}

test('queue persists real metadata, isolates owners and clears only the owner files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-'));
  try {
    const store = new DownloadStore('test', async (_job, dir) => {
      const file = join(dir, 'audio.wav'); await writeFile(file, wav(2)); return file;
    }, root);
    await store.create('alice', [track], 'original');
    const job = await waitForJob(store, 'alice');
    assert.equal(job.status, 'completed'); assert.ok(job.audio?.codec); assert.equal(job.audio?.sampleRate, 8000);
    assert.equal(job.filename, 'Test - Fixture.wav'); assert.equal('path' in job, false); assert.equal('owner' in job, false);
    assert.deepEqual(await store.list('bob'), []);
    await assert.rejects(store.file('bob', job.id), { code: 'NOT_FOUND' });
    const restored = new DownloadStore('test', undefined, root);
    assert.equal((await restored.list('alice'))[0]?.status, 'completed');
    assert.ok((await restored.file('alice', job.id)).path.endsWith('.wav'));
    await restored.clear('bob'); assert.equal((await restored.list('alice')).length, 1);
    await restored.clear('alice'); assert.deepEqual(await readdir(join(root, 'test')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('short previews fail and their audio files are removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-'));
  try {
    const store = new DownloadStore('test', async (_job, dir) => {
      const file = join(dir, 'audio.wav'); await writeFile(file, wav(1)); return file;
    }, root);
    await store.create('alice', [track], 'original');
    const job = await waitForJob(store, 'alice'); assert.equal(job.status, 'failed');
    assert.match(job.error!, /音源長度不足/);
    assert.deepEqual((await readdir(join(root, 'test'))).filter((p) => !p.endsWith('.json')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});
