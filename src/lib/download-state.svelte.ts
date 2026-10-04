import { api } from './ui';
import type { DownloadJob } from './types';

export function createDownloadState() {
  let jobs = $state<DownloadJob[]>([]);
  let error = $state('');
  let busy = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;
  async function refresh() {
    try { jobs = await api<DownloadJob[]>('/api/downloads'); error = ''; }
    catch (e) { error = e instanceof Error ? e.message : '無法取得下載記錄。'; }
  }
  async function tick() {
    if (stopped) return;
    if (document.visibilityState === 'visible') await refresh();
    if (!stopped) timer = setTimeout(tick, jobs.some((j) => ['queued', 'downloading'].includes(j.status)) ? 1800 : 10000);
  }
  return {
    get jobs() { return jobs; }, get error() { return error; }, get busy() { return busy; },
    refresh,
    start() { stopped = false; void tick(); return () => { stopped = true; clearTimeout(timer); }; },
    async clear() {
      busy = true;
      try { await api('/api/downloads', { method: 'DELETE' }); await refresh(); }
      catch (e) { error = e instanceof Error ? e.message : '無法清除記錄。'; }
      finally { busy = false; }
    },
    async retry(job: DownloadJob) {
      busy = true;
      try { await api('/api/downloads', { method: 'POST', body: JSON.stringify({ tracks: [{ provider: job.track.provider, id: job.track.id }], format: job.format }) }); await refresh(); }
      catch (e) { error = e instanceof Error ? e.message : '重新獲取失敗。'; }
      finally { busy = false; }
    },
  };
}
