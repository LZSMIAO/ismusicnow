import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The real handler, isolated preferences/cache and fake network: no group posts.
test('group commands, mentions, member languages, owned reply selection and concurrent forum topics remain isolated', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-group-'));
  const env = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
  let now = realNow(), nextMessage = 1000;
  Date.now = () => now;
  process.env.DATA_DIR = root; process.env.BOT_TOKEN = '999001:stub'; process.env.BOT_ALLOWED_USERS = '';
  process.env.NETEASE_API_URL = 'https://metadata.example.test/'; process.env.NETEASE_COOKIE = ''; process.env.MUSIC_U = '';
  const calls: { method: string; body: Record<string, any> }[] = [], queries: string[] = [];
  const songs = Array.from({ length: 10 }, (_, i) => ({ id: 10000 + i, name: `歌曲 ${i + 1}`, ar: [{ name: '草東沒有派對' }], al: { name: '醜奴兒' }, dt: 150000 }));
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body || '{}'));
    for (const key of ['reply_parameters', 'reply_markup']) if (typeof body[key] === 'string') body[key] = JSON.parse(body[key]);
    if (address.startsWith('https://metadata.example.test/')) {
      assert.ok(address.endsWith('/cloudsearch') || address.endsWith('/song/detail') || address.endsWith('/lyric'));
      if (address.endsWith('/cloudsearch')) queries.push(body.keywords);
      return Response.json(address.endsWith('/lyric') ? { code: 200, lrc: { lyric: '[00:01.00]Fixture' } } : address.endsWith('/song/detail') ? { code: 200, songs: [songs[0]] } : { code: 200, result: { songs, songCount: 12 } });
    }
    assert.ok(address.startsWith('https://api.telegram.org/bot999001:stub/'), 'no real Telegram or music requests');
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    return Response.json({ ok: true, result: ['sendMessage', 'sendAudio', 'sendDocument'].includes(method) ? { message_id: ++nextMessage } : true });
  };
  try {
    const { BotMusicCache } = await import('../src/lib/server/bot-cache.js');
    const { BotSettingsStore } = await import('../src/lib/server/bot-settings.js');
    const settings = new BotSettingsStore(), cache = new BotMusicCache('999001');
    for (const song of songs) await cache.put({ provider: 'netease', id: String(song.id), quality: 'original-lossless' }, { fileId: `cached:${song.id}`, kind: 'audio', duration: 150, bytes: 1234, audioSource: 'netease' });
    for (const user of [90, 91]) await settings.choose(user, 'original');
    const { handle } = await import('../scripts/bot.js');
    const message = async (id: number, text: string, user = 90, thread?: number, replyTo?: number, chat = -100, language = 'en') => {
      now += 3100;
      await handle({ update_id: id, message: { message_id: id, message_thread_id: thread, chat: { id: chat, type: chat === -101 ? 'group' : 'supergroup' }, from: { id: user, language_code: language }, text,
        ...(replyTo === undefined ? {} : { reply_to_message: { message_id: replyTo, from: { username: 'muismbot' } } }) } });
    };
    const callback = async (data: string, menu: number, user = 90, thread?: number, language = 'en') => {
      now += 1000;
      await handle({ update_id: 900, callback_query: { id: 'stub', from: { id: user, language_code: language }, data,
        message: { message_id: menu, message_thread_id: thread, chat: { id: -100, type: 'supergroup' } } } });
    };
    const sent = () => calls.findLast((call) => call.method === 'sendMessage')!;
    const audioCount = () => calls.filter((call) => call.method === 'sendAudio').length;
    const selector = () => ({ id: nextMessage, pick: sent().body.reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.startsWith('pick:')).callback_data, page: sent().body.reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.startsWith('page:')).callback_data });
    await message(10, '普通聊天'); await message(11, '1'); await message(12, '/search@another_bot 床');
    await message(13, '@muismbot_other 床'); await message(14, '/unknown@muismbot 床');
    await handle({ update_id: 15, message: { message_id: 15, chat: { id: -100, type: 'supergroup' }, from: { id: 90, is_bot: true }, text: '/start' } });
    await handle({ update_id: 16, message: { message_id: 16, chat: { id: -100, type: 'supergroup' }, sender_chat: { id: -100 }, from: { id: 90 }, text: '/start' } });
    assert.equal(calls.length, 0); assert.equal(queries.length, 0);

    await message(20, '/start@muismbot', 90, 10);
    assert.equal(sent().body.message_thread_id, 10); assert.equal(sent().body.reply_parameters, undefined);
    assert.match(sent().body.text, /In groups, use \/search@muismbot/);
    assert.equal(sent().body.reply_markup.inline_keyboard.flat().length, 1);
    assert.deepEqual(calls.findLast((call) => call.method === 'setMyCommands')!.body.scope, { type: 'chat_member', chat_id: -100, user_id: 90 });
    await message(21, '/settings@muismbot', 91, 20, undefined, -100, 'ja');
    assert.deepEqual(calls.findLast((call) => call.method === 'setMyCommands')!.body.scope, { type: 'chat_member', chat_id: -100, user_id: 91 });
    assert.equal(sent().body.message_thread_id, 20); assert.match(sent().body.text, /日本語/);
    const settingsMenu = nextMessage;
    await callback('ui:91:fr', settingsMenu, 90, 20);
    assert.equal((await settings.get(91)).uiLanguage, undefined);
    await callback('ui:91:fr', settingsMenu, 91, 20, 'ja');
    assert.equal((await settings.get(91)).uiLanguage, 'fr'); assert.equal(await new BotSettingsStore().get(90).then((s) => s.uiLanguage), undefined);
    let commands = calls.findLast((call) => call.method === 'setMyCommands')!;
    assert.deepEqual(commands.body.scope, { type: 'chat_member', chat_id: -100, user_id: 91 });
    assert.match(commands.body.commands.find((c: { command: string }) => c.command === 'search').description, /Chercher/);

    await Promise.all([message(30, '/search@muismbot 草東', 90, 10), message(31, '/search@muismbot 人是猫', 91, 20)]);
    const topicMenus = calls.filter((call) => call.method === 'sendMessage' && /<b>(草東|人是猫)<\/b>/.test(call.body.text));
    assert.equal(topicMenus.length, 2);
    assert.equal(topicMenus.find((call) => call.body.text.includes('<b>草東</b>'))!.body.message_thread_id, 10);
    assert.equal(topicMenus.find((call) => call.body.text.includes('<b>人是猫</b>'))!.body.message_thread_id, 20);
    assert.match(topicMenus.find((call) => call.body.text.includes('<b>草東</b>'))!.body.text, /reply to this list/);

    await message(40, '@muismbot 床', 90, 10);
    assert.equal(queries.at(-1), '床'); assert.equal(sent().body.message_thread_id, 10);
    const choices = selector();
    await callback(choices.page, choices.id, 90, 10);
    assert.match(calls.findLast((call) => call.method === 'editMessageText')!.body.text, /6–10 \/ 10/);
    const before = audioCount();
    await message(41, '9', 90, 10); assert.equal(audioCount(), before);
    await message(42, '9', 91, 10, choices.id); assert.equal(audioCount(), before);
    await message(43, '9', 90, 20, choices.id); assert.equal(audioCount(), before);
    await callback(choices.pick, choices.id, 91, 10); assert.equal(audioCount(), before);
    await callback(choices.pick, choices.id, 90, 20); assert.equal(audioCount(), before);
    await message(44, '9', 90, 10, choices.id);
    const audio = calls.findLast((call) => call.method === 'sendAudio')!;
    assert.equal(audio.body.audio, 'cached:10008'); assert.equal(audio.body.message_thread_id, '10');
    assert.equal(audio.body.reply_parameters, undefined); assert.match(audio.body.caption, /tg:\/\/user\?id=90/);
    const deleted = calls.filter(call => call.method === 'deleteMessage').map(call => call.body.message_id);
    for (const id of [40, 44, choices.id]) assert.ok(deleted.includes(id), 'accepted requests are deleted immediately');
    for (const id of [41, 42, 43]) assert.ok(!deleted.includes(id), 'ignored or failed requests must survive');

    await message(50, '草東沒有派對', 90, 20, 1000);
    assert.equal(queries.at(-1), '草東沒有派對'); const replyChoices = selector();
    await callback(replyChoices.pick, replyChoices.id, 90, 20);
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.message_thread_id, '20');
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.reply_parameters, undefined);
    await message(60, '/netease@muismbot 10000', 90, undefined, undefined, -101);
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.chat_id, '-101');
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.message_thread_id, undefined);
    await message(61, '/lyric@muismbot 10000', 90, 20);
    assert.equal(calls.findLast((call) => call.method === 'sendDocument')!.body.message_thread_id, '20');

    // A name preference prompt persists its original topic, even if changed
    // from a different topic after the settings store is recreated.
    await message(70, '/netease@muismbot 10000', 92, 10);
    const firstPrompt = nextMessage;
    assert.equal(sent().body.message_thread_id, 10); assert.match(sent().body.text, /first NetEase download/);
    assert.equal((await new BotSettingsStore().get(92)).pending?.messageThreadId, 10);
    await callback('lang:92:original', firstPrompt, 92, 20);
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.message_thread_id, '10');
    assert.equal(calls.findLast((call) => call.method === 'sendAudio')!.body.reply_parameters, undefined);
    assert.ok(calls.some(call => call.method === 'deleteMessage' && call.body.message_id === firstPrompt));
    const prompts = () => calls.filter(call => call.method === 'sendMessage' && call.body.text?.includes('first NetEase download')).length;
    const promptCount = prompts();
    await message(71, '/netease@muismbot 10000', 92, 20);
    assert.equal(prompts(), promptCount, 'Chinese choice is only asked once');
  } finally {
    globalThis.fetch = realFetch; Date.now = realNow; process.env = env;
    await rm(root, { recursive: true, force: true });
  }
});
