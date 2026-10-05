import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/lib/server/config.js';
import { searchMyhk } from '../src/lib/server/providers/myhk.js';
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
async function waitForJob(store: DownloadStore, owner: string, root: string) {
  for (let i = 0; i < 100; i++) {
    const job = (await store.list(owner))[0]!;
    if (['failed', 'completed'].includes(job.status)) {
      // Wait for the terminal state to reach disk before simulating a restart.
      const persisted = JSON.parse(await readFile(join(root, 'test', `${job.id}.json`), 'utf8'));
      if (persisted.status === job.status) return job;
    }
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
    const job = await waitForJob(store, 'alice', root);
    assert.equal(job.status, 'completed', job.error); assert.ok(job.audio?.codec); assert.equal(job.audio?.sampleRate, 8000);
    assert.equal(job.filename, 'Test - Fixture.wav'); assert.equal('path' in job, false); assert.equal('owner' in job, false);
    assert.deepEqual(await store.list('bob'), []);
    await assert.rejects(store.file('bob', job.id), { code: 'NOT_FOUND' });
    const restored = new DownloadStore('test', undefined, root);
    assert.equal((await restored.list('alice'))[0]?.status, 'completed');
    assert.ok((await restored.file('alice', job.id)).path.endsWith('.wav'));
    await restored.clear('bob'); assert.equal((await restored.list('alice')).length, 1);
    await restored.remove('bob', job.id); assert.equal((await restored.list('alice')).length, 1);
    await restored.remove('alice', job.id); assert.deepEqual(await readdir(join(root, 'test')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('short previews fail and their audio files are removed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-'));
  try {
    const store = new DownloadStore('test', async (_job, dir) => {
      const file = join(dir, 'audio.wav'); await writeFile(file, wav(1)); return file;
    }, root);
    await store.create('alice', [track], 'original');
    const job = await waitForJob(store, 'alice', root); assert.equal(job.status, 'failed');
    assert.match(job.error!, /音源長度不足/); assert.equal(job.errorCode, 'INCOMPLETE_AUDIO');
    assert.equal((await new DownloadStore('test', undefined, root).list('alice'))[0]?.errorCode, 'INCOMPLETE_AUDIO');
    assert.deepEqual((await readdir(join(root, 'test'))).filter((p) => !p.endsWith('.json')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bot download ceilings reach the executor and fail with a size error; web defaults remain independent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-ceiling-'));
  const fileBytes = wav(2);
  try {
    let ceiling = 0;
    const limited = new DownloadStore('test', async (_job, dir, limit) => {
      ceiling = limit; const file = join(dir, 'audio.wav'); await writeFile(file,fileBytes); return file;
    }, root, fileBytes.length - 1);
    await limited.create('limited',[track],'original');
    const failed = await waitForJob(limited,'limited',root);
    assert.equal(ceiling,fileBytes.length-1); assert.equal(failed.errorCode,'FILE_TOO_LARGE');
    const normal = new DownloadStore('test',async (_job,dir) => { const file=join(dir,'audio.wav'); await writeFile(file,fileBytes); return file; },root);
    await normal.create('normal',[track],'original');
    assert.equal((await waitForJob(normal,'normal',root)).status,'completed');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('unavailable new sources use only the same native recording and persist its actual source', async () => {
  const previousFetch = globalThis.fetch, previousKey = config.myhkApiKey, previousApi = config.neteaseApiUrl;
  config.myhkApiKey = 'fixture-key'; config.neteaseApiUrl = 'https://native.test/';
  const root = await mkdtemp(join(tmpdir(), 'muism-recording-fallback-'));
  try {
    for (const [index, variation] of ['match', 'artist', 'album', 'duration', 'title'].entries()) {
      const id = `0003T91h4Wg24${index}`;
      let audioRequests = 0;
      globalThis.fetch = (async (url, options) => {
        const address = String(url);
        if (address.includes('myhkw.cn')) {
          if (address.endsWith('/search')) return Response.json({code:0,data:{song:{list:[{songmid:id,songname:'Song',singer:[{name:'Artist'}],albumname:'Release',interval:2}]}}});
          return Response.json({code:0,data:''});
        }
        if (address.includes('/cloudsearch')) return Response.json({code:200,result:{songs:[{id:987,name:variation==='title'?'Song (Live)':'Song',ar:[{id:88,name:variation==='artist'?'Cover Artist':'Artist'}],al:{id:66,name:variation==='album'?'Other release':'Release'},dt:variation==='duration'?4500:2000}]}});
        if (address.includes('/song/url/v1')) return Response.json({code:200,data:[{url:'https://m801.music.126.net/fallback.mp3',type:'mp3'}]});
        audioRequests++; return new Response(new Uint8Array(wav(2)));
      }) as typeof fetch;
      const selected = (await searchMyhk(`fallback-${variation}`, 'qq')).tracks[0]!;
      const store = new DownloadStore('test', undefined, root);
      await store.create(variation, [selected], 'original');
      const job = await waitForJob(store, variation, root);
      if (variation === 'match') {
        assert.equal(job.status, 'completed', job.error); assert.equal(job.audioSource, 'netease');
        assert.equal(job.track.provider, 'qq'); assert.equal(job.audioTrack?.id, '987');
        assert.equal(job.audioTrack?.sourceUrl, 'https://music.163.com/song?id=987'); assert.equal(audioRequests, 1);
        const restored = (await new DownloadStore('test', undefined, root).list(variation))[0]!;
        assert.equal(restored.audioSource, 'netease'); assert.equal(restored.audioTrack?.id, '987');
      } else { assert.equal(job.status, 'failed'); assert.equal(job.errorCode, 'NO_AUDIO'); assert.equal(audioRequests, 0); }
    }
  } finally {
    globalThis.fetch = previousFetch; config.myhkApiKey = previousKey; config.neteaseApiUrl = previousApi;
    await rm(root, { recursive: true, force: true });
  }
});

test('a primary 30-second preview cannot bypass missing or known full-length metadata', async () => {
  const previousFetch = globalThis.fetch, previousKey = config.myhkApiKey, previousApi = config.neteaseApiUrl;
  config.myhkApiKey = 'preview-fixture-key'; config.neteaseApiUrl = 'https://native.test/';
  const root = await mkdtemp(join(tmpdir(), 'muism-preview-'));
  try {
    for (const verified of [true, false]) {
      globalThis.fetch = (async url => {
        const address = String(url);
        if (address.includes('myhkw.cn')) return Response.json({code:1,data:'https://m801.music.126.net/preview.mp3'});
        if (address.includes('/song/url/v1')) return Response.json({code:200,data:[{url:'https://m801.music.126.net/trial.mp3',type:'mp3',freeTrialInfo:{start:0,end:30}}]});
        if (address.includes('/song/detail')) return Response.json({code:200,songs:verified?[{id:verified?991:992,name:'Song',dt:180000}]:[]});
        return new Response(new Uint8Array(wav(30)));
      }) as typeof fetch;
      const owner = verified ? 'known-preview' : 'unverified-preview';
      const store = new DownloadStore('test', undefined, root);
      await store.create(owner, [{...track,id:verified?'991':'992',durationMs:0}], 'original');
      const job = await waitForJob(store, owner, root);
      assert.equal(job.status,'failed'); assert.equal(job.errorCode,'INCOMPLETE_AUDIO');
    }
  } finally { globalThis.fetch = previousFetch; config.myhkApiKey = previousKey; config.neteaseApiUrl = previousApi; await rm(root,{recursive:true,force:true}); }
});
