import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('typed search → owned artist view → albums → tracks, stale callbacks and retained music cards', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-browse-'));
  const env = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
  let now = realNow(), nextMessage = 1000;
  Date.now = () => now;
  process.env.DATA_DIR = root; process.env.BOT_TOKEN = '999002:stub'; process.env.BOT_ALLOWED_USERS = ''; process.env.BOT_RICH_SEARCH = '0';
  process.env.NETEASE_API_URL = 'https://metadata.example.test/'; process.env.NETEASE_COOKIE = ''; process.env.MUSIC_U = '';
  process.env.SPOTIFY_ACCESS_TOKEN = 'stub';
  const calls: { method: string; body: Record<string, any> }[] = [], upstream: { url: string; body: Record<string, any> }[] = [];
  const song = { id: 10000, name: '床 <live>', ar: [{ id: 7, name: '草東 & 樂隊' }], al: { id: 99, name: '瓦合' }, dt: 232000 };
  const album = { id: 99, name: '瓦合', artists: [{ name: '草東 & 樂隊' }], size: 12, publishTime: Date.UTC(2023, 4, 20) };
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = init?.body instanceof FormData ? Object.fromEntries(init.body.entries()) : JSON.parse(String(init?.body || '{}'));
    for (const key of ['reply_parameters', 'reply_markup']) if (typeof body[key] === 'string') body[key] = JSON.parse(body[key]);
    if (address.startsWith('https://metadata.example.test/')) {
      upstream.push({ url: address, body });
      if (address.endsWith('/cloudsearch')) return Response.json({ code: 200, result: body.type === 10 ? { albums: [album], albumCount: 1 } : body.type === 100 ? { artists: [{ id: 7, name: '草東 & 樂隊', musicSize: 30 }], artistCount: 1 } : body.type === 1000 ? { playlists: [{ id: 88, name: '收藏', trackCount: 50, creator: { nickname: 'Miao' } }], playlistCount: 1 } : { songs: [song], songCount: 1 } });
      if (address.endsWith('/artists')) return Response.json({ code: 200, artist: { id: 7, name: '草東 & 樂隊' }, hotSongs: [song] });
      if (address.endsWith('/artist/album')) return Response.json({ code: 200, artist: { name: '草東 & 樂隊', albumSize: 1 }, hotAlbums: [album] });
      if (address.endsWith('/album')) return Response.json({ code: 200, album, songs: [song] });
      throw new Error('Unexpected metadata endpoint: ' + address);
    }
    if (address.startsWith('https://api.spotify.com/v1/search')) {
      upstream.push({ url: address, body });
      const type = new URL(address).searchParams.get('type')!;
      return Response.json({ [type + 's']: { items: [null, { id: 'a'.repeat(22), name: 'Native artist', artists: [{ name: 'Native artist' }], release_date: '2024-01', total_tracks: 10, owner: { display_name: 'Owner' }, duration_ms: 1000, album: { name: 'Native album' } }], total: 1, next: null } });
    }
    if (address.startsWith('https://api.spotify.com/v1/artists/')) {
      upstream.push({ url: address, body });
      const url = new URL(address);
      if (url.pathname.endsWith('/albums')) {
        assert.equal(url.searchParams.get('limit'), '10', 'artist album pages respect the current API limit');
        const offset = Number(url.searchParams.get('offset') || 0);
        const items = Array.from({ length: offset ? 1 : 10 }, (_, i) => ({ id: String(offset + i).padStart(22, '0'), name: `Album ${offset + i + 1}`, artists: [{ name: 'Native artist' }], total_tracks: 12, release_date: '2024-01' }));
        return Response.json({ items, total: 11, next: offset ? null : address + '&offset=10' });
      }
      assert.ok(!url.pathname.endsWith('/top-tracks'), 'removed Spotify endpoint is never offered or requested');
      return Response.json({ id: 'a'.repeat(22), name: 'Native artist' });
    }
    assert.ok(address.startsWith('https://api.telegram.org/bot999002:stub/'), 'only mock requests are permitted');
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    return Response.json({ ok: true, result: ['sendMessage', 'sendAudio'].includes(method) ? { message_id: ++nextMessage } : true });
  };
  try {
    const { BotMusicCache } = await import('../src/lib/server/bot-cache.js');
    const { BotSettingsStore } = await import('../src/lib/server/bot-settings.js');
    await new BotSettingsStore().choose(42, 'original');
    await new BotMusicCache('999002').put({ provider: 'netease', id: '10000', quality: 'original-lossless' }, { fileId: 'cached-song', kind: 'audio', duration: 232, bytes: 1234, audioSource: 'netease' });
    const { handle } = await import('../scripts/bot.js');
    const message = async (id: number, text: string) => { now += 3100; await handle({ update_id: id, message: { message_id: id, chat: { id: 7, type: 'private' }, from: { id: 42, language_code: 'en' }, text } }); };
    const callback = async (data: string, menu: number, user = 42) => { now += 1000; await handle({ update_id: 999, callback_query: { id: 'mock', from: { id: user, language_code: 'en' }, data, message: { message_id: menu, chat: { id: 7, type: 'private' } } } }); };
    const panel = () => calls.findLast(c => ['sendMessage', 'editMessageText'].includes(c.method))!.body;
    const button = (prefix: string) => panel().reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.startsWith(prefix)).callback_data;
    const deleted = () => calls.filter(c => c.method === 'deleteMessage').map(c => c.body.message_id);
    const neteaseSearch = () => upstream.findLast(c => c.url.endsWith('/cloudsearch'))!;
    await message(1, '@ismusicbot'); assert.equal(upstream.length, 0, 'a bare mention never searches for @ songs');
    await message(2, '/album 草東'); assert.equal(neteaseSearch().body.type, 10);
    assert.match(panel().text, /All sources/); assert.match(panel().text, /Spotify/);
    const menu = nextMessage, staleAlbum = button('pick:');
    assert.match(panel().text, /2023 · 12 songs/);
    const artistTab = panel().reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.endsWith(':artist')).callback_data;
    await callback(artistTab, menu, 43); assert.equal(neteaseSearch().body.type, 10, 'other users cannot switch this menu');
    await callback(artistTab, menu); assert.equal(neteaseSearch().body.type, 100);
    assert.equal(new URL(upstream.findLast(c => c.url.includes('/v1/search'))!.url).searchParams.get('type'), 'artist', 'category switches preserve cross-source scope');
    const artistPick = button('pick:');
    const count = upstream.length; await callback(staleAlbum, menu); assert.equal(upstream.length, count, 'old buttons cannot select the new category by index');
    await callback(artistPick, menu); assert.ok(upstream.at(-1)!.url.endsWith('/artists'));
    assert.match(panel().text, /Top songs/);
    await callback(panel().reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.startsWith('view:') && b.callback_data.endsWith(':album')).callback_data, menu);
    assert.ok(upstream.at(-1)!.url.endsWith('/artist/album'));
    await callback(button('pick:'), menu); assert.ok(upstream.at(-1)!.url.endsWith('/album'));
    const pick = button('pick:'), albumBack = button('back:'); await callback(pick, menu);
    const audio = calls.findLast(c => c.method === 'sendAudio')!.body;
    assert.equal(audio.reply_parameters, undefined, 'no deleted-message quote on permanent audio');
    assert.match(audio.caption, /<blockquote expandable>.*瓦合/s); assert.match(audio.caption, /&lt;live&gt;/); assert.match(audio.caption, /&amp;/);
    assert.equal(audio.parse_mode, 'HTML'); assert.ok(!deleted().includes(menu), 'album selector remains usable');
    await callback(pick, menu); assert.equal(calls.filter(c => c.method === 'sendAudio').length, 2, 'a second album track request remains usable');
    const musicCard = nextMessage;
    await callback(albumBack, menu); assert.match(panel().text, /2023 · 12 songs/, 'back restores the artist album results');
    await callback(button('back:'), menu); assert.match(panel().text, /Artists/, 'a second back restores the original category');
    assert.ok(!panel().reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data.startsWith('back:')));
    await callback('browse:netease:album:99', musicCard);
    const albumMenu = nextMessage, cardPick = button('pick:');
    await callback(cardPick, albumMenu); await callback(cardPick, albumMenu);
    assert.ok(!deleted().includes(musicCard), 'opening an album never deletes the source music card');
    await callback(button('close:'), albumMenu); assert.ok(deleted().includes(albumMenu), 'close removes the panel now');
    await message(3, '/playlist 收藏'); assert.equal(neteaseSearch().body.type, 1000); assert.match(panel().text, /Miao · 50 songs/);
    const { searchSpotify } = await import('../src/lib/server/providers/spotify.js');
    for (const type of ['track', 'album', 'artist', 'playlist'] as const) {
      const collection = await searchSpotify('native', type);
      assert.equal(new URL(upstream.at(-1)!.url).searchParams.get('type'), type);
      assert.equal(type === 'track' ? collection.tracks.length : collection.entities?.length, 1, 'null catalog entries are ignored');
    }
    await message(4, '/spotify native');
    const spotifyMenu = nextMessage;
    await callback(panel().reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.endsWith(':artist')).callback_data, spotifyMenu);
    await callback(button('pick:'), spotifyMenu);
    assert.match(panel().text, /Native artist/);
    assert.match(panel().text, /1–8 \/ 11/, 'artist album pagination loads subsequent API pages');
    assert.doesNotMatch(panel().text, /Top songs/);
    assert.ok(!panel().reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data.startsWith('view:')), 'Spotify artist view exposes available albums without a dead top-tracks tab');
  } finally { globalThis.fetch = realFetch; Date.now = realNow; process.env = env; await rm(root, { recursive: true, force: true }); }
});
