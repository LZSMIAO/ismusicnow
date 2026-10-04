<script lang="ts">
  import { onMount } from 'svelte';
  import { ArrowUpRight, Check, X } from '@lucide/svelte';
  import AcquireForm from '#lib/components/AcquireForm.svelte';
  import TrackList from '#lib/components/TrackList.svelte';
  import DownloadQueue from '#lib/components/DownloadQueue.svelte';
  import ServiceOverview from '#lib/components/ServiceOverview.svelte';
  import { createDownloadState } from '#lib/download-state.svelte.js';
  import type { Collection, DownloadFormat, Provider, ServiceStatus } from '#lib/types.js';
  import { api } from '#lib/ui.js';
  let input = $state(''); let provider = $state<Provider>('netease');
  let collection = $state<Collection | null>(null); let selected = $state<string[]>([]);
  let format = $state<DownloadFormat>('original'); let loading = $state(false); let adding = $state(false);
  let error = $state(''); let notice = $state(''); let statusError = $state(''); let status = $state<ServiceStatus | null>(null);
  const queue = createDownloadState();
  onMount(() => {
    void api<ServiceStatus>('/api/status').then((result) => status = result).catch(() => statusError = '暫時無法讀取適配器狀態，請稍後重新整理。');
    return queue.start();
  });
  async function resolve() {
    if (!input.trim() || loading) return;
    loading = true; error = ''; notice = ''; collection = null; selected = [];
    try {
      collection = await api<Collection>('/api/resolve', { method: 'POST', body: JSON.stringify({ input, provider }) });
      provider = collection.provider; format = 'original';
      selected = collection.tracks.slice(0, 20).map((t) => `${t.provider}:${t.id}`);
    } catch (e) { error = e instanceof Error ? e.message : '無法獲取音樂。'; }
    finally { loading = false; }
  }
  function toggle(key: string) { selected = selected.includes(key) ? selected.filter((id) => id !== key) : [...selected, key]; }
  async function addDownloads() {
    if (!collection || !selected.length || adding) return;
    adding = true; error = ''; notice = '';
    try {
      const tracks = collection.tracks.filter((t) => selected.includes(`${t.provider}:${t.id}`)).map((t) => ({ provider: t.provider, id: t.id }));
      await api('/api/downloads', { method: 'POST', body: JSON.stringify({ tracks, format }) });
      notice = `${tracks.length} 首歌曲已加入下載佇列。`; selected = []; await queue.refresh();
    } catch (e) { error = e instanceof Error ? e.message : '無法加入下載。'; }
    finally { adding = false; }
  }
</script>

<svelte:head><title>獲取音樂 · ismusicnow 音樂主義</title></svelte:head>
<div class="page-content">
  <header class="page-top"><span class="page-context">你的音樂收藏，從這裡開始。</span><a class="top-external" href="https://t.me/ismusicnow_bot" target="_blank" rel="noreferrer">Telegram bot <ArrowUpRight size={16} /></a></header>
  <div class="page-intro"><h1>喜歡的聲音，<br class="mobile-break" />留在身邊<span>。</span></h1><p>從網易雲、Spotify 和 YouTube Music 獲取音樂。<br class="desktop-break" />把散落在各處的喜歡，慢慢收進自己的收藏。</p></div>
  <div class="workspace"><div class="acquisition"><AcquireForm bind:input bind:provider busy={loading || adding} onsubmit={resolve} />
    <div class="feedback" aria-live="polite">{#if error}<div class="error-banner" role="alert"><span>{error} <a href="/guide">查看指南</a></span><button class="icon-button" aria-label="關閉錯誤訊息" onclick={() => error = ''}><X size={17} /></button></div>{/if}{#if notice}<p class="success-notice"><Check size={16} />{notice}</p>{/if}</div>
    {#if loading}<div class="loading-results" aria-busy="true" aria-label="正在讀取音樂資料"><div class="skeleton skeleton-title"></div>{#each [1, 2, 3] as n (n)}<div class="skeleton-row"><div class="skeleton skeleton-cover"></div><div class="skeleton skeleton-text"></div></div>{/each}</div>{:else if collection}<TrackList {collection} {selected} bind:format busy={adding} ontoggle={toggle} onselectall={() => selected = collection!.tracks.slice(0, 20).map((t) => `${t.provider}:${t.id}`)} ondownload={addDownloads} />{:else}<ServiceOverview {status} error={statusError} />{/if}
    <div class="music-note"><span class="note-line"></span><p>音樂是生活裡，值得留下的部分。</p><span class="note-line"></span></div>
  </div><DownloadQueue jobs={queue.jobs} busy={queue.busy} error={queue.error} onclear={() => queue.clear()} onretry={(job) => queue.retry(job)} /></div>
  <footer class="page-footer"><span>ismusicnow · 音樂主義</span><span>獨立開源項目 · <a href="/license.txt">GPL-3.0</a></span></footer>
</div>
