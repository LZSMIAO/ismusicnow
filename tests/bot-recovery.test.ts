import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { selectionCloseData, canCloseSelection } from '../src/lib/server/bot-close.js';
import { botTransport, botUploadFile, checkBotUpload, botRequestTimeout } from '../src/lib/server/bot-transport.js';
import { BotSelections } from '../src/lib/server/bot-selection.js';
import { BotSettingsStore } from '../src/lib/server/bot-settings.js';
import { botError, botLanguages } from '../src/lib/server/bot-i18n.js';

test('signed close survives missing search/topic metadata and stays bound to actor, bot and chat', () => {
  const target = { id: '1234567890abcdef', chatId: -100123, userId: 42, messageThreadId: 8 };
  const data = selectionCloseData(target, 'secret');
  const message = { from: { id: 999 }, chat: { id: target.chatId, type: 'supergroup' }, message_thread_id: 8 };
  assert.ok(canCloseSelection(message, 42, data, 999, 'secret'));
  assert.ok(!canCloseSelection(message, 42, data, 999, 'secret', true), 'new group close buttons require their persisted menu binding');
  assert.ok(!canCloseSelection(message, 43, data, 999, 'secret'));
  assert.ok(!canCloseSelection({ ...message, chat: { id: -100124 } }, 42, data, 999, 'secret'));
  assert.ok(canCloseSelection({ ...message, message_thread_id: undefined }, 42, data, 999, 'secret'));
  assert.ok(canCloseSelection({ ...message, message_thread_id: 9 }, 42, data, 999, 'secret'));
  assert.ok(!canCloseSelection({ ...message, from: { id: 998 } }, 42, data, 999, 'secret'));
  assert.ok(!canCloseSelection(message, 42, data, 999, 'other-secret'));
  assert.ok(!canCloseSelection(message, 42, data.slice(0,-1) + (data.endsWith('0') ? '1' : '0'), 999, 'secret'));
  assert.ok(Buffer.byteLength(selectionCloseData({ ...target, userId: 4503599627370495 }, 'secret')) <= 64);
  const oldData = `close:${target.id}:42:` + createHmac('sha256', 'secret').update(JSON.stringify([target.id, target.chatId, null, 42])).digest('hex').slice(0, 16);
  assert.ok(canCloseSelection(message, 42, oldData, 999, 'secret'), 'already-sent ordinary reply menus remain closeable');
  assert.ok(!canCloseSelection({ ...message, is_topic_message: true }, 42, oldData, 999, 'secret'));
  const legacy = 'close:' + target.id;
  assert.ok(canCloseSelection({ from: { id: 999 }, chat: { id: 42, type: 'private' } }, 42, legacy, 999, 'secret'));
  assert.ok(!canCloseSelection(message, 42, legacy, 999, 'secret'));
  assert.ok(canCloseSelection({ ...message, entities: [{ type: 'text_mention', offset: 0, user: { id: 42 } }] }, 42, legacy, 999, 'secret'));
});

