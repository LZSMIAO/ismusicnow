<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { mountTelegram, setTelegramBack } from '#lib/telegram.js';
  import { page } from '$app/state';
  let { children } = $props();
  onMount(() => mountTelegram());
  $effect(() => { if (page.url.pathname !== '/') return setTelegramBack(() => void goto('/')); });
</script>
<svelte:head><meta name="description" content="音樂主義 — 搜尋、試聽與保存網易雲、Spotify 和 YouTube Music 的音樂。" /><meta name="robots" content="noindex,nofollow" /></svelte:head>
<a class="skip-link" href="#main">跳到主要內容</a>
{#if page.url.pathname === '/'}{@render children()}{:else}
  <header class="document-header"><a class="brand" href="/"><strong>MUISM.</strong></a><nav aria-label="主要導覽"><a href="/">音樂</a><a href="/downloads" aria-current={page.url.pathname === '/downloads' ? 'page' : undefined}>下載</a><a href="/guide" aria-current={page.url.pathname === '/guide' ? 'page' : undefined}>指南</a></nav></header><main id="main" class="document-main">{@render children()}</main>
{/if}
