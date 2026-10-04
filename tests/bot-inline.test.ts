import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BotInline, parseInlineQuery, parseInlineStart, inlineStart } from '../src/lib/server/bot-inline.js';
import { TelegramRequestError } from '../src/lib/server/bot-media.js';
import type { CachedMusic } from '../src/lib/server/bot-cache.js';
import type { Collection, Track } from '../src/lib/types.js';
import type { AlbumLanguage } from '../src/lib/server/bot-settings.js';
import { botLanguages, botText } from '../src/lib/server/bot-i18n.js';
const track: Track = { id: '123', provider: 'netease', title: '人是猫', artists: ['张卡斯', '洛天依'], album: '音乐', artistIds: ['999'], albumUrl: 'https://music.163.com/album?id=555', cover: 'https://p1.music.126.net/a.jpg', durationMs: 136000, sourceUrl: 'https://music.163.com/song?id=123' };
const audio: CachedMusic = { fileId: 'telegram-original-file', kind: 'audio', duration: 136, bytes: 1000, audioSource: 'netease', audio: { codec: 'MPEG 1 Layer 3', lossless: false } };
const collection: Collection = { kind: 'search', title: 'query', provider: 'netease', tracks: [track], total: 1, query: '床', warnings: [] };
function harness(options: { names?: AlbumLanguage; record?: CachedMusic; resolve?: () => Promise<Collection>; timeout?: number } = {}) {
  const calls: { method: string; body: any }[] = [], searches: { input: string; provider: string; kind: string }[] = [];
  let preferences = { ui: 'en' as typeof botLanguages[number], names: options.names };
  const deps = {
    telegram: async (method: string, body: Record<string, unknown>) => { calls.push({ method, body }); return true; },
    username: () => 'muismbot', preferences: async () => preferences,
    resolve: async (input: string, provider: any, kind: any) => { searches.push({ input, provider, kind }); return options.resolve ? options.resolve() : collection; },
    albums: async () => ({ ...collection, kind: 'artist' as const, entities: [{ id: '555', provider: 'netease' as const, kind: 'album' as const, title: '专辑', artists: ['歌手'], sourceUrl: track.albumUrl!, cover: '' }] }),
    getTrack: async () => track, cache: async () => options.record,
    metadata: async (value: Track) => ({ ...value, metadataLanguages: { title: 'zh', artists: ['zh', 'zh'], album: 'zh' } }),
  };
  return { calls, searches, deps, inline: new BotInline(deps, options.timeout), setPreferences: (value: typeof preferences) => { preferences = value; } };
}
const query = (value = '床', offset = '', id = 'query-1') => ({ id, from: { id: 42 }, query: value, offset });

