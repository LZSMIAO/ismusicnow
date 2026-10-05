<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ChevronUp, RotateCcw, Maximize2 } from '@lucide/svelte';
  import { slide } from 'svelte/transition';
  import { quartOut } from 'svelte/easing';
  import LyricsPage from './LyricsPage.svelte';
  import { api, providerNames } from '#lib/ui.js';
  import { displayLyricLines, lyricIndex, type Lyrics } from '#lib/lyrics.js';
  import type { Track } from '#lib/types.js';
  let { track, elapsed, ready, playing, length, gettime, pageOpen = $bindable(false), onseek }: { track: Track | null; elapsed: number; ready: boolean; playing: boolean; length: number; gettime: () => number; pageOpen?: boolean; onseek: (time: number) => void } = $props();
  let pageTrigger: HTMLButtonElement;
  function closePage() { pageOpen = false; void tick().then(() => pageTrigger?.focus({ preventScroll: true })); }
  let data = $state<Lyrics | null>(null), expanded = $state(false), loading = $state(false), error = $state(''), retry = $state(0);
  let root: HTMLElement;
  let reduced = $state(false);
  let scroller = $state<HTMLElement>();
  const lines = $derived(displayLyricLines(data?.lines || [], track?.title || '', track?.artists || []));
  const index = $derived(lyricIndex(lines, elapsed));
  const line = $derived((index >= 0 ? lines[index]?.text || '· · ·' : '') || (loading ? '正在讀取歌詞…' : error || (data?.instrumental ? '純音樂' : lines.length ? '前奏' : data?.plain ? '未提供同步時間' : '暫無歌詞')));
  $effect(() => {
    const next = track; retry;
    data = null; error = ''; loading = !!next;
    if (!next) return;
    const request = new AbortController();
    void api<Lyrics>('/api/lyrics', { method: 'POST', body: JSON.stringify({ provider: next.provider, id: next.id, title: next.title, artists: next.artists, album: next.album, durationMs: next.durationMs }), signal: request.signal })
      .then(value => { if (!request.signal.aborted) data = value; })
      .catch(() => { if (!request.signal.aborted) error = '歌詞暫時無法讀取'; })
      .finally(() => { if (!request.signal.aborted) loading = false; });
    return () => request.abort();
  });
  $effect(() => {
    const current = index; const open = expanded;
    if (open && current >= 0) void tick().then(() => { const row = scroller?.querySelector<HTMLElement>(`[data-line="${current}"]`); if (row && scroller) scroller.scrollTo({ top: Math.max(0, row.offsetTop - scroller.clientHeight / 2 + row.clientHeight / 2), behavior: reduced ? 'instant' : 'smooth' }); });
  });
  $effect(() => {
    document.documentElement.classList.toggle('has-lyrics', !!track && !pageOpen);
    if (!expanded) return;
    const outside = (event: PointerEvent) => { if (!root.contains(event.target as Node)) expanded = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { expanded = false; } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  });
  onMount(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)'); reduced = media.matches;
    const motion = () => reduced = media.matches; media.addEventListener('change', motion);
    document.documentElement.style.removeProperty('--lyrics-height');
    return () => { media.removeEventListener('change', motion); document.documentElement.classList.remove('has-lyrics'); };
  });
</script>
<section class="player-lyrics" class:lyrics-expanded={expanded} bind:this={root} hidden={!track || pageOpen} aria-label="歌詞">
  <div class="lyrics-strip">
    <button class="lyrics-toggle" aria-label={expanded ? '收起歌詞' : '展開歌詞'} aria-expanded={expanded} aria-controls="lyrics-body" onclick={() => expanded = !expanded}>
      <span class="lyrics-label">歌詞</span><span class="lyrics-now">{expanded ? track?.title : line}</span><ChevronUp size={16} />
    </button>
    {#if error}<button class="icon-button lyrics-action" aria-label="重試歌詞" onclick={() => retry++}><RotateCcw size={16} /></button>{/if}
    <button bind:this={pageTrigger} class="icon-button lyrics-action" aria-label="開啟歌詞頁" onclick={() => { expanded = false; pageOpen = true; }}><Maximize2 size={16} /></button>
  </div>
  {#if expanded}
    <div class="lyrics-body" id="lyrics-body" in:slide={{ duration: reduced ? 0 : 220, easing: quartOut }} out:slide={{ duration: reduced ? 0 : 180, easing: quartOut }}>
      <div class="lyrics-lines" bind:this={scroller}>
        {#if lines.length}
          {#each lines as item, i (i)}<button class:lyric-current={i === index} data-line={i} disabled={!ready} aria-label={`跳到歌詞：${item.text || '間奏'}`} aria-current={i === index ? 'true' : undefined} onclick={() => onseek(item.time)}>{item.text || '· · ·'}</button>{/each}
        {:else if data?.plain}<p class="lyrics-plain">{data.plain}</p>{:else}<p class="lyrics-empty">{line}</p>{/if}
      </div>
      {#if data}<a class="lyrics-credit" href={data.source === 'lrclib' ? 'https://lrclib.net' : track?.sourceUrl} target="_blank" rel="noreferrer">{data.source === 'lrclib' ? 'LRCLIB' : providerNames[data.source]} ↗</a>{/if}
    </div>
  {/if}
</section>

{#if pageOpen && track}<LyricsPage {track} {lines} plain={data?.plain || ""} {loading} {error} instrumental={!!data?.instrumental} {ready} {playing} {length} {elapsed} {gettime} {onseek} onclose={closePage} onretry={() => retry++} />{/if}