test('cloud and local limits reflect actual endpoint; disk blobs preserve bytes without an eager file copy', async () => {
  const cloud = {}, local = { BOT_API_LOCAL: '1', BOT_API_BASE_URL: 'http://telegram-api:8081' };
  assert.equal(botTransport(cloud).maxUploadBytes, 50 * 1024 * 1024);
  assert.equal(botTransport(local).maxUploadBytes, 2000 * 1024 * 1024);
  checkBotUpload(50 * 1024 * 1024, cloud);
  assert.throws(() => checkBotUpload(50 * 1024 * 1024 + 1, cloud), { code: 'FILE_TOO_LARGE' });
  checkBotUpload(2000 * 1024 * 1024, local);
  assert.throws(() => checkBotUpload(2000 * 1024 * 1024 + 1, local), { code: 'FILE_TOO_LARGE' });
  for (const base of ['http://public.example/', 'https://u:p@example.test', 'https://example.test/path', 'https://example.test/?q=1']) assert.throws(() => botTransport({ BOT_API_BASE_URL: base }));
  assert.throws(() => botTransport({ BOT_API_LOCAL: '1' }));
  assert.throws(() => botTransport({ ...local, BOT_API_BASE_URL: 'http://public.example' }));
  assert.equal(botRequestTimeout('sendAudio', new FormData(), true), 1800000);
  assert.equal(botRequestTimeout('getUpdates', {}, true), 40000);
  const root = await mkdtemp(join(tmpdir(), 'muism-upload-'));
  try {
    const bytes = Buffer.from('ID3fixture'); const path = join(root, 'fixture.mp3'); await writeFile(path, bytes);
    const file = await botUploadFile(path); assert.equal(file.type, 'audio/mpeg'); assert.equal(file.size, bytes.length);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes);
    const saved = { ...process.env };
    try { Object.assign(process.env, local); for (const language of botLanguages) assert.match(botError(language, 'FILE_TOO_LARGE'), /2000/); }
    finally { process.env = saved; }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('closing a busy result also cancels pending replacements; layout preference survives restart independently of locale', async () => {
  const selections = new BotSelections();
  const collection = { provider: 'netease' as const, kind: 'search' as const, title: 'query', tracks: [], total: 0, warnings: [] };
  const session = selections.create(42, 42, 1, collection); session.menuId = 99; session.busy = true;
  const replacement = selections.replace(session, collection);
  selections.close(session);
  assert.ok(replacement.closed); assert.throws(() => selections.replace(session, collection), { code: 'SELECTION_CLOSED' });
  assert.throws(() => selections.get(42,42,replacement.id), { code: 'SELECTION_EXPIRED' });
  selections.abort(replacement);
  assert.equal(selections.request(42,42,1), undefined);
  const root = await mkdtemp(join(tmpdir(), 'muism-layout-'));
  try {
    const store = new BotSettingsStore(root); await store.setRichSearch(42, false); await store.setUiLanguage(42,'ja');
    assert.deepEqual(await new BotSettingsStore(root).get(42), { richSearch: false, uiLanguage: 'ja' });
    await store.setRichSearch(42,true); assert.equal((await store.get(42)).richSearch,true);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('real handler switches rich to buttons in place, remembers it for later searches, and closes expired menus without a notice', async () => {
  const env = { ...process.env }, realFetch = globalThis.fetch, realNow = Date.now;
  const root = await mkdtemp(join(tmpdir(), 'muism-recovery-handler-'));
  let now = realNow(), nextId = 100, pendingAlbum: (() => void) | undefined, signalAlbum: (() => void) | undefined;
  Date.now = () => now;
  Object.assign(process.env, { DATA_DIR: root, BOT_TOKEN: '999666:stub', BOT_ALLOWED_USERS: '', BOT_RICH_SEARCH: '1', NETEASE_API_URL: 'https://recovery.example.test', SPOTIFY_ACCESS_TOKEN: '' });
  delete process.env.BOT_API_LOCAL; delete process.env.BOT_API_BASE_URL;
  const calls: { method: string; body: any }[] = [];
  globalThis.fetch = async (url, init) => {
    const address = String(url), body = JSON.parse(String(init?.body || '{}'));
    if (address.startsWith('https://recovery.example.test')) {
      if (body.type === 10 && signalAlbum) { signalAlbum(); await new Promise<void>(resolve => { pendingAlbum = resolve; }); }
      return Response.json({ code: 200, result: { songs: [{ id: 123, name: 'Fixture', ar: [{ name: 'Artist' }], al: { name: 'Album' }, dt: 150000 }], songCount: 1, albums: [{ id: 12, name: 'Album', artist: { name: 'Artist' } }], albumCount: 1 } });
    }
    if (address.includes('spotify.com')) return Response.json({ error: 'Unavailable' }, { status: 503 });
    assert.ok(address.startsWith('https://api.telegram.org/bot999666:stub/'));
    const method = address.split('/').at(-1)!; calls.push({ method, body });
    return Response.json({ ok: true, result: ['sendMessage','sendRichMessage'].includes(method) ? { message_id: ++nextId } : true });
  };
  try {
    const script = '../scripts/bot.js?recovery'; const { handle } = await import(script);
    const search = async (id: number) => { now += 3100; await handle({ update_id: id, message: { message_id: id, chat: { id: 42, type: 'private' }, from: { id: 42, language_code: 'en' }, text: '/search netease Fixture' } }); };
    const callback = (data: string, menu: number, actor = 42) => handle({ update_id: 99, callback_query: { id: 'stub', from: { id: actor, language_code: 'en' }, data, message: { message_id: menu, from: { id: 999666 }, chat: { id: 42, type: 'private' } } } });
    const panel = () => calls.findLast(call => ['sendRichMessage','sendMessage','editMessageText'].includes(call.method))!.body;
    const button = (prefix: string) => panel().reply_markup.inline_keyboard.flat().find((b: any) => b.callback_data.startsWith(prefix)).callback_data;
    await search(1); assert.ok(panel().rich_message); const menu = nextId, layout = button('layout:');
    await callback(layout,menu,43); assert.ok(!calls.some(c => c.method === 'editMessageText'));
    await callback(layout,menu); assert.equal(panel().message_id,menu); assert.ok(panel().text); assert.equal(panel().rich_message,undefined);
    assert.ok(panel().reply_markup.inline_keyboard.flat().some((b: any) => b.callback_data.startsWith('pick:')));
    await search(2); assert.ok(panel().text); assert.equal(panel().rich_message,undefined);
    await callback(button('layout:'),nextId); assert.ok(panel().rich_message);
    const close = button('close:'), expiredMenu = nextId;
    now += 31 * 60000; const notices = calls.filter(c=>c.method==='sendMessage').length;
    await callback(close,expiredMenu); assert.ok(calls.some(c=>c.method==='deleteMessage' && c.body.message_id===expiredMenu));
    assert.equal(calls.filter(c=>c.method==='sendMessage').length,notices);
    await callback('close:0123456789abcdef',55); assert.ok(calls.some(c=>c.method==='deleteMessage' && c.body.message_id===55));
    await search(3); const concurrentMenu=nextId, concurrentClose=button('close:');
    const category=panel().rich_message.html.match(/data="(type:[^"]+:album)"/)[1];
    const ready=new Promise<void>(resolve=>{signalAlbum=resolve;});
    const switching=callback(category,concurrentMenu); await ready;
    await callback(concurrentClose,concurrentMenu); const edits=calls.filter(c=>c.method==='editMessageText').length;
    pendingAlbum!(); await switching; assert.equal(calls.filter(c=>c.method==='editMessageText').length,edits,'pending search cannot reopen the closed menu');
    assert.ok(!calls.findLast(c=>c.method==='sendMessage')?.body.text.includes('unavailable'));
  } finally { process.env=env; globalThis.fetch=realFetch; Date.now=realNow; await rm(root,{recursive:true,force:true}); }
});
