import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';

// Exercise the actual rune controller with browser media events, without a DOM.
const source = await readFile(new URL('../src/lib/preview-state.svelte.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext } }).outputText;
const compiled = compileModule(js, { filename: 'preview-state.svelte.js', generate: 'client' }).js.code
  .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')))
  .replaceAll("'./ui.js'", JSON.stringify(new URL('../src/lib/ui.ts', import.meta.url).href))
  .replaceAll("'./telegram.js'", JSON.stringify(new URL('../src/lib/telegram.ts', import.meta.url).href));
const { createPreviewState } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

class Media {
  static latest: Media;
  duration = 245.5; currentTime = 0; src = ''; volume = 1; preload = '';
  onplaying?: (() => void) | null; onpause?: (() => void) | null;
  onwaiting?: (() => void) | null; onloadedmetadata?: (() => void) | null;
  ondurationchange?: (() => void) | null; ontimeupdate?: (() => void) | null;
  onended?: (() => void) | null; onerror?: (() => void) | null;
  constructor() { Media.latest = this; }
  async play() { this.onloadedmetadata?.(); this.onplaying?.(); }
  pause() { this.onpause?.(); }
  removeAttribute() { this.src = ''; }
  load() {}
}
const track = { provider: 'netease', id: '1', title: 'Full song', durationMs: 240000 };
const job = { id: 'complete', status: 'completed', track };

test('full downloaded audio plays past 30 seconds and advances only on ended', async () => {
  const original = globalThis.Audio;
  globalThis.Audio = Media as unknown as typeof Audio;
  let ends = 0;
  const player = createPreviewState(() => ends++);
  const stop = player.mount();
  try {
    await player.play(track, [job]);
    assert.equal(player.length, 245.5);
    assert.equal(player.limited, false);
    player.seek(90);
    Media.latest.ontimeupdate?.();
    assert.equal(player.elapsed, 90);
    assert.equal(player.status, 'playing');
    assert.equal(ends, 0);
    Media.latest.duration = 260;
    Media.latest.ondurationchange?.();
    assert.equal(player.length, 260);
    Media.latest.onended?.(); Media.latest.onended?.();
    assert.equal(ends, 1);
    assert.equal(player.status, 'paused');
  } finally { stop(); globalThis.Audio = original; }
  assert.equal(Media.latest.ontimeupdate, null);
  assert.equal(Media.latest.ondurationchange, null);
});

test('platform clips retain their real duration and are marked limited', async () => {
  const originalAudio = globalThis.Audio, originalFetch = globalThis.fetch;
  globalThis.Audio = Media as unknown as typeof Audio;
  globalThis.fetch = async () => new Response(JSON.stringify({ available: true, url: 'https://p.scdn.co/clip', limited: true }));
  const player = createPreviewState(() => {}), stop = player.mount();
  try {
    Media.latest.duration = 28.2;
    await player.play({ ...track, provider: 'spotify' }, []);
    assert.equal(player.length, 28.2);
    assert.equal(player.limited, true);
    assert.equal(player.status, 'playing');
  } finally { stop(); globalThis.Audio = originalAudio; globalThis.fetch = originalFetch; }
});

test('missing Spotify audio exposes the real capability and clears when leaving the failed song', async () => {
  const originalAudio = globalThis.Audio, originalFetch = globalThis.fetch;
  globalThis.Audio = Media as unknown as typeof Audio;
  globalThis.fetch = async () => new Response(JSON.stringify({ available: false, downloadable: false, message: 'Spotify 未提供此曲試聽。請在原平台播放。' }));
  const player = createPreviewState(() => {}), stop = player.mount();
  try {
    await player.play({ ...track, provider: 'spotify' }, []);
    assert.equal(player.status, 'unavailable');
    assert.equal(player.ready, false);
    assert.equal(player.canDownload, false);
    assert.equal(Media.latest.src, '');
    assert.match(player.error, /Spotify/);
    player.clearFailure();
    assert.equal(player.track, null);
    assert.equal(player.error, '');
    assert.equal(player.length, 0);
    assert.equal(player.status, 'idle');
    await player.play(track, [job]);
    assert.equal(player.status, 'playing');
    assert.equal(player.canDownload, true);
    player.clearFailure();
    assert.equal(player.status, 'playing'); // A new search never cuts off healthy playback.
  } finally { stop(); globalThis.Audio = originalAudio; globalThis.fetch = originalFetch; }
});

test('Spotify full playback uses the listening endpoint, not the 30-second preview endpoint', async () => {
  const originalAudio = globalThis.Audio, originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.Audio = Media as unknown as typeof Audio;
  globalThis.fetch = async input => {
    calls.push(String(input));
    return new Response(JSON.stringify({available:true,status:'completed',url:'https://music.ism.tw/api/listen/spotify/test/audio?grant=signed',limited:false,downloadable:true,remaining:4}));
  };
  const player = createPreviewState(() => {}), stop = player.mount();
  try {
    await player.play({...track,provider:'spotify'},[]);
    assert.deepEqual(calls,['/api/listen/spotify']);
    assert.equal(player.limited,false);
    assert.equal(player.length,245.5);
    assert.equal(player.remaining,4);
    assert.equal(player.status,'playing');
    player.seek(120); assert.equal(player.elapsed,120);
  } finally {stop();globalThis.Audio=originalAudio;globalThis.fetch=originalFetch;}
});

test('iPhone gesture blocking leaves prepared full audio ready for the next tap', async () => {
  const originalAudio=globalThis.Audio,originalFetch=globalThis.fetch;
  let attempts=0,requests=0;
  class GestureMedia extends Media { async play() { if (++attempts===1) throw new DOMException('Gesture needed','NotAllowedError'); await super.play(); } }
  globalThis.Audio=GestureMedia as unknown as typeof Audio;
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({available:true,url:'https://music.ism.tw/full.m4a',limited:false,downloadable:true}));};
  const player=createPreviewState(()=>{}),stop=player.mount();
  try {
    await player.play({...track,provider:'spotify'},[]);
    assert.equal(player.status,'paused'); assert.match(player.error,/按播放/); assert.equal(player.ready,false);
    await player.play({...track,provider:'spotify'},[]);
    assert.equal(player.status,'playing'); assert.equal(player.error,''); assert.equal(requests,1);
  }finally{stop();globalThis.Audio=originalAudio;globalThis.fetch=originalFetch;}
});
