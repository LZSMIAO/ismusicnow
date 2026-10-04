import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Track, Collection } from '../src/lib/types.js';
import { sameRecording, recordingGroups, rankedSources, trackIdentity, sourceFallbackAllowed, type SourceEvidence } from '../src/lib/server/bot-recordings.js';
import { BotSelections, selectionMessage, selectionCount, selectionLifetime } from '../src/lib/server/bot-selection.js';
import { BotSelectionDelivery } from '../src/lib/server/bot-selection-delivery.js';
import { TelegramRequestError } from '../src/lib/server/bot-media.js';
import { botLanguages } from '../src/lib/server/bot-i18n.js';
const n: Track = { provider: 'netease', id: '123', title: '爛泥', artists: ['草東沒有派對'], album: '醜奴兒', durationMs: 150000, cover: '', sourceUrl: 'https://music.163.com/song?id=123' };
const s: Track = { ...n, provider: 'spotify', id: 'a'.repeat(22), title: '烂泥', artists: ['草东没有派对'], album: '丑奴儿' };
const collection = (tracks: Track[], kind: Collection['kind'] = 'search'): Collection => ({ title: 'query', provider: 'netease', searchScope: 'all', kind, tracks, total: tracks.length, warnings: [] });
test('only confident same recordings group; covers, versions, releases, ISRC conflicts and unknown metadata stay separate', () => {
  assert.ok(sameRecording(n, s));
  for (const change of [{ artists: ['Cover singer'] }, { title: '烂泥 (Live)' }, { album: 'Another recording' }, { durationMs: 151001 }, { durationMs: 0 }, { durationMs: Infinity }, { artists: [] }, { album: '' }]) assert.ok(!sameRecording(n, { ...s, ...change }), JSON.stringify(change));
  const code = 'TWAAA2300001';
  assert.ok(sameRecording({ ...n, isrc: code }, { ...s, album: 'Compilation', isrc: code }));
  assert.ok(!sameRecording({ ...n, isrc: code }, { ...s, isrc: 'TWAAA2300002' }));
  assert.equal(recordingGroups(collection([n, s, { ...n }, { ...s, id: 'b'.repeat(22), title: s.title + ' (Live)' }])).length, 2);
  assert.equal(recordingGroups(collection([n, s], 'album')).length, 2, 'collection order is never coalesced');
  assert.ok(!sameRecording(n, { ...n, id: 'another' }), 'same platform release IDs remain distinct');
});
test('pairwise matching prevents transitive duration groups and entities never collapse by name', () => {
  const tracks: Track[] = [n, { ...s, durationMs: 151000 }, { ...n, provider: 'ytm', id: 'abcdefghijk', durationMs: 152000 }];
  assert.deepEqual(recordingGroups(collection(tracks)).map(group => group.tracks.length), [2, 1]);
  const value = { ...collection([]), searchType: 'artist' as const, entities: [n, s].map(track => ({ ...track, kind: 'artist' as const })) };
  assert.equal(selectionCount(new BotSelections().create(7, 42, 1, value)), 2);
});
test('source rank is identity-local, based on measured evidence and never a fixed provider preference', () => {
  const group = { tracks: [n, s] }, evidence = new Map<string, SourceEvidence>();
  evidence.set(trackIdentity(s), { availability: 'complete', lossless: true, cached: true, sampleRate: 48000, bitsPerSample: 24 });
  assert.equal(rankedSources(group, evidence)[0]!.provider, 'spotify');
  evidence.set(trackIdentity(n), { availability: 'complete', lossless: true, cached: true, sampleRate: 96000, bitsPerSample: 24 });
  assert.equal(rankedSources(group, evidence)[0]!.provider, 'netease');
  evidence.set(trackIdentity(n), { availability: 'unavailable', lossless: true });
  assert.equal(rankedSources(group, evidence)[0]!.provider, 'spotify');
  assert.deepEqual(rankedSources(group), rankedSources({ tracks: [s, n] }), 'tie break is stable across upstream arrival order');
  assert.ok(sourceFallbackAllowed({ code: 'PREVIEW_ONLY' }));
  for (const error of [new Error('timeout'), { code: 'TELEGRAM_ERROR' }, { code: 'NETWORK_ERROR' }, { code: 'ADAPTER_FAILED' }]) assert.ok(!sourceFallbackAllowed(error));
});
test('eight table rows are direct actions with optional source panels/details, bounded text and all translations', () => {
  const tracks = Array.from({ length: 10 }, (_, i) => ({ ...n, id: String(i), title: '長'.repeat(600) + ` ${i} (Live)`, artists: ['A'.repeat(600)], album: 'B'.repeat(600) }));
  const session = new BotSelections().create(7, 42, 1, collection(tracks));
  for (const ui of botLanguages) {
    const value = selectionMessage(session, ui), html = value.rich_message.html;
    assert.equal((html.match(/<tr>/g) || []).length, 9);
    assert.match(html, /\(Live\)/); assert.match(html, /<details><summary>/); assert.doesNotMatch(html, /<details open|tg-spoiler/);
    assert.ok(value.text.replace(/<[^>]+>/g, '').length < 4096);
    for (const data of [...html.matchAll(/data="([^"]+)"/g)].map(match => match[1]!)) assert.ok(Buffer.byteLength(data) <= 64);
    assert.ok(!value.rich_keyboard.inline_keyboard.flat().some(button => /^\d+$/.test(button.text)));
  }
  const grouped = new BotSelections().create(7, 42, 1, collection([n, s]));
  assert.equal(selectionCount(grouped), 1);
  assert.match(selectionMessage(grouped, 'en').rich_message.html, /\+1 sources/);
  grouped.panel = 'providers';
  assert.doesNotMatch(selectionMessage(grouped, 'en').rich_message.html, />YTM</, 'link-only adapter does not appear as a keyword search source');
  grouped.panel = { group: 0 };
  assert.match(selectionMessage(grouped, 'en').rich_message.html, /from:[a-f0-9]+:0:1/);
});
test('source ordering and request lookup expire, and replacement invalidates old callbacks only after successful edit', () => {
  let now = 1000;
  const selections = new BotSelections(() => now), session = selections.create(7, 42, 1, collection([n, s]));
  session.menuId = 2;
  selections.rank(session, new Map([[trackIdentity(s), { availability: 'complete' }]]));
  assert.equal(selections.track(session, 0).provider, 'spotify');
  const replacement = selections.replace(session, collection([n]));
  assert.equal(selections.get(7, 42, session.id, 2), session);
  selections.commit(replacement);
  assert.throws(() => selections.get(7, 42, session.id), { code: 'SELECTION_EXPIRED' });
  now += selectionLifetime;
  assert.equal(selections.request(7, 42, 1), undefined);
});
test('RichMessage transport keeps a single message, edits pages and only falls back after explicit unsupported rejection', async () => {
  const calls: { method: string; body: any }[] = [];
  const session = new BotSelections().create(-100, 42, 1, collection([n]), 10);
  const transport = new BotSelectionDelivery(async (method, body) => { calls.push({ method, body }); return { message_id: 2 } as any; }, true);
  const sent = await transport.show(session, 'en', 'original'); session.menuId = sent.message_id;
  assert.equal(calls[0]!.method, 'sendRichMessage'); assert.equal(calls[0]!.body.message_thread_id, 10); assert.equal(calls[0]!.body.text, undefined);
  await transport.show(session, 'en', 'original', true);
  assert.equal(calls[1]!.method, 'editMessageText'); assert.equal(calls[1]!.body.message_id, 2);
  const unsupported = new BotSelectionDelivery(async (method, body) => { calls.push({ method, body }); if (method === 'sendRichMessage') throw new TelegramRequestError(404, 'Not Found'); return { message_id: 3 } as any; }, true);
  const fresh = new BotSelections().create(7, 42, 1, collection([n, s]));
  await unsupported.show(fresh, 'en', 'original');
  assert.equal(calls.at(-1)!.method, 'sendMessage'); assert.ok(calls.at(-1)!.body.reply_markup.inline_keyboard.flat().some((button: any) => button.callback_data.startsWith('from:')));
  let attempts = 0;
  const uncertain = new BotSelectionDelivery(async () => { attempts++; throw new Error('network interrupted'); }, true);
  await assert.rejects(uncertain.show(new BotSelections().create(7, 42, 1, collection([n])), 'en', 'original'));
  assert.equal(attempts, 1, 'ambiguous delivery must not duplicate a message');
});
