import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Exercise the actual bot handler with an isolated DATA_DIR and a fully stubbed
// network. This never sends messages to real users or starts long polling.
test('plain text → reply/pagination → numeric or owned callback selection → cached audio → delayed deletion; failed inputs survive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-handler-'));
  const env = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
  let now = realNow(), nextMessage = 1000, failDelivery = false;
  Date.now = () => now;
  process.env.DATA_DIR = root; process.env.BOT_TOKEN = '999000:stub'; process.env.BOT_ALLOWED_USERS = '';
  process.env.NETEASE_API_URL = 'https://metadata.example.test/'; process.env.NETEASE_COOKIE = ''; process.env.MUSIC_U = '';
  const calls: { method: string; body: Record<string, any> }[] = [];
  const songs = Array.from({ length: 10 }, (_, i) => ({ id: 10000 + i, name: `歌曲 ${i + 1}`, ar: [{ name: '草東沒有派對' }], al: { name: '醜奴兒' }, dt: 150000 }));
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body || '{}'));
    for (const key of ['reply_parameters', 'reply_markup']) if (typeof body[key] === 'string') body[key] = JSON.parse(body[key]);
    if (address.startsWith('https://metadata.example.test/')) {
      assert.ok(address.endsWith('/cloudsearch') || address.endsWith('/song/detail'));
      return Response.json(address.endsWith('/song/detail') ? { code: 200, songs: [songs[0]] } : { code: 200, result: { songs: body.keywords === 'missing' ? [] : songs, songCount: 12 } });
    }
    assert.ok(address.startsWith('https://api.telegram.org/bot999000:stub/'), 'all network requests must stay stubbed');
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    if (method === 'sendAudio' && failDelivery) return Response.json({ ok: false, error_code: 403, description: 'blocked' });
    return Response.json({ ok: true, result: method === 'sendMessage' || method === 'sendAudio' ? { message_id: ++nextMessage } : true });
  };
  try {
    const { BotMusicCache } = await import('../src/lib/server/bot-cache.js');
    const { BotSettingsStore } = await import('../src/lib/server/bot-settings.js');
    const { BotMessageCleanup } = await import('../src/lib/server/bot-cleanup.js');
    const cache = new BotMusicCache('999000');
    for (const song of songs) await cache.put({ provider: 'netease', id: String(song.id), quality: 'original-lossless' }, { fileId: `cached:${song.id}`, kind: 'audio', duration: 150, bytes: 1234, audioSource: 'netease' });
    await new BotSettingsStore().choose(42, 'original');
    const { handle } = await import('../scripts/bot.js');
    const message = async (id: number, text: string, user = 42, chatId = 7, type = 'private') => {
      now += 3100;
      await handle({ update_id: id, message: { message_id: id, chat: { id: chatId, type }, from: { id: user, language_code: 'de' }, text } });
    };
    const callback = async (data: string, menuId: number, user = 42) => {
      now += 1000;
      await handle({ update_id: 500, callback_query: { id: 'stub', from: { id: user, language_code: 'de' }, data, message: { message_id: menuId, chat: { id: 7, type: 'private' } } } });
    };
    await message(90, '/start');
    let sent = calls.filter((call) => call.method === 'sendMessage').at(-1)!;
    assert.equal(sent.body.reply_markup.inline_keyboard.flat().length, 1);
    assert.equal(sent.body.reply_markup.inline_keyboard[0][0].text, 'English ｜ Switch language');
    await message(100, '草東沒有派對');
    sent = calls.filter((call) => call.method === 'sendMessage').at(-1)!;
    assert.equal(sent.body.reply_parameters.message_id, 100);
    assert.match(sent.body.text, /Songs · NetEase/); assert.equal(sent.body.deleteAfterMs, undefined);
    const menuId = nextMessage, pageData = sent.body.reply_markup.inline_keyboard.at(-1)[0].callback_data;
    await callback(pageData, menuId);
    assert.match(calls.findLast((call) => call.method === 'editMessageText')!.body.text, /9–10 \/ 10/);
    const audioCount = () => calls.filter((call) => call.method === 'sendAudio').length;
    await callback(sent.body.reply_markup.inline_keyboard[0][0].callback_data, menuId, 43);
    assert.equal(audioCount(), 0);
    await message(101, '9');
    let audio = calls.findLast((call) => call.method === 'sendAudio')!;
    assert.ok(audio, JSON.stringify(calls.slice(-5)));
    assert.equal(audio.body.audio, 'cached:10008'); assert.equal(audio.body.reply_parameters.message_id, 101);
    let pending = JSON.parse(await readFile(join(root, 'bot-cleanup', '999000.json'), 'utf8')) as { messageId: number; due: number }[];
    for (const id of [100, 101, menuId]) assert.ok(pending.some((entry) => entry.messageId === id && entry.due <= now + 2000));
    await message(110, '床');
    sent = calls.findLast((call) => call.method === 'sendMessage')!;
    await callback(sent.body.reply_markup.inline_keyboard[0][0].callback_data, nextMessage);
    audio = calls.findLast((call) => call.method === 'sendAudio')!;
    assert.equal(audio.body.reply_parameters.message_id, 110);
    failDelivery = true;
    await message(120, 'https://music.163.com/song?id=10000');
    pending = JSON.parse(await readFile(join(root, 'bot-cleanup', '999000.json'), 'utf8'));
    assert.ok(!pending.some((entry) => entry.messageId === 120));
    const error = calls.findLast((call) => call.method === 'sendMessage')!;
    assert.equal(error.body.reply_parameters.message_id, 120);
    assert.ok(pending.some((entry) => entry.messageId === nextMessage && entry.due === now + 60_000));
    failDelivery = false;
    const before = calls.length;
    await message(130, '普通群組聊天', 42, -100, 'supergroup');
    await message(131, '/netease@another_bot 床');
    assert.equal(calls.length, before);
    await callback('ui:42:ja', nextMessage);
    await message(140, '/start');
    sent = calls.findLast((call) => call.method === 'sendMessage')!;
    assert.equal(sent.body.reply_markup.inline_keyboard[0][0].text, '日本語 ｜ 言語を変更');
    now += 31 * 60_000;
    const removed: number[] = [];
    await new BotMessageCleanup('999000', async (_chat, id) => { removed.push(id); }, root, () => now).flush();
    assert.ok(removed.includes(100) && removed.includes(101)); assert.ok(!removed.includes(120));
    assert.ok(!removed.includes(90) && !removed.includes(140), 'start screens and music cards remain');
  } finally {
    globalThis.fetch = realFetch; Date.now = realNow; process.env = env;
    await rm(root, { recursive: true, force: true });
  }
});
