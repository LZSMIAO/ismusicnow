import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotGroupReplies, withGroupReply, type GroupReplyRequest } from '../src/lib/server/bot-group-replies.js';
import { TelegramRequestError } from '../src/lib/server/bot-media.js';

const reply = { userId: 42, username: 'listener', name: '<listener>', requestId: 10, language: 'zh-Hant' as const };
const caption = '「歌曲」\n<blockquote expandable>專輯\n來源\n時長\n#NetEase #flac\nvia @muismbot</blockquote>';
const keyboard = { inline_keyboard: [[{ text: '來源', url: 'https://example.test' }]] };
const peer = -1000000000123;
async function fixture(work: (group: BotGroupReplies, calls: { method: string; body: Record<string, unknown> }[], request: GroupReplyRequest, root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'muism-group-replies-'));
  const calls: { method: string; body: Record<string, unknown> }[] = [];
  const request: GroupReplyRequest = async <T>(method: string, input: Record<string, unknown> | FormData) => {
    const body = input instanceof FormData ? Object.fromEntries(input) : { ...input };
    calls.push({ method, body }); return { message_id: 20 } as T;
  };
  try { await work(new BotGroupReplies('999', root), calls, request, root); } finally { await rm(root, { recursive: true, force: true }); }
}
const sendBody = (chat = peer) => withGroupReply({ chat_id: chat, audio: 'cached-file', caption, parse_mode: 'HTML', reply_markup: keyboard, message_thread_id: 7 }, reply);

test('expired group close checks the durable menu owner and its exact button after restart', () => fixture(async (group, calls, request, root) => {
  const data = 'close:1234567890abcdef:42:0123456789abcdef';
  await group.run('sendMessage', withGroupReply({ chat_id: peer, text: 'menu', reply_markup: { inline_keyboard: [[{ text: 'Close', callback_data: data }]] } }, reply), request);
  const restarted = new BotGroupReplies('999', root);
  assert.equal(await restarted.selectionCloseOwner(peer, 20, 42, data), true);
  assert.equal(await restarted.selectionCloseOwner(peer, 20, 43, data), false);
  assert.equal(await restarted.selectionCloseOwner(peer, 20, 42, data + '0'), false);
  assert.equal(await restarted.selectionCloseOwner(peer, 21, 42, data), undefined);
}));

test('group audio replies to the request without a top mention; missing reply retries only a definitive rejection', () => fixture(async (group, calls, request) => {
  await group.run('sendAudio', sendBody(), request);
  assert.deepEqual(calls[0]!.body.reply_parameters, { message_id: 10, allow_sending_without_reply: false });
  assert.equal(calls[0]!.body.caption, caption); assert.ok(!('muism_group_reply' in calls[0]!.body));
  let tries = 0;
  const rejected: GroupReplyRequest = async <T>(method: string, body: Record<string, unknown> | FormData) => {
    if (++tries === 1) throw new TelegramRequestError(400, 'Bad Request: message to be replied not found');
    return request<T>(method, body);
  };
  await group.run('sendAudio', sendBody(), rejected);
  const body = calls.at(-1)!.body;
  assert.equal(body.reply_parameters, undefined); assert.equal(body.message_thread_id, 7);
  assert.match(String(body.caption), /<\/blockquote>\n由 <a href="tg:\/\/user\?id=42">@listener<\/a> 獲取$/);
  await assert.rejects(group.run('sendAudio', sendBody(), async () => { throw new Error('timeout'); }), /timeout/);
  assert.equal(calls.length, 2, 'an ambiguous network failure never reposts music');
}));

test('deleted original gets one footer below details, survives restart and later caption edits', () => fixture(async (group, calls, request, root) => {
  await group.run('sendAudio', sendBody(), request);
  const restarted = new BotGroupReplies('999', root);
  await restarted.deleted(peer, [10], request);
  assert.equal(calls[1]!.method, 'editMessageCaption');
  assert.deepEqual(calls[1]!.body.reply_markup, keyboard); assert.match(String(calls[1]!.body.caption), /#NetEase #flac/);
  await restarted.deleted(peer, [10], request); assert.equal(calls.length, 2);
  await restarted.run('editMessageCaption', { chat_id: peer, message_id: 20, caption: caption.replace('專輯', '新專輯'), parse_mode: 'HTML', reply_markup: keyboard }, request);
  assert.equal((String(calls.at(-1)!.body.caption).match(/由 /g) || []).length, 1);
  assert.match(String(calls.at(-1)!.body.caption), /新專輯/);
}));

test('delete events stay in their peer; deleting our own card never recreates it', () => fixture(async (group, calls, request) => {
  await group.run('sendAudio', sendBody(), request);
  await group.deleted(peer - 1, [10], request);
  await group.deleted(undefined, [10], request); assert.equal(calls.length, 1, 'peerless event cannot match a channel ID');
  await group.deleted(peer, [20, 10], request); assert.equal(calls.length, 1);
  await group.deleted(peer, [10], request); assert.equal(calls.length, 1);
}));

test('basic group events and callback fallback preserve rich content and escape requester names', () => fixture(async (group, calls, request) => {
  const html = '<p>歌曲</p><details><summary>詳情</summary><p>#來源</p></details>';
  await group.run('sendRichMessage', withGroupReply({ chat_id: -123, rich_message: { html }, reply_markup: keyboard }, { ...reply, username: undefined }), request);
  await group.deleted(undefined, [10], request);
  assert.equal((calls[1]!.body.rich_message as { html: string }).html, html + '<p>由 <a href="tg://user?id=42">&lt;listener&gt;</a> 獲取</p>');
  await group.run('sendAudio', sendBody(), request);
  await group.observe({ message_id: 20, date: 1, from: { id: 999 }, chat: { id: peer, type: 'supergroup' } }, request);
  assert.equal(calls.at(-1)!.method, 'editMessageCaption');
}));

test('source deletion during delivery still updates the newly returned music card', () => fixture(async (group, calls, request) => {
  const delayed: GroupReplyRequest = async <T>(method: string, body: Record<string, unknown> | FormData) => {
    if (method === 'sendAudio') await group.deleted(peer, [10], request); return request<T>(method, body);
  };
  await group.run('sendAudio', sendBody(), delayed);
  assert.deepEqual(calls.map(call => call.method), ['sendAudio', 'editMessageCaption']);
}));

test('concurrent disclosure and pagination retain the latest page and one footer', () => fixture(async (group, calls, request) => {
  await group.run('sendMessage', withGroupReply({ chat_id: peer, text: '<b>Page 1</b>', parse_mode: 'HTML' }, reply), request);
  await Promise.all([group.deleted(peer, [10], request), group.run('editMessageText', { chat_id: peer, message_id: 20, text: '<b>Page 2</b>', parse_mode: 'HTML' }, request)]);
  assert.match(String(calls.at(-1)!.body.text), /Page 2/);
  assert.equal((String(calls.at(-1)!.body.text).match(/由 /g) || []).length, 1);
}));
