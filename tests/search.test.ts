import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combineSearches } from '../src/lib/server/search.js';
import { ServiceError } from '../src/lib/server/errors.js';
import type { Collection, Provider } from '../src/lib/types.js';

function result(provider: Provider, ids: string[]): Collection {
  return { provider, title: 'same name', kind: 'search', total: ids.length, warnings: [], tracks: ids.map((id) => ({
    provider, id, title: 'same name', artists: ['artist'], album: '', cover: '', durationMs: 1000, sourceUrl: `https://example.com/${provider}/${id}`,
  })) };
}
test('combined search preserves identities and upstream rank on equal relevance', async () => {
  const netease = result('netease', ['1', '2', '3']), spotify = result('spotify', ['a', 'b']);
  const collection = await combineSearches('query', [
    { provider: 'netease', search: async () => netease }, { provider: 'spotify', search: async () => spotify },
  ]);
  assert.deepEqual(collection.tracks.map(t => `${t.provider}:${t.id}`).sort(), ['netease:1', 'netease:2', 'netease:3', 'spotify:a', 'spotify:b']);
  assert.ok(collection.tracks.indexOf(netease.tracks[0]!) < collection.tracks.indexOf(netease.tracks[1]!));
  assert.deepEqual([...collection.providers!].sort(), ['netease', 'spotify']);
  assert.equal(collection.total, 5);
  assert.equal(collection.tracks.find(t => t.provider === 'spotify' && t.id === 'a')?.sourceUrl, spotify.tracks[0]?.sourceUrl);
});
test('a failed source leaves successful results and exposes only safe public errors', async () => {
  const collection = await combineSearches('query', [
    { provider: 'netease', search: async () => { throw new Error('private upstream details'); } },
    { provider: 'spotify', search: async () => result('spotify', ['a']) },
  ]);
  assert.equal(collection.tracks[0]?.provider, 'spotify');
  assert.deepEqual(collection.warnings, ['網易雲音樂：暫時無法搜尋。']);
});
test('all failed sources return an error rather than an empty successful search', async () => {
  await assert.rejects(combineSearches('query', [{ provider: 'netease', search: async () => { throw new ServiceError('TIMEOUT', '稍後再試'); } }]), { code: 'SEARCH_UNAVAILABLE', status: 503 });
});
test('an empty source does not hide other results and a genuinely empty search stays empty', async () => {
  const collection = await combineSearches('query', [{ provider: 'netease', search: async () => result('netease', []) }, { provider: 'spotify', search: async () => result('spotify', ['a']) }]);
  assert.equal(collection.tracks.length, 1);
  assert.deepEqual((await combineSearches('query', [{ provider: 'netease', search: async () => result('netease', []) }])).tracks, []);
});

test('the matching singer and studio title outrank a cover from the first platform', async () => {
  const netease = result('netease', ['1']), spotify = result('spotify', ['a']);
  netease.tracks[0] = { ...netease.tracks[0]!, title: '晴天 (Cover 周杰倫)', artists: ['其他歌手'] };
  spotify.tracks[0] = { ...spotify.tracks[0]!, title: '晴天', artists: ['周杰伦'] };
  const run = (sources: typeof netease[]) => combineSearches('周杰倫 晴天', sources.map(c => ({ provider: c.provider, search: async () => c })));
  for (const sources of [[netease, spotify], [spotify, netease]]) {
    const merged = await run(sources);
    assert.equal(merged.tracks[0]?.provider, 'spotify');
    assert.equal(merged.providers?.[0], 'spotify');
    assert.equal(merged.tracks.length, 2);
  }
});
test('unspecified live versions rank lower but explicit live searches prefer them', async () => {
  const studio = result('netease', ['1']), live = result('spotify', ['a']);
  studio.tracks[0]!.title = '晴天'; live.tracks[0]!.title = '晴天 Live';
  const run = (query: string) => combineSearches(query, [studio, live].map(c => ({ provider: c.provider, search: async () => c })));
  assert.equal((await run('晴天')).tracks[0]?.id, '1');
  assert.equal((await run('晴天 Live')).tracks[0]?.id, 'a');
});
test('a source with a matching song ranks above a successful empty source', async () => {
  const merged = await combineSearches('same name', [{ provider: 'netease', search: async () => result('netease', []) }, { provider: 'spotify', search: async () => result('spotify', ['a']) }]);
  assert.deepEqual(merged.providers, ['spotify', 'netease']);
});
