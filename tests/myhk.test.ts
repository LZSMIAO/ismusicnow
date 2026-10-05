import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../src/lib/server/config.js';
import { myhkRequest, searchMyhk, resolveMyhk, myhkAudio, myhkLyrics, mapMyhkTrack, validateMyhkAudioUrl } from '../src/lib/server/providers/myhk.js';
import { parseMusicLink, musicSourceUrl, validateTrackId } from '../src/lib/server/links.js';
import { inlineStart, parseInlineStart, parseInlineQuery, browseStart, parseBrowseStart, BotInline } from '../src/lib/server/bot-inline.js';
import { savePlatformAudio } from '../src/lib/server/downloads.js';
import { searchNetease, neteaseAudio } from '../src/lib/server/providers/netease.js';

const samples = { netease: '2663919685', qq: '003A9wEs1yOobn', kuwo: '20936119', kugou: 'BE516320657EB3C20D08472B8ADB9A11', migu: '60054701923', qianqian: 'T10064789361' } as const;
const row = (id: string) => ({ id, name: '春雨', artist: ['Spylent'], album: '把他的蜡笔拿走!', pic_id: '002qie5W24bm86' });
async function mocked(run: () => Promise<void>, fetcher: typeof fetch) {
  const previousFetch = globalThis.fetch, previousKey = config.myhkApiKey, previousApi = config.neteaseApiUrl;
  config.myhkApiKey = 'test-private-key'; globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = previousFetch; config.myhkApiKey = previousKey; config.neteaseApiUrl = previousApi; }
}

test('all six track identities round-trip platform links and Inline starts without truncating hashes', () => {
  for (const [provider, id] of Object.entries(samples) as [keyof typeof samples, string][]) {
    validateTrackId(provider, id);
    const url = musicSourceUrl(provider, 'track', id);
    assert.deepEqual(parseMusicLink(url), { provider, kind: 'track', id, url });
    assert.deepEqual(parseInlineStart(inlineStart({ provider, id })), { provider, id });
    assert.equal(parseInlineQuery(`${provider} 春雨`).provider, provider);
    assert.ok(Buffer.byteLength(`ip:9999999999999999:g:${id}`) <= 64);
  }
  for (const provider of ['qq', 'kugou', 'migu', 'qianqian'] as const) assert.throws(() => validateTrackId(provider, '../secret'));
  assert.equal(parseBrowseStart(browseStart('qq', 'album', '002qie5W24bm86'))?.url, 'https://y.qq.com/n/ryqq/albumDetail/002qie5W24bm86');
  assert.equal(parseBrowseStart(browseStart('kuwo', 'album', '123'))?.provider, 'kuwo');
});

test('search uses POST, coalesces concurrent requests, preserves artist credits and exposes no credentials', async () => {
  const calls: { url: string; body: URLSearchParams }[] = [];
  await mocked(async () => {
    const results = await Promise.all([searchMyhk('test-concurrent', 'qq'), searchMyhk('test-concurrent', 'qq')]);
    assert.equal(calls.length, 1); assert.equal(calls[0]!.url, 'https://myhkw.cn/open/music/search');
    assert.equal(calls[0]!.body.get('key'), 'test-private-key'); assert.equal(calls[0]!.body.get('type'), 'qq');
    assert.equal(calls[0]!.body.get('format'), '0');
    assert.deepEqual(results[0]!.tracks[0]!.artists, ['Spylent']);
    assert.equal(results[0]!.tracks[0]!.durationMs, 180000);
    assert.equal(results[0]!.tracks[0]!.albumUrl, 'https://y.qq.com/n/ryqq/albumDetail/002qie5W24bm86');
    assert.doesNotMatch(JSON.stringify(results), /test-private-key|url_id/);
  }, (async (url, options) => { assert.equal(options?.redirect, 'error'); calls.push({url: String(url), body: options!.body as URLSearchParams}); return Response.json({code:0,data:{song:{list:[{songmid:samples.qq,songname:'春雨',singer:[{name:'Spylent'}],albumname:'把他的蜡笔拿走!',albummid:'002qie5W24bm86',interval:180}]}}}); }) as typeof fetch);
});

