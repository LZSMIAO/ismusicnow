import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotAudioNames, cachedMusicPath, namedMusicCacheKey } from '../src/lib/server/bot-audio-names.js';
import { BotMusicCache, type CachedMusic } from '../src/lib/server/bot-cache.js';
import { displayTrack } from '../src/lib/server/bot-settings.js';
import type { Track } from '../src/lib/types.js';

const track: Track = { provider: 'spotify', id: '0SHrmvOJ3Sn10j1oHxFepC', title: '金银', artists: ['卦者靈风'], album: '金银', durationMs: 200000, cover: '', sourceUrl: 'https://open.spotify.com/track/0SHrmvOJ3Sn10j1oHxFepC' };
const source: CachedMusic = { fileId: 'original-source', kind: 'audio', duration: 200, bytes: 12, audioSource: 'spotify', audio: { codec: 'FLAC', lossless: true, sampleRate: 44100, bitsPerSample: 16 } };

test('named audio coalesces uploads, keeps original and spelling/quality variants separate, and retains lossless metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-names-test-'));
  try {
    const path = join(root, 'names.flac'); await writeFile(path, 'audio-stream');
    const cache = new BotMusicCache('999', root);
    const rawKey = { provider: track.provider, id: track.id, quality: 'original' };
    await cache.put(rawKey, source);
    let preparations = 0, uploads = 0, releases = 0;
    const names = new BotAudioNames(cache, async (method, body) => {
      assert.equal(method, 'sendAudio'); const form = body as FormData; uploads++;
      assert.equal(form.has('reply_markup'), false); assert.equal(form.get('disable_notification'), 'true');
      assert.equal((form.get('audio') as File).type, 'audio/flac');
      assert.equal(Buffer.from(await (form.get('audio') as File).arrayBuffer()).toString(), 'audio-stream');
      assert.match(String(form.get('caption')), /#flac/);
      return { audio: { file_id: `names-${uploads}`, title: form.get('title'), performer: form.get('performer') } };
    }, () => -10042, () => 'muismbot', async original => {
      preparations++; return { path, audio: original.audio!, duration: original.duration, thumbnail: new Uint8Array([1]), release: async () => { releases++; } };
    });
    const tc = displayTrack(track, 'zh-Hant'), sc = displayTrack(track, 'zh-Hans');
    const [first, simultaneous] = await Promise.all([names.get(track, tc, source), names.get(track, tc, source)]);
    assert.deepEqual(first, simultaneous); assert.equal(uploads, 1); assert.equal(preparations, 1); assert.equal(releases, 1);
    assert.equal(first.names?.title, '金銀'); assert.equal(first.names?.performer, '卦者靈風'); assert.deepEqual(first.audio, source.audio);
    assert.equal((await names.get(track, track, source)).fileId, source.fileId);
    const simplified = await names.get(track, sc, source);
    assert.notEqual(simplified.fileId, first.fileId); assert.equal(simplified.names?.performer, '卦者灵风');
    assert.equal((await new BotAudioNames(cache, async () => { throw Error('Must not upload'); }, () => -10042, () => 'muismbot').peek(track, tc, source))?.fileId, first.fileId);
    const otherQuality = { ...source, fileId: 'other-original-quality' };
    assert.notDeepEqual(namedMusicCacheKey(track, tc, otherQuality), namedMusicCacheKey(track, tc, source));
    await names.invalidate(track, first);
    assert.equal(await names.peek(track, tc, source), undefined);
    assert.equal((await names.peek(track, sc, source))?.fileId, simplified.fileId);
    assert.deepEqual(await cache.get(rawKey), source);
    assert.equal((await readFile(path, 'utf8')), 'audio-stream');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('incorrect Telegram player names never become reusable spelling references and temporary resources are released', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-names-failure-'));
  try {
    const path = join(root, 'names.flac'); await writeFile(path, 'audio-stream');
    const cache = new BotMusicCache('999', root); let released = 0;
    const names = new BotAudioNames(cache, async () => ({ audio: { file_id: 'ignored-names', title: track.title, performer: track.artists.join(' / ') } }), () => -10042, () => 'muismbot',
      async () => ({ path, audio: source.audio!, duration: 200, release: async () => { released++; } }));
    const tc = displayTrack(track, 'zh-Hant');
    await assert.rejects(names.get(track, tc, source), /Named audio was not accepted/);
    assert.equal(released, 1); assert.equal(await names.peek(track, tc, source), undefined);
    assert.deepEqual(await names.get(track, tc, { ...source, kind: 'document' }), { ...source, kind: 'document' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('local cached music reads only the configured bot music mount and validates its file size', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-music-path-'));
  try {
    await writeFile(join(root, 'file_1.flac'), 'audio-stream');
    const env = { BOT_API_LOCAL: '1', BOT_API_BASE_URL: 'http://telegram-api:8081', BOT_API_MUSIC_DIR: root, BOT_TOKEN: '999:test' };
    const lookup = (path: string) => async () => ({ file_path: path });
    assert.equal(await cachedMusicPath(source, lookup('/var/lib/telegram-bot-api/999:test/music/file_1.flac'), root, env), await realpath(join(root, 'file_1.flac')));
    for (const path of ['/var/lib/telegram-bot-api/other/music/file_1.flac', '/var/lib/telegram-bot-api/999:test/music/../database.bin']) {
      await assert.rejects(cachedMusicPath(source, lookup(path), root, env), /Local music cache is unavailable/);
    }
    await assert.rejects(cachedMusicPath({ ...source, bytes: 13 }, lookup('/var/lib/telegram-bot-api/999:test/music/file_1.flac'), root, env), /Cached music is incomplete/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
