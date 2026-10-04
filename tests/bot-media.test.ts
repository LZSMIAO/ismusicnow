import { test } from 'node:test';
import assert from 'node:assert/strict';
import { musicCaption, sendMusic, TelegramRequestError, coverUrl, type MusicUpload } from '../src/lib/server/bot-media.js';

const upload: MusicUpload = {
  chatId: 7, replyTo: 90, filename: '張卡斯 - 人是貓.flac', duration: 136, bytes: new Uint8Array([102, 76, 97, 67]), thumbnail: new Uint8Array([255, 216, 255]),
  track: { id: '123', provider: 'netease', title: '人是貓', artists: ['張卡斯', '洛天依'], album: '人是貓', cover: '', durationMs: 136000, sourceUrl: 'https://music.163.com/song?id=123' },
  job: { id: 'job', track: {} as MusicUpload['track'], format: 'original', status: 'completed', stage: '', createdAt: '', updatedAt: '', audioSource: 'netease', bytes: 27486620,
    audio: { codec: 'FLAC', bitrate: 1543790, sampleRate: 48000, bitsPerSample: 16, lossless: true } },
};

test('FLAC uses a music upload with unchanged bytes, album, cover, duration and original-message reply', async () => {
  const methods: string[] = [];
  const result = await sendMusic(async (method, form) => {
    methods.push(method);
    const file = form.get('audio') as File;
    assert.equal(file.type, 'audio/flac'); assert.equal(file.name, upload.filename);
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), upload.bytes);
    assert.equal(form.get('title'), '人是貓'); assert.equal(form.get('performer'), '張卡斯 / 洛天依'); assert.equal(form.get('duration'), '136');
    assert.equal((form.get('thumbnail') as File).type, 'image/jpeg');
    assert.deepEqual(JSON.parse(String(form.get('reply_parameters'))), { message_id: 90, allow_sending_without_reply: true });
    assert.match(String(form.get('caption')), /專輯：人是貓/); assert.match(String(form.get('reply_markup')), /https:\/\/music.163.com\/song\?id=123/);
  }, upload);
  assert.equal(result, 'audio'); assert.deepEqual(methods, ['sendAudio']);
});
test('definitive format rejection falls back to the same original file with its album caption', async () => {
  const methods: string[] = [];
  const result = await sendMusic(async (method, form) => {
    methods.push(method);
    if (method === 'sendAudio') throw new TelegramRequestError(400, 'Bad Request: AUDIO_CONTENT_TYPE_INVALID');
    const file = form.get('document') as File;
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), upload.bytes);
    assert.match(String(form.get('caption')), /專輯：人是貓/);
  }, upload);
  assert.equal(result, 'document'); assert.deepEqual(methods, ['sendAudio', 'sendDocument']);
});
test('thumbnail rejection retries audio without a cover; network failures never duplicate an upload', async () => {
  let count = 0;
  assert.equal(await sendMusic(async (_method, form) => {
    if (++count === 1) throw new TelegramRequestError(400, 'Bad Request: invalid thumbnail');
    assert.equal(form.has('thumbnail'), false);
  }, upload), 'audio');
  count = 0;
  await assert.rejects(sendMusic(async () => { count++; throw new Error('Connection lost after upload'); }, upload));
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(sendMusic(async () => { count++; throw new TelegramRequestError(403, 'Forbidden'); }, upload));
  assert.equal(count, 1);
  assert.equal(await sendMusic(async () => ({ document: { file_id: 'accepted-as-document' } }), upload), 'document');
});
test('caption respects Telegram limits and cover downloads are restricted to platform image CDNs', () => {
  assert.ok(musicCaption({ ...upload.track, title: '貓'.repeat(2000), album: '曲'.repeat(2000) }, upload.job).length <= 1024);
  assert.equal(coverUrl('https://p1.music.126.net/cover.jpg').hostname, 'p1.music.126.net');
  for (const raw of ['https://127.0.0.1/cover', 'https://music.126.net.evil.example/a', 'http://p1.music.126.net/a', 'https://user:pass@i.scdn.co/a']) assert.throws(() => coverUrl(raw));
});
