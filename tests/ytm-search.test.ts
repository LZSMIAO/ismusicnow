import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapYtmBrowse, mapYtmSearch } from '../src/lib/server/providers/ytm.js';
import { parseMusicLink } from '../src/lib/server/links.js';

const artist = 'UC' + 'a'.repeat(22), album = 'MPREb_example';
test('YTM songs retain real video identity, credited artists, album and duration', () => {
  const result = mapYtmSearch('床', 'track', [
    { videoId: 'abcdefghijk', title: '床', artists: [{ name: '草東沒有派對' }], duration: '3:52', album: {name:'瓦合',id:album}, thumbnails:[{url:'https://example.test/cover.jpg'}] },
    { videoId: 'bad', title: 'Invalid' },
    { videoId: 'ABCDEFGHIJK', title: 'Unavailable', isAvailable: false },
  ]);
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0]?.durationMs, 232000);
  assert.equal(result.tracks[0]?.sourceUrl, 'https://music.youtube.com/watch?v=abcdefghijk');
  assert.deepEqual(result.tracks[0]?.artists, ['草東沒有派對']);
  assert.equal(result.tracks[0]?.albumUrl, 'https://music.youtube.com/browse/' + album);
  assert.deepEqual(result.warnings, []);
});
test('YTM artists are selectable browse links rather than fabricated track IDs', () => {
  const result = mapYtmSearch('草東', 'artist', [{browseId:artist,artist:'草東沒有派對',thumbnails:[{url:'https://example.test/artist.jpg'}]}]);
  assert.equal(result.entities?.[0]?.kind, 'artist');
  const link = parseMusicLink(result.entities![0]!.sourceUrl)!;
  assert.equal(link.kind, 'artist');
  const page = mapYtmBrowse(link, {name:'草東沒有派對',songs:{results:[{videoId:'abcdefghijk',title:'床',duration:'3:52'}]},albums:{results:[{browseId:album,title:'瓦合'}]}});
  assert.deepEqual(page.tracks[0]?.artists, ['草東沒有派對']);
  assert.equal(page.entities?.[0]?.sourceUrl, 'https://music.youtube.com/browse/' + album);
  const albumPage = mapYtmBrowse(parseMusicLink(page.entities![0]!.sourceUrl)!, {title:'瓦合',artists:[{name:'草東沒有派對'}],tracks:[{videoId:'abcdefghijk',title:'床',duration_seconds:232}]});
  assert.equal(albumPage.tracks[0]?.album,'瓦合');
  assert.equal(albumPage.tracks[0]?.albumUrl,'https://music.youtube.com/browse/' + album);
  assert.throws(() => parseMusicLink('https://music.youtube.com/browse/not-valid'));
});
