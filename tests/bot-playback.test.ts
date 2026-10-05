import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotPlayback } from '../src/lib/server/bot-playback.js';
import { BotMusicCache } from '../src/lib/server/bot-cache.js';
import { musicCacheKey, telegramPlaybackKey } from '../src/lib/server/bot-cache-key.js';
import type { DownloadJob, Track } from '../src/lib/types.js';
const track: Track = { provider: 'spotify', id: '0123456789012345678901', title: 'Song', artists: ['Artist'], album: 'Album', cover: '', durationMs: 1000, sourceUrl: 'https://open.spotify.com/track/0123456789012345678901' };
const mp3 = { codec: 'MPEG 1 Layer 3', bitrate: 320000, lossless: false };
async function fixture(chat: number | undefined = -10042, song = track, nativeDocument = false, audio?: DownloadJob['audio']) {
  const root = await mkdtemp(join(tmpdir(), 'muism-playback-test-')), original = join(root, 'source.ogg'), derivative = join(root, 'playback.mp3');
  await writeFile(original, 'original-vorbis-bytes'); await writeFile(derivative, 'mp3-playback-bytes');
  const job: DownloadJob = { id: 'job', track: song, audioSource: song.provider, format: 'original', status: 'completed', stage: '', bytes: 21, audio: audio || { codec: song.provider === 'netease' ? 'FLAC' : 'Vorbis I', bitrate: 320000, lossless: song.provider === 'netease' }, createdAt: '', updatedAt: '' };
  const uploads: { method: string; form: FormData }[] = [];
  const counts = { create: 0, removed: 0, prepared: 0, released: 0 };
  const cache = new BotMusicCache('999', root);
  const store = { create: async () => { counts.create++; return [job]; }, list: async () => [job], file: async () => ({ path: original }), remove: async () => { counts.removed++; } };
  const playback = new BotPlayback(store as any, cache, async (method, form) => { uploads.push({ method, form }); const kind = method === 'sendAudio' && !(nativeDocument && uploads.length === 1) ? 'audio' : 'document'; return { [kind]: { file_id: kind + '-id-' + uploads.length } }; }, () => chat, () => 'muismbot', async (_path, input) => { counts.prepared++; return { path: derivative, job: { ...input, audio: mp3, bytes: 18, presentation: 'telegram-playback' }, release: async () => { counts.released++; } }; }, async () => ({ duration: 1 }));
  return { root, cache, playback, counts, uploads, original };
}
test('concurrent playback requests upload once, preserve source bytes and keep original and derivative IDs separate', async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.playback.get(track), f.playback.get(track)]);
    assert.deepEqual(a, b); assert.equal(a.kind, 'audio'); assert.equal(a.presentation, 'telegram-playback'); assert.equal(a.audioSource, 'spotify');
    assert.equal(f.counts.create, 1); assert.equal(f.counts.prepared, 1); assert.equal(f.counts.removed, 1); assert.equal(f.counts.released, 1);
    assert.deepEqual(f.uploads.map(x => x.method), ['sendDocument', 'sendAudio']);
    assert.ok(f.uploads.every(x => x.form.get('chat_id') === '-10042' && x.form.get('disable_notification') === 'true'));
    assert.ok(f.uploads.every(x => !x.form.has('reply_markup')), 'cache channel uploads cannot contain inline-query buttons');
    assert.equal(await readFile(f.original, 'utf8'), 'original-vorbis-bytes');
    assert.equal(await (f.uploads[0]!.form.get('document') as Blob).text(), 'original-vorbis-bytes');
    assert.equal(await (f.uploads[1]!.form.get('audio') as Blob).text(), 'mp3-playback-bytes');
    assert.equal((f.uploads[0]!.form.get('document') as Blob).type, 'audio/ogg');
    assert.equal((f.uploads[1]!.form.get('audio') as Blob).type, 'audio/mpeg');
    assert.doesNotMatch(String(f.uploads[0]!.form.get('caption')), /MP3 conversion/);
    assert.match(String(f.uploads[1]!.form.get('caption')), /MP3 conversion/);
    const key = await musicCacheKey(track), source = await f.cache.get(key), playback = await f.cache.get(telegramPlaybackKey(key));
    assert.equal(source?.kind, 'document'); assert.equal(source?.audio?.codec, 'Vorbis I'); assert.notEqual(source?.fileId, playback?.fileId);
    await f.playback.get(track); assert.equal(f.uploads.length, 2, 'cache hits perform neither source download nor Telegram upload');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('original MP3 audio is reused without a channel, conversion or quality relabelling', async () => {
  const f = await fixture(undefined);
  try {
    const key = await musicCacheKey(track), source = { kind: 'audio' as const, fileId: 'native-source-mp3', duration: 1, bytes: 100, audioSource: 'spotify' as const, audio: mp3 };
    await f.cache.put(key, source);
    assert.deepEqual(await f.playback.get(track), source); assert.equal(f.counts.create, 0); assert.equal(f.uploads.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('missing cache destination fails before starting a download', async () => {
  const f = await fixture(0);
  try {
    await assert.rejects(f.playback.get(track), (error: any) => error.code === 'INLINE_CACHE_SETUP'); assert.equal(f.counts.create, 0); assert.equal(f.uploads.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('invalidating a playback reference preserves the independent original-file cache', async () => {
  const f = await fixture();
  try {
    const record = await f.playback.get(track), key = await musicCacheKey(track);
    await f.playback.invalidate(track, record);
    assert.equal(await f.cache.get(telegramPlaybackKey(key)), undefined); assert.equal((await f.cache.get(key))?.audio?.codec, 'Vorbis I');
    await f.playback.get(track); assert.equal(f.uploads.length, 3, 'original file must not be uploaded again');
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

const netease: Track = { ...track, provider: 'netease', id: '411314656', sourceUrl: 'https://music.163.com/song?id=411314656' };
test('native NetEase requests preserve audio FLAC while sharing the original cache across requests', async () => {
  const f = await fixture(-10042, netease);
  try {
    const [a, b] = await Promise.all([f.playback.get(netease, true), f.playback.get(netease, true)]);
    assert.deepEqual(a, b); assert.equal(a.kind, 'audio'); assert.equal(a.audio?.codec, 'FLAC'); assert.equal(a.presentation, undefined);
    assert.equal(f.counts.create, 1); assert.equal(f.counts.prepared, 0); assert.equal(f.counts.removed, 1);
    assert.deepEqual(f.uploads.map(x => x.method), ['sendAudio']);
    assert.ok(f.uploads.every(x => x.form.get('chat_id') === '-10042'));
    await f.playback.get(netease, true); assert.equal(f.uploads.length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('legacy NetEase documents are refreshed as original FLAC audio instead of forcing an old MP3 derivative', async () => {
  const f = await fixture(-10042, netease);
  try {
    const key = await musicCacheKey(netease);
    const original = { fileId: 'original-document', kind: 'document' as const, duration: 1, bytes: 21, audioSource: 'netease' as const, audio: { codec: 'FLAC', lossless: true } };
    await f.cache.put(key, original);
    const a = await f.playback.get(netease, true);
    assert.equal(a.kind, 'audio'); assert.equal(a.presentation, undefined); assert.ok(a.audio?.lossless);
    assert.deepEqual(await f.cache.get(key), a); assert.equal(f.counts.prepared,0);
    assert.deepEqual(await f.playback.get(netease, true), a);
    assert.deepEqual(f.uploads.map(x => x.method), ['sendAudio']); assert.equal(f.counts.create, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('a newly downloaded original falling back to document prepares playback once in the cache channel', async () => {
  const f = await fixture(-10042, netease, true);
  try {
    const [a, b] = await Promise.all([f.playback.get(netease, true), f.playback.get(netease, true)]);
    assert.deepEqual(a, b); assert.equal(a.kind, 'audio'); assert.equal(a.presentation, 'telegram-playback');
    const key = await musicCacheKey(netease);
    assert.equal((await f.cache.get(key))?.kind, 'document'); assert.notEqual((await f.cache.get(key))?.fileId, a.fileId);
    assert.equal(f.counts.create, 1); assert.equal(f.counts.prepared, 1); assert.equal(f.counts.released, 1); assert.equal(f.counts.removed, 1);
    assert.equal(f.uploads.length, 2); assert.ok(f.uploads.every(x => x.form.get('chat_id') === '-10042'));
    await f.playback.get(netease, true); assert.equal(f.uploads.length, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('non-NetEase FLAC and M4A keep accepted original audio without an MP3 derivative', async () => {
  for (const audio of [{ codec: 'FLAC', lossless: true }, { codec: 'AAC', lossless: false }]) {
    const f = await fixture(-10042, track, false, audio);
    try {
      const a = await f.playback.get(track);
      assert.equal(a.kind, 'audio'); assert.deepEqual(a.audio, audio); assert.equal(a.presentation, undefined);
      assert.equal(f.counts.prepared, 0); assert.deepEqual(f.uploads.map(x => x.method), ['sendAudio']);
      assert.deepEqual(await f.playback.get(track), a); assert.equal(f.counts.create, 1);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
