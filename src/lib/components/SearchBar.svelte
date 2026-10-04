<script lang="ts">
  import { ArrowRight, ChevronDown, Music2, Search } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { providerNames } from '#lib/ui.js';
  import type { Provider, SearchSource } from '#lib/types.js';

  type Recent = { input: string; provider: SearchSource; title: string; artist: string; cover: string; kind: string };
  let { value = $bindable(''), source = $bindable('all'), inputElement = $bindable(), loading = false, recent = [], priorities = [], onsearch, onrecent }: {
    value?: string; source?: string; inputElement?: HTMLInputElement; loading?: boolean; recent?: Recent[]; priorities?: Provider[]; onsearch: () => void; onrecent: (item: Recent) => void;
  } = $props();
  const catalogue = [
    { value: 'all', label: '所有來源' }, { value: 'netease', label: '網易雲' },
    { value: 'spotify', label: 'Spotify' }, { value: 'ytm', label: 'YouTube Music' },
    { value: 'soundcloud', label: 'SoundCloud' }, { value: 'bandcamp', label: 'Bandcamp' }, { value: 'bilibili', label: 'Bilibili' },
  ];
  const options = $derived([catalogue[0]!, ...catalogue.slice(1).sort((a,b) => {
    const ai = priorities.indexOf(a.value as Provider), bi = priorities.indexOf(b.value as Provider);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi);
  })]);
  const selected = $derived(options.find(option => option.value === source) || options[0]);
  let form: HTMLFormElement, panel: HTMLDivElement, sourceRow: HTMLDivElement, measure: HTMLDivElement;
  let capacity = $state(2), more = $state(false);
  const pinned = $derived(source !== 'all' ? [options[0]!, selected, ...options.slice(1).filter(o => o.value !== source)] : options);
  const visible = $derived(pinned.slice(0, capacity)), overflow = $derived(pinned.slice(capacity));
  function fitSources() {
    if (!sourceRow || !measure) return;
    const available = sourceRow.clientWidth;
    const items = [...measure.querySelectorAll<HTMLElement>('[data-source]')];
    const sizes = new Map(items.map(item => [item.dataset.source, item.getBoundingClientRect().width]));
    const gap = 6, moreWidth = measure.querySelector<HTMLElement>('.source-more')!.getBoundingClientRect().width;
    const sum = pinned.reduce((total, option) => total + (sizes.get(option.value) || 0), 0) + gap * (pinned.length - 1);
    let count = 0, used = 0;
    for (const option of pinned) {
      const size = sizes.get(option.value) || 0;
      if (used + size + (count ? gap : 0) + (sum > available ? moreWidth + gap : 0) > available) break;
      used += size + (count ? gap : 0); count++;
    }
    capacity = Math.max(1, count);
  }
  $effect(() => { void pinned; if (open) fitSources(); });
  let open = $state(false), top = $state(0), left = $state(0), width = $state(0), maxHeight = $state(0);
  function position() {
    const bounds = form.getBoundingClientRect(), viewport = window.visualViewport;
    width = Math.min(bounds.width, window.innerWidth - 24);
    left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    top = bounds.bottom + 8;
    maxHeight = Math.max(0, Math.min(560, (viewport ? viewport.height + viewport.offsetTop : window.innerHeight) - top - 12));
  }
  function expand() {
    position();
    if (!panel.matches(':popover-open')) panel.showPopover();
  }
  function close(restore = false) {
    // Restore first: focusing the input must not reopen a panel just dismissed with Escape.
    if (restore) inputElement?.focus({ preventScroll: true });
    panel.hidePopover(); more = false;
  }
  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    close(); inputElement?.blur(); onsearch();
  }
  function inputKeyboard(event: KeyboardEvent) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'ArrowDown') {
      event.preventDefault(); expand();
      (panel.querySelector<HTMLButtonElement>('.search-history-item') || panel.querySelector<HTMLButtonElement>('[aria-checked="true"]'))?.focus({ preventScroll: true });
    }
  }
  function recentKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('.search-history-item')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowUp' && index === 0) { event.preventDefault(); inputElement?.focus({ preventScroll: true }); return; }
    let next: number;
    if (event.key === 'ArrowDown') next = Math.min(index + 1, buttons.length - 1);
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault(); buttons[next]?.focus();
  }
  function subtitle(item: Recent) {
    const kind = ({ search: '搜尋', album: '專輯', artist: '藝術家', playlist: '歌單', track: '歌曲' } as Record<string, string>)[item.kind] || '音樂';
    const artist = item.artist && item.artist !== '搜尋結果' ? item.artist : '';
    const provider = item.provider === 'all' ? '所有來源' : providerNames[item.provider];
    return [kind, artist, provider].filter(Boolean).join(' · ');
  }
  function optionKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[role="radio"]')].filter(button => button.offsetParent !== null);
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault(); source = buttons[next]!.dataset.source!; buttons[next]?.focus({ preventScroll: true });
  }
  onMount(() => {
    // Manual popover: native light-dismiss sees the input outside the panel and
    // closes it between focus and click, causing a close/open flash. One owner
    // handles outside clicks, focus departure and Escape instead.
    const observer = new ResizeObserver(fitSources); observer.observe(sourceRow); observer.observe(measure);
    const reposition = () => { if (panel.matches(':popover-open')) position(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && panel.matches(':popover-open')) { event.preventDefault(); close(true); }
    };
    const focused = (event: FocusEvent) => {
      const target = event.target as Node;
      if (panel.matches(':popover-open') && !form.contains(target) && !panel.contains(target)) close();
    };
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.matches(':popover-open') && !form.contains(target) && !panel.contains(target)) close();
    };
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    window.visualViewport?.addEventListener('resize', reposition); window.visualViewport?.addEventListener('scroll', reposition);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focused);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('focusin', focused);
      document.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