test('album/list formats normalize their envelope, retain order and reject unsupported capabilities', async () => {
  await mocked(async () => {
    const value = await resolveMyhk({ provider: 'kuwo', kind: 'album', id: '111', url: 'https://www.kuwo.cn/album_detail/111' });
    assert.deepEqual(value.tracks.map(t => t.id), ['22', '11']);
    await assert.rejects(resolveMyhk({ provider: 'kugou', kind: 'album', id: '111', url: '' }), {code: 'UNSUPPORTED_LINK'});
  }, (async (_url, options) => { assert.equal((options!.body as URLSearchParams).get('format'), '1'); return Response.json({code:1, data:{songId:['22','11'], songName:['A','B'], albumName:['Release','Release'], artistName:['X','Y']}}); }) as typeof fetch);
});

test('upstream errors and malformed data never echo keys or vendor messages', async () => {
  await mocked(async () => {
    await assert.rejects(myhkRequest('search', 'migu', {name:'private-error'}), error => {
      assert.doesNotMatch(String(error), /test-private-key|vendor-secret/); return true;
    });
  }, (async () => Response.json({code:0,msg:'vendor-secret test-private-key',data:''})) as typeof fetch);
  await mocked(async () => {
    await assert.rejects(myhkRequest('info', 'qianqian', {id:'T1-malformed'}), {code:'UPSTREAM_ERROR'});
  }, (async () => new Response('<html>vendor error</html>')) as typeof fetch);
});

test('audio/lyrics envelopes use real media and provider-scoped CDNs', async () => {
  await mocked(async () => {
    assert.equal((await myhkAudio('kuwo', '333')).extension, 'mp3');
    assert.equal(await myhkLyrics('kuwo', '333'), '[00:01.00]hello');
  }, (async url => Response.json({code:1,data:String(url).endsWith('/lrc')?'[00:01.00]hello':'https://kw-lv.kuwo.cn/resource/test.mp3'})) as typeof fetch);
  for (const url of ['http://127.0.0.1/a.mp3','https://kw-lv.kuwo.cn.evil.test/a','https://user:pass@kw-lv.kuwo.cn/a','https://kw-lv.kuwo.cn:8443/a']) assert.throws(() => validateMyhkAudioUrl(url,'kuwo'));
  assert.throws(() => validateMyhkAudioUrl('https://sharefs.kugou.com/a.mp3','qq'));
  assert.throws(() => validateMyhkAudioUrl('https://myhkw.cn/open/music/url?key=private','qq'));
  assert.equal(mapMyhkTrack('kugou', { ...row(samples.kugou), artist:['A、B'],pic:'https://127.0.0.1/image' }).cover, '');
});

