import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotMusicCache, type CachedMusic } from '../src/lib/server/bot-cache.js';
import { musicReferencePayload, sendMusic, TelegramRequestError } from '../src/lib/server/bot-media.js';
import { displayTrack } from '../src/lib/server/bot-settings.js';
import type { Track, DownloadJob } from '../src/lib/types.js';

const key = { provider: 'netease' as const, id: '123', quality: 'original-lossless' };
const record: CachedMusic = { fileId: 'telegram-file-123', kind: 'audio', duration: 136, bytes: 123456,
  audioSource: 'netease', audio: { codec: 'FLAC', lossless: true, bitrate: 900000 } };
const track: Track = { id: '123', provider: 'netease', title: '人是猫', artists: ['张卡斯'], album: '音乐', cover: '', durationMs: 136000, sourceUrl: 'https://music.163.com/song?id=123' };

test('cross-user references survive restarts; provider, track, quality and bot identity remain separate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-cache-'));
  try {
    const cache = new BotMusicCache('100', root);
    let uploads = 0, cachedSends = 0;
    assert.equal(await cache.deliver(key, async () => { throw new Error('unexpected hit'); }, async () => { uploads++; return record; }), 'miss');
    const restored = new BotMusicCache('100', root);
    assert.equal(await restored.deliver(key, async (value) => { assert.deepEqual(value, record); cachedSends++; }, async () => { throw new Error('must not download or upload'); }), 'hit');
    assert.equal(uploads, 1); assert.equal(cachedSends, 1);
    for (const selection of [{ ...key, provider: 'spotify' as const }, { ...key, id: '456' }, { ...key, quality: 'mp3' }]) assert.equal(await restored.get(selection), undefined);
    assert.equal(await new BotMusicCache('101', root).get(key), undefined);
    const dir = join(root, 'telegram-media', '100'), [filename] = await readdir(dir);
    const raw = await readFile(join(dir, filename!), 'utf8');
    assert.doesNotMatch(raw, /chatId|userId|caption|title|artists|album|BOT_TOKEN/);
    assert.equal((await stat(join(dir, filename!))).mode & 0o777, 0o600);
    await writeFile(join(dir, filename!), '{invalid'); assert.equal(await restored.get(key), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('simultaneous recipients share one original upload, and failed uploads are never cached', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-cache-'));
  try {
    const cache = new BotMusicCache('100', root);
    let uploads = 0, hits = 0;
    const results = await Promise.all(Array.from({ length: 8 }, () => cache.deliver(key, async () => { hits++; }, async () => {
      uploads++; await new Promise((done) => setTimeout(done, 20)); return record;
    })));
    assert.equal(uploads, 1); assert.equal(hits, 7); assert.equal(results.filter((r) => r === 'miss').length, 1);
    const failed = { ...key, id: 'failure' };
    const outcome = await Promise.allSettled(Array.from({ length: 4 }, () => cache.deliver(failed, async () => {}, async () => {
      uploads++; await new Promise((done) => setTimeout(done, 20)); throw new Error('download failed');
    })));
    assert.ok(outcome.every((r) => r.status === 'rejected')); assert.equal(uploads, 2); assert.equal(await cache.get(failed), undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a definitive expired file ID is refreshed once; network and recipient errors never reupload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-cache-'));
  try {
    const cache = new BotMusicCache('100', root); await cache.put(key, record);
    let uploads = 0;
    const fresh = { ...record, fileId: 'refreshed-id' };
    await Promise.all(Array.from({ length: 4 }, () => cache.deliver(key, async (value) => {
      if (value.fileId === record.fileId) throw new TelegramRequestError(400, 'Bad Request: wrong file identifier/HTTP URL specified');
    }, async () => { uploads++; await new Promise((done) => setTimeout(done, 20)); return fresh; })));
    assert.equal(uploads, 1); assert.equal((await cache.get(key))!.fileId, fresh.fileId);
    for (const error of [new Error('network response lost'), new TelegramRequestError(403, 'Forbidden'), new TelegramRequestError(429, 'Too many requests')]) {
      await assert.rejects(cache.deliver(key, async () => { throw error; }, async () => { uploads++; return record; }));
      assert.equal((await cache.get(key))!.fileId, fresh.fileId);
    }
    assert.equal(uploads, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cached sends contain file_id only, regenerate per-user names and captions, and preserve document type', () => {
  const job: DownloadJob = { ...record, id: 'cached', track, format: 'original', status: 'completed', stage: '', createdAt: '', updatedAt: '' };
  const tc = musicReferencePayload({ chatId: 7, replyTo: 90, job, track: displayTrack(track, 'zh-Hant'), fileId: record.fileId, kind: 'audio', duration: record.duration, uiLanguage: 'en' });
  assert.equal(tc.get('audio'), record.fileId); assert.equal(tc.get('title'), '人是貓'); assert.equal(tc.get('performer'), '張卡斯');
  assert.match(String(tc.get('caption')), /Album：音樂/); assert.equal(tc.has('thumbnail'), false);
  assert.equal(JSON.parse(String(tc.get('reply_markup'))).inline_keyboard.flat().length, 1);
  const sc = musicReferencePayload({ chatId: 8, replyTo: 91, job, track, fileId: record.fileId, kind: 'audio', duration: record.duration, uiLanguage: 'zh-Hans' });
  assert.equal(sc.get('audio'), record.fileId); assert.match(String(sc.get('caption')), /专辑：音乐/);
  assert.equal(sc.get('title'), '人是猫'); assert.equal(sc.get('chat_id'), '8');
  const document = musicReferencePayload({ chatId: 8, replyTo: 91, job, track, fileId: 'document-id', kind: 'document', duration: record.duration });
  assert.equal(document.get('document'), 'document-id'); assert.equal(document.has('audio'), false); assert.equal(document.has('title'), false);
});

test('original upload captures the actual Telegram media type and its reusable identifier', async () => {
  let captured: unknown;
  const result = await sendMusic(async () => ({ document: { file_id: 'file-stored-as-document' } }), {
    chatId: 7, replyTo: 90, track, job: { ...record, id: 'new', track, format: 'original', status: 'completed', stage: '', createdAt: '', updatedAt: '' },
    bytes: new Uint8Array([1, 2, 3]), filename: 'music.flac', duration: 136,
    onDelivered: (kind, message) => { captured = { kind, message }; },
  });
  assert.equal(result, 'document'); assert.deepEqual(captured, { kind: 'document', message: { document: { file_id: 'file-stored-as-document' } } });
});
