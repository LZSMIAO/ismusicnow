<script lang="ts">
  import { CircleDot, Disc3, Radio, ArrowUpRight } from '@lucide/svelte';
  import type { ServiceStatus } from '#lib/types.js';
  let { status, error = '' }: { status: ServiceStatus | null; error?: string } = $props();
</script>

<section class="service-overview" aria-labelledby="source-title"><div class="section-heading"><h2 id="source-title">不同的來源，同樣的喜歡。</h2><a href="/guide" class="text-button">了解來源 <ArrowUpRight size={15} /></a></div><p class="section-description">各自獨立獲取，保留原本的聲音。音質依帳號權限與實際音源而定。</p>
  <div class="source-row"><span class="source-symbol"><Disc3 size={21} /></span><div><h3>網易雲音樂</h3><p>搜尋與分享連結 · 平台原生 MP3、FLAC</p></div><span class="status-tag">{status ? status.netease.accountConfigured ? '帳號已配置' : '基礎模式' : '檢查中'}</span></div>
  <div class="source-row"><span class="source-symbol"><CircleDot size={21} /></span><div><h3>Spotify</h3><p>Spotify 原始音源 · 保留原始編碼與音質</p></div><span class="status-tag" class:ready={status?.spotify.downloaderReady}>{status ? status.spotify.downloaderReady ? '適配器已配置' : '適配器待配置' : '檢查中'}</span></div>
  <div class="source-row"><span class="source-symbol"><Radio size={21} /></span><div><h3>YouTube Music</h3><p>歌曲與歌單連結 · 獨立 YTM 適配器</p></div><span class="status-tag" class:ready={status?.ytm.downloaderReady}>{status ? status.ytm.downloaderReady ? '適配器已安裝' : '適配器待安裝' : '檢查中'}</span></div>
  {#if error}<p class="result-notice" role="status">{error}</p>{/if}
</section>
