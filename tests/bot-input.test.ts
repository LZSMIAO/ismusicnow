import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNeteaseCommand } from '../src/lib/server/bot-input.js';
import type { Collection, Track } from '../src/lib/types.js';

const track: Track = { id: '123', provider: 'netease', title: '床', artists: ['Artist'], album: '', cover: '', durationMs: 1000, sourceUrl: 'https://music.163.com/song?id=123' };
const search: Collection = { title: '床', provider: 'netease', kind: 'search', tracks: [track, { ...track, id: '456' }], total: 2, warnings: [] };

test('/netease 的中文關鍵詞直接獲取首個搜尋結果', async () => {
  const result = await resolveNeteaseCommand(' 床 ', {
    getTrack: async () => { throw new Error('A keyword must not be used as a track ID'); },
    resolveMusic: async (input, provider) => { assert.equal(input, '床'); assert.equal(provider, 'netease'); return search; },
  });
  assert.equal(result.kind, 'track'); assert.deepEqual(result.tracks, [track]);
});
test('/netease 數字 ID 直接取曲，不進入關鍵詞搜尋', async () => {
  const result = await resolveNeteaseCommand('123', {
    getTrack: async (provider, id) => { assert.equal(provider, 'netease'); assert.equal(id, '123'); return track; },
    resolveMusic: async () => { throw new Error('An ID must not be searched'); },
  });
  assert.deepEqual(result.tracks, [track]);
});
test('/netease 接受分享連結，歌單保留選曲流程', async () => {
  const playlist: Collection = { ...search, kind: 'playlist' };
  const result = await resolveNeteaseCommand('分享歌單 https://music.163.com/playlist?id=1', {
    getTrack: async () => { throw new Error('A link must not be used as a track ID'); },
    resolveMusic: async (input) => { assert.match(input, /playlist\?id=1/); return playlist; },
  });
  assert.deepEqual(result, playlist);
});
test('/netease 空參數、無結果與其他平台都有明確錯誤', async () => {
  await assert.rejects(resolveNeteaseCommand(''), { code: 'INVALID_INPUT' });
  await assert.rejects(resolveNeteaseCommand('missing', { getTrack: async () => track, resolveMusic: async () => ({ ...search, tracks: [] }) }), { code: 'NOT_FOUND' });
  await assert.rejects(resolveNeteaseCommand('spotify link', { getTrack: async () => track, resolveMusic: async () => ({ ...search, provider: 'spotify' }) }), { code: 'WRONG_PROVIDER' });
});
