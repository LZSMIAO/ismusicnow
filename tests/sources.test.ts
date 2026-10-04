import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMusicLink, safeFilename } from '../src/lib/server/links.js';
import { validateAudioUrl } from '../src/lib/server/downloads.js';
import { spotifyDownloadArgs } from '../src/lib/server/providers/spotify.js';
import { config } from '../src/lib/server/config.js';

test('網易雲的分享文字與 fragment 連結仍可解析', () => {
  assert.equal(parseMusicLink('分享歌曲 https://music.163.com/#/song?id=186016&userid=123')?.id, '186016');
  assert.equal(parseMusicLink('https://y.music.163.com/m/playlist?id=123')?.kind, 'playlist');
});
test('Spotify 與 YTM 永遠分屬獨立來源', () => {
  assert.equal(parseMusicLink('https://open.spotify.com/intl-tw/track/6rqhFgbbKwnb9MLmUQDhG6?si=test')?.provider, 'spotify');
  assert.equal(parseMusicLink('spotify:album:6rqhFgbbKwnb9MLmUQDhG6')?.kind, 'album');
  assert.equal(parseMusicLink('https://music.youtube.com/watch?v=Zi_XLOBDo_Y&list=RD12345678')?.provider, 'ytm');
});
test('不接受偽造主機、URL 使用者資訊和本機地址', () => {
  for (const url of ['https://music.163.com.attacker.test/song?id=1', 'https://user@music.163.com/song?id=1', 'http://localhost/song?id=1']) assert.throws(() => parseMusicLink(url));
  assert.throws(() => validateAudioUrl('http://127.0.0.1/private'));
  assert.throws(() => validateAudioUrl('https://music.126.net.attacker.test/song.mp3'));
  assert.equal(validateAudioUrl('https://m701.music.126.net/abc.mp3').hostname, 'm701.music.126.net');
});
test('Spotify 原音適配參數沒有搜尋匹配或轉碼', () => {
  const previous = config.spotifyCookiesPath;
  config.spotifyCookiesPath = '/tmp/spotify-cookies.txt';
  const link = parseMusicLink('spotify:track:6rqhFgbbKwnb9MLmUQDhG6')!;
  const args = spotifyDownloadArgs({ ...link, title: 'Song', artists: [], album: '', cover: '', durationMs: 0, sourceUrl: link.url }, '/tmp/output');
  assert.ok(args.includes('vorbis-high'));
  assert.equal(args.at(-1), link.url);
  assert.ok(!args.some((a) => /youtube|spotdl|--bitrate|--format/.test(a)));
  config.spotifyCookiesPath = previous;
});
test('檔名不帶路徑或控制字元', () => {
  assert.ok(!safeFilename('../../Song\nby/Artist').includes('/'));
  assert.equal(safeFilename('...'), 'ismusicnow');
});
