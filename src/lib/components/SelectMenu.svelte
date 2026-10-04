<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  let { id, value = $bindable(''), options, label, disabled = false, compact = false }: {
    id: string; value?: string; options: { value: string; label: string }[]; label: string; disabled?: boolean; compact?: boolean;
  } = $props();
  let trigger: HTMLButtonElement; let menu: HTMLDivElement;
  let open = $state(false), top = $state(0), left = $state(0);
  const selected = $derived(options.find((option) => option.value === value) || options[0]);
  function position() {
    const bounds = trigger.getBoundingClientRect();
    left = Math.max(12, Math.min(bounds.right - 192, window.innerWidth - 204));
    const height = options.length * 44 + 16;
    top = bounds.bottom + 8 + height > window.innerHeight ? Math.max(12, bounds.top - height - 8) : bounds.bottom + 8;
  }
  function close(restore = true) { menu.hidePopover(); if (restore) trigger.focus({ preventScroll: true }); }
  async function changed(event: ToggleEvent) {
    open = event.newState === 'open';
    if (open) { await tick(); menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true }); }
  }
  function keyboard(event: KeyboardEvent) {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next = index;
    if (event.key === 'ArrowDown') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowUp') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    else if (event.key === 'Tab') { close(false); return; }
    else return;
    event.preventDefault(); buttons[next]?.focus();
  }
  onMount(() => {
    const reposition = () => { if (open) position(); };
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    return () => { window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true); };
  });
</script>
<button type="button" class="select-trigger" class:compact bind:this={trigger} {disabled} popovertarget={id} aria-label={`${label}：${selected?.label}`} aria-haspopup="menu" aria-expanded={open} onclick={position} onkeydown={(event) => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); position(); menu.showPopover(); } }}>
  <span>{selected?.label}</span><ChevronDown size={15} class={open ? 'chevron open' : 'chevron'} />
</button>
<div {id} bind:this={menu} popover class="select-menu" role="menu" tabindex="-1" aria-label={label} style={`top:${top}px;left:${left}px`} ontoggle={changed} onkeydown={keyboard}>
  {#each options as option (option.value)}<button type="button" role="menuitemradio" aria-checked={value === option.value} tabindex={value === option.value ? 0 : -1} onclick={() => { value = option.value; close(); }}><span>{option.label}</span>{#if value === option.value}<Check size={16} />{/if}</button>{/each}
</div>
