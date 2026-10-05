import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BotCaptionDetails } from '../src/lib/server/bot-caption-details.js';
import { botLanguages, botText } from '../src/lib/server/bot-i18n.js';
import { musicCaption } from '../src/lib/server/bot-media.js';
const markup = { inline_keyboard: [[{text:'專輯',callback_data:'browse:netease:album:66'}, {text:'歌手',callback_data:'browse:netease:artist:88'}], [{text:'來源 ↗',url:'https://music.163.com/song?id=123'}, {text:'分享至聊天',switch_inline_query:'https://music.163.com/song?id=123'}]] };
const track={id:'123',provider:'netease' as const,title:'Song',artists:['Artist'],album:'Album',cover:'',durationMs:1000,sourceUrl:'https://music.163.com/song?id=123'};
const job={id:'fixture',track,format:'original' as const,status:'completed' as const,stage:'',createdAt:'',updatedAt:'',bytes:22964263,audioSource:'netease' as const,audio:{codec:'FLAC',lossless:true,bitrate:909060}};
test('new cards retain the native quote and all measured audio facts without extra buttons or spacer rows',async()=>{
  const root=await mkdtemp(join(tmpdir(),'muism-native-caption-'));
  try {for(const language of botLanguages){
    const details=new BotCaptionDetails('123',root),caption=musicCaption(track,job,language),form=new FormData();
    form.set('caption',caption);form.set('reply_markup',JSON.stringify(markup));form.set('muism_caption_language',language);
    await details.prepare('sendAudio',form);
    assert.equal(form.has('muism_caption_language'),false);assert.equal(form.get('caption'),caption);
    assert.match(caption,/<blockquote expandable>/);assert.match(caption,/#flac 21.90MB 909.06kbps/);assert.doesNotMatch(caption,/\n\n/);
    const lines=caption.match(/<blockquote expandable>([^]*?)<\/blockquote>/)![1]!.split('\n');
    assert.equal(lines.length,4);assert.equal(lines[2],'via @muismbot');assert.match(lines[1]!,new RegExp(botText(language,'source')));
    assert.deepEqual(JSON.parse(String(form.get('reply_markup'))),markup);
    const result={type:'audio',caption,muism_caption_language:language,reply_markup:markup};
    const inline=await details.prepare('answerInlineQuery',{results:[result]}) as any;
    assert.equal(inline.results[0].muism_caption_language,undefined);assert.equal(inline.results[0].caption,caption);assert.deepEqual(inline.results[0].reply_markup,markup);
    const edit=await details.prepare('editMessageMedia',{media:result,reply_markup:markup}) as any;
    assert.equal(edit.media.muism_caption_language,undefined);assert.equal(edit.media.caption,caption);assert.deepEqual(edit.reply_markup,markup);
    const converted=musicCaption(track,{...job,presentation:'telegram-playback'},language);
    assert.ok(converted.indexOf(botText(language,'playbackVersion'))<converted.indexOf('<blockquote expandable>'));
  }}finally{await rm(root,{recursive:true,force:true});}
});
test('legacy buttons restore full native quotes, remove their own controls and preserve album, artist, source and share actions after restart',async()=>{
  const root=await mkdtemp(join(tmpdir(),'muism-legacy-caption-'));
  try {
    const id='a'.repeat(32),path=join(root,'caption-details','123');await mkdir(path,{recursive:true});
    await writeFile(join(path,id+'.json'),JSON.stringify({collapsed:'missing facts',expanded:'<b>Song</b>\n<blockquote>Album：Album\n#NetEase #mp3 6.52MB 320.00kbps\nvia @muismbot</blockquote>',markup,language:'en'}));
    const details=new BotCaptionDetails('123',root);
    for(const action of ['0','1']){
      const restored=await details.toggle(`md:${id}:${action}`);
      assert.match(restored!.caption,/<blockquote expandable>Album：Album\nSource：NetEase\nvia @muismbot\n#mp3 6.52MB 320.00kbps<\/blockquote>/);
      assert.deepEqual(restored!.reply_markup,markup);assert.doesNotMatch(restored!.caption,/\n\n/);
    }
    await details.remember(`md:${id}:1`,{chat_id:-100123,message_id:66});
    const files=await readdir(join(path,'deliveries'));
    assert.deepEqual(JSON.parse(await readFile(join(path,'deliveries',files[0]!),'utf8')),{chat_id:-100123,message_id:66,data:`md:${id}:1`});
    assert.equal(await new BotCaptionDetails('456',root).toggle(`md:${id}:1`),undefined);
    assert.equal(await details.toggle('md:../../private:1'),undefined);
  }finally{await rm(root,{recursive:true,force:true});}
});
