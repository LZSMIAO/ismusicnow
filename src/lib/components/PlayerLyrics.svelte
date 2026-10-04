<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ChevronUp, ChevronDown, AlignLeft, RotateCcw } from '@lucide/svelte';
  import { api } from '#lib/ui.js';
  import { lyricIndex, type Lyrics } from '#lib/lyrics.js';
  import type { Track } from '#lib/types.js';
  let { track, elapsed, ready, onseek }: { track: Track | null; elapsed: number; ready: boolean; onseek: (time: number) => void } = $props();
  let data = $state<Lyrics | null>(null), expanded = $state(false), loading = $state(false), error = $state(''), retry = $state(0);
  let root: HTMLElement;
  let scroller = $state<HTMLElement>();
  const index = $derived(lyricIndex(data?.lines || [], elapsed));
  const line = $derived(data?.lines[index]?.text || (loading ? '正在讀取歌詞…' : error || (data?.instrumental ? '純音樂' : data?.lines.length ? '前奏' : data?.plain ? '未提供同步時間' : '暫無歌詞')));
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
    if (open && current >= 0) void tick().then(() => { const row = scroller?.querySelector<HTMLElement>(`[data-line="${current}"]`); if (row && scroller) scroller.scrollTop = Math.max(0, row.offsetTop - scroller.offsetTop - scroller.clientHeight / 2 + row.clientHeight / 2); });
  });
  onMount(() => {
    const resize = new ResizeObserver(() => document.documentElement.style.setProperty('--lyrics-height', `${root.getBoundingClientRect().height}px`));
    resize.observe(root); return () => { resize.disconnect(); document.documentElement.style.removeProperty('--lyrics-height'); };
  });
</script>
<section class="player-lyrics" bind:this={root} hidden={!track} aria-label="歌詞">
  <div class="lyrics-strip"><button class="lyrics-toggle" aria-expanded={expanded} aria-controls="lyrics-lines" onclick={() => expanded = !expanded}><AlignLeft size={16} /><span>歌詞</span>{#if expanded}<ChevronDown size={16} />{:else}<ChevronUp size={16} />{/if}</button><p>{line}</p>{#if error}<button class="icon-button" aria-label="重試歌詞" onclick={() => retry++}><RotateCcw size={16} /></button>{/if}</div>
  {#if expanded}<div class="lyrics-lines" id="lyrics-lines" bind:this={scroller}>
    {#if data?.lines.length}{#each data.lines as item, i (i)}<button class:lyric-current={i === index} data-line={i} disabled={!ready} aria-label={`跳到歌詞：${item.text || '間奏'}`} aria-current={i === index ? 'true' : undefined} onclick={() => onseek(item.time)}>{item.text || '· · ·'}</button>{/each}
    {:else if data?.plain}<p class="lyrics-plain">{data.plain}</p>{:else}<p class="lyrics-empty">{line}</p>{/if}
    {#if data}<a class="lyrics-credit" href={data.source === 'lrclib' ? 'https://lrclib.net' : track?.sourceUrl} target="_blank" rel="noreferrer">{data.source === 'lrclib' ? 'LRCLIB' : '網易雲音樂'} ↗</a>{/if}
  </div>{/if}
</section>
