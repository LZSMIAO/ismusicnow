import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botLanguages, botCommands, botError, botHelp, botText } from '../src/lib/server/bot-i18n.js';
import { musicPayload, type MusicUpload } from '../src/lib/server/bot-media.js';

test('the requested eight UI languages localize help, commands and errors while preserving interpolated metadata', () => {
  assert.deepEqual(botLanguages, ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'es', 'fr', 'ru']);
  for (const language of botLanguages) {
    const help = botHelp(language), commands = botCommands(language);
    assert.ok(help.length < 4000); assert.equal(commands.length, 9);
    assert.ok(commands.every((c) => c.description.length > 0 && c.description.length <= 256));
    assert.doesNotMatch(help, /\{\w+\}/);
    const progress = botText(language, 'fetching', { title: '張卡斯 / 米津玄師 {source}', source: 'spotify' });
    assert.ok(progress.includes('張卡斯 / 米津玄師 {source}'));
    assert.ok(botError(language, 'SPOTIFY_COOKIES').includes('Spotify'));
    assert.equal(botError(language, 'UNRECOGNIZED'), botText(language, 'serviceError'));
  }
  assert.match(botHelp('zh-Hans'), /网易云/); assert.doesNotMatch(botHelp('zh-Hans'), /網易雲/);
  assert.match(botError('en', 'SPOTIFY_COOKIES'), /administrator.*cookies/);
  assert.match(botCommands('ru').find((c) => c.command === 'settings')!.description, /Язык/);
});

test('localized music captions and buttons never change source names, file names or audio bytes', async () => {
  const track = { id: '123', provider: 'spotify' as const, title: '張卡斯 / 米津玄師', artists: ['張卡斯', '米津玄師'], album: '音樂 / 海の幽霊', cover: '', durationMs: 2000, sourceUrl: 'https://open.spotify.com/track/123' };
  const upload: MusicUpload = { chatId: 7, replyTo: 90, track, job: { id: 'job', track, format: 'original', status: 'completed', stage: '', createdAt: '', updatedAt: '', audioSource: 'spotify' }, bytes: new Uint8Array([1, 2, 3]), filename: '張卡斯 - 音樂.ogg', duration: 2 };
  for (const language of botLanguages) {
    const form = musicPayload({ ...upload, uiLanguage: language });
    assert.equal(form.get('title'), track.title); assert.equal(form.get('performer'), track.artists.join(' / '));
    assert.ok(String(form.get('caption')).includes(track.album));
    assert.equal((form.get('audio') as File).name, upload.filename);
    assert.deepEqual(new Uint8Array(await (form.get('audio') as File).arrayBuffer()), upload.bytes);
    assert.ok(String(form.get('reply_markup')).includes(botText(language, 'settings')));
    assert.doesNotMatch(String(form.get('reply_markup')), /中文顯示字形/);
  }
});
