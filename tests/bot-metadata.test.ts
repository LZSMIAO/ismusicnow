import { test } from 'node:test';
import assert from 'node:assert/strict';
import { artistLanguage, artistDisplayName } from '../src/lib/server/bot-metadata.js';

test('source native language hints protect kanji names; equivalent native aliases do not substitute other nicknames', () => {
  const artist = { name: '米津玄师', alias: ['ハチ', '米津玄師'], briefDesc: '日本音乐人、歌手。' };
  assert.equal(artistLanguage(artist), 'ja'); assert.equal(artistDisplayName('米津玄师', artist), '米津玄師');
  assert.equal(artistDisplayName('米津玄师', { ...artist, alias: ['ハチ'] }), '米津玄师');
  assert.equal(artistLanguage({ name: '周杰伦', alias: ['ジェイ・チョウ'], briefDesc: '中国台湾男歌手。' }), 'zh');
  assert.equal(artistDisplayName('周杰伦', { name: '周杰伦', alias: ['Jay Chou'] }), '周杰伦');
});
