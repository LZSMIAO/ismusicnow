import { test } from 'node:test';
import assert from 'node:assert/strict';

test('web artists preserve real provider identity and a failed source does not hide artists', async () => {
  const savedFetch = globalThis.fetch;
  process.env.NETEASE_API_URL = 'https://web-search.example.test';
  process.env.SPOTIFY_ACCESS_TOKEN = 'fixture';
  let failSpotify = false;
  globalThis.fetch = async (url, init) => {
    const address = String(url);
    if (address.startsWith('https://web-search.example.test/')) {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.type, 100);
      return Response.json({ code: 200, result: { artists: [{ id: 7, name: '草東沒有派對', img1v1Url: 'https://example.test/artist.jpg' }], artistCount: 1 } });
    }
    assert.ok(address.startsWith('https://api.spotify.com/v1/search?'));
    assert.equal(new URL(address).searchParams.get('type'), 'artist');
    if (failSpotify) return Response.json({ error: 'failed' }, { status: 503 });
    return Response.json({ artists: { items: [{ id: 'a'.repeat(22), name: 'No Party For Cao Dong', images: [{ url: 'https://example.test/spotify.jpg' }] }], total: 1, next: null } });
  };
  try {
    const { POST } = await import('../src/routes/api/resolve/+server.js');
    const run = (provider = 'all', searchType = 'artist') => POST({ request: new Request('https://music.ism.tw/api/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input: '草東', provider, searchType }) }), getClientAddress: () => '127.0.0.1' } as never);
    const result = await (await run()).json();
    assert.deepEqual(result.entities.map((a: any) => a.provider), ['netease', 'spotify']);
    assert.equal(result.entities[0].sourceUrl, 'https://music.163.com/artist?id=7');
    assert.equal(result.entities[1].sourceUrl, 'https://open.spotify.com/artist/' + 'a'.repeat(22));
    assert.equal(result.entities[0].cover, 'https://example.test/artist.jpg');
    assert.deepEqual(result.tracks, []);
    failSpotify = true;
    const partial = await (await run()).json();
    assert.equal(partial.entities.length, 1); assert.equal(partial.entities[0].provider, 'netease');
    assert.ok(partial.warnings.some((w: string) => w.includes('Spotify')));
    assert.equal((await run('all', 'garbage')).status, 400);
  } finally { globalThis.fetch = savedFetch; delete process.env.NETEASE_API_URL; delete process.env.SPOTIFY_ACCESS_TOKEN; }
});
