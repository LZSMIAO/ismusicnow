<script lang="ts">
  import { Download, ArrowUpRight, Music2 } from '@lucide/svelte';
  import type { Collection, DownloadFormat } from '#lib/types.js';
  import { duration, providerNames } from '#lib/ui.js';
  let { collection, selected, format = $bindable<DownloadFormat>('original'), busy, ontoggle, onselectall, ondownload }: {
    collection: Collection; selected: string[]; format?: DownloadFormat; busy: boolean;
    ontoggle: (key: string) => void; onselectall: () => void; ondownload: () => void;
  } = $props();
  const kinds = { track: '單曲', album: '專輯', playlist: '歌單', search: '搜尋結果' };
</script>

<section class="track-section" aria-labelledby="collection-title">
  <div class="collection-header">
    {#if collection.tracks[0]?.cover}<img class="collection-cover" src={collection.tracks[0].cover} alt="" width="88" height="88" referrerpolicy="no-referrer" onerror={(event) => event.currentTarget.setAttribute('hidden', '')} />{/if}
    <div class="collection-heading"><span class="small-label">{providerNames[collection.provider]} · {kinds[collection.kind]}</span><h2 id="collection-title">{collection.title}</h2><p>{collection.kind === 'track' ? collection.tracks[0]?.artists.join(' / ') || '演出者資料未提供' : `${collection.tracks.length} 首已載入`}<span> · {collection.provider === 'spotify' ? 'Spotify 原始音源' : collection.provider === 'ytm' ? '獨立 YTM 音源' : '網易雲音源'}</span></p></div>
  </div>
  {#each collection.warnings as warning}<p class="result-notice">{warning}</p>{/each}
  {#if collection.tracks.length}
    <div class="list-toolbar"><button class="text-button" onclick={onselectall} disabled={busy}>選取前 {Math.min(20, collection.tracks.length)} 首</button><span>已選 {selected.length} 首 · 每次最多 20 首</span></div>
    <div class="track-table" role="group" aria-label="曲目列表">
      <div class="track-table-heading"><span></span><span>曲目</span><span class="album-column">專輯</span><span class="duration-column">時長</span><span></span></div>
      {#each collection.tracks as track, i (`${track.provider}:${track.id}:${i}`)}
        <div class="track-row" class:checked={selected.includes(`${track.provider}:${track.id}`)}>
          <input type="checkbox" aria-label={`選取 ${track.title}`} checked={selected.includes(`${track.provider}:${track.id}`)} disabled={busy || (!selected.includes(`${track.provider}:${track.id}`) && selected.length >= 20)} onchange={() => ontoggle(`${track.provider}:${track.id}`)} />
          <div class="track-identity"><span class="track-art">{#if track.cover}<img src={track.cover} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => event.currentTarget.setAttribute('hidden', '')} />{:else}<Music2 size={18} />{/if}</span><div><strong>{track.title}</strong><small>{track.artists.join(' / ') || '演出者資料未提供'}</small></div></div>
          <span class="album-column">{track.album || '—'}</span><span class="duration-column">{duration(track.durationMs)}</span><a class="icon-button" href={track.sourceUrl} target="_blank" rel="noreferrer" aria-label={`在 ${providerNames[track.provider]} 打開 ${track.title}`}><ArrowUpRight size={17} /></a>
        </div>
      {/each}
    </div>
    <div class="selection-bar"><div class="format-select"><label for="format">保存音質</label><select id="format" bind:value={format} disabled={busy}><option value="original">原始可用音質</option>{#if collection.provider === 'netease'}<option value="mp3">平台原生 MP3</option><option value="flac">平台原生 FLAC</option>{/if}</select></div><button class="primary-button" onclick={ondownload} disabled={!selected.length || busy}><Download size={17} />{busy ? '正在加入…' : `獲取 ${selected.length} 首`}</button></div>
  {:else}<div class="empty-results"><Music2 size={24} /><h3>沒有找到歌曲</h3><p>試試完整歌名或演出者名稱，也可以直接貼上歌曲連結。</p></div>{/if}
</section>
