<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import { pushState, replaceState } from '$app/navigation';
  import { workspaceUrl, readWorkspaceLocation } from '#lib/workspace-location.js';
  import { fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { Library, House, Search, Download, ArrowRight, ChevronLeft, PanelRight, X, Play, Pause, SkipBack, SkipForward, Volume2, Music2, LoaderCircle, ExternalLink, RotateCcw, CodeXml, Send, UserRound } from '@lucide/svelte';
  import GuideContent from './GuideContent.svelte';
  import TrackList from './MusicTrackList.svelte';
  import SelectMenu from './SelectMenu.svelte';
  import SearchBar from './SearchBar.svelte';
  import DownloadQueue from './QueueList.svelte';
  import PlayerLyrics from './PlayerLyrics.svelte';
  import PlaybackGlyph from './PlaybackGlyph.svelte';
  import PlaybackNotice from './PlaybackNotice.svelte';
  import { createDownloadState } from '#lib/download-state.svelte.js';
  import { createPreviewState } from '#lib/preview-state.svelte.js';
  import { api, duration, providerNames } from '#lib/ui.js';
  import { setTelegramBack } from '#lib/telegram.js';
  import type { Collection, SearchSource, Track, MusicEntity } from '#lib/types.js';

  type Recent = { input: string; provider: SearchSource; title: string; artist: string; cover: string; kind: Collection['kind']; query?: string };
  let input = $state(''), source = $state<string>('all'), collection = $state<Collection | null>(null), recent = $state<Recent[]>([]);
  let artists = $state<MusicEntity[]>([]), artistsLoading = $state(false);
  let selected = $state<string[]>([]), format = $state<string>('original'), loading = $state(false), adding = $state(false), error = $state(''), notice = $state('');
  let previewVisible = $state(true), reduced = $state(false), queueOpen = $state(false), continuous = $state(false), lyricsPage = $state(false);
  type Section = 'music' | 'guide' | 'downloads';
  let section = $state<Section>('music'), musicScroll = 0;
  let sectionTrigger: HTMLElement | undefined;
  type View = { artists: MusicEntity[]; collection: Collection; selected: string[]; format: string; input: string; source: string; resource: string };
  let previous = $state<View[]>([]), viewInput = $state(''), viewSource = 'all', viewResource = '';
  let routeReady = false, restoringLocation = true, locationRevision = 0;
  let queueTrigger: HTMLElement | undefined;
  let queueAnimations: Animation[] = [], queueClosing = false, queueRevision = 0;
  let searchInput = $state<HTMLInputElement>();
  let panel: HTMLElement, drawer: HTMLDialogElement, playerElement: HTMLElement;
  let searchRequest: AbortController | undefined, noticeTimer: ReturnType<typeof setTimeout> | undefined;
  const queue = createDownloadState();
  const player = createPreviewState(() => { if (continuous) void adjacent(1, false); });
  const first = $derived(collection?.tracks[0]);
  const active = $derived(player.track || first || null);
  const current = $derived(player.track ? `${player.track.provider}:${player.track.id}` : '');
  const isPlaying = $derived(player.status === 'playing');
  const collectionTrack = $derived(collection?.tracks.find((track) => `${track.provider}:${track.id}` === current));
  const collectionPlaying = $derived(!!collectionTrack && isPlaying);
  const collectionLoading = $derived(!!collectionTrack && player.status === 'loading');
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
    const resizePlayer = new ResizeObserver(() => document.documentElement.style.setProperty('--player-height', `${playerElement.getBoundingClientRect().height}px`));
    resizePlayer.observe(playerElement);
    const media = matchMedia('(prefers-reduced-motion: reduce)'); reduced = media.matches;
    const motion = () => reduced = media.matches; media.addEventListener('change', motion);
    try { const saved: unknown = JSON.parse(localStorage.getItem('ismusicnow-recent') || '[]'); if (Array.isArray(saved)) recent = saved.filter((item) => item && typeof item.input === 'string' && typeof item.title === 'string' && typeof item.artist === 'string' && typeof item.cover === 'string' && ['track', 'album', 'playlist', 'search', 'artist'].includes(item.kind) && ['all', 'netease', 'qq', 'kuwo', 'kugou', 'migu', 'qianqian', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili'].includes(item.provider)).slice(0, 8); } catch { /* Browsing works without local storage. */ }
    routeReady = true;
    const pop = () => void tick().then(restoreLocation);
    window.addEventListener('popstate', pop); void restoreLocation();
    return () => { window.removeEventListener('popstate', pop); document.documentElement.classList.remove('queue-open', 'queue-moving'); queueRevision++; queueAnimations.forEach(animation => animation.cancel()); resizePlayer.disconnect(); document.documentElement.style.removeProperty('--player-height'); searchRequest?.abort(); clearTimeout(noticeTimer); stopQueue(); stopPlayer(); media.removeEventListener('change', motion); };
  });
  $effect(() => {
    return setTelegramBack(queueOpen ? closeQueue : lyricsPage ? () => lyricsPage = false : section !== 'music' ? () => void showSection('music') : collection ? (previous.length ? back : home) : null);
  });
  function feedback(text: string) { notice = text; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => notice = '', 5000); }
  async function resolve(value = input, provider = source as SearchSource, query = value) {
    if (!value.trim()) { searchInput?.focus(); return; }
    section = 'music'; musicScroll = 0; lyricsPage = false; searchRequest?.abort(); const request = new AbortController(); searchRequest = request;
    const oldArtists = artists; input = query; source = provider; artists = []; artistsLoading = false; loading = true; error = ''; notice = ''; continuous = false;
    try {
      const result = await api<Collection>('/api/resolve', { method: 'POST', body: JSON.stringify({ input: value, provider }), signal: request.signal });
      if (searchRequest !== request) return;
      if (collection) previous = [...previous.slice(-11), { artists: oldArtists, collection, selected: [...selected], format, input: viewInput, source: viewSource, resource: viewResource }];
      if (!query && result.kind !== 'search') input = result.title;
      viewInput = input; viewSource = result.kind === 'search' ? provider : result.provider; viewResource = value;
      artistsLoading = result.kind === 'search'; player.clearFailure(); collection = result; selected = []; format = 'original';
      const track = result.tracks[0];
      if (track) {
        recent = [{ input: value, query: viewInput, provider, title: result.title, artist: result.kind === 'search' ? '搜尋結果' : track.artists.join(' / '), cover: track.cover, kind: result.kind }, ...recent.filter((item) => item.input !== value || item.provider !== provider)].slice(0, 8);
        try { localStorage.setItem('ismusicnow-recent', JSON.stringify(recent)); } catch { /* Optional history. */ }
      }
      await tick(); panel.scrollTop = 0; writeLocation();
      if (result.kind === 'search') void loadArtists(value, provider, request);
    } catch (e) { if (!request.signal.aborted) error = e instanceof Error ? e.message : '無法取得音樂，請稍後重試。'; }
    finally { if (searchRequest === request) loading = false; }
  }
  function writeLocation(replace = false) {
    if (!routeReady || restoringLocation) return;
    const url = workspaceUrl({ view: section !== 'music' ? section : collection?.kind || 'home', provider: viewSource as SearchSource, resource: viewResource, query: viewInput, lyrics: lyricsPage && player.track ? current : undefined, lyricResource: lyricsPage ? player.track?.sourceUrl : undefined });
    if (url !== location.pathname + location.search) (replace ? replaceState : pushState)(url, { searchQuery: viewInput });
  }
  async function restoreLocation() {
    const revision = ++locationRevision, href = location.href, state = readWorkspaceLocation(new URL(href));
    restoringLocation = true; lyricsPage = false;
    try {
      if (state.resource) await resolve(state.resource, state.provider, typeof page.state.searchQuery === 'string' ? page.state.searchQuery : state.query);
      else { home(); }
      if (location.href !== href) return;
      if (state.view === 'guide' || state.view === 'downloads') await showSection(state.view);
      if (state.lyrics) {
        let track = collection?.tracks.find(t => `${t.provider}:${t.id}` === state.lyrics);
        if (!track) {
          const separator = state.lyrics.indexOf(':'), provider = state.lyrics.slice(0, separator), id = state.lyrics.slice(separator + 1);
          const result = await api<Collection>('/api/resolve', { method: 'POST', body: JSON.stringify({ input: state.lyricResource || playbackResource(provider, id), provider }) });
          track = result.tracks[0];
        }
        if (track) { player.select(track); lyricsPage = true; }
      }
    } catch (e) { error = e instanceof Error ? e.message : '頁面載入失敗，請稍後重試。'; }
    finally { if (revision === locationRevision) { restoringLocation = false; if (!error) writeLocation(true); } }
  }
  function playbackResource(provider: string, id: string) {
    return provider === 'netease' ? `https://music.163.com/song?id=${encodeURIComponent(id)}` : provider === 'spotify' ? `https://open.spotify.com/track/${encodeURIComponent(id)}` : provider === 'ytm' ? `https://music.youtube.com/watch?v=${encodeURIComponent(id)}` : `${provider}:${id}`;
  }
  $effect(() => { lyricsPage; current; if (routeReady && !restoringLocation) writeLocation(); });
  function browse(value: string, provider: SearchSource) { void resolve(value, provider, input); }
  function reopen(item: Pick<Recent, 'input' | 'provider' | 'title' | 'query'>) { void resolve(item.input, item.provider, typeof item.query === 'string' ? item.query : /^https?:\/\//i.test(item.input) ? item.title : item.input); }
  async function loadArtists(value: string, provider: SearchSource, request: AbortController) {
    try {
      const result = await api<Collection>('/api/resolve', { method: 'POST', body: JSON.stringify({ input: value, provider, searchType: 'artist' }), signal: request.signal });
      if (searchRequest === request && !request.signal.aborted) artists = (result.entities || []).slice(0, 6);
    } catch { /* Songs remain usable when an artist source is unavailable. */ }
    finally { if (searchRequest === request) artistsLoading = false; }
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
      await queue.refresh(); feedback('已加入下載佇列。'); openQueue();
    } catch (e) { error = e instanceof Error ? e.message : '無法取得完整音訊。'; }
    finally { adding = false; }
  }
  async function showSection(next: Section) {
    if (section === next) return;
    if (section === 'music') {
      musicScroll = panel.scrollTop;
      sectionTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    }
    section = next; lyricsPage = false;
    await tick();
    panel.scrollTop = next === 'music' ? musicScroll : 0;
    if (next === 'music') sectionTrigger?.isConnected && sectionTrigger.focus({ preventScroll: true });
    else panel.querySelector<HTMLElement>('.integrated-page h1')?.focus({ preventScroll: true });
    writeLocation();
  }
  async function viewAllDownloads() {
    await closeQueue();
    if (!drawer.open) await showSection('downloads');
  }
  function home() { section = 'music'; musicScroll = 0; searchRequest?.abort(); searchRequest = undefined; loading = false; artists = []; artistsLoading = false; player.clearFailure(); collection = null; selected = []; input = viewInput = viewResource = ''; previous = []; continuous = false; writeLocation(); }
  function back() {
    if (section !== 'music') { void showSection('music'); return; }
    const last = previous.at(-1);
    if (!last) return;
    searchRequest?.abort(); searchRequest = undefined; loading = false; artistsLoading = false; artists = last.artists;
    previous = previous.slice(0, -1); collection = last.collection; selected = last.selected; format = last.format;
    input = viewInput = last.input; source = viewSource = last.source; viewResource = last.resource; continuous = false; panel.scrollTop = 0; writeLocation(true);
  }
  function cancelQueueMotion() { queueAnimations.forEach(animation => animation.cancel()); queueAnimations = []; }
  function openQueue() {
    if (drawer.open && !queueClosing) return;
    const revision = ++queueRevision;
    const sheet = drawer.querySelector<HTMLElement>('.queue-sheet')!;
    const shade = drawer.querySelector<HTMLElement>('.queue-shade')!;
    const focus = drawer.querySelector<HTMLElement>('.queue-focus-layer')!;
    const wasOpen = drawer.open;
    const from = wasOpen ? getComputedStyle(sheet).transform : 'translate3d(calc(100% + 48px),0,0)';
    const shadeFrom = wasOpen ? getComputedStyle(shade).opacity : '0';
    const focusFrom = wasOpen ? getComputedStyle(focus).opacity : '0';
    cancelQueueMotion(); queueClosing = false;
    if (!wasOpen) queueTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    drawer.classList.remove('queue-closing');
    document.documentElement.classList.add('queue-open');
    if (!wasOpen) drawer.showModal();
    queueOpen = true;
    if (!reduced) {
      document.documentElement.classList.add('queue-moving');
      const options = {duration:220,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards' as FillMode};
      queueAnimations = [
        sheet.animate([{transform:from},{transform:'translate3d(0,0,0)'}], {...options,duration:260}),
        shade.animate([{opacity:shadeFrom},{opacity:1}], options),
        focus.animate([{opacity:focusFrom},{opacity:1}], options),
      ];
      void Promise.all(queueAnimations.map(animation => animation.finished)).then(() => {
        if (queueRevision === revision) document.documentElement.classList.remove('queue-moving');
      }).catch(() => {});
    } else { shade.style.opacity = '1'; focus.style.opacity = '1'; }
    drawer.querySelector<HTMLButtonElement>('[aria-label="關閉下載佇列"]')?.focus({preventScroll:true});
  }
  async function closeQueue() {
    if (!drawer.open || queueClosing) return;
    const revision = ++queueRevision; queueClosing = true;
    const sheet = drawer.querySelector<HTMLElement>('.queue-sheet')!;
    const shade = drawer.querySelector<HTMLElement>('.queue-shade')!;
    const focus = drawer.querySelector<HTMLElement>('.queue-focus-layer')!;
    // Read all current frames before cancellation so reversing mid-entry never jumps.
    const from = getComputedStyle(sheet).transform, shadeFrom = getComputedStyle(shade).opacity;
    const focusFrom = getComputedStyle(focus).opacity;
    const travel = sheet.getBoundingClientRect().width + 48;
    const x = from === 'none' ? 0 : new DOMMatrixReadOnly(from).m41;
    const duration = Math.max(70, Math.round(180 * Math.max(0, Math.min(1, (travel - x) / travel))));
    cancelQueueMotion(); drawer.classList.add('queue-closing');
    if (!reduced) {
      document.documentElement.classList.add('queue-moving');
      const options = {duration,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards' as FillMode};
      queueAnimations = [
        sheet.animate([{transform:from},{transform:'translate3d(calc(100% + 48px),0,0)'}], options),
        shade.animate([{opacity:shadeFrom},{opacity:0}], options),
        focus.animate([{opacity:focusFrom},{opacity:0}], options),
      ];
      try { await Promise.all(queueAnimations.map(animation => animation.finished)); }
      catch { return; } // A newer opening or unmount owns the dialog now.
    }
    if (revision !== queueRevision) return;
    drawer.close(); cancelQueueMotion(); shade.style.removeProperty('opacity'); focus.style.removeProperty('opacity');
    drawer.classList.remove('queue-closing'); queueClosing = false;
    document.documentElement.classList.remove('queue-moving');
  }
  function queueClosed() {
    queueOpen = false; document.documentElement.classList.remove('queue-open', 'queue-moving');
    if (queueTrigger?.isConnected) queueTrigger.focus({preventScroll:true});
  }
  function playTrack(track: Track) {
    continuous = false;
    if (current === `${track.provider}:${track.id}` && (isPlaying || player.status === 'loading')) return;
    void player.play(track, queue.jobs);
  }
  function preview(track: Track, album = false) {
    continuous = album;
    if (current === `${track.provider}:${track.id}` && (isPlaying || player.status === 'loading')) player.pause();
    else void player.play(track, queue.jobs);
  }
  function playCollection() {
    const track = collectionTrack || first;
    if (track) preview(track, true);
  }
  function adjacent(offset: number, wrap = true) {
    const tracks = collection?.tracks || []; const index = tracks.findIndex((track) => `${track.provider}:${track.id}` === current);
    if (!tracks.length || (!wrap && index + offset >= tracks.length)) { continuous = false; return; }
    const track = tracks[(Math.max(0, index) + offset + tracks.length) % tracks.length];
    if (track) return player.play(track, queue.jobs);
  }
  function keyboard(event: KeyboardEvent) {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape' && section !== 'music' && !queueOpen && !lyricsPage) { event.preventDefault(); void showSection('music'); return; }
    const target = event.target as HTMLElement;
    if (target.closest('input,textarea,select,[contenteditable],button,a')) return;
    if (event.key === '/') { event.preventDefault(); searchInput?.focus(); }
    if (event.code === 'Space' && active) { event.preventDefault(); preview(active); }
  }
</script>

<svelte:window onkeydown={keyboard} />
<header class="app-header">
  <a class="brand" href="/" aria-label="MUISM 首頁" onclick={(e) => { e.preventDefault(); home(); }}><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><strong>MUISM.</strong></a>
  <SearchBar bind:value={input} bind:source bind:inputElement={searchInput} {loading} {recent} priorities={input.trim() === viewInput.trim() ? collection?.providers || (collection ? [collection.provider] : []) : []} onrecent={reopen} onsearch={() => void resolve()} />
  <nav class="mobile-nav" aria-label="行動版導覽"><button class="icon-button" aria-label="使用指南" aria-pressed={section === 'guide'} onclick={() => void showSection('guide')}><Library size={18} /></button><button class="icon-button" aria-label="下載佇列" aria-expanded={queueOpen} onclick={openQueue}><Download size={18} /></button></nav>
  <nav class="header-links" aria-label="項目連結"><a href="https://github.com/LZSMIAO/muism" target="_blank" rel="noreferrer" aria-label="GitHub，於新分頁開啟"><CodeXml size={18} /><span>GitHub</span></a><a href="https://t.me/muismbot" target="_blank" rel="noreferrer" aria-label="Telegram，於新分頁開啟"><Send size={18} /><span>Telegram</span></a></nav>
</header>
<div inert={lyricsPage} class="workspace" class:preview-hidden={!previewVisible} class:empty={!collection && !loading && section === 'music'} class:search-results={collection?.kind === 'search'}>
  <aside class="library" aria-label="音樂導覽">
    <div class="library-head"><Library size={22} /><span>你的音樂</span></div><nav class="side-nav"><button class:active={section === 'music' && collection?.kind !== 'search'} onclick={home} aria-label="最近開啟"><House size={20} /><span>最近開啟</span></button><button class:active={section === 'music' && collection?.kind === 'search'} onclick={() => searchInput?.focus()} aria-label="搜尋音樂"><Search size={20} /><span>搜尋</span></button><button onclick={openQueue} aria-label="下載佇列"><Download size={20} /><span>下載佇列</span>{#if queue.jobs.length}<span class="badge">{queue.jobs.length}</span>{/if}</button></nav>
    {#if recent.length}<div class="recent-heading">最近開啟</div>{#each recent as item (`${item.provider}:${item.input}`)}<button class="recent-album" aria-label={`重新開啟 ${item.title}`} onclick={() => reopen(item)}><span class="recent-cover">{#if item.cover}<img src={item.cover} alt="" width="48" height="48" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={22} />{/if}</span><span><strong>{item.title}</strong><small>{item.artist}</small></span></button>{/each}{/if}
    <nav class="side-footer" aria-label="工具"><button aria-current={section === 'guide' ? 'page' : undefined} onclick={() => void showSection('guide')}><Library size={18} /><span>使用指南</span></button><button aria-current={section === 'downloads' ? 'page' : undefined} onclick={() => void showSection('downloads')}><Download size={18} /><span>全部下載</span></button></nav>
  </aside>
  <main class="main-panel" id="main" bind:this={panel} aria-busy={loading && section === 'music'}>
    <div class="panel-navigation"><button class="back-button" aria-label="回到上一頁" disabled={section === 'music' && !previous.length} onclick={back}><ChevronLeft size={20} /></button><span>{section === 'guide' ? '使用指南' : section === 'downloads' ? '全部下載' : loading ? '正在搜尋' : collection?.kind === 'search' ? `歌曲 · ${collection.tracks.length} 首` : collection?.title || '音樂'}</span><button class="icon-button" aria-label={previewVisible ? '收起預覽面板' : '展開預覽面板'} aria-pressed={previewVisible} onclick={() => previewVisible = !previewVisible}><PanelRight size={20} /></button></div>
    <div hidden={section !== 'music'}>
    {#if error}<div class="error-banner" role="alert"><span>{error}</span><button class="icon-button" aria-label="關閉錯誤訊息" onclick={() => error = ''}><X size={18} /></button></div>{/if}
    {#if loading}<div class="loading-results" aria-label="正在讀取音樂資料"><div class="skeleton-album"><div class="skeleton skeleton-cover"></div><div><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div></div></div>{#each [1,2,3,4,5] as n (n)}<div class="skeleton skeleton-row"></div>{/each}</div>
    {:else if collection}
      {#key collection}<div class="result-view" in:fade={{ duration: reduced ? 0 : 180, easing: cubicOut }}>
      {#if collection.kind !== 'search' && !collection.entities?.length}
        <section class="album-hero" aria-label={`${collection.title} ${collection.kind === 'artist' ? '藝術家' : collection.kind === 'playlist' ? '歌單' : collection.kind === 'track' ? '單曲' : '專輯'}`}>
          <div class="album-cover">{#if first?.cover}<img src={first.cover} alt={`${collection.title} 封面`} width="208" height="208" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={56} strokeWidth={1.2} />{/if}</div>
          <div class="album-heading"><p class="album-type">{collection.kind === 'artist' ? '藝術家' : collection.kind === 'album' ? '專輯' : collection.kind === 'playlist' ? '歌單' : '單曲'}</p><h1>{collection.title}</h1>{#if first?.artists.length}<button class="artist-link" onclick={() => browse(first!.artists.join(' '), first!.provider)}>{first.artists.join(' / ')}</button>{/if}<p class="album-facts">{collection.tracks.length} 首{totalTime ? ` · ${Math.floor(totalTime / 60000)} 分鐘` : ''}</p></div>
        </section>
      {:else}<header class="search-heading"><h1>{collection.kind === 'search' ? `「${collection.title}」` : collection.title}</h1><span>{collection.entities?.length ? `專輯 · ${collection.entities.length} 張` : `歌曲 · ${collection.tracks.length} 首已載入${collection.total > collection.tracks.length ? ` / ${collection.total} 首` : ''}`}</span></header>{/if}
      {#if collection.tracks.length}<div class="album-tools">
        <div class="preview-actions"><button class="big-play" aria-label={collectionLoading ? '取消載入' : collectionPlaying ? '暫停播放' : '播放全部曲目'} aria-busy={collectionLoading} disabled={!first} onclick={playCollection}>{#if collectionLoading}<LoaderCircle size={24} class="loading-icon" />{:else}<PlaybackGlyph paused={collectionPlaying} />{/if}</button><div class="source-origin">{(collection.providers?.length || 0) > 1 ? '多個來源' : providerNames[collection.provider]}{#if first && collection.kind !== 'search'}<a href={collection.kind === 'album' ? first.albumUrl || first.sourceUrl : first.sourceUrl} target="_blank" rel="noreferrer">查看原頁 ↗</a>{/if}</div></div>
        <div class="download-controls"><span class="selected-count" aria-live="polite">已選 {selected.length} 首</span><SelectMenu id="format-menu" bind:value={format} options={formatOptions} label="下載音質" disabled={adding} compact /><button class="download-button" disabled={adding || !selected.length} onclick={download}>{#if adding}<LoaderCircle size={18} class="loading-icon" />{:else}<Download size={18} />{/if}<span>{adding ? '正在加入' : selected.length ? `下載 ${selected.length} 首` : '下載'}</span></button></div>
      </div>
      {/if}
      {#if collection.kind === 'search' && (artists.length || artistsLoading)}<section class="search-artists" aria-label="藝術家搜尋結果"><h2>藝術家</h2><div class="artist-results">{#if artistsLoading}{#each [1,2,3] as n (n)}<div class="artist-result" aria-hidden="true"><span class="artist-avatar skeleton"></span><strong>&nbsp;</strong><small>&nbsp;</small></div>{/each}{:else}{#each artists as artist (`${artist.provider}:${artist.id}`)}<button class="artist-result" onclick={() => browse(artist.sourceUrl, artist.provider)}><span class="artist-avatar">{#if artist.cover}<img src={artist.cover} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<UserRound size={36} strokeWidth={1.4} />{/if}</span><strong>{artist.title}</strong><small>{providerNames[artist.provider]}</small></button>{/each}{/if}</div></section>{/if}
      {#if collection.entities?.length}<section class="search-albums" aria-label="藝術家專輯"><h2>專輯</h2><div>{#each collection.entities as entity (`${entity.provider}:${entity.id}`)}<button class="search-album" onclick={() => browse(entity.sourceUrl, entity.provider)}><span class="search-album-cover">{#if entity.cover}<img src={entity.cover} alt="" loading="lazy" referrerpolicy="no-referrer" />{:else}<Music2 size={24} />{/if}</span><span><strong>{entity.title}</strong><small>{[entity.year, entity.artists.join(' / ')].filter(Boolean).join(' · ')}</small></span><ArrowRight size={16} /></button>{/each}</div></section>{/if}
      {#if collection.kind === 'search' && albums.length}<section class="search-albums" aria-label="搜尋結果中的專輯"><h2>專輯</h2><div>{#each albums as album (album.albumUrl)}<button class="search-album" onclick={() => browse(album.albumUrl!, album.provider)}><span class="search-album-cover">{#if album.cover}<img src={album.cover} alt="" loading="lazy" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={24} />{/if}</span><span><strong>{album.album}</strong><small>{album.artists.join(' / ')} · {providerNames[album.provider]}</small></span><ArrowRight size={16} /></button>{/each}</div></section>{/if}
      {#if collection.tracks.length}<TrackList tracks={collection.tracks} {selected} {current} playing={isPlaying} busy={adding} search={collection.kind === 'search'} ontoggle={toggle} onselectall={selectAll} onpreview={preview} onplay={playTrack} ondownload={(track) => void downloadForPlayback(track)} />{/if}
      </div>{/key}
    {:else}
      <div class="home-view">{#if recent.length}<h1>最近開啟</h1><div class="history-grid">{#each recent as item (`${item.provider}:${item.input}`)}<button class="history-card" onclick={() => reopen(item)}><span class="history-cover">{#if item.cover}<img src={item.cover} alt="" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={48} />{/if}</span><strong>{item.title}</strong><small>{item.artist}</small></button>{/each}</div>{:else}<div class="initial-search"><Music2 size={48} strokeWidth={1.2} /><p>尚未開啟音樂</p><button class="download-button" onclick={() => searchInput?.focus()}><Search size={18} />搜尋</button></div>{/if}</div>
    {/if}
    </div>
    {#if section === 'guide'}
      <div class="integrated-page integrated-guide"><GuideContent /></div>
    {:else if section === 'downloads'}
      <section class="integrated-page integrated-downloads" aria-label="全部下載">
        <header class="page-intro"><h1 tabindex="-1">全部下載</h1><p>檔案保留 24 小時。保存、重試與下載佇列即時同步。</p></header>
        <DownloadQueue jobs={queue.jobs} busy={queue.busy} error={queue.error} compact={false} onclear={() => queue.clear()} onretry={(job) => queue.retry(job)} />
      </section>
    {/if}
  </main>
  {#if previewVisible}
    <aside class="preview" aria-label="歌曲預覽" in:fade={{ duration: reduced ? 0 : 180 }}>
      <div class="preview-head"><h2>歌曲預覽</h2><button class="icon-button" aria-label="收起預覽面板" onclick={() => previewVisible = false}><X size={18} /></button></div>
      {#if active}<div class="preview-cover">{#if active.cover}<img src={active.cover} alt={`${active.album || active.title} 封面`} referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={56} />{/if}</div><div class="preview-title"><h3>{active.title}</h3><p>{active.artists.join(' / ')}</p></div><div class="preview-info"><span>{providerNames[active.provider]}</span>{#if player.track && player.status !== 'loading' && player.status !== 'unavailable' && player.status !== 'error'}<span>{player.limited ? '平台試聽片段' : '完整播放'}</span>{/if}</div>
        {#if nextTrack}<section class="next-preview"><h3>下一首</h3><button class="next-song" onclick={() => preview(nextTrack!)}><span class="next-cover">{#if nextTrack.cover}<img src={nextTrack.cover} alt="" width="40" height="40" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={16} />{/if}</span><span><strong>{nextTrack.title}</strong><small>{nextTrack.artists.join(' / ')}</small></span><Play size={18} /></button></section>{/if}
      {:else}<p class="preview-empty">尚未選擇歌曲</p>{/if}
    </aside>
  {/if}
</div>
<PlayerLyrics track={player.track} elapsed={player.elapsed} ready={player.ready} playing={isPlaying} length={player.length} gettime={() => player.currentTime} bind:pageOpen={lyricsPage} onseek={(time) => player.seek(time)} />
<section class="player" bind:this={playerElement} aria-label="音樂播放器">
  <div class="now-playing"><span class="player-cover">{#if active?.cover}<img src={active.cover} alt="" width="56" height="56" referrerpolicy="no-referrer" onerror={(e) => (e.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={24} />{/if}</span><span><strong>{active?.title || '尚未播放'}</strong><small>{#if active}<span class="player-source">{providerNames[active.provider]} · </span>{/if}{active?.artists.join(' / ') || 'MUISM · 音樂主義'}</small></span></div>
  <div class="player-center"><div class="transport"><button aria-label="上一首" disabled={!collection?.tracks.length} onclick={() => { continuous = false; void adjacent(-1); }}><SkipBack size={18} fill="currentColor" /></button><button class="player-play" aria-label={isPlaying ? '暫停播放' : player.error ? '重試播放' : '播放音樂'} disabled={!active} onclick={() => active && preview(active)}>{#if player.status === 'loading'}<LoaderCircle size={18} class="loading-icon" />{:else if isPlaying}<PlaybackGlyph size={18} paused />{:else if player.error}<RotateCcw size={18} />{:else}<PlaybackGlyph size={18} />{/if}</button><button aria-label="下一首" disabled={!collection?.tracks.length} onclick={() => { continuous = false; void adjacent(1); }}><SkipForward size={18} fill="currentColor" /></button></div><div class="seek-line"><span>{player.elapsed ? duration(player.elapsed * 1000) : '0:00'}</span><input type="range" min="0" max={player.length} step=".1" value={player.elapsed} disabled={!player.ready} aria-label="播放進度" style={`--played:${player.length ? player.elapsed / player.length * 100 : 0}%`} oninput={(e) => player.seek(Number(e.currentTarget.value))} /><span>{player.ready ? duration(player.length * 1000) : '—'}</span></div></div>
  <div class="player-right"><button class="icon-button" aria-label="下載佇列" aria-expanded={queueOpen} onclick={openQueue}><Download size={18} /></button><Volume2 size={18} /><input type="range" min="0" max="1" step=".01" value={player.volume} aria-label="音量" oninput={(e) => player.setVolume(Number(e.currentTarget.value))} /><button class="icon-button" aria-label="切換預覽面板" aria-pressed={previewVisible} onclick={() => previewVisible = !previewVisible}><PanelRight size={18} /></button></div>

</section>
<PlaybackNotice message={player.error || player.preparing} title={player.track?.title || '播放音樂'} preparing={!!player.preparing && !player.error} identity={current} {reduced} onretry={() => player.track && preview(player.track)} ondownload={() => player.track && void downloadForPlayback(player.track)} />
<dialog class="queue-modal" bind:this={drawer} aria-label="下載佇列" aria-modal="true" oncancel={(event) => { event.preventDefault(); closeQueue(); }} onclose={queueClosed} onpointerdown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('queue-shade')) closeQueue(); }}>
  <div class="queue-focus-layer" aria-hidden="true"></div>
  <div class="queue-shade" aria-hidden="true"></div>
  <div class="queue-sheet"><DownloadQueue jobs={queue.jobs} busy={queue.busy} error={queue.error} onclear={() => queue.clear()} onretry={(job) => queue.retry(job)} onclose={closeQueue} onviewall={() => void viewAllDownloads()} /></div>
</dialog>
{#if notice}<div class="toast" role="status" in:fade={{ duration: reduced ? 0 : 160 }} out:fade={{ duration: reduced ? 0 : 120 }}><span>{notice}</span><button class="icon-button" aria-label="關閉提示" onclick={() => notice = ''}><X size={16} /></button></div>{/if}
