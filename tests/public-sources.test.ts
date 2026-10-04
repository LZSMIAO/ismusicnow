import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLink, validateTrackId } from '../src/lib/server/links.js';
import { mapPublicTrack, publicTrackUrl } from '../src/lib/server/providers/public-audio.js';

test('public source links normalize to their actual platform; foreign hosts and malformed IDs are rejected', () => {
  const sources = [
    ['https://soundcloud.com/artist/a-song?utm_source=share', 'soundcloud'],
    ['https://artist.bandcamp.com/track/a-song', 'bandcamp'],
    ['https://www.bilibili.com/video/BV1n44y1Q7sc?share=1', 'bilibili'],
  ] as const;
  for (const [url, provider] of sources) assert.equal(parseMusicLink(url)?.provider, provider);
  assert.equal(parseMusicLink('https://artist.bandcamp.com/album/a-release')?.kind, 'album');
  assert.equal(parseMusicLink('https://soundcloud.com/artist/sets/a-release')?.kind, 'playlist');
  for (const url of ['https://soundcloud.com.evil.test/artist/song', 'https://artist.bandcamp.com.evil.test/track/song', 'https://www.bilibili.com@127.0.0.1/video/BV1n44y1Q7sc', 'https://www.bilibili.com:8080/video/BV1n44y1Q7sc']) assert.throws(() => parseMusicLink(url));
  for (const [provider, id] of [['bandcamp','../localhost~evil'], ['soundcloud','https://127.0.0.1'], ['bilibili','invalid']] as const) assert.throws(() => validateTrackId(provider,id));
});
test('SoundCloud, Bandcamp and Bilibili metadata stay separate and missing/unsafe rows are omitted', () => {
  const sc = mapPublicTrack('soundcloud', { id:'123', title:'Song', artists:['Artist'], duration:180, webpage_url:'https://soundcloud.com/artist/song' });
  assert.equal(sc?.id, '123'); assert.equal(sc?.provider,'soundcloud'); assert.equal(sc?.durationMs,180000);
  assert.equal(publicTrackUrl('soundcloud','123'),'https://api.soundcloud.com/tracks/123');
  const bc = mapPublicTrack('bandcamp', { id:'123', track:'Song', title:'Artist - Song', artist:'Artist', album:'Release', webpage_url:'https://artist.bandcamp.com/track/song' });
  assert.equal(bc?.id,'artist~song'); assert.equal(bc?.title,'Song'); assert.equal(bc?.sourceUrl, publicTrackUrl('bandcamp',bc!.id));
  const bili = mapPublicTrack('bilibili',{ id:'BV1n44y1Q7sc', title:'Song (Cover)', uploader:'Uploader', url:'https://www.bilibili.com/video/BV1n44y1Q7sc' });
  assert.equal(bili?.title,'Song (Cover)'); assert.deepEqual(bili?.artists,['Uploader']);
  assert.equal(mapPublicTrack('bandcamp',{title:'Song', webpage_url:'https://127.0.0.1/track/song'}),null);
  assert.equal(mapPublicTrack('bilibili',{title:'Unknown',id:'garbage'}),null);
  assert.equal(mapPublicTrack('soundcloud',{id:'123'}),null);
});

test('Bilibili search reads actual song metadata rather than blank flat-playlist references', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(new URL(String(url)).hostname, 'api.bilibili.com');
    return Response.json({ code:0, data:{result:[{bvid:'BV1n44y1Q7sc',title:'<em class="keyword">晴天</em> &amp; Live',author:'音樂作者',pic:'//example.test/cover.jpg',duration:'3:40'}]} });
  };
  try {
    const { searchPublic } = await import('../src/lib/server/providers/public-audio.js');
    const collection = await searchPublic('bilibili','晴天');
    assert.equal(collection.tracks[0]?.title,'晴天 & Live');
    assert.equal(collection.tracks[0]?.durationMs,220000);
    assert.equal(collection.tracks[0]?.provider,'bilibili');
    assert.equal(collection.tracks[0]?.sourceUrl,'https://www.bilibili.com/video/BV1n44y1Q7sc');
    assert.equal(collection.tracks[0]?.cover,'https://example.test/cover.jpg');
  } finally { globalThis.fetch = saved; }
});
