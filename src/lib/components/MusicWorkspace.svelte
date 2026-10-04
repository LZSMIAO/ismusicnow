<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Library, House, Search, Download, ArrowRight, ChevronLeft, PanelRight, X, Play, Pause, SkipBack, SkipForward, Volume2, Music2, LoaderCircle, ExternalLink } from '@lucide/svelte';
  import TrackList from './MusicTrackList.svelte';
  import SelectMenu from './SelectMenu.svelte';
  import DownloadQueue from './QueueList.svelte';
  import { createDownloadState } from '#lib/download-state.svelte.js';
  import { createPreviewState } from '#lib/preview-state.svelte.js';
  import { api, duration, providerNames } from '#lib/ui.js';
  import { setTelegramBack } from '#lib/telegram.js';
  import type { Collection, SearchSource, Track } from '#lib/types.js';

  type Recent = { input: string; provider: SearchSource; title: string; artist: string; cover: string; kind: Collection['kind'] };
  let input = $state(''), source = $state<string>('all'), collection = $state<Collection | null>(null), recent = $state<Recent[]>([]);
  let selected = $state<string[]>([]), format = $state<string>('original'), loading = $state(false), adding = $state(false), error = $state(''), notice = $state('');
  let previewVisible = $state(true), reduced = $state(false), queueOpen = $state(false), continuous = $state(false);
  type View = { collection: Collection; selected: string[]; format: string; input: string; source: string };
  let previous = $state<View[]>([]), viewInput = '', viewSource = 'all';
  let queueTrigger: HTMLElement | undefined;
  let searchInput: HTMLInputElement, panel: HTMLElement, drawer: HTMLElement;
  let searchRequest: AbortController | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const queue = createDownloadState();
  const player = createPreviewState(() => { if (continuous) void adjacent(1, false); });
  const sourceOptions = [{ value: 'all', label: '所有來源' }, { value: 'netease', label: '網易雲' }, { value: 'spotify', label: 'Spotify' }, { value: 'ytm', label: 'YouTube Music' }];
  const first = $derived(collection?.tracks[0]);
  const active = $derived(player.track || first || null);
  const current = $derived(player.track ? `${player.track.provider}:${player.track.id}` : '');
  const isPlaying = $derived(player.status === 'playing');
  const nextTrack = $derived.by(() => { const tracks = collection?.tracks || []; const index = tracks.findIndex((t) => `${t.provider}:${t.id}` === current); return tracks[Math.max(0, index) + 1] || null; });
  const allowFormats = $derived(!!collection && collection.tracks.filter((t) => selected.includes(`${t.provider}:${t.id}`)).every((t) => t.provider === 'netease'));
  const formatOptions = $derived(allowFormats ? [{ value: 'original', label: '原始格式' }, { value: 'mp3', label: 'MP3' }, { value: 'flac', label: '原生 FLAC' }] : [{ value: 'original', label: '原始格式' }]);
  const albums = $derived.by(() => {
    const seen = new Set<string>();
    return (collection?.tracks || []).filter((track) => {
      if (!track.albumUrl || seen.has(track.albumUrl)) return false;
      seen.add(track.albumUrl); return true;
    }).slice(0, 3);
  });
  const totalTime = $derived(collection?.tracks.reduce((sum, track) => sum + track.durationMs, 0) || 0);

  onMount(() => {
    const stopQueue = queue.start(), stopPlayer = player.mount();
    const media = matchMedia('(prefers-reduced-motion: reduce)'); reduced = media.matches;
    const motion = () => reduced = media.matches; media.addEventListener('change', motion);
    try { const saved: unknown = JSON.parse(localStorage.getItem('ismusicnow-recent') || '[]'); if (Array.isArray(saved)) recent = saved.filter((item) => item && typeof item.input === 'string' && typeof item.title === 'string' && typeof item.artist === 'string' && typeof item.cover === 'string' && ['track', 'album', 'playlist', 'search'].includes(item.kind) && ['all', 'netease', 'spotify', 'ytm'].includes(item.provider)).slice(0, 8); } catch { /* Browsing works without local storage. */ }
    return () => { searchRequest?.abort(); clearTimeout(noticeTimer); stopQueue(); stopPlayer(); media.removeEventListener('change', motion); };
  });
  $effect(() => {
    return setTelegramBack(queueOpen ? closeQueue : collection ? (previous.length ? back : home) : null);
  });
  function feedback(text: string) { notice = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice = '', 5000); }
  async function resolve(value = input, provider = source as SearchSource) {
    if (!value.trim()) { searchInput.focus(); return; }
    searchRequest?.abort(); const request = new AbortController(); searchRequest = request;
    input = value; source = provider; loading = true; error = ''; notice = ''; continuous = false;
    try {
      const result = await api<Collection>('/api/resolve', { method: 'POST', body: JSON.stringify({ input: value, provider }), signal: request.signal });
      if (searchRequest !== request) return;
      if (collection) previous = [...previous.slice(-11), { collection, selected: [...selected], format, input: viewInput, source: viewSource }];
      viewInput = value; viewSource = provider;
      collection = result; selected = result.tracks.slice(0, 1).map((track) => `${track.provider}:${track.id}`); format = 'original';
      const track = result.tracks[0];
      if (track) {
        recent = [{ input: value, provider, title: result.title, artist: result.kind === 'search' ? '搜尋結果' : track.artists.join(' / '), cover: track.cover, kind: result.kind }, ...recent.filter((item) => item.input !== value || item.provider !== provider)].slice(0, 8);
        try { localStorage.setItem('ismusicnow-recent', JSON.stringify(recent)); } catch { /* Optional history. */ }
      }
      await tick(); panel.scrollTop = 0;
    } catch (e) { if (!request.signal.aborted) error = e instanceof Error ? e.message : '無法取得音樂，請稍後重試。'; }
    finally { if (searchRequest === request) loading = false; }
  }
  function resetFormat() { if (!collection?.tracks.filter((t) => selected.includes(`${t.provider}:${t.id}`)).every((t) => t.provider === 'netease')) format = 'original'; }
  function toggle(key: string) { selected = selected.includes(key) ? selected.filter((id) => id !== key) : selected.length < 20 ? [...selected, key] : selected; resetFormat(); }
  function selectAll() {
    const keys = collection?.tracks.slice(0, 20).map((track) => `${track.provider}:${track.id}`) || [];
    selected = keys.every((key) => selected.includes(key)) ? [] : keys; resetFormat();
    if ((collection?.tracks.length || 0) > 20 && selected.length) feedback('已選前 20 首，每次最多下載 20 首。');
  }
  async function download() {
    if (!collection || !selected.length || adding) return;
    adding = true; error = '';
    try {
      const tracks = collection.tracks.filter((track) => selected.includes(`${track.provider}:${track.id}`)).map(({ provider, id }) => ({ provider, id }));
      await api('/api/downloads', { method: 'POST', body: JSON.stringify({ tracks, format }) });
      await queue.refresh(); feedback(`${tracks.length} 首已加入下載佇列。`); openQueue();
    } catch (e) { error = e instanceof Error ? e.message : '無法加入下載，請稍後重試。'; }
    finally { adding = false; }
  }
  async function downloadForPlayback(track: Track) {
    if (adding) return;
    adding = true; error = '';
    try {
      await api('/api/downloads', { method: 'POST', body: JSON.stringify({ tracks: [{ provider: track.provider, id: track.id }], format: 'original' }) });
      await queue.refresh(); feedback('已加入下載佇列，完成後再按播放即可播放完整音訊。'); openQueue();
    } catch (e) { error = e instanceof Error ? e.message : '無法取得完整音訊。'; }
    finally { adding = false; }
  }
  function home() { collection = null; selected = []; input = ''; previous = []; continuous = false; }
  function back() {
    const last = previous.at(-1);
    if (!last) return;
    previous = previous.slice(0, -1); collection = last.collection; selected = last.selected; format = last.format;
    input = viewInput = last.input; source = viewSource = last.source; continuous = false; panel.scrollTop = 0;
  }
  function openQueue() { queueTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; drawer.showPopover({ source: queueTrigger }); drawer.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }); }
  function closeQueue() { drawer.hidePopover(); queueTrigger?.focus({ preventScroll: true }); }
  function queueKeyboard(event: KeyboardEvent) { if (event.key === 'Escape') { event.preventDefault(); closeQueue(); } }
  function preview(track: Track, album = false) {
    continuous = album;
    if (current === `${track.provider}:${track.id}` && (isPlaying || player.status === 'loading')) player.pause();
    else void player.play(track, queue.jobs);
  }
  function adjacent(offset: number, wrap = true) {
    const tracks = collection?.tracks || []; const index = tracks.findIndex((track) => `${track.provider}:${track.id}` === current);
    if (!tracks.length || (!wrap && index + offset >= tracks.length)) { continuous = false; return; }
    const track = tracks[(Math.max(0, index) + offset + tracks.length) % tracks.length];
    if (track) return player.play(track, queue.jobs);
  }
  function keyboard(event: KeyboardEvent) {
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable],button,a')) return;
    if (event.key === '/') { event.preventDefault(); searchInput.focus(); }
    if (event.code === 'Space' && active) { event.preventDefault(); preview(active); }
  }