test('inline prefixes preserve words, auto-detect platform URLs and validate private deep links', () => {
  assert.equal(parseInlineQuery('床').input, '床');
  assert.equal(parseInlineQuery('床').provider, 'all');
  assert.deepEqual(parseInlineQuery('spotify album OK Computer'), { input: 'OK Computer', provider: 'spotify', kind: 'album', albums: false });
  assert.equal(parseInlineQuery('artist spotify Radiohead').provider, 'spotify');
  assert.equal(parseInlineQuery('Spotifyish').input, 'Spotifyish');
  assert.equal(parseInlineQuery('albums https://music.163.com/artist?id=999').albums, true);
  assert.equal(parseInlineQuery('https://open.spotify.com/track/0123456789012345678901').provider, 'spotify');
  for (const value of [track, { provider: 'spotify' as const, id: '0123456789012345678901' }, { provider: 'ytm' as const, id: 'a-_01234567' }]) assert.deepEqual(parseInlineStart(inlineStart(value)), { provider: value.provider, id: value.id });
  assert.equal(parseInlineStart('in_x_123'), undefined); assert.throws(() => parseInlineStart('in_s_123'));
  assert.throws(() => parseInlineQuery('https://127.0.0.1/private'));
});
test('one-character searches return cached native audio and per-user Chinese captions without upload or chat cleanup', async () => {
  const h = harness({ names: 'zh-Hant', record: audio });
  await h.inline.answer(query());
  assert.equal(h.searches[0]!.input, '床');
  const body = h.calls[0]!.body, result = body.results[0];
  assert.equal(body.cache_time, 0); assert.equal(body.is_personal, true);
  assert.equal(result.type, 'audio'); assert.equal(result.audio_file_id, audio.fileId);
  assert.match(result.caption, /人是貓.*張卡斯/); assert.match(result.caption, /<blockquote expandable>/); assert.doesNotMatch(result.caption, /tg-spoiler/);
  assert.ok(result.reply_markup.inline_keyboard.flat().some((b: any) => b.url === 'https://t.me/muismbot?start=browse_n_album_555'));
  assert.ok(result.reply_markup.inline_keyboard.flat().some((b: any) => b.url === 'https://t.me/muismbot?start=browse_n_artist_999'));
  assert.deepEqual(h.calls.map(c => c.method), ['answerInlineQuery']);
  h.setPreferences({ ui: 'ja', names: 'original' });
  await h.inline.answer(query());
  assert.match(h.calls.at(-1)!.body.results[0].caption, /人是猫.*张卡斯/);
  assert.match(h.calls.at(-1)!.body.results[0].caption, /アルバム/);
});
test('uncached and first-time NetEase results prepare same-message playback without private redirects', async () => {
  for (const record of [undefined, audio]) {
    const h = harness({ record }); await h.inline.answer(query());
    const result = h.calls[0]!.body.results[0];
    assert.equal(result.type, 'article');
    assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data, 'ip:42:n:123');
    assert.match(result.description, /Play/);
    assert.match(result.input_message_content.message_text, /Preparing playback/);
  }
});
test('original documents never become unplayable Inline documents in any UI language', async () => {
  const h = harness({ names: 'original', record: { ...audio, kind: 'document' } });
  for (const ui of botLanguages) {
    h.setPreferences({ ui, names: 'original' }); await h.inline.answer(query());
    const result = h.calls.at(-1)!.body.results[0];
    assert.equal(result.type, 'article'); assert.equal(result.document_file_id, undefined); assert.equal(result.title, track.title);
    assert.ok(result.input_message_content.message_text.includes(botText(ui, 'preparePlayback')));
  }
});
test('pagination is scoped to the parsed query and reuses bounded metadata searches', async () => {
  const tracks = Array.from({ length: 25 }, (_, i) => ({ ...track, id: String(100 + i) }));
  const h = harness({ names: 'original', resolve: async () => ({ ...collection, tracks, total: 40 }) });
  await h.inline.answer(query()); const first = h.calls.at(-1)!.body;
  assert.equal(first.results.length, 11); assert.match(first.next_offset, /^[a-f0-9]{12}:10$/);
  await h.inline.answer(query('床', first.next_offset)); const second = h.calls.at(-1)!.body;
  assert.equal(second.results.length, 10); assert.equal(second.results[0].id, 'netease:110');
  await h.inline.answer(query('床', second.next_offset)); assert.equal(h.calls.at(-1)!.body.results.length, 5); assert.equal(h.calls.at(-1)!.body.next_offset, '');
  assert.equal(h.searches.length, 1);
  await h.inline.answer(query('other', first.next_offset)); assert.deepEqual(h.calls.at(-1)!.body.results, []);
});
test('albums, artists and playlists have actionable inline browse results; artist albums remain a separate view', async () => {
  for (const kind of ['album', 'artist', 'playlist'] as const) {
    const entity = { id: '555', provider: 'netease' as const, kind, title: 'Entity', artists: ['Artist'], sourceUrl: `https://music.163.com/${kind}?id=555`, cover: '' };
    const h = harness({ resolve: async () => ({ ...collection, tracks: [], entities: [entity], searchType: kind }) });
    await h.inline.answer(query(`${kind} keyword`));
    assert.equal(h.searches[0]!.kind, kind);
    const result = h.calls[0]!.body.results[0];
    assert.equal(result.reply_markup.inline_keyboard[0][0].switch_inline_query_current_chat, entity.sourceUrl);
    if (kind === 'artist') assert.equal(result.reply_markup.inline_keyboard[1][0].switch_inline_query_current_chat, `albums ${entity.sourceUrl}`);
  }
  const h = harness(); await h.inline.answer(query('albums https://music.163.com/artist?id=999'));
  assert.equal(h.searches.length, 0); assert.equal(h.calls[0]!.body.results[0].id, 'netease:album:555');
});
test('denied, empty, malformed, unavailable and timed-out queries always receive a short answer', async () => {
  const denied = harness(); await denied.inline.answer(query(), false); assert.deepEqual(denied.calls[0]!.body.results, []); assert.equal(denied.searches.length, 0);
  const empty = harness(); await empty.inline.answer(query('')); assert.equal(empty.searches.length, 0); assert.equal(empty.calls.length, 1);
  await empty.inline.answer(query('https://127.0.0.1')); assert.equal(empty.calls.length, 2);
  const timeout = harness({ timeout: 10, resolve: () => new Promise(() => {}) }); await timeout.inline.answer(query()); assert.equal(timeout.calls.length, 1);
  const unavailable = harness({ resolve: async () => { throw new Error('secret upstream details'); } }); await unavailable.inline.answer(query()); assert.equal(unavailable.calls.length, 1); assert.doesNotMatch(JSON.stringify(unavailable.calls), /secret upstream/);
});
test('out-of-order search completion cannot replace a newer query', async () => {
  let done!: (v: Collection) => void;
  const h = harness({ resolve: () => new Promise(resolve => { done = resolve; }) });
  const pending = h.inline.answer(query('first', '', 'old')); await new Promise(resolve => setTimeout(resolve, 0));
  await h.inline.answer(query('', '', 'new')); done(collection); await pending;
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0]!.body.inline_query_id, 'new');
});
test('Telegram inline format rejection falls back to a file_id insertion button with no redownload', async () => {
  const h = harness({ names: 'original', record: audio });
  h.deps.telegram = async (method, body) => { h.calls.push({ method, body }); if (h.calls.length === 1) throw new TelegramRequestError(400, 'wrong audio file type'); return true; };
  await h.inline.answer(query());
  const result = h.calls.at(-1)!.body.results[0]; assert.equal(result.type, 'article');
  assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data, 'ip:42:n:123');
  await h.inline.callback({ id: 'cb', from: { id: 42 }, inline_message_id: 'inline-opaque-id', data: 'ix:42:n:123' });
  const edit = h.calls.at(-1)!; assert.equal(edit.method, 'editMessageMedia'); assert.equal(edit.body.inline_message_id, 'inline-opaque-id'); assert.equal(edit.body.media.media, audio.fileId); assert.equal(edit.body.chat_id, undefined);
});
test('inline callback ownership, missing media and expired queries never touch group messages', async () => {
  const h = harness({ names: 'original' });
  await h.inline.callback({ id: 'cb', from: { id: 43 }, inline_message_id: 'inline', data: 'ix:42:n:123' });
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0]!.body.show_alert, true);
  await h.inline.callback({ id: 'cb', from: { id: 42 }, inline_message_id: 'inline', data: 'ix:42:n:123' });
  assert.equal(h.calls.at(-1)!.method, 'editMessageText'); assert.match(JSON.stringify(h.calls.at(-1)!.body), /start=in_n_123/);
  assert.ok(!h.calls.some(c => c.method === 'deleteMessage' || c.method === 'sendMessage'));
  const expired = harness(); expired.deps.telegram = async () => { throw new TelegramRequestError(400, 'query is too old'); };
  await expired.inline.answer(query());
});

