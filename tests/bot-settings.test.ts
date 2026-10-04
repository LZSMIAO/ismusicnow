import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotLanguageSettings, BotSettingsStore, displayTrack } from '../src/lib/server/bot-settings.js';
import type { Track } from '../src/lib/types.js';

const track: Track = { id: '123', provider: 'netease', title: '人是猫', artists: ['张卡斯', '洛天依'], album: '人是猫', durationMs: 136000, cover: '', sourceUrl: 'https://music.163.com/song?id=123' };

test('NetEase Chinese preferences convert metadata; other providers always preserve source names', () => {
  assert.deepEqual(displayTrack(track, 'original'), track);
  const traditional = displayTrack(track, 'zh-Hant');
  assert.equal(traditional.title, '人是貓'); assert.equal(traditional.album, '人是貓'); assert.deepEqual(traditional.artists, ['張卡斯', '洛天依']);
  assert.equal(traditional.id, track.id); assert.equal(traditional.sourceUrl, track.sourceUrl);
  assert.deepEqual(displayTrack(traditional, 'zh-Hans'), track);
  assert.equal(track.title, '人是猫');
  for (const provider of ['spotify', 'ytm'] as const) {
    const other = { ...track, provider };
    assert.deepEqual(displayTrack(other, 'zh-Hant'), other);
    assert.deepEqual(displayTrack({ ...traditional, provider }, 'zh-Hans'), { ...traditional, provider });
  }
});

test('TC and SC normalize Chinese parts while native English, Japanese and Korean names remain unchanged', () => {
  const chinese = { ...track, title: '音乐 Music', artists: ['张卡斯', 'Taylor Swift'], album: '人是猫 / Original' };
  assert.equal(displayTrack(chinese, 'zh-Hant').title, '音樂 Music');
  assert.deepEqual(displayTrack(chinese, 'zh-Hant').artists, ['張卡斯', 'Taylor Swift']);
  const japanese = { ...track, title: '海の幽霊', album: '海の幽霊', artists: ['米津玄師'], metadataLanguages: { artists: ['ja'] } };
  for (const choice of ['zh-Hant', 'zh-Hans'] as const) assert.deepEqual(displayTrack(japanese, choice), japanese);
  const kanjiOnly = { ...japanese, title: '飛燕', album: '平熱' };
  assert.equal(displayTrack(kanjiOnly, 'zh-Hans').title, '飛燕');
  assert.equal(displayTrack(kanjiOnly, 'zh-Hans').artists[0], '米津玄師');
  const korean = { ...track, artists: ['김윤아'], title: '봄날', album: '春' };
  assert.deepEqual(displayTrack(korean, 'zh-Hans'), korean);
  const duet = { ...chinese, artists: ['张卡斯', '宇多田ヒカル'], metadataLanguages: { title: 'zh', album: 'zh', artists: ['zh', 'ja'] } };
  assert.deepEqual(displayTrack(duet, 'zh-Hant').artists, ['張卡斯', '宇多田ヒカル']);
});

