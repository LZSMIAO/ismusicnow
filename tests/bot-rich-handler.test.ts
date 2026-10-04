import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('real rich handler groups sources, switches scope in place, guards actors/stale buttons, and distinguishes auto from explicit acquisition', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-rich-'));
  const env = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
  let now = realNow(), nextMessage = 1000, uncertainDelivery = false;
  Date.now = () => now;
  Object.assign(process.env, { DATA_DIR: root, BOT_TOKEN: '999555:stub', BOT_ALLOWED_USERS: '', BOT_RICH_SEARCH: '1', BOT_CACHE_CHAT_ID: '-10042', NETEASE_API_URL: 'https://metadata.example.test/', NETEASE_COOKIE: '', MUSIC_U: '', SPOTIFY_ACCESS_TOKEN: 'stub' });
  const calls: { method: string; body: any }[] = [], queries: string[] = [];
  const sid = 'a'.repeat(22);
  const song = { id: 10000, name: '爛泥', ar: [{ id: 7, name: '草東沒有派對' }], al: { id: 99, name: '醜奴兒' }, dt: 150000 };
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body || '{}'));
    for (const key of ['reply_markup', 'reply_parameters']) if (typeof body[key] === 'string') body[key] = JSON.parse(body[key]);
    if (address.startsWith('https://metadata.example.test/')) {
      queries.push('netease');
      return Response.json({ code: 200, result: { songs: [song], songCount: 1 }, songs: [song] });
    }
    if (address.startsWith('https://api.spotify.com/v1/search')) {
      queries.push('spotify');
      return Response.json({ tracks: { items: [{ id: sid, name: '烂泥', artists: [{ name: '草东没有派对' }], album: { name: '丑奴儿' }, duration_ms: 150000 }], total: 1, next: null } });
    }
    assert.ok(address.startsWith('https://api.telegram.org/bot999555:stub/'));
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    if (method === 'sendAudio' && uncertainDelivery) throw new Error('network interruption');
    return Response.json({ ok: true, result: ['sendRichMessage', 'sendMessage', 'sendAudio'].includes(method) ? { message_id: ++nextMessage } : true });
  };
  const { DownloadStore } = await import('../src/lib/server/downloads.js');
  const create = DownloadStore.prototype.create, list = DownloadStore.prototype.list;
  try {
    const { BotMusicCache } = await import('../src/lib/server/bot-cache.js');
    const { BotSettingsStore } = await import('../src/lib/server/bot-settings.js');
    const cache = new BotMusicCache('999555');
    const neteaseKey = { provider: 'netease' as const, id: '10000', quality: 'original-lossless' };
    const spotifyKey = { provider: 'spotify' as const, id: sid, quality: 'vorbis-high' };
    await cache.put(neteaseKey, { kind: 'audio', fileId: 'netease-lossless', duration: 150, bytes: 1000, audioSource: 'netease', audio: { codec: 'FLAC', lossless: true, bitsPerSample: 16, sampleRate: 44100 } });
    const original = { kind: 'document' as const, fileId: 'spotify-original', duration: 150, bytes: 1000, audioSource: 'spotify' as const, audio: { codec: 'FLAC', lossless: true, bitsPerSample: 24, sampleRate: 48000 } };
    const playable = { ...original, kind: 'audio' as const, fileId: 'spotify-playback', presentation: 'telegram-playback' as const, audio: { codec: 'MPEG 1 Layer 3', lossless: false, bitrate: 320000 } };
    const playbackKey = { ...spotifyKey, quality: spotifyKey.quality + ':telegram-mp3-320-v1' };
    await cache.put(spotifyKey, original); await cache.put(playbackKey, playable);
    await new BotSettingsStore().choose(42, 'original');
    const { handle } = await import('../scripts/bot.js');
    const search = async (id: number) => { now += 3100; await handle({ update_id: id, message: { message_id: id, chat: { id: 7, type: 'private' }, from: { id: 42, language_code: 'en' }, text: '爛泥' } }); };
    const callback = async (data: string, menu = nextMessage, actor = 42) => { now += 1000; await handle({ update_id: 900, callback_query: { id: 'stub', from: { id: actor, language_code: 'en' }, data, message: { message_id: menu, chat: { id: 7, type: 'private' } } } }); };
    const panel = () => calls.findLast(call => ['sendRichMessage', 'editMessageText'].includes(call.method))!.body;
    const data = (prefix: string) => panel().rich_message.html.match(new RegExp(`data="(${prefix}:[^"]+)"`))[1];
    const audio = () => calls.filter(call => call.method === 'sendAudio');
    await search(1);
    assert.match(panel().rich_message.html, /1–1 \/ 1/); assert.match(panel().rich_message.html, /\+1 sources/);
    assert.match(panel().rich_message.html, /Spotify/); assert.match(panel().rich_message.html, /<details><summary>/);
    const menu = nextMessage, pick = data('pick'), more = data('sources'), filter = data('filter');
    await callback(more, menu, 43); assert.equal(audio().length, 0);
    await callback(more, menu); assert.equal(panel().message_id, menu); assert.match(panel().rich_message.html, /Spotify · Preferred/);
    await callback(panel().reply_markup.inline_keyboard[0][0].callback_data, menu);
    await callback(filter, menu); assert.doesNotMatch(panel().rich_message.html, />YTM</);
    const scope = panel().rich_message.html.match(/data="(scope:[^"]+:spotify)"/)[1];
    const before = queries.length; await callback(scope, menu);
    assert.deepEqual(queries.slice(before), ['spotify']); assert.match(panel().rich_message.html, /Spotify ▾<\/tg-button> · Songs/);
    const staleCount = audio().length; await callback(pick, menu); assert.equal(audio().length, staleCount);
    await search(2); assert.match(panel().rich_message.html, /All sources/);
    const auto = data('pick'), exact = data('from'), activeMenu = nextMessage;
    // The preferred source becomes definitively unavailable after the snapshot.
    await cache.invalidate(spotifyKey, original.fileId); await cache.invalidate(playbackKey, playable.fileId);
    let failedJob: any;
    DownloadStore.prototype.create = async (_owner, tracks) => [failedJob = { id: 'failed', track: tracks[0], status: 'failed', errorCode: 'NO_AUDIO' }] as any;
    DownloadStore.prototype.list = async () => [failedJob];
    await callback(auto, activeMenu);
    assert.equal(audio().at(-1)!.body.audio, 'netease-lossless', 'automatic acquisition can use only a confirmed same-recording alternate');
    assert.equal(audio().length, 1);
    assert.ok(calls.some(call => call.method === 'deleteMessage' && call.body.message_id === activeMenu));
    await cache.put(spotifyKey, original); await cache.put(playbackKey, playable);
    await search(3); const explicit = data('from'), exactMenu = nextMessage;
    await cache.invalidate(spotifyKey, original.fileId); await cache.invalidate(playbackKey, playable.fileId);
    await callback(explicit, exactMenu);
    assert.equal(audio().length, 1, 'an explicitly selected platform must not silently fall back');
    assert.ok(calls.findLast(call => call.method === 'sendMessage')!.body.text.includes('complete downloadable track'));
    await search(4); const lastMenu = nextMessage, finalPick = data('pick');
    uncertainDelivery = true;
    const attempts = audio().length;
    await callback(finalPick, lastMenu);
    assert.equal(audio().length, attempts + 1, 'ambiguous recipient delivery does not try another provider');
    assert.ok(exact);
  } finally {
    DownloadStore.prototype.create = create; DownloadStore.prototype.list = list;
    globalThis.fetch = realFetch; Date.now = realNow; process.env = env;
    await rm(root, { recursive: true, force: true });
  }
});
