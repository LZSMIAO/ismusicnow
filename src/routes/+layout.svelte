<script lang="ts">
  import '../app.css';
  import Sidebar from '#lib/components/Sidebar.svelte';
  let { children } = $props();
</script>

<svelte:head><meta name="description" content="音樂主義 — 從網易雲、Spotify 與 YouTube Music 獲取音樂，建立自己的收藏。" /><meta name="robots" content="noindex,nofollow" /></svelte:head>
<a class="skip-link" href="#main">跳到主要內容</a>
<div class="app-shell"><Sidebar /><main id="main">{@render children()}</main></div>