test('channel browsing uses a destination chooser rather than an unsupported current-chat switch', async () => {
  const h = harness({ names: 'original', record: audio });
  await h.inline.answer({ ...query(), chat_type: 'channel' });
  const buttons = h.calls[0]!.body.results[0].reply_markup.inline_keyboard.flat();
  assert.ok(!buttons.some((button: any) => button.switch_inline_query_current_chat));
  assert.ok(buttons.some((button: any) => button.url?.includes('start=browse_n_album_')));
  assert.ok(buttons.some((button: any) => button.switch_inline_query === track.sourceUrl));
});


test('FLAC and unknown cached audio never invalidate an inline page or trigger a download', async () => {
  for (const metadata of [{ codec: 'FLAC', lossless: true }, undefined]) {
    const h = harness({ names: 'zh-Hant', record: { ...audio, audio: metadata } });
    await h.inline.answer(query('netease 塵'));
    assert.equal(h.searches[0]!.input, '尘');
    assert.equal(h.calls.length, 1);
    const result = h.calls[0]!.body.results[0];
    assert.equal(result.type, 'article');
    assert.equal(result.reply_markup.inline_keyboard[0][0].callback_data, 'ip:42:n:123');
    await h.inline.callback({ id: 'cb', from: { id: 42 }, inline_message_id: 'older-card', data: 'ix:42:n:123' });
    assert.equal(h.calls.at(-1)!.method, 'editMessageMedia');
    assert.equal(h.calls.at(-1)!.body.media.media,audio.fileId);
    assert.ok(!h.calls.some(c => c.method === 'sendAudio'));
  }
  const h = harness();
  await h.inline.answer(query('spotify 塵'));
  assert.equal(h.searches[0]!.input, '塵');
  await h.inline.answer(query('塵と光'));
  assert.equal(h.searches[1]!.input, '塵と光');
  await h.inline.answer(query(track.sourceUrl));
  assert.equal(h.searches[2]!.input, track.sourceUrl);
});