test('first NetEase acquisition pauses, offers choices and resumes exactly once after a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const messages: { text: string; extra?: Record<string, unknown> }[] = [], acquisitions: unknown[][] = [];
    const send = async (_chat: number, text: string, extra?: Record<string, unknown>) => { messages.push({ text, extra }); };
    const acquire = async (...args: Parameters<ConstructorParameters<typeof BotLanguageSettings>[2]>) => { acquisitions.push(args); };
    const flow = new BotLanguageSettings(new BotSettingsStore(root), send, acquire);
    await flow.observeLanguage(42, 'zh-TW');
    await flow.request(7, 42, track, 90);
    assert.equal(acquisitions.length, 0);
    assert.match(messages[0]!.text, /首次獲取網易雲/);
    assert.match(JSON.stringify(messages[0]!.extra), /Original.*中文統一繁體.*中文统一简体/);
    assert.doesNotMatch(JSON.stringify(messages[0]!.extra), /其他語言/);
    const restored = new BotLanguageSettings(new BotSettingsStore(root), send, acquire);
    await Promise.all([restored.callback(7, 42, 'lang:42:zh-Hant'), restored.callback(7, 42, 'lang:42:zh-Hant')]);
    assert.deepEqual(acquisitions, [[7, 42, track, 'zh-Hant', 90]]);
    assert.equal((await stat(join(root, 'bot-users', '42.json'))).mode & 0o777, 0o600);
    await restored.request(8, 42, track, 91);
    assert.deepEqual(acquisitions.at(-1), [8, 42, track, 'zh-Hant', 91]);
    assert.equal((await new BotSettingsStore(root).get(42)).language, 'zh-Hant');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Spotify and YTM bypass Chinese settings without consuming a pending NetEase request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const store = new BotSettingsStore(root), acquisitions: unknown[][] = [], messages: string[] = [];
    const flow = new BotLanguageSettings(store, async (_id, text) => { messages.push(text); }, async (...args) => { acquisitions.push(args); });
    await flow.request(7, 42, { ...track, provider: 'spotify' }, 80);
    assert.equal(messages.length, 0); assert.deepEqual(await store.get(42), {});
    await flow.request(7, 42, track, 90);
    await flow.request(7, 42, { ...track, provider: 'ytm' }, 91);
    assert.equal((await store.get(42)).pending?.track.provider, 'netease');
    await flow.callback(7, 42, 'lang:42:zh-Hant');
    assert.deepEqual(acquisitions.map((a) => [a[2], a[3]]), [[{ ...track, provider: 'spotify' }, 'original'], [{ ...track, provider: 'ytm' }, 'original'], [track, 'zh-Hant']]);
    await flow.request(7, 42, { ...track, provider: 'spotify' }, 92);
    assert.equal(acquisitions.at(-1)?.[3], 'original');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('UI language persists independently of NetEase spelling and pending first-use requests', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const store = new BotSettingsStore(root), messages: { text: string; extra?: Record<string, unknown> }[] = [], acquisitions: unknown[][] = [];
    const send = async (_chat: number, text: string, extra?: Record<string, unknown>) => { messages.push({ text, extra }); };
    const flow = new BotLanguageSettings(store, send, async (...args) => { acquisitions.push(args); }, async () => { throw new Error('Menu update failed'); });
    await flow.request(7, 42, track, 90);
    await flow.callback(7, 42, 'ui:42:en');
    assert.equal(acquisitions.length, 0);
    assert.equal((await store.get(42)).pending?.track.title, '人是猫');
    assert.equal((await store.get(42)).language, undefined);
    assert.equal(await new BotLanguageSettings(new BotSettingsStore(root), send, async () => {}).locale(42), 'en');
    assert.match(messages.at(-1)!.text, /Bot settings/);
    await flow.callback(7, 42, 'lang:42:zh-Hant');
    assert.equal(acquisitions.at(-1)?.[3], 'zh-Hant');
    await flow.callback(7, 42, 'ui:42:ja');
    assert.equal((await store.get(42)).language, 'zh-Hant');
    await flow.callback(7, 11, 'ui:42:ru');
    assert.equal(await flow.locale(42), 'ja'); assert.equal(await flow.locale(11), 'en');
    await flow.showUi(7, 42);
    const keyboard = (messages.at(-1)!.extra?.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard;
    assert.equal(keyboard.flat().filter((b) => b.callback_data.startsWith('ui:')).length, 8);
    assert.doesNotMatch(JSON.stringify(keyboard), /Deutsch|Português/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('group setting buttons are bound to the owner; preferences stay isolated and can be changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const store = new BotSettingsStore(root), messages: string[] = [];
    const flow = new BotLanguageSettings(store, async (_id, text) => { messages.push(text); }, async () => { throw new Error('No pending track'); });
    await flow.callback(-100, 11, 'lang:42:zh-Hans');
    assert.match(messages.at(-1)!, /another user/); assert.deepEqual(await store.get(11), {}); assert.deepEqual(await store.get(42), {});
    await flow.callback(-100, 42, 'lang:42:original');
    await flow.callback(-100, 11, 'lang:11:zh-Hans');
    await flow.callback(-100, 42, 'lang:42:zh-Hant');
    assert.equal((await store.get(42)).language, 'zh-Hant'); assert.equal((await store.get(11)).language, 'zh-Hans');
    assert.equal(await flow.callback(7, 42, 'dl:netease:123'), false);
    await assert.rejects(store.get(-1));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('expired first-use requests cannot unexpectedly download a song when settings are changed later', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  let now = 1000;
  try {
    const store = new BotSettingsStore(root, () => now);
    await store.stage(42, { chatId: 7, messageId: 90, track });
    now += 31 * 60_000;
    assert.equal(await store.choose(42, 'original'), undefined);
    assert.equal((await store.get(42)).language, 'original');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Telegram language is automatic until a manual choice; start shows one button and expands choices only on click', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const store = new BotSettingsStore(root), messages: { text: string; extra?: Record<string, unknown> }[] = [];
    const flow = new BotLanguageSettings(store, async (_chat, text, extra) => { messages.push({ text, extra }); }, async () => {});
    await flow.observeLanguage(42, 'en-US');
    await flow.start(7, 42);
    assert.match(messages.at(-1)!.text, /Send a name or link/);
    const startButtons = (messages.at(-1)!.extra?.reply_markup as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard.flat();
    assert.deepEqual(startButtons, [{ text: '🇬🇧 English ｜ 🌐 Switch language', callback_data: 'setting:42:ui' }]);
    await flow.callback(7, 42, startButtons[0]!.callback_data);
    const expanded = (messages.at(-1)!.extra?.reply_markup as { inline_keyboard: { callback_data: string }[][] }).inline_keyboard.flat();
    assert.equal(expanded.filter((b) => b.callback_data.startsWith('ui:')).length, 8);
    await flow.observeLanguage(42, 'ja'); assert.equal(await flow.locale(42), 'ja');
    await flow.callback(7, 42, 'ui:42:fr');
    await flow.observeLanguage(42, 'zh-CN'); assert.equal(await flow.locale(42), 'fr');
    const restored = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async () => {});
    assert.equal(await restored.locale(42), 'fr');
    assert.equal((await store.get(42)).language, undefined);
    await flow.observeLanguage(11, 'ko'); await flow.observeLanguage(11, undefined);
    assert.equal(await flow.locale(11), 'ko'); assert.equal(await flow.locale(12), 'en');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('first-use preferences preserve the requesting forum topic across restart and a choice in another chat', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const acquisitions: unknown[][] = [];
    const flow = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async (...args) => { acquisitions.push(args); });
    await flow.request(-100, 42, track, 90, 10);
    const restored = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async (...args) => { acquisitions.push(args); });
    await restored.callback(7, 42, 'lang:42:original');
    assert.deepEqual(acquisitions, [[-100, 42, track, 'original', 90, 10]]);
    assert.equal((await new BotSettingsStore(root).get(42)).pending, undefined);
    await restored.request(-100, 42, track, 91, 20);
    assert.deepEqual(acquisitions.at(-1), [-100, 42, track, 'original', 91, 20]);
  } finally { await rm(root, { recursive: true, force: true }); }
});


test('first-use dismissal precedes acquisition and retained music cards survive a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const events: string[] = [], acquisitions: unknown[][] = [];
    const flow = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async () => {});
    await flow.request(-100, 42, track, 90, 10, true);
    const restored = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async (...args) => { events.push('acquire'); acquisitions.push(args); });
    await restored.callback(-100, 42, 'lang:42:original', async () => { events.push('dismiss'); });
    assert.deepEqual(events, ['dismiss', 'acquire']);
    assert.deepEqual(acquisitions, [[-100, 42, track, 'original', 90, 10, true]]);
    assert.equal((await new BotSettingsStore(root).get(42)).pending, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Inline acquisition context and resolved menu languages survive first-use choices and restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-inline-settings-'));
  try {
    const store = new BotSettingsStore(root), acquisitions: unknown[][] = [];
    const flow = new BotLanguageSettings(store, async () => {}, async (...args) => { acquisitions.push(args); });
    await flow.observeLanguage(42, 'ja');
    await flow.request(42, 42, track, 90, undefined, false, true);
    const restored = new BotLanguageSettings(new BotSettingsStore(root), async () => {}, async (...args) => { acquisitions.push(args); });
    await restored.callback(42, 42, 'lang:42:original');
    assert.deepEqual(acquisitions, [[42, 42, track, 'original', 90, undefined, false, true]]);
    await store.setUiLanguage(42, 'en');
    await store.observeLanguage(43, 'ko');
    await store.choose(44, 'original');
    assert.deepEqual((await new BotSettingsStore(root).knownLocales()).sort((a, b) => a.userId - b.userId), [{ userId: 42, language: 'en' }, { userId: 43, language: 'ko' }, { userId: 44, language: 'en' }]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
