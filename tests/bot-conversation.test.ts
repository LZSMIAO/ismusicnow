import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotMessageCleanup } from '../src/lib/server/bot-cleanup.js';
import { BotSelections, selectionMessage } from '../src/lib/server/bot-selection.js';
import { TelegramRequestError } from '../src/lib/server/bot-media.js';
import type { Collection } from '../src/lib/types.js';

const collection: Collection = { provider: 'netease', kind: 'search', title: '草東沒有派對', total: 12, warnings: [],
  tracks: Array.from({ length: 10 }, (_, i) => ({ id: String(10000 + i), provider: 'netease', title: `歌曲 ${i + 1}`, artists: ['草東沒有派對'], album: '醜奴兒', durationMs: 150000, cover: '', sourceUrl: `https://music.163.com/song?id=${10000 + i}` })) };

test('selection numbers are scoped to user/chat, absolute across pages, and expire', () => {
  let now = 1000;
  const choices = new BotSelections(() => now), session = choices.create(7, 42, 90, collection);
  session.menuId = 91;
  assert.equal(choices.number(7, 42, '9')?.track?.id, '10008');
  assert.equal(choices.number(8, 42, '1'), undefined);
  assert.equal(choices.number(7, 43, '1'), undefined);
  assert.throws(() => choices.number(7, 43, '1', 91), { code: 'SELECTION_OWNER' });
  assert.throws(() => choices.get(7, 43, session.id, 91), { code: 'SELECTION_OWNER' });
  assert.throws(() => choices.number(7, 42, '11'), { code: 'SELECTION_NUMBER' });
  assert.throws(() => choices.get(7, 42, session.id, 92), { code: 'SELECTION_OWNER' });
  assert.equal(choices.number(7, 42, '10000'), undefined);
  session.page = 1;
  const page = selectionMessage(session, 'en');
  assert.match(page.text, /9–10 \/ 10/); assert.match(page.text, /Showing loaded results/);
  assert.match(page.text, /醜奴兒 · 2:30/);
  assert.doesNotMatch(page.text, /<blockquote/);
  assert.match(page.rich_message.html, /<details><summary>/);
  assert.doesNotMatch(page.text, /tg-spoiler/);
  assert.equal(page.reply_markup.inline_keyboard.flat().find(button => button.callback_data.startsWith('pick:'))!.callback_data, `pick:${session.id}:8`);
  assert.equal(page.reply_markup.inline_keyboard.at(-1)![0]!.callback_data, `page:${session.id}:0`);
  now += 30 * 60_000;
  assert.equal(choices.number(7, 42, '1'), undefined);
  assert.throws(() => choices.get(7, 42, session.id), { code: 'SELECTION_EXPIRED' });
});

test('delivered searches clean both inputs and the selector, while album/playlist selectors stay usable', () => {
  for (const kind of ['search', 'album', 'playlist'] as const) {
    const choices = new BotSelections(), session = choices.create(7, 42, 90, { ...collection, kind });
    session.menuId = 91; choices.reply(session, 92);
    assert.deepEqual(choices.delivered(7, 92), { inputIds: [92, 90], menuId: kind === 'search' ? 91 : undefined });
    if (kind === 'search') assert.throws(() => choices.get(7, 42, session.id), { code: 'SELECTION_EXPIRED' });
    else assert.equal(choices.get(7, 42, session.id), session);
    assert.deepEqual(choices.delivered(7, 999), { inputIds: [999] });
  }
});

test('delayed cleanup survives restart, waits until due, deduplicates and isolates bot IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-cleanup-'));
  let now = 1000;
  const removed: number[][] = [];
  try {
    const queue = new BotMessageCleanup('42', async (...ids) => { removed.push(ids); }, root, () => now);
    await Promise.all([queue.schedule(7, 90, 60_000), queue.schedule(7, 91, 2000), queue.schedule(7, 91, 3000)]);
    await queue.flush(); assert.equal(removed.length, 0);
    now += 3000;
    await new BotMessageCleanup('42', async (...ids) => { removed.push(ids); }, root, () => now).flush();
    assert.deepEqual(removed, [[7, 91]]);
    await new BotMessageCleanup('43', async () => { throw new Error('Another bot must not delete these messages'); }, root, () => now).flush();
    now += 60_000;
    await new BotMessageCleanup('42', async (...ids) => { removed.push(ids); }, root, () => now).flush();
    assert.deepEqual(removed, [[7, 91], [7, 90]]);
    assert.equal((await stat(join(root, 'bot-cleanup', '42.json'))).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cleanup handles Telegram permission/missing errors once and retries transient failures after backoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-cleanup-'));
  let now = 1000;
  const attempts: number[] = [];
  try {
    const queue = new BotMessageCleanup('42', async (_chat, id) => {
      attempts.push(id);
      if (id === 90) throw new TelegramRequestError(403, 'no permission');
      if (id === 91) throw new TelegramRequestError(400, 'message not found');
      if (id === 92 && attempts.filter((value) => value === 92).length === 1) throw new TelegramRequestError(429, 'retry later');
    }, root, () => now);
    for (const id of [90, 91, 92]) await queue.schedule(7, id, 0);
    await queue.flush(); assert.deepEqual(attempts, [90, 91, 92]);
    await queue.flush(); assert.deepEqual(attempts, [90, 91, 92]);
    now += 60_000; await queue.flush(); assert.deepEqual(attempts, [90, 91, 92, 92]);
    assert.deepEqual(JSON.parse(await readFile(join(root, 'bot-cleanup', '42.json'), 'utf8')), []);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('forum selection numbers and callbacks cannot cross topics, even for the same member', () => {
  const choices = new BotSelections();
  const a = choices.create(-100, 42, 90, collection, 10), b = choices.create(-100, 42, 100, collection, 20);
  a.menuId = 91; b.menuId = 101;
  assert.equal(choices.number(-100, 42, '1', undefined, 10)?.session.id, a.id);
  assert.equal(choices.number(-100, 42, '2', undefined, 20)?.session.id, b.id);
  assert.equal(choices.number(-100, 42, '1'), undefined);
  assert.throws(() => choices.number(-100, 42, '1', 91, 20), { code: 'SELECTION_OWNER' });
  assert.throws(() => choices.get(-100, 42, a.id, 91, 20), { code: 'SELECTION_OWNER' });
  assert.equal(choices.get(-100, 42, a.id, 91, 10), a);
  assert.match(selectionMessage(a, 'en').text, /tg:\/\/user\?id=42/);
  choices.delivered(-100, 90);
  assert.equal(choices.number(-100, 42, '2', undefined, 20)?.session.id, b.id);
});

test('an action removes its own panel immediately and persists a transient deletion failure for retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-immediate-'));
  let now = 1000, attempts = 0;
  const removed: number[] = [];
  try {
    const queue = new BotMessageCleanup('42', async (_chat, id) => {
      if (id === 91 && ++attempts === 1) throw new TelegramRequestError(429, 'retry');
      removed.push(id);
    }, root, () => now);
    await queue.schedule(7, 90, 60_000);
    await queue.removeNow(7, 92); assert.deepEqual(removed, [92]);
    await queue.removeNow(7, 91); assert.deepEqual(removed, [92]);
    now += 60_000;
    await new BotMessageCleanup('42', async (_chat, id) => { removed.push(id); }, root, () => now).flush();
    assert.deepEqual(new Set(removed), new Set([90, 91, 92]));
  } finally { await rm(root, { recursive: true, force: true }); }
});