test('mixed FLAC, MP3 and document caches preserve usable native results in one response', async () => {
  const h = harness({ names: 'original', resolve: async () => ({ ...collection, tracks: [track, { ...track, id: '124' }, { ...track, id: '125' }] }) });
  h.deps.cache = async (value?: Track): Promise<CachedMusic | undefined> => value?.id === '123' ? { ...audio, audio: { codec: 'FLAC', lossless: true } } : value?.id === '125' ? { ...audio, kind: 'document' } : audio;
  await h.inline.answer(query());
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0]!.body.results.map((r: any) => r.type), ['article', 'audio', 'article', 'article']);
});

test('selecting an uncached song edits only the selected inline message into a native player', async () => {
  const h = harness({ names: 'zh-Hant' }); let acquisitions = 0;
  const playable = { ...audio, presentation: 'telegram-playback' as const };
  const inline = new BotInline({ ...h.deps, acquire: async () => { acquisitions++; return playable; } });
  await inline.answer(query()); assert.equal(acquisitions, 0, 'typing must not acquire audio');
  await inline.chosen({ result_id: 'netease:123', from: { id: 42 }, inline_message_id: 'same-inline-card', query: '床' });
  assert.equal(acquisitions, 1);
  const edit = h.calls.at(-1)!; assert.equal(edit.method, 'editMessageMedia'); assert.equal(edit.body.inline_message_id, 'same-inline-card'); assert.equal(edit.body.media.type, 'audio'); assert.equal(edit.body.media.media, playable.fileId);
  assert.match(edit.body.media.caption, /人是貓.*張卡斯/); assert.match(edit.body.media.caption, /MP3 conversion/);
  const buttons = edit.body.reply_markup.inline_keyboard.flat(); assert.ok(buttons.some((b: any) => /start=raw_n_123$/.test(b.url || '')));
  assert.ok(!buttons.some((b: any) => b.switch_inline_query_current_chat), 'finished cards also work in channels');
  assert.ok(!h.calls.some(c => ['sendMessage', 'sendAudio', 'sendDocument', 'deleteMessage'].includes(c.method)));
  await inline.chosen({ result_id: 'netease:123:audio', from: { id: 42 }, inline_message_id: 'cached-card', query: '床' });
  await inline.chosen({ result_id: 'netease:123', from: { id: 42 }, query: '床' }); assert.equal(acquisitions, 1);
});
test('NetEase inline name preference is asked once, actor-bound and resumes the same selected message', async () => {
  const h = harness(); let names: AlbumLanguage | undefined, acquired = 0;
  const inline = new BotInline({ ...h.deps, preferences: async () => ({ ui: 'en', names }), chooseNames: async (_id, language) => { names = language; }, acquire: async () => { acquired++; return audio; } });
  await inline.chosen({ result_id: 'netease:123', from: { id: 42 }, inline_message_id: 'same', query: '床' });
  assert.match(h.calls.at(-1)!.body.text, /first NetEase download/); assert.equal(acquired, 0);
  await inline.callback({ id: 'intruder', from: { id: 43 }, inline_message_id: 'same', data: 'inlang:42:n:123:zh-Hant' }); assert.equal(names, undefined);
  await inline.callback({ id: 'select', from: { id: 42 }, inline_message_id: 'same', data: 'inlang:42:n:123:zh-Hant' });
  assert.equal(names, 'zh-Hant'); assert.equal(acquired, 1); assert.equal(h.calls.at(-1)!.method, 'editMessageMedia'); assert.match(h.calls.at(-1)!.body.media.caption, /人是貓/);
  const before = h.calls.length;
  await inline.chosen({ result_id: 'netease:123', from: { id: 42 }, inline_message_id: 'next', query: '床' });
  assert.ok(!h.calls.slice(before).some(c => /first NetEase download/.test(c.body.text || ''))); assert.equal(acquired, 2);
});
test('definitively expired playback IDs refresh once; ambiguous network failures never duplicate acquisition', async () => {
  for (const stale of [true, false]) {
    const h = harness({ names: 'original' }); let acquired = 0, invalidated = 0;
    h.deps.telegram = async (method, body) => {
      h.calls.push({ method, body });
      if (method === 'editMessageMedia' && acquired === 1) throw stale ? new TelegramRequestError(400, 'invalid file_id') : new Error('network failure'); return true;
    };
    const inline = new BotInline({ ...h.deps, acquire: async () => ({ ...audio, fileId: 'id-' + (++acquired) }), invalidate: async () => { invalidated++; } });
    await inline.chosen({ result_id: 'netease:123', from: { id: 42 }, inline_message_id: 'same', query: '床' });
    assert.equal(acquired, stale ? 2 : 1); assert.equal(invalidated, stale ? 1 : 0);
    assert.equal(h.calls.at(-1)!.method, stale ? 'editMessageMedia' : 'editMessageText');
    if (!stale) assert.equal(h.calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data, 'ip:42:n:123');
    assert.ok(!h.calls.some(c => c.method === 'deleteMessage' || c.method === 'sendMessage'));
  }
});

