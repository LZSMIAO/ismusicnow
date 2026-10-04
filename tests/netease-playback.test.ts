import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/lib/server/config.js';
import { neteaseAudio, neteasePreview } from '../src/lib/server/providers/netease.js';

test('NetEase playback preserves full sources and labels platform trials without allowing trial downloads', async () => {
  const originalFetch = globalThis.fetch, originalUrl = config.neteaseApiUrl;
  config.neteaseApiUrl = 'https://netease.example.invalid';
  let trial = false;
  globalThis.fetch = async () => Response.json({ code: 200, data: [{ url: 'https://m7.music.126.net/song.mp3', type: 'mp3', freeTrialInfo: trial ? { start: 0, end: 30 } : null }] });
  try {
    assert.deepEqual(await neteasePreview('1'), { url: 'https://m7.music.126.net/song.mp3', limited: false });
    trial = true;
    assert.deepEqual(await neteasePreview('1'), { url: 'https://m7.music.126.net/song.mp3', limited: true });
    await assert.rejects(neteaseAudio('1', 'original'), { code: 'PREVIEW_ONLY' });
  } finally { globalThis.fetch = originalFetch; config.neteaseApiUrl = originalUrl; }
});
