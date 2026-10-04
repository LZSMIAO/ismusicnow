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