test('duplicate selection feedback shares work and metadata failures leave a retry on the same message', async () => {
  const h = harness({ names: 'original' }); let acquisitions = 0, resolve!: (record: CachedMusic) => void;
  const inline = new BotInline({ ...h.deps, acquire: async () => { acquisitions++; return new Promise(done => { resolve = done; }); } });
  const selected = { result_id: 'netease:123', from: { id: 42 }, inline_message_id: 'same', query: '床' };
  const a = inline.chosen(selected), b = inline.chosen(selected);
  await new Promise(done => setTimeout(done, 0)); assert.equal(acquisitions, 1); resolve(audio); await Promise.all([a, b]);
  assert.equal(h.calls.filter(c => c.method === 'editMessageMedia').length, 1);
  const failure = new BotInline({ ...h.deps, getTrack: async () => { throw new Error('private API diagnostic'); } });
  await failure.chosen({ ...selected, inline_message_id: 'failed-card' });
  assert.equal(h.calls.at(-1)!.method, 'editMessageText'); assert.equal(h.calls.at(-1)!.body.inline_message_id, 'failed-card');
  assert.equal(h.calls.at(-1)!.body.reply_markup.inline_keyboard[0][0].callback_data, 'ip:42:n:123'); assert.doesNotMatch(h.calls.at(-1)!.body.text, /private API/);
});

test('Inline inserts cached native FLAC without conversion; only a definitive format rejection requests a derivative', async () => {
  for (const rejection of [false, true, 'network'] as const) {
    const native={ ...audio, audio:{ codec:'FLAC',lossless:true } };
    const h=harness({ names:'original', record:native }); let conversions=0, edits=0;
    (h.deps as any).acquire=async()=>native;
    (h.deps as any).fallbackPlayback=async()=>{ conversions++; return { ...audio,presentation:'telegram-playback' }; };
    h.deps.telegram=async(method,body)=>{
      h.calls.push({method,body});
      if(method==='editMessageMedia' && ++edits===1 && rejection) {
        if(rejection==='network') throw new Error('Network interruption');
        throw new TelegramRequestError(400,'Unsupported audio file type');
      }
      return true;
    };
    await h.inline.chosen({ result_id:'netease:123', from:{id:42}, inline_message_id:'native-flac-inline',query:'Fixture' });
    assert.equal(conversions,rejection===true?1:0);
    if(!rejection) { assert.equal(h.calls.at(-1)!.method,'editMessageMedia'); assert.doesNotMatch(h.calls.at(-1)!.body.media.caption,/MP3 conversion/); }
    if(rejection===true) assert.match(h.calls.at(-1)!.body.media.caption,/MP3 conversion/);
  }
});
