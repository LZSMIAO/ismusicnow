<script lang="ts">
  import { Play, Pause, Clock3, Music2, ExternalLink } from '@lucide/svelte';
  import type { Track } from '#lib/types.js';
  import { duration, providerNames } from '#lib/ui.js';
  let { tracks, selected, current = '', playing = false, busy = false, search = false, ontoggle, onselectall, onpreview }: {
    tracks: Track[]; selected: string[]; current?: string; playing?: boolean; busy?: boolean; search?: boolean;
    ontoggle: (key: string) => void; onselectall: () => void; onpreview: (track: Track) => void;
  } = $props();
  const selectedCount = $derived(tracks.filter((track) => selected.includes(`${track.provider}:${track.id}`)).length);
</script>
<section class="tracklist" aria-label="曲目列表">
  <div class="track-head"><span>#</span><span>曲名</span><span class="source-column">{search ? '來源' : '專輯'}</span><Clock3 size={16} /><label class="check-hit"><input type="checkbox" aria-label="選取或取消前 20 首" checked={selectedCount === Math.min(20, tracks.length) && selectedCount > 0} indeterminate={selectedCount > 0 && selectedCount < Math.min(20, tracks.length)} disabled={busy || !tracks.length} onchange={onselectall} /></label></div>
  {#each tracks as track, i (`${track.provider}:${track.id}:${i}`)}
    {@const key = `${track.provider}:${track.id}`}
    <div class="track" class:checked={selected.includes(key)} class:current={current === key}>
      <button class="track-play" aria-label={`${current === key && playing ? '暫停' : '播放'} ${track.title}`} onclick={() => onpreview(track)}><span class="track-number">{i + 1}</span><span class="track-icon">{#if current === key && playing}<Pause size={16} fill="currentColor" />{:else}<Play size={16} fill="currentColor" />{/if}</span></button>
      <div class="track-identity">{#if search}<span class="track-thumb">{#if track.cover}<img src={track.cover} alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={18} />{/if}</span>{/if}<span class="track-title"><strong>{track.title}</strong><small>{track.artists.join(' / ') || '演出者資料未提供'}</small></span></div>
      <a class="source-column" href={track.sourceUrl} target="_blank" rel="noreferrer" aria-label={`在 ${providerNames[track.provider]} 打開 ${track.title}`}>{search ? providerNames[track.provider] : track.album || '—'}<ExternalLink size={12} /></a>
      <span class="duration">{duration(track.durationMs)}</span><label class="check-hit"><input type="checkbox" aria-label={`下載 ${track.title}`} checked={selected.includes(key)} disabled={busy || (!selected.includes(key) && selected.length >= 20)} onchange={() => ontoggle(key)} /></label>
    </div>
  {/each}
  {#if !tracks.length}<p class="empty-results">沒有找到歌曲。試試其他關鍵字或完整音樂連結。</p>{/if}
</section>