<form bind:this={form} class="searchbar" class:search-expanded={open} role="search" onsubmit={submit}>
  <Search size={24} aria-hidden="true" />
  <input id="music-input" bind:this={inputElement} bind:value aria-label="搜尋音樂或貼上連結" aria-controls="search-options" aria-expanded={open} aria-describedby="search-current-source" placeholder={source === 'all' ? '搜尋或貼上連結' : source === 'bandcamp' ? `貼上 ${selected.label} 連結` : `搜尋 ${selected.label}，或貼上連結`} maxlength="1000" autocomplete="off" onfocus={expand} onclick={expand} onkeydown={inputKeyboard} />
  <span id="search-current-source" class="sr-only">搜尋來源：{selected.label}</span>
  <button class="search-submit" type="submit" aria-label={loading ? '重新搜尋' : '搜尋'} disabled={!value.trim()}><ArrowRight size={24} /></button>
</form>
<div id="search-options" bind:this={panel} popover="manual" class="search-options" aria-label="搜尋選項" style={`top:${top}px;left:${left}px;width:${width}px;max-height:${maxHeight}px`} onbeforetoggle={(event: ToggleEvent) => open = event.newState === 'open'}>
  <div class="source-control" role="radiogroup" tabindex="-1" aria-label="搜尋來源" onkeydown={optionKeyboard}>
    <div bind:this={sourceRow} class="search-sources">
      {#each visible as option (option.value)}
        <button type="button" class="source-chip" data-source={option.value} role="radio" aria-label={option.label} aria-checked={source === option.value} tabindex={source === option.value ? 0 : -1} onclick={() => { source = option.value; more = false; inputElement?.focus({ preventScroll: true }); }}>
          {#if option.value === 'ytm'}<span class="source-name-desktop">YTM</span><span class="source-name-mobile" aria-hidden="true">YTM</span>{:else}<span>{option.label}</span>{/if}
        </button>
      {/each}
      {#if overflow.length}
        <button type="button" class="source-chip source-more" aria-expanded={more} aria-controls="source-more-options" aria-label="More，更多音樂來源" onclick={() => more = !more}>More <ChevronDown size={14} class={more ? 'rotated' : ''} /></button>
      {/if}
    </div>
    <div id="source-more-options" class="source-more-options" hidden={!more}>
      {#each overflow as option, index (option.value)}
        <button type="button" class="source-chip" data-source={option.value} role="radio" aria-label={option.label} aria-checked={source === option.value} tabindex={index === 0 ? 0 : -1} onclick={() => { source = option.value; more = false; inputElement?.focus({ preventScroll: true }); }}>{option.label}{#if option.value === 'bandcamp'}<small class="source-capability">連結</small>{/if}</button>
      {/each}
    </div>
    <div bind:this={measure} class="source-measure" aria-hidden="true" inert>
      {#each catalogue as option}<span class="source-chip" data-source={option.value}>{#if option.value === 'ytm'}<span class="source-name-desktop">YTM</span><span class="source-name-mobile">YTM</span>{:else}{option.label}{/if}</span>{/each}
      <span class="source-chip source-more">More <ChevronDown size={14} /></span>
    </div>
  </div>
  {#if recent.length}
    <section class="search-history" aria-label="最近搜尋">
      <h2>最近搜尋</h2>
      <div class="search-history-list">
        {#each recent.slice(0, 6) as item (`${item.provider}:${item.input}`)}
          <button type="button" class="search-history-item" aria-label={`重新搜尋 ${item.title}`} onkeydown={recentKeyboard} onclick={() => { close(); inputElement?.blur(); onrecent(item); }}>
            <span class="search-history-cover" class:artist={item.kind === 'artist'}>{#if item.cover}<img src={item.cover} alt="" width="48" height="48" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => (event.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={20} />{/if}</span>
            <span class="search-history-text"><strong>{item.title}</strong><small>{subtitle(item)}</small></span>
          </button>
        {/each}
      </div>
    </section>
  {/if}
</div>
