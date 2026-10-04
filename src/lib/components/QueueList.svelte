<script lang="ts">
  import { Download, Music2, Check, RotateCcw, Trash2, LoaderCircle } from '@lucide/svelte';
  import type { DownloadJob } from '#lib/types.js';
  import { audioLabel, providerNames } from '#lib/ui.js';
  let { jobs, busy = false, error = '', compact = true, onclear, onretry }: {
    jobs: DownloadJob[]; busy?: boolean; error?: string; compact?: boolean; onclear: () => void; onretry: (job: DownloadJob) => void;
  } = $props();
</script>
<section class="queue-panel" class:expanded={!compact} aria-label="下載佇列">
  <div class="queue-heading"><h2>下載佇列 <span>{jobs.length}</span></h2>{#if jobs.some((j) => j.status === 'completed' || j.status === 'failed')}<button class="icon-button" aria-label="清除已完成及失敗項目" disabled={busy} onclick={onclear}><Trash2 size={18} /></button>{/if}</div>
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if !jobs.length}<p class="queue-empty">尚無下載</p>{:else}
    <ul class="job-list">{#each jobs as job (job.id)}
      <li class="job-item"><div class="job-top"><span class="job-art">{#if job.track.cover}<img src={job.track.cover} alt="" width="44" height="44" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => (event.currentTarget as HTMLImageElement).hidden = true} />{:else}<Music2 size={18} />{/if}</span><div class="job-identity"><strong>{job.track.title}</strong><small>{job.track.artists.join(' / ') || providerNames[job.track.provider]}</small></div>{#if job.status === 'completed'}<Check size={18} />{:else if job.status === 'downloading'}<LoaderCircle size={18} class="loading-icon" />{/if}</div>
        <div class="job-meta"><span>{providerNames[job.audioSource]} · {job.stage}</span>{#if job.status === 'completed'}<span>{((job.bytes || 0) / 1048576).toFixed(1)} MB</span>{/if}</div>
        {#if job.status === 'completed'}<p class="audio-info">{audioLabel(job)}</p><a class="save-button" href={`/api/downloads/${job.id}/file`} download><Download size={16} />保存音樂</a>{:else if job.status === 'failed'}<p class="job-error">{job.error}</p><button class="text-button" disabled={busy} onclick={() => onretry(job)}><RotateCcw size={14} />重試</button>{/if}
      </li>
    {/each}</ul><p class="queue-footnote">檔案保留 24 小時</p>
  {/if}
</section>
