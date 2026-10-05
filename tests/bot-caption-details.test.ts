import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotCaptionDetails } from '../src/lib/server/bot-caption-details.js';
import { botLanguages } from '../src/lib/server/bot-i18n.js';

const caption = '<b>「Song」</b> — Artist\n<blockquote expandable>專輯：Album\n#網易雲音樂 #flac 21.90MB 909.06kbps\nvia @muismbot</blockquote>';
const markup = { inline_keyboard: [[{text:'專輯',callback_data:'browse:netease:album:66'}, {text:'歌手',callback_data:'browse:netease:artist:88'}], [{text:'來源 ↗',url:'https://music.163.com/song?id=123'}, {text:'分享至聊天',switch_inline_query:'https://music.163.com/song?id=123'}]] };
test('caption details survive restarts, hide technical data without blank rows and preserve footer actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-caption-details-'));
  try {
    for (const language of botLanguages) {
      const details = new BotCaptionDetails('123', root), form = new FormData();
      form.set('caption', caption); form.set('reply_markup', JSON.stringify(markup)); form.set('muism_caption_language', language);
      const prepared = await details.prepare('sendAudio', form) as FormData;
      assert.equal(prepared.has('muism_caption_language'), false);
      assert.doesNotMatch(String(prepared.get('caption')), /#flac|21.90MB|909.06kbps|\n\n|expandable/);
      assert.match(String(prepared.get('caption')), /#網易雲音樂\nvia @muismbot/);
      const rows = JSON.parse(String(prepared.get('reply_markup'))).inline_keyboard;
      assert.deepEqual(rows.at(-1), markup.inline_keyboard.at(-1));
      const button = rows[0].at(-1); assert.ok(Buffer.byteLength(button.callback_data) <= 64);
      const restarted = new BotCaptionDetails('123', root);
      const expanded = await restarted.toggle(button.callback_data);
      assert.match(expanded!.caption, /#flac 21.90MB 909.06kbps/);
      assert.doesNotMatch(expanded!.caption, /\n\n|expandable/);
      const collapse = expanded!.reply_markup.inline_keyboard[0]!.at(-1)!;
      assert.notEqual(collapse.text, button.text);
      assert.equal((await restarted.toggle(String(collapse.callback_data)))!.caption, prepared.get('caption'));
      assert.equal(await new BotCaptionDetails('456', root).toggle(button.callback_data), undefined);
      assert.equal(await restarted.toggle('md:../../private:1'), undefined);
    }
  } finally { await rm(root, {recursive:true,force:true}); }
});
test('cached Inline answers, media edits and channel cache uploads all receive functional caption controls', async () => {
  const root = await mkdtemp(join(tmpdir(), 'muism-caption-paths-'));
  try {
    const details = new BotCaptionDetails('123', root);
    const input = {type:'audio',audio_file_id:'cached',caption,muism_caption_language:'en',reply_markup:markup};
    const answer = await details.prepare('answerInlineQuery', {results:[input]}) as any;
    const item = answer.results[0]; assert.equal(item.muism_caption_language, undefined);
    assert.equal(item.reply_markup.inline_keyboard[0].at(-1).text, 'Details ▾');
    const edit = await details.prepare('editMessageMedia', {inline_message_id:'same',media:{type:'audio',media:'cached',caption,muism_caption_language:'en'},reply_markup:markup}) as any;
    assert.equal(edit.media.caption,item.caption); assert.equal(edit.media.reply_markup,undefined); assert.equal(edit.media.muism_caption_language,undefined);
    assert.deepEqual(edit.reply_markup,item.reply_markup);
    const form = new FormData(); form.set('caption', caption.replace('via @muismbot','Telegram playback copy (MP3 conversion)\nvia @muismbot'));
    await details.prepare('sendAudio',form);
    assert.match(String(form.get('caption')),/MP3 conversion/);
    const rows = JSON.parse(String(form.get('reply_markup'))).inline_keyboard;
    assert.equal(rows.length,1); assert.match(rows[0][0].callback_data,/^md:/);
    const expanded = await details.toggle(rows[0][0].callback_data);
    assert.equal(await details.prepare('editMessageCaption',expanded!),expanded);
  } finally { await rm(root,{recursive:true,force:true}); }
});
