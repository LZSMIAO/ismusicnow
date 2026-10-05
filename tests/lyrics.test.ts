import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPlayerLines } from '../src/lib/lyric-player.js';
import { parseLrc, lyricIndex, displayLyricLines } from '../src/lib/lyrics.js';

test('timed lyrics handle multiple tags, offsets, instrumental gaps and backwards seeking', () => {
  const lines = parseLrc('[ar:artist]\n[offset:-500]\n[00:03.50][00:08.500]repeat\n[00:01.00]first\n[00:06.00]\n[00:99.00]invalid');
  assert.deepEqual(lines, [{ time: .5, text: 'first' }, { time: 3, text: 'repeat' }, { time: 5.5, text: '' }, { time: 8, text: 'repeat' }]);
  assert.equal(lyricIndex(lines, 0), -1); assert.equal(lyricIndex(lines, 8), 3); assert.equal(lyricIndex(lines, 1), 0);
  assert.deepEqual(parseLrc('plain text'), []);
});

test('lyrics use original NetEase ID and exact LRCLIB metadata without substituting another song', async () => {
  process.env.NETEASE_API_URL = 'https://lyrics.example.test';
  const realFetch = globalThis.fetch; const urls: URL[] = [];
  globalThis.fetch = async (address, init) => {
    const url = new URL(String(address)); urls.push(url);
    if (url.hostname === 'lyrics.example.test') {
      assert.equal(JSON.parse(String(init?.body)).id, '42');
      return Response.json({ code: 200, lrc: { lyric: '[00:01.25]timed fixture' } });
    }
    assert.equal(url.hostname, 'lrclib.net'); assert.equal(url.pathname, '/api/get');
    assert.equal(url.searchParams.get('artist_name'), 'Artist'); assert.equal(url.searchParams.get('duration'), '240');
    if (url.searchParams.get('track_name') === 'missing') return Response.json({}, { status: 404 });
    return Response.json({ syncedLyrics: '[00:10.00]fixture', plainLyrics: 'fixture' });
  };
  try {
    const { trackLyrics } = await import('../src/lib/server/lyrics.js');
    const base = { id: '42', provider: 'netease' as const, title: 'test', artists: ['Artist'], album: 'Album', durationMs: 240000 };
    assert.equal((await trackLyrics(base)).lines[0]?.time, 1.25);
    const spotify = { ...base, id: 'a'.repeat(22), provider: 'spotify' as const };
    assert.equal((await trackLyrics(spotify)).source, 'lrclib');
    await trackLyrics(spotify); assert.equal(urls.length, 2, 'replays reuse the metadata-scoped cache');
    assert.deepEqual((await trackLyrics({ ...spotify, title: 'missing' })).lines, []);
  } finally { globalThis.fetch = realFetch; delete process.env.NETEASE_API_URL; }
});

test('AMLL conversion preserves sentence timing and instrumental gaps without invented word times', () => {
  const lines = toPlayerLines([{ time: 1.25, text: 'one sentence' }, { time: 3, text: '' }, { time: 8, text: 'last sentence' }], 12);
  assert.equal(lines.length, 2); assert.equal(lines[0]?.endTime, 3000);
  assert.deepEqual(lines[0]?.words, [{ word: 'one sentence', startTime: 1250, endTime: 3000 }]);
  assert.equal(lines[1]?.endTime, 12000); assert.deepEqual(toPlayerLines([], 0), []);
});

test('display lyrics remove introductory credits without changing real lyric timing', () => {
  const lines = [{ time: 0, text: 'Spring Rain - Artist' }, { time: 1, text: '词：Artist' }, { time: 2, text: '和声 : Singer' }, { time: 12, text: '曲終人未散' }, { time: 20, text: '' }, { time: 25, text: 'Spring Rain - Artist' }];
  const visible = displayLyricLines(lines, 'Spring Rain', ['Artist']);
  assert.deepEqual(visible, lines.slice(3));
  assert.equal(lyricIndex(visible, 15), 0);
  assert.equal(lyricIndex(visible, 20), 1);
});
