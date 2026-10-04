<script lang="ts">
  import { Download, Music2, Check, RotateCcw, Trash2, LoaderCircle, X } from '@lucide/svelte';
  import { onMount } from 'svelte';
  import { telegramBridge, downloadTelegramFile } from '#lib/telegram.js';
  import { api } from '#lib/ui.js';
  import type { DownloadJob } from '#lib/types.js';
  import { audioLabel, providerNames } from '#lib/ui.js';
  let miniApp = $state(false), saving = $state(''), saveError = $state('');
  onMount(() => { miniApp = !!telegramBridge(); });
  async function save(job: DownloadJob) {
    if (saving) return;
    saving = job.id; saveError = '';
    try {
      const result = await api<{ url: string; filename: string }>(`/api/downloads/${job.id}/access`, { method: 'POST', body: JSON.stringify({ purpose: 'file' }) });
      downloadTelegramFile(result.url, result.filename);
    } catch (error) { saveError = error instanceof Error ? error.message : '無法保存音樂，請重試。'; }
    finally { saving = ''; }
  }
  let { jobs, busy = false, error = '', compact = true, onclear, onretry, onclose, onviewall }: {
    jobs: DownloadJob[]; busy?: boolean; error?: string; compact?: boolean; onclear: () => void; onretry: (job: DownloadJob) => void; onclose?: () => void; onviewall?: () => void;
  } = $props();
</script>
<section class="queue-panel" class:expanded={!compact} aria-label="下載佇列">
  <div class="queue-heading"><h2>下載佇列 <span>{jobs.length}</span></h2><div class="queue-actions">{#if jobs.some((j) => j.status === 'completed' || j.status === 'failed')}<button class="icon-button" aria-label="清除已完成及失敗項目" disabled={busy} onclick={onclear}><Trash2 size={20} /></button>{/if}{#if onclose}<button class="icon-button" aria-label="關閉下載佇列" onclick={onclose}><X size={20} /></button>{/if}</div></div>
  <div class="queue-body">
  {#if saveError}<p class="error-message" role="alert">{saveError}</p>{/if}
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if !jobs.length}<p class="queue-empty">尚無下載</p>{:else}
    <ul class="job-list">{#each jobs as job (job.id)}
      <li class="job-item"><div class="job-top"><span class="job-art">{#if job.track.cover}<img src={job.track.cover} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => (event.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={18} />{/if}</span><div class="job-identity"><strong>{job.track.title}</strong><small>{job.track.artists.join(' / ') || providerNames[job.track.provider]}</small></div>{#if job.status === 'completed'}<Check size={18} />{:else if job.status === 'downloading'}<LoaderCircle size={18} class="loading-icon" />{/if}</div>
        <div class="job-meta"><span>{providerNames[job.audioSource]} · {job.stage}</span>{#if job.status === 'completed'}<span>{((job.bytes || 0) / 1048576).toFixed(1)} MB</span>{/if}</div>
        {#if job.status === 'completed'}<p class="audio-info">{audioLabel(job)}</p>{#if miniApp}<button class="save-button" disabled={!!saving} onclick={() => void save(job)}>{#if saving === job.id}<LoaderCircle size={16} class="loading-icon" />{:else}<Download size={16} />{/if}保存音樂</button>{:else}<a class="save-button" href={`/api/downloads/${job.id}/file`} download><Download size={16} />保存音樂</a>{/if}{:else if job.status === 'failed'}<p class="job-error">{job.error}</p><button class="text-button" disabled={busy} onclick={() => onretry(job)}><RotateCcw size={14} />重試</button>{/if}
      </li>
    {/each}</ul><p class="queue-footnote">檔案保留 24 小時</p>
  {/if}
  </div>
  {#if onviewall}<button class="queue-view-all" onclick={onviewall}>全部下載</button>{/if}
</section>