test('CDN redirects are checked before making the next network request; streaming enforces limits', async () => {
  const root = await mkdtemp(join(tmpdir(),'muism-myhk-'));
  try {
    let count=0;
    await mocked(async () => {
      await assert.rejects(savePlatformAudio('https://kw-lv.kuwo.cn/a',join(root,'audio'),100,'kuwo'),{code:'INVALID_AUDIO_HOST'});
      assert.equal(count,1);
    }, (async () => { count++;return new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}); }) as typeof fetch);
    await mocked(async () => {
      await assert.rejects(savePlatformAudio('https://kw-lv.kuwo.cn/b',join(root,'large'),3,'kuwo'),{code:'FILE_TOO_LARGE'});
      await savePlatformAudio('https://kw-lv.kuwo.cn/c',join(root,'small'),10,'kuwo');
      assert.equal((await readFile(join(root,'small'))).length,5);
    }, (async () => new Response(new Uint8Array(5))) as typeof fetch);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('NetEase falls back on primary failure and bypasses MP3-only primary for native FLAC', async () => {
  let primary=0,native=0;
  await mocked(async () => {
    config.neteaseApiUrl='https://native.test/';
    const value=await searchNetease('test-fallback'); assert.equal(value.tracks[0]!.id,'123');
    assert.equal((await neteaseAudio('flac-test','flac')).extension,'flac');
    assert.equal(primary,1); assert.equal(native,2);
  }, (async url => {
    if(String(url).includes('myhkw.cn')) {primary++;return Response.json({code:0,msg:'failure'});}
    native++;return Response.json(String(url).includes('cloudsearch')?{code:200,result:{songs:[{id:123,name:'track'}],songCount:1}}:{code:200,data:[{url:'https://m801.music.126.net/test.flac',type:'flac'}]});
  }) as typeof fetch);
});

test('Kugou chosen results and 32-character callback IDs replace the same Inline message', async () => {
  const track=mapMyhkTrack('kugou', row(samples.kugou)), calls: {method:string;body:any}[]=[];
  const inline=new BotInline({telegram:async(method,body)=>{calls.push({method,body});return true;},username:()=> 'muismbot',preferences:async()=>({ui:'en',names:'original'}),resolve:async()=>({title:'',provider:'kugou',kind:'search',tracks:[track],total:1,warnings:[]}),albums:async()=>{throw Error();},getTrack:async()=>track,cache:async()=>undefined,metadata:async t=>t,acquire:async()=>({fileId:'cached-original',kind:'audio',duration:180,bytes:1000,audioSource:'kugou',audio:{codec:'MPEG 1 Layer 3',lossless:false}})});
  await inline.chosen({result_id:`kugou:${samples.kugou}`,from:{id:42},inline_message_id:'same-message',query:'春雨'});
  assert.ok(calls.some(call=>call.method==='editMessageMedia'&&call.body.inline_message_id==='same-message'));
  calls.length=0;
  await inline.callback({id:'cb',from:{id:42},inline_message_id:'same-message',data:`ip:42:g:${samples.kugou}`});
  assert.equal(calls[0]!.method,'answerCallbackQuery'); assert.ok(calls.some(call=>call.method==='editMessageMedia'));
});

test('native Kuwo and Kugou preserve duration; a Kugou quality hash may return real FLAC', async () => {
  const sq = '489190A9A84F2A27FC0BE704A12DF3B5';
  await mocked(async () => {
    const kuwo = await searchMyhk('native-kuwo-duration', 'kuwo');
    assert.equal(kuwo.tracks[0]!.id, '251977041'); assert.equal(kuwo.tracks[0]!.durationMs, 180000);
    const kg = await searchMyhk('native-kugou-quality', 'kugou');
    assert.equal(kg.tracks[0]!.title, 'Song'); assert.equal(kg.tracks[0]!.durationMs, 180000);
    assert.equal((await myhkAudio('kugou', samples.kugou)).extension, 'flac');
  }, (async (url, options) => {
    const params = options!.body as URLSearchParams;
    if (String(url).endsWith('/url')) { assert.equal(params.get('id'), sq); return Response.json({code:1,data:'https://fs.kugou.com/audio.flac'}); }
    if (params.get('type') === 'kw') return Response.json({abslist:[{MUSICRID:'MUSIC_251977041',NAME:'Song',ARTIST:'Artist',ALBUM:'Release',ALBUMID:'12',DURATION:'180'}]});
    return Response.json({status:1,data:{lists:[{FileHash:samples.kugou,SQFileHash:sq,SongName:'<em>Song</em>',SingerName:'Artist',AlbumName:'Release',Duration:180}]}});
  }) as typeof fetch);
});

test('empty native QQ responses are valid lists, not failed vendor envelopes', async () => {
  await mocked(async () => { assert.deepEqual((await searchMyhk('native-empty-qq', 'qq')).tracks, []); },
    (async () => Response.json({code:0,data:{song:{list:[]}}})) as typeof fetch);
});

test('original NetEase quality prefers authorized native FLAC over a primary MP3', async () => {
  let primary = 0;
  await mocked(async () => {
    config.neteaseApiUrl = 'https://native.test/';
    assert.equal((await neteaseAudio('quality-native-first','original')).extension, 'flac');
    assert.equal(primary, 0);
  }, (async url => {
    if (String(url).includes('myhkw.cn')) { primary++; return Response.json({code:1,data:'https://m801.music.126.net/mp3.mp3'}); }
    return Response.json({code:200,data:[{url:'https://m801.music.126.net/native.flac',type:'flac'}]});
  }) as typeof fetch);
});
