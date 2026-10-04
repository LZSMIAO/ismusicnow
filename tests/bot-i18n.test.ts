import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botLanguages, botCommands, botError, botHelp, botText, telegramLanguage } from '../src/lib/server/bot-i18n.js';
import { musicPayload, musicReferencePayload, type MusicUpload } from '../src/lib/server/bot-media.js';

test('Telegram IETF tags map to eight UI languages with an English fallback and script precedence', () => {
  for (const [tag, language] of [['zh-Hant', 'zh-Hant'], ['zh_TW', 'zh-Hant'], ['zh-HK', 'zh-Hant'], ['zh-Hans', 'zh-Hans'], ['zh-CN', 'zh-Hans'], ['zh-SG', 'zh-Hans'], ['zh', 'zh-Hans'], ['en-GB', 'en'], ['JA', 'ja'], ['ko-KR', 'ko'], ['es-MX', 'es'], ['fr-CA', 'fr'], ['ru-RU', 'ru'], ['de', 'en'], ['zh-Hant-CN', 'zh-Hant'], ['zh-Hans-TW', 'zh-Hans'], ['zh-MO', 'zh-Hant'], ['it', 'en']] as const) {
    assert.equal(telegramLanguage(tag), language);
  }
  assert.equal(telegramLanguage(), 'en');
});

test('the requested eight UI languages localize help, commands and errors while preserving interpolated metadata', () => {
  assert.deepEqual(botLanguages, ['zh-Hant', 'zh-Hans', 'en', 'ja', 'ko', 'es', 'fr', 'ru']);
  for (const language of botLanguages) {
    const help = botHelp(language), commands = botCommands(language);
    assert.ok(help.length < 4000); assert.equal(commands.length, 13);
    assert.ok(commands.every((c) => c.description.length > 0 && c.description.length <= 256));
    assert.doesNotMatch(help, /\{\w+\}/);
    assert.doesNotMatch(help, /GPL|warranty|擔保|担保|adapter|適配器|适配器/);
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
    assert.ok(String(form.get('reply_markup')).includes(botText(language, 'source')));
    assert.equal(JSON.parse(String(form.get('reply_markup'))).inline_keyboard.flat().length, 1);
    assert.doesNotMatch(String(form.get('reply_markup')), /open-settings/);
    assert.doesNotMatch(String(form.get('reply_markup')), /中文顯示字形/);
  }
});

test('group instructions and both fresh/cached captions use the active bot identity', () => {
  for (const language of botLanguages) {
    assert.ok(botHelp(language, true, 'another_music_bot').includes('/search@another_music_bot'));
    assert.doesNotMatch(botHelp(language, true, 'another_music_bot'), /muismbot|ismusicnow_bot|\{botUsername\}/);
  }
  const track = { id: '123', provider: 'netease' as const, title: '床', artists: ['草東沒有派對'], album: '醜奴兒', cover: '', durationMs: 1000, sourceUrl: 'https://music.163.com/song?id=123' };
  const job = { id: 'job', track, format: 'original' as const, status: 'completed' as const, stage: '', createdAt: '', updatedAt: '', audioSource: 'netease' as const };
  const identity = { chatId: 1, replyTo: 2, track, job, duration: 1, botUsername: 'another_music_bot' };
  for (const form of [musicPayload({ ...identity, bytes: new Uint8Array([1]), filename: '床.flac' }), musicReferencePayload({ ...identity, fileId: 'cached-audio', kind: 'audio' })]) {
    assert.match(String(form.get('caption')), /via @another_music_bot/);
    assert.doesNotMatch(String(form.get('caption')), /via @muismbot|via @ismusicnow_bot/);
  }
});
