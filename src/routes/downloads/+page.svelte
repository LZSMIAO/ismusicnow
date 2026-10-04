<script lang="ts">
  import { onMount } from 'svelte';
  import DownloadQueue from '#lib/components/QueueList.svelte';
  import { createDownloadState } from '#lib/download-state.svelte.js';
  const queue = createDownloadState();
  onMount(() => queue.start());
</script>
<svelte:head><title>下載記錄 · MUISM · 音樂主義</title></svelte:head>
<div class="page-content history-page"><header class="page-intro"><h1>下載記錄</h1><p>檔案保留 24 小時。Telegram 內依帳號保存記錄；一般瀏覽器依 cookies 保存。</p></header><DownloadQueue jobs={queue.jobs} busy={queue.busy} error={queue.error} compact={false} onclear={() => queue.clear()} onretry={(job) => queue.retry(job)} /></div>
