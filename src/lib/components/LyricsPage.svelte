<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { ChevronLeft, Music2, RotateCcw } from '@lucide/svelte';
  import type { LyricPlayer, LyricLineMouseEvent } from '@applemusic-like-lyrics/core';
  import type { Track } from '#lib/types.js';
  import { lyricIndex, type LyricLine } from '#lib/lyrics.js';
  import { toPlayerLines } from '#lib/lyric-player.js';
  import { providerNames } from '#lib/ui.js';
  import '@applemusic-like-lyrics/core/style.css';
  let { track, lines, plain, loading, error, instrumental, playing, ready, length, elapsed, gettime, onseek, onclose, onretry }: {
    track: Track; lines: LyricLine[]; plain: string; loading: boolean; error: string; instrumental: boolean;
    playing: boolean; ready: boolean; length: number; elapsed: number; gettime: () => number;
    onseek: (time: number) => void; onclose: () => void; onretry: () => void;
  } = $props();
  let host: HTMLDivElement, closeButton: HTMLButtonElement;
  let renderer = $state<LyricPlayer>(), failed = $state(false);
  let frame = 0, lastFrame = 0;
  const current = $derived(lyricIndex(lines, elapsed));
  const status = $derived(loading ? '正在讀取歌詞…' : error || (instrumental ? '純音樂' : '暫無歌詞'));
  function animate(time: number) {
    frame = 0;
    if (!renderer || document.hidden) return;
    // Keep the scroll engine alive while paused; inertia can outlast a short wake timer.
    // Cap render work at 60 Hz on high-refresh displays.
    if (!lastFrame || time - lastFrame >= 15) {
      renderer.setCurrentTime(gettime() * 1000);
      renderer.update(Math.min(50, Math.max(0, time - (lastFrame || time)))); lastFrame = time;
    }
    frame = requestAnimationFrame(animate);
  }
  function wake() {
    if (!frame && renderer && !document.hidden) { lastFrame = 0; frame = requestAnimationFrame(animate); }
  }
  $effect(() => {
    if (!renderer) return;
    renderer.setLyricLines(toPlayerLines(lines, track.durationMs / 1000 || untrack(() => length)), untrack(gettime) * 1000);
    wake();
  });
  $effect(() => { if (!renderer) return; if (playing) renderer.resume(); else renderer.pause(); wake(); });
  // Explicit jumps are detected by AMLL from the media clock; repeated paused updates are not seeks.
  onMount(() => {
    let disposed = false;
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    function motion() { renderer?.setEnableBlur(false); renderer?.setEnableScale(!media.matches); renderer?.setEnableSpring(!media.matches); wake(); }
    const visibility = () => { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else wake(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('.queue-modal[open]')) onclose(); };
    closeButton.focus({ preventScroll: true });
    document.addEventListener('visibilitychange', visibility); document.addEventListener('keydown', escape); media.addEventListener('change', motion);
    void import('@applemusic-like-lyrics/core').then(({ LyricPlayer }) => {
      if (disposed) return;
      const instance = new LyricPlayer();
      // Use one position engine: CSS transition fallback was trailing manual scroll and newly mounted lines.
      instance.setEnableSpring(!media.matches); instance.setEnableScale(!media.matches); instance.setEnableBlur(false);
      instance.setAlignPosition(.42); instance.setOverscanPx(600);
      instance.getElement().setAttribute('aria-hidden', 'true');
      instance.addEventListener('line-click', event => {
        const row = (event as LyricLineMouseEvent).line;
        if (ready && row) { onseek(row.getLine().startTime / 1000); wake(); }
      });
      host.append(instance.getElement()); renderer = instance;
    }).catch(() => { if (!disposed) failed = true; });
    return () => {
      disposed = true; cancelAnimationFrame(frame);
      document.removeEventListener('visibilitychange', visibility); document.removeEventListener('keydown', escape); media.removeEventListener('change', motion);
      renderer?.dispose();
    };
  });
</script>
<section class="lyrics-page" aria-label="歌詞頁">
  <header class="lyrics-page-header"><button bind:this={closeButton} class="icon-button" aria-label="返回音樂" onclick={onclose}><ChevronLeft size={22} /></button><span>歌詞</span></header>
  <div class="lyrics-page-body">
    <aside class="lyrics-record"><div class="lyrics-record-cover">{#if track.cover}<img src={track.cover} alt={`${track.album || track.title} 封面`} referrerpolicy="no-referrer" onerror={(event) => (event.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={72} strokeWidth={1} />{/if}</div><h1>{track.title}</h1><p>{track.artists.join(' / ')}</p><small>{track.album} · {providerNames[track.provider]}</small></aside>
    <div class="lyrics-stage">
      <div class="lyrics-renderer" bind:this={host} role="region" aria-label="同步歌詞" onwheel={wake} ontouchmove={wake} hidden={!lines.length || failed}></div>
      <select class="lyrics-jump" aria-label="跳到歌詞" disabled={!ready || !lines.length} value={current} onchange={(event) => { const row = lines[Number(event.currentTarget.value)]; if (row) { onseek(row.time); wake(); } }}>{#if current < 0}<option value="-1">前奏</option>{/if}{#each lines as line, i}<option value={i}>{line.text || "間奏"}</option>{/each}</select>
      {#if !lines.length || failed}<div class="lyrics-page-fallback">{#if error}<p>{status}</p><button class="text-button" onclick={onretry}><RotateCcw size={16} />重試</button>{:else if plain}<p class="lyrics-page-plain">{plain}</p>{:else}<p>{status}</p>{/if}{#if failed && lines.length}{#each lines as line}<button disabled={!ready} onclick={() => onseek(line.time)}>{line.text || '· · ·'}</button>{/each}{/if}</div>{/if}
    </div>
  </div>
</section>
