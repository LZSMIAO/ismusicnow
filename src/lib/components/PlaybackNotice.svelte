<script lang="ts">
  import { fly } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { LoaderCircle, CircleAlert, X, RotateCcw, Download } from '@lucide/svelte';
  let { message, title, preparing, identity, reduced, onretry, ondownload }: { message: string; title: string; preparing: boolean; identity: string; reduced: boolean; onretry: () => void; ondownload: () => void } = $props();
  let dismissed = $state(false);
  $effect(() => { message; identity; dismissed = false; });
</script>
{#if message && !dismissed}
  <aside class="playback-notice" aria-label="播放通知" role="status" aria-live="polite" aria-atomic="true" in:fly={{y:8,duration:reduced?0:180,easing:cubicOut}} out:fly={{y:4,duration:reduced?0:120}}>
    {#if preparing}<LoaderCircle class="loading-icon notice-symbol" size={20} />{:else}<CircleAlert class="notice-symbol" size={20} />{/if}
    <div class="notice-copy"><strong>{title}</strong><p>{message}</p>{#if !preparing}<div class="notice-actions"><button onclick={onretry}><RotateCcw size={14} />重試播放</button><button onclick={ondownload}><Download size={14} />下載音訊</button></div>{/if}</div>
    <button class="icon-button notice-close" aria-label="關閉播放通知" onclick={() => dismissed = true}><X size={18} /></button>
  </aside>
{/if}
