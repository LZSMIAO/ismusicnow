<script lang="ts">
  import { Download, Music2, Check, RotateCcw, Trash2, ArrowRight } from '@lucide/svelte';
  import type { DownloadJob } from '#lib/types.js';
  import { audioLabel, providerNames } from '#lib/ui.js';
  let { jobs, busy = false, error = '', compact = true, onclear, onretry }: {
    jobs: DownloadJob[]; busy?: boolean; error?: string; compact?: boolean; onclear: () => void; onretry: (job: DownloadJob) => void;
  } = $props();
  const visible = $derived(compact ? jobs.slice(0, 5) : jobs);
</script>

<section class="queue-panel" class:expanded={!compact} aria-labelledby="queue-title">
  <div class="queue-heading"><h2 id="queue-title">{compact ? '下載佇列' : '你的下載'}<span>{jobs.length.toString().padStart(2, '0')}</span></h2>{#if jobs.some((j) => j.status === 'completed' || j.status === 'failed')}<button class="icon-button" title="清除已完成及失敗項目" aria-label="清除已完成及失敗項目" disabled={busy} onclick={onclear}><Trash2 size={17} /></button>{/if}</div>
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if !jobs.length}
    <div class="queue-empty"><span class="empty-disc"><Download size={23} strokeWidth={1.3} /></span><h3>讓好音樂，<br />有個落腳的地方。</h3><p>選好曲目，加入佇列。<br />完成後，直接保存到你的裝置。</p></div>
  {:else}
    <ul class="job-list">
      {#each visible as job (job.id)}
        <li class="job-item"><div class="job-top"><span class="job-art">{#if job.track.cover}<img src={job.track.cover} alt="" width="40" height="40" loading="lazy" referrerpolicy="no-referrer" onerror={(event) => event.currentTarget.setAttribute('hidden', '')} />{:else}<Music2 size={18} />{/if}</span><div class="job-identity"><strong>{job.track.title}</strong><small>{job.track.artists.join(' / ') || providerNames[job.track.provider]}</small></div>{#if job.status === 'completed'}<Check size={17} class="success-icon" />{/if}</div>
          {#if job.status === 'downloading'}<div class="indeterminate" aria-label="正在獲取音源"><span></span></div>{/if}
          <div class="job-meta"><span>{providerNames[job.audioSource]} · {job.stage}</span>{#if job.status === 'completed'}<span>{((job.bytes || 0) / 1048576).toFixed(1)} MB</span>{/if}</div>
          {#if job.status === 'completed'}<p class="audio-info">{audioLabel(job)}</p><a class="save-button" href={`/api/downloads/${job.id}/file`} download><Download size={14} /> 保存音樂</a>{:else if job.status === 'failed'}<p class="job-error">{job.error}</p><button class="text-button" disabled={busy} onclick={() => onretry(job)}><RotateCcw size={13} />重新獲取</button>{/if}
        </li>
      {/each}
    </ul>
    {#if compact && jobs.length > 5}<a class="text-button all-downloads" href="/downloads">查看全部 {jobs.length} 個項目 <ArrowRight size={14} /></a>{/if}
  {/if}
  <div class="queue-footnote"><span class="small-dot"></span>檔案保留 24 小時，完成後記得保存。</div>
</section>