</script>

<svelte:window onkeydown={keyboard} />
<header class="app-header">
  <a class="brand" href="/" aria-label="ismusicnow 首頁" onclick={(e) => { e.preventDefault(); home(); }}><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><strong>ismusicnow.</strong></a>
  <form class="searchbar" role="search" onsubmit={(e) => { e.preventDefault(); void resolve(); }}><Search size={22} /><input id="music-input" bind:this={searchInput} bind:value={input} aria-label="搜尋音樂或貼上連結" placeholder="搜尋音樂，或貼上連結" maxlength="1000" autocomplete="off" /><SelectMenu id="source-menu" bind:value={source} options={sourceOptions} label="搜尋來源" /><button class="search-submit" type="submit" aria-label={loading ? '重新搜尋' : '搜尋'} disabled={!input.trim()}><ArrowRight size={18} /></button></form>
  <nav class="mobile-nav" aria-label="行動版導覽"><a class="icon-button" href="/guide" aria-label="使用指南"><Library size={18} /></a><button class="icon-button" aria-label="下載佇列" aria-expanded={queueOpen} onclick={openQueue}><Download size={18} /></button></nav>
  <div class="header-links"><a href="https://github.com/LZSMIAO/ismusicnow" target="_blank" rel="noreferrer">GitHub ↗</a><a href="https://t.me/muismbot" target="_blank" rel="noreferrer">Telegram ↗</a></div>
