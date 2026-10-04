import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real handler routes inline queries without chat IDs, deep-link onboarding and private cached audio back to sharing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-inline-handler-'));
  const env = { ...process.env }, fetchBefore = globalThis.fetch, nowBefore = Date.now;
  let now = nowBefore(), nextMessage = 1000;
  Date.now = () => now;
  process.env.DATA_DIR = root; process.env.BOT_TOKEN = '999222:stub'; process.env.BOT_ALLOWED_USERS = '42';
  process.env.NETEASE_API_URL = 'https://inline-metadata.example.test/'; process.env.NETEASE_COOKIE = ''; process.env.MUSIC_U = '';
  const calls: { method: string; body: any }[] = [];
  const song = { id: 123, name: '床', ar: [{ id: 99, name: '草东没有派对' }], al: { id: 55, name: '瓦合' }, dt: 150000 };
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body || '{}'));
    for (const key of ['reply_markup', 'reply_parameters']) if (typeof body[key] === 'string') body[key] = JSON.parse(body[key]);
    if (address.startsWith('https://inline-metadata.example.test/')) return Response.json(address.endsWith('/song/detail') ? { code: 200, songs: [song] } : { code: 200, result: { songs: [song], songCount: 1 } });
    assert.ok(address.startsWith('https://api.telegram.org/bot999222:stub/'));
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'sendMessage' || method === 'sendAudio' ? { message_id: ++nextMessage } : true });
  };
  try {
    const { BotMusicCache } = await import('../src/lib/server/bot-cache.js');
    await new BotMusicCache('999222').put({ provider: 'netease', id: '123', quality: 'original-lossless' }, { fileId: 'existing-file-id', kind: 'audio', duration: 150, bytes: 1000, audioSource: 'netease' });
    const { handle } = await import('../scripts/bot.js');
    await handle({ update_id: 1, inline_query: { id: 'denied', from: { id: 43 }, query: '床', offset: '' } });
    assert.deepEqual(calls.at(-1)!.body.results, []);
    await handle({ update_id: 2, inline_query: { id: 'first', from: { id: 42, language_code: 'de' }, query: '床', offset: '' } });
    assert.equal(calls.at(-1)!.body.results[0].type, 'article');
    assert.match(calls.at(-1)!.body.results[0].reply_markup.inline_keyboard[0][0].url, /start=in_n_123$/);
    now += 4000;
    await handle({ update_id: 3, message: { message_id: 3, chat: { id: 42, type: 'private' }, from: { id: 42, language_code: 'de' }, text: '/start in_n_123' } });
    const prompt = calls.findLast(c => c.method === 'sendMessage')!;
    assert.match(prompt.body.text, /first NetEase download/);
    const promptId = nextMessage;
    await handle({ update_id: 4, callback_query: { id: 'choose', from: { id: 42 }, data: 'lang:42:original', message: { message_id: promptId, chat: { id: 42, type: 'private' } } } });
    const audio = calls.findLast(c => c.method === 'sendAudio')!;
    assert.equal(audio.body.audio, 'existing-file-id'); assert.match(audio.body.caption, /<blockquote expandable>/);
    assert.equal(audio.body.reply_parameters, undefined);
    assert.equal(audio.body.reply_markup.inline_keyboard.at(-1)[0].switch_inline_query, 'https://music.163.com/song?id=123');
    assert.ok(calls.some(c => c.method === 'deleteMessage' && c.body.message_id === promptId));
    await handle({ update_id: 5, inline_query: { id: 'ready', from: { id: 42, language_code: 'ja' }, query: '床', offset: '' } });
    assert.equal(calls.at(-1)!.body.results[0].audio_file_id, 'existing-file-id'); assert.match(calls.at(-1)!.body.results[0].caption, /アルバム/);
    const before = calls.length;
    await handle({ update_id: 6, callback_query: { id: 'insert', from: { id: 42 }, inline_message_id: 'opaque-inline-message', data: 'ix:42:n:123' } });
    assert.equal(calls.at(-1)!.method, 'editMessageMedia'); assert.equal(calls.at(-1)!.body.inline_message_id, 'opaque-inline-message');
    assert.ok(!calls.slice(before).some(c => c.method === 'deleteMessage'));
    now += 4000;
    await handle({ update_id: 7, message: { message_id: 7, chat: { id: 42, type: 'private' }, from: { id: 42 }, text: '/help' } });
    const help = calls.at(-1)!; assert.equal(help.body.parse_mode, 'HTML'); assert.match(help.body.text, /<blockquote expandable>/); assert.match(help.body.text, /@muismbot/);
  } finally { globalThis.fetch = fetchBefore; Date.now = nowBefore; process.env = env; await rm(root, { recursive: true, force: true }); }
});
