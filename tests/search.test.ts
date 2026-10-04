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
test('combined search interleaves ranks and keeps independent sources with matching titles', async () => {
  const netease = result('netease', ['1', '2', '3']), spotify = result('spotify', ['a', 'b']);
  const collection = await combineSearches('query', [
    { provider: 'netease', search: async () => netease }, { provider: 'spotify', search: async () => spotify },
  ]);
  assert.deepEqual(collection.tracks.map((t) => `${t.provider}:${t.id}`), ['netease:1', 'spotify:a', 'netease:2', 'spotify:b', 'netease:3']);
  assert.deepEqual(collection.providers, ['netease', 'spotify']);
  assert.equal(collection.total, 5);
  assert.equal(collection.tracks[1]?.sourceUrl, spotify.tracks[0]?.sourceUrl);
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
