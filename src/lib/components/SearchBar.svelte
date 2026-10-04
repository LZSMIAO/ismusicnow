<script lang="ts">
  import { ArrowRight, Check, Search } from '@lucide/svelte';
  import { onMount } from 'svelte';

  let { value = $bindable(''), source = $bindable('all'), inputElement = $bindable(), loading = false, onsearch }: {
    value?: string; source?: string; inputElement?: HTMLInputElement; loading?: boolean; onsearch: () => void;
  } = $props();
  const options = [
    { value: 'all', label: '所有來源' }, { value: 'netease', label: '網易雲' },
    { value: 'spotify', label: 'Spotify' }, { value: 'ytm', label: 'YouTube Music' },
  ];
  const selected = $derived(options.find(option => option.value === source) || options[0]);
  let form: HTMLFormElement, panel: HTMLDivElement;
  let open = $state(false), top = $state(0), left = $state(0), width = $state(0), maxHeight = $state(0);
  function position() {
    const bounds = form.getBoundingClientRect(), viewport = window.visualViewport;
    width = Math.min(bounds.width, window.innerWidth - 24);
    left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    top = bounds.bottom + 8;
    maxHeight = Math.max(0, (viewport ? viewport.height + viewport.offsetTop : window.innerHeight) - top - 12);
  }
  function expand() {
    position();
    if (!panel.matches(':popover-open')) panel.showPopover();
  }
  function close(restore = false) {
    // Restore first: focusing the input must not reopen a panel just dismissed with Escape.
    if (restore) inputElement?.focus({ preventScroll: true });
    panel.hidePopover();
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
      panel.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    }
  }
  function optionKeyboard(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); close(true); return; }
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault(); source = options[next]!.value; buttons[next]?.focus({ preventScroll: true });
  }
  onMount(() => {
    const reposition = () => { if (panel.matches(':popover-open')) position(); };
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
    document.addEventListener('focusin', focused);
    document.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
      window.visualViewport?.removeEventListener('resize', reposition); window.visualViewport?.removeEventListener('scroll', reposition);
      document.removeEventListener('focusin', focused);
      document.removeEventListener('pointerdown', outside, true);
    };
  });
</script>

<form bind:this={form} class="searchbar" class:search-expanded={open} role="search" onsubmit={submit}>
  <Search size={22} aria-hidden="true" />
  <input id="music-input" bind:this={inputElement} bind:value aria-label="搜尋音樂或貼上連結" aria-controls="search-options" aria-expanded={open} aria-describedby="search-current-source" placeholder={source === 'all' ? '搜尋或貼上連結' : `搜尋 ${selected.label}，或貼上連結`} maxlength="1000" autocomplete="off" onfocus={expand} onclick={expand} onkeydown={inputKeyboard} />
  <span id="search-current-source" class="sr-only">搜尋來源：{selected.label}</span>
  <button class="search-submit" type="submit" aria-label={loading ? '重新搜尋' : '搜尋'} disabled={!value.trim()}><ArrowRight size={18} /></button>
</form>
<div id="search-options" bind:this={panel} popover class="search-options" aria-label="搜尋選項" style={`top:${top}px;left:${left}px;width:${width}px;max-height:${maxHeight}px`} ontoggle={(event: ToggleEvent) => open = event.newState === 'open'}>
  <div class="search-sources" role="radiogroup" tabindex="-1" aria-label="搜尋來源" onkeydown={optionKeyboard}>
    {#each options as option (option.value)}
      <button type="button" role="radio" aria-checked={source === option.value} tabindex={source === option.value ? 0 : -1} onclick={() => { source = option.value; inputElement?.focus({ preventScroll: true }); }}>
        <span>{option.label}</span><Check size={14} aria-hidden="true" class={source === option.value ? '' : 'source-check-hidden'} />
      </button>
    {/each}
  </div>
</div>
