<script lang="ts">
  import { ArrowRight, Link2, Clipboard, Search, CircleDot, Disc3, Radio } from '@lucide/svelte';
  import type { Provider } from '#lib/types.js';
  let { input = $bindable(''), provider = $bindable<Provider>('netease'), busy = false, onsubmit }: {
    input?: string; provider?: Provider; busy?: boolean; onsubmit: () => void;
  } = $props();
  let clipboardNotice = $state('');
  const sources = [{ id: 'netease' as const, name: '網易雲音樂', icon: Disc3, caption: '原始音源 · MP3 / FLAC' },
    { id: 'spotify' as const, name: 'Spotify', icon: CircleDot, caption: 'Spotify 原始音源' },
    { id: 'ytm' as const, name: 'YouTube Music', icon: Radio, caption: '獨立 YTM 音源' }];
  async function paste() {
    try { input = await navigator.clipboard.readText(); clipboardNotice = ''; }
    catch { clipboardNotice = '無法讀取剪貼簿，請使用 Ctrl / ⌘ + V 貼上。'; }
  }
</script>

<section class="acquire-panel" aria-label="音樂獲取">
  <div class="source-tabs" role="group" aria-label="搜尋來源">
    {#each sources as source}
      <button class:selected={provider === source.id} aria-pressed={provider === source.id} disabled={busy} onclick={() => provider = source.id}>
        <source.icon size={21} strokeWidth={1.6} /><span><strong>{source.name}</strong><small>{source.caption}</small></span>
      </button>
    {/each}
  </div>
  <form onsubmit={(event) => { event.preventDefault(); onsubmit(); }}>
    <label for="music-input">一個連結，一首歌，或一整張專輯。</label>
    <div class="input-line">
      <div class="music-input"><Link2 size={19} aria-hidden="true" /><input id="music-input" bind:value={input} disabled={busy} autocomplete="off" required maxlength="1000" placeholder={provider === 'ytm' ? '貼上 YouTube Music 歌曲或歌單連結' : '貼上音樂連結，或搜尋歌名、演出者…'} /><button type="button" class="icon-button" aria-label="從剪貼簿貼上" title="貼上連結" disabled={busy} onclick={paste}><Clipboard size={18} /></button></div>
      <button class="primary-button" disabled={busy || !input.trim()} type="submit">{busy ? '正在尋找…' : '獲取音樂'}<ArrowRight size={18} /></button>
    </div>
    <div class="input-meta"><span><Search size={14} /> 連結自動辨識來源{provider === 'ytm' ? ' · YTM 支援連結獲取' : ' · 關鍵字使用所選平台'}</span><button class="text-button" type="button" disabled={busy} onclick={() => input = provider === 'netease' ? 'https://music.163.com/song?id=4010201' : provider === 'spotify' ? 'https://open.spotify.com/track/18gqCQzqYb0zvurQPlRkpo' : 'https://music.youtube.com/watch?v=Zi_XLOBDo_Y'}>填入範例連結 <ArrowRight size={13} /></button></div>
    {#if clipboardNotice}<p class="form-notice" role="status">{clipboardNotice}</p>{/if}
  </form>
</section>
