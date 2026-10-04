import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotLanguageSettings, BotSettingsStore, displayTrack } from '../src/lib/server/bot-settings.js';
import type { Track } from '../src/lib/types.js';

const track: Track = { id: '123', provider: 'netease', title: '人是猫', artists: ['张卡斯', '洛天依'], album: '人是猫', durationMs: 136000, cover: '', sourceUrl: 'https://music.163.com/song?id=123' };

test('Original preserves all names; Chinese preferences convert metadata without changing the source track', () => {
  assert.deepEqual(displayTrack(track, 'original'), track);
  const traditional = displayTrack(track, 'zh-Hant');
  assert.equal(traditional.title, '人是貓'); assert.equal(traditional.album, '人是貓'); assert.deepEqual(traditional.artists, ['張卡斯', '洛天依']);
  assert.equal(traditional.id, track.id); assert.equal(traditional.sourceUrl, track.sourceUrl);
  assert.deepEqual(displayTrack(traditional, 'zh-Hans'), track);
  assert.equal(track.title, '人是猫');
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

test('first acquisition pauses, offers the requested choices, and resumes exactly once after a restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const messages: { text: string; extra?: Record<string, unknown> }[] = [], acquisitions: unknown[][] = [];
    const send = async (_chat: number, text: string, extra?: Record<string, unknown>) => { messages.push({ text, extra }); };
    const acquire = async (...args: Parameters<ConstructorParameters<typeof BotLanguageSettings>[2]>) => { acquisitions.push(args); };
    const flow = new BotLanguageSettings(new BotSettingsStore(root), send, acquire);
    await flow.request(7, 42, track, 90);
    assert.equal(acquisitions.length, 0);
    assert.match(messages[0]!.text, /首次獲取/);
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

test('group setting buttons are bound to the owner; preferences stay isolated and can be changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ismusicnow-settings-'));
  try {
    const store = new BotSettingsStore(root), messages: string[] = [];
    const flow = new BotLanguageSettings(store, async (_id, text) => { messages.push(text); }, async () => { throw new Error('No pending track'); });
    await flow.callback(-100, 11, 'lang:42:zh-Hans');
    assert.match(messages.at(-1)!, /其他用戶/); assert.deepEqual(await store.get(11), {}); assert.deepEqual(await store.get(42), {});
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