</header>
<div class="workspace" class:preview-hidden={!previewVisible}>
  <aside class="library" aria-label="音樂導覽">
    <div class="library-head"><Library size={22} /><span>你的音樂</span></div><nav class="side-nav"><button class:active={collection?.kind !== 'search'} onclick={home} aria-label="最近開啟"><House size={20} /><span>最近開啟</span></button><button class:active={collection?.kind === 'search'} onclick={() => searchInput.focus()} aria-label="搜尋音樂"><Search size={20} /><span>搜尋</span></button><button onclick={openQueue} aria-label="下載佇列"><Download size={20} /><span>下載佇列</span>{#if queue.jobs.length}<span class="badge">{queue.jobs.length}</span>{/if}</button></nav>
    {#if recent.length}<div class="recent-heading">最近開啟</div>{#each recent as item (`${item.provider}:${item.input}`)}<button class="recent-album" aria-label={`重新開啟 ${item.title}`} onclick={() => void resolve(item.input, item.provider)}><span class="recent-cover">{#if item.cover}<img src={item.cover} alt="" width="48" height="48" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={22} />{/if}</span><span><strong>{item.title}</strong><small>{item.artist}</small></span></button>{/each}{/if}
    <div class="side-footer"><a href="/guide">使用指南 ↗</a><a href="/downloads">全部下載 ↗</a></div>
  </aside>
  <main class="main-panel" id="main" bind:this={panel} aria-busy={loading}>
    <div class="panel-navigation"><button class="back-button" aria-label="回到上一頁" disabled={!previous.length} onclick={back}><ChevronLeft size={20} /></button><span>{loading ? '正在搜尋' : collection?.title || '音樂'}</span><button class="icon-button" aria-label={previewVisible ? '收起預覽面板' : '展開預覽面板'} aria-pressed={previewVisible} onclick={() => previewVisible = !previewVisible}><PanelRight size={20} /></button></div>
    {#if error}<div class="error-banner" role="alert"><span>{error}</span><button class="icon-button" aria-label="關閉錯誤訊息" onclick={() => error = ''}><X size={18} /></button></div>{/if}
    {#if loading}<div class="loading-results" aria-label="正在讀取音樂資料"><div class="skeleton-album"><div class="skeleton skeleton-cover"></div><div><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div></div>{#each [1,2,3,4,5] as n (n)}<div class="skeleton skeleton-row"></div>{/each}</div>
    {:else if collection}
      {#key collection}<div class="result-view" in:fade={{ duration: reduced ? 0 : 180, easing: cubicOut }}>
      {#if collection.kind !== 'search'}
        <section class="album-hero" aria-label={`${collection.title} ${collection.kind === 'playlist' ? '歌單' : collection.kind === 'track' ? '單曲' : '專輯'}`}>
          <div class="album-cover">{#if first?.cover}<img src={first.cover} alt={`${collection.title} 封面`} width="208" height="208" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={56} strokeWidth={1.2} />{/if}</div>
          <div class="album-heading"><p class="album-type">{collection.kind === 'album' ? '專輯' : collection.kind === 'playlist' ? '歌單' : '單曲'}</p><h1>{collection.title}</h1>{#if first?.artists.length}<button class="artist-link" onclick={() => void resolve(first!.artists.join(' '), first!.provider)}>{first.artists.join(' / ')}</button>{/if}<p class="album-facts">{collection.tracks.length} 首{totalTime ? ` · ${Math.floor(totalTime / 60000)} 分鐘` : ''}</p></div>
        </section>
      {:else}<header class="search-heading"><h1>「{collection.title}」</h1><span>歌曲 · {collection.tracks.length} 首已載入{collection.total > collection.tracks.length ? ` / ${collection.total} 首` : ''}</span></header>{/if}
      <div class="album-tools">
        <div class="preview-actions"><button class="big-play" aria-label={isPlaying && continuous ? '暫停專輯播放' : '播放全部曲目'} disabled={!first} onclick={() => first && preview(continuous && player.track ? player.track : first, true)}>{#if player.status === 'loading'}<LoaderCircle size={24} class="loading-icon" />{:else if isPlaying && continuous}<Pause size={24} fill="currentColor" />{:else}<Play size={24} fill="currentColor" />{/if}</button><div class="source-origin">{(collection.providers?.length || 0) > 1 ? '多個來源' : providerNames[collection.provider]}{#if first && collection.kind !== 'search'}<a href={collection.kind === 'album' ? first.albumUrl || first.sourceUrl : first.sourceUrl} target="_blank" rel="noreferrer">查看原頁 ↗</a>{/if}</div></div>
        <div class="download-controls"><span class="selected-count" aria-live="polite">已選 {selected.length} 首</span><SelectMenu id="format-menu" bind:value={format} options={formatOptions} label="下載音質" disabled={adding} compact /><button class="download-button" disabled={adding || !selected.length} onclick={download}>{#if adding}<LoaderCircle size={18} class="loading-icon" />{:else}<Download size={18} />{/if}<span>{adding ? '正在加入' : `下載 ${selected.length} 首`}</span></button></div>
      </div>
      {#if collection.warnings.length}<details class="result-warnings"><summary>{collection.warnings.length} 項來源提示</summary>{#each collection.warnings as warning}<p>{warning}</p>{/each}</details>{/if}
      {#if collection.kind === 'search' && albums.length}<section class="search-albums" aria-label="搜尋結果中的專輯"><h2>專輯</h2><div>{#each albums as album (album.albumUrl)}<button class="search-album" onclick={() => void resolve(album.albumUrl!, album.provider)}><span class="search-album-cover">{#if album.cover}<img src={album.cover} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={24} />{/if}</span><span><strong>{album.album}</strong><small>{album.artists.join(' / ')} · {providerNames[album.provider]}</small></span><ArrowRight size={16} /></button>{/each}</div></section>{/if}
      <TrackList tracks={collection.tracks} {selected} {current} playing={isPlaying} busy={adding} search={collection.kind === 'search'} ontoggle={toggle} onselectall={selectAll} onpreview={preview} />
      </div>{/key}
    {:else}
      <div class="home-view">{#if recent.length}<h1>最近開啟</h1><div class="history-grid">{#each recent as item (`${item.provider}:${item.input}`)}<button class="history-card" onclick={() => void resolve(item.input, item.provider)}><span class="history-cover">{#if item.cover}<img src={item.cover} alt="" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={48} />{/if}</span><strong>{item.title}</strong><small>{item.artist}</small></button>{/each}</div>{:else}<div class="initial-search"><Music2 size={48} strokeWidth={1.2} /><p>尚未開啟音樂</p><button class="download-button" onclick={() => searchInput.focus()}><Search size={18} />搜尋</button></div>{/if}</div>
    {/if}
  </main>
  {#if previewVisible}
    <aside class="preview" aria-label="歌曲預覽" in:fade={{ duration: reduced ? 0 : 180 }}>
      <div class="preview-head"><h2>歌曲預覽</h2><button class="icon-button" aria-label="收起預覽面板" onclick={() => previewVisible = false}><X size={18} /></button></div>
      {#if active}<div class="preview-cover">{#if active.cover}<img src={active.cover} alt={`${active.album || active.title} 封面`} referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={56} />{/if}</div><div class="preview-title"><h3>{active.title}</h3><p>{active.artists.join(' / ')}</p></div><div class="preview-info"><span>{providerNames[active.provider]}</span>{#if player.track && player.status !== 'loading' && player.status !== 'unavailable' && player.status !== 'error'}<span>{player.limited ? '平台試聽片段' : '完整播放'}</span>{/if}</div>
        {#if player.error && player.track}<p class="preview-message" role="status">{player.error}</p><a class="text-button" href={player.track.sourceUrl} target="_blank" rel="noreferrer">在原平台播放 <ExternalLink size={14} /></a>{/if}
        {#if player.track && (player.error || player.limited)}<button class="text-button" disabled={adding} onclick={() => player.track && void downloadForPlayback(player.track)}><Download size={14} />{adding ? '正在加入' : '下載完整音訊'}</button>{/if}
        {#if nextTrack}<section class="next-preview"><h3>下一首</h3><button class="next-song" onclick={() => preview(nextTrack!)}><span class="next-cover">{#if nextTrack.cover}<img src={nextTrack.cover} alt="" width="40" height="40" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={16} />{/if}</span><span><strong>{nextTrack.title}</strong><small>{nextTrack.artists.join(' / ')}</small></span><Play size={18} /></button></section>{/if}
      {:else}<p class="preview-empty">尚未選擇歌曲</p>{/if}
    </aside>
  {/if}
</div>
<section class="player" aria-label="音樂播放器">
  <div class="now-playing"><span class="player-cover">{#if active?.cover}<img src={active.cover} alt="" width="56" height="56" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={24} />{/if}</span><span><strong>{active?.title || '尚未播放'}</strong><small>{active?.artists.join(' / ') || 'ismusicnow'}</small></span></div>
  <div class="player-center"><div class="transport"><button aria-label="上一首" disabled={!collection?.tracks.length} onclick={() => { continuous = false; void adjacent(-1); }}><SkipBack size={18} fill="currentColor" /></button><button class="player-play" aria-label={isPlaying ? '暫停播放' : '播放音樂'} disabled={!active} onclick={() => active && preview(active)}>{#if player.status === 'loading'}<LoaderCircle size={18} class="loading-icon" />{:else if isPlaying}<Pause size={18} fill="currentColor" />{:else}<Play size={18} fill="currentColor" />{/if}</button><button aria-label="下一首" disabled={!collection?.tracks.length} onclick={() => { continuous = false; void adjacent(1); }}><SkipForward size={18} fill="currentColor" /></button></div><div class="seek-line"><span>{player.elapsed ? duration(player.elapsed * 1000) : '0:00'}</span><input type="range" min="0" max={player.length} step=".1" value={player.elapsed} disabled={!player.ready} aria-label="播放進度" style={`--played:${player.length ? player.elapsed / player.length * 100 : 0}%`} oninput={(e) => player.seek(Number(e.currentTarget.value))} /><span>{duration(player.length * 1000)}</span></div></div>
  <div class="player-right"><button class="icon-button" aria-label="下載佇列" aria-expanded={queueOpen} onclick={openQueue}><Download size={18} /></button><Volume2 size={18} /><input type="range" min="0" max="1" step=".01" value={player.volume} aria-label="音量" oninput={(e) => player.setVolume(Number(e.currentTarget.value))} /><button class="icon-button" aria-label="切換預覽面板" aria-pressed={previewVisible} onclick={() => previewVisible = !previewVisible}><PanelRight size={18} /></button></div>
</section>
{#if player.error}<div class="mobile-preview-error" class:preview-collapsed={!previewVisible} role="status"><span>{player.error}</span>{#if player.track}<button class="text-button" disabled={adding} onclick={() => player.track && void downloadForPlayback(player.track)}>下載完整音訊</button>{/if}{#if player.track}<a href={player.track.sourceUrl} target="_blank" rel="noreferrer">原平台 ↗</a>{/if}</div>{/if}
<div role="dialog" aria-modal="false" class="queue-drawer" bind:this={drawer} popover tabindex="-1" onkeydown={queueKeyboard} aria-label="下載佇列面板" ontoggle={(event) => queueOpen = event.newState === 'open'}><button class="icon-button queue-close" aria-label="關閉下載佇列" onclick={closeQueue}><X size={18} /></button><DownloadQueue jobs={queue.jobs} busy={queue.busy} error={queue.error} onclear={() => queue.clear()} onretry={(job) => queue.retry(job)} /></div>
{#if notice}<div class="toast" role="status" in:fade={{ duration: reduced ? 0 : 160 }} out:fade={{ duration: reduced ? 0 : 120 }}><span>{notice}</span><button class="icon-button" aria-label="關閉提示" onclick={() => notice = ''}><X size={16} /></button></div>{/if}
