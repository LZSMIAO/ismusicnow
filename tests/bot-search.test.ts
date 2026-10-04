import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBotMusic } from '../src/lib/server/bot-search.js';
import type { Collection, MusicSearchKind, Provider } from '../src/lib/types.js';
import { BotSelections, selectionMessage } from '../src/lib/server/bot-selection.js';

const fixture = (provider: Provider, kind: MusicSearchKind): Collection => ({
  provider, title: 'query', kind: 'search', query: 'query', searchType: kind, total: 1, warnings: [],
  tracks: kind === 'track' ? [{ provider, id: provider === 'netease' ? '123' : '0123456789012345678901', title: 'Title', artists: ['Artist'], album: 'Album', cover: '', durationMs: 150000, sourceUrl: `https://example.test/${provider}` }] : [],
  ...(kind === 'track' ? {} : { entities: [{ provider, id: '123', kind, title: 'Entity', artists: ['Artist'], cover: '', sourceUrl: `https://example.test/${provider}` }] }),
});
test('generic search and all category views keep independent sources, original query and readable source labels', async () => {
  for (const kind of ['track', 'album', 'artist', 'playlist'] as const) {
    const calls: [string, Provider, MusicSearchKind][] = [];
    const collection = await resolveBotMusic('塵', 'all', kind, async (input, provider, type) => { calls.push([input, provider, type!]); return fixture(provider, type!); });
    assert.deepEqual(calls, [['尘', 'netease', kind], ['塵', 'spotify', kind]]);
    assert.equal(collection.query, '塵'); assert.equal(collection.searchScope, 'all');
    assert.deepEqual((collection.entities || collection.tracks).map(item => item.provider), ['netease', 'spotify']);
    const text = selectionMessage(new BotSelections().create(1, 1, 1, collection), 'en').rich_message.html;
    assert.match(text, /All sources/); assert.match(text, /NetEase/); assert.match(text, /Spotify/);
  }
});
test('platform prefixes and links choose one source and keep native Japanese search names', async () => {
  const calls: [string, Provider][] = [];
  const resolver = async (input: string, provider: Provider) => { calls.push([input, provider]); return fixture(provider, 'track'); };
  await resolveBotMusic('spotify 塵', 'all', 'track', resolver);
  await resolveBotMusic('塵と光', 'netease', 'track', resolver);
  const link = 'https://music.youtube.com/watch?v=abcdefghijk';
  await resolveBotMusic(link, 'spotify', 'track', resolver);
  assert.deepEqual(calls, [['塵', 'spotify'], ['塵と光', 'netease'], [link, 'ytm']]);
});
test('a slow source times out independently without hiding the successful source', async () => {
  const result = await resolveBotMusic('Title', 'all', 'album', async (_input, provider) => provider === 'netease' ? fixture(provider, 'album') : new Promise(() => {}), 15);
  assert.equal(result.entities?.[0]?.provider, 'netease'); assert.equal(result.warnings.length, 1);
  await assert.rejects(resolveBotMusic('Title', 'spotify', 'track', () => new Promise(() => {}), 15), { code: 'UPSTREAM_TIMEOUT' });
});
