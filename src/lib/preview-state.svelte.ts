import type { DownloadJob, Track } from './types.js';
import { telegramBridge } from './telegram.js';
import { api } from './ui.js';

export function createPreviewState(onfinish: () => void) {
  let track = $state<Track | null>(null);
  let status = $state<'idle' | 'loading' | 'playing' | 'paused' | 'unavailable' | 'error'>('idle');
  let elapsed = $state(0), length = $state(0), volume = $state(.7), error = $state(''), ready = $state(false), limited = $state(false), canDownload = $state(false), preparing = $state('');
  let audio: HTMLAudioElement | undefined, request: AbortController | undefined, generation = 0, finished = false;
  function finish() {
    if (finished) return;
    finished = true; audio?.pause(); status = 'paused'; onfinish();
  }
  return {
    get track() { return track; }, get status() { return status; }, get elapsed() { return elapsed; },
    get currentTime() { return audio?.currentTime ?? elapsed; },
    get length() { return length; }, get volume() { return volume; }, get error() { return error; }, get ready() { return ready; }, get limited() { return limited; }, get canDownload() { return canDownload; }, get preparing() { return preparing; },
    mount() {
      audio = new Audio(); audio.preload = 'metadata'; audio.volume = volume;
      audio.onplaying = () => status = 'playing';
      audio.onpause = () => { if (status === 'playing') status = 'paused'; };
      audio.onwaiting = () => { if (status === 'playing') status = 'loading'; };
      audio.onloadedmetadata = audio.ondurationchange = () => {
        const duration = audio!.duration;
        ready = Number.isFinite(duration) && duration > 0;
        if (ready) length = duration;
      };
      // Only the media's ended event advances an album; metadata estimates
      // and timeupdate must never truncate a full source.
      audio.ontimeupdate = () => { elapsed = audio!.currentTime; };
      audio.onended = finish;
      audio.onerror = () => { status = 'error'; error = '此音訊無法在瀏覽器播放，請改用原平台播放。'; ready = false; };
      const mounted = audio;
      return () => {
        generation++; request?.abort();
        // Media events can be queued by pause/load after the component unmounts.
        mounted.onplaying = mounted.onpause = mounted.onwaiting = mounted.onloadedmetadata = mounted.ondurationchange = mounted.ontimeupdate = mounted.onended = mounted.onerror = null;
        mounted.pause(); mounted.removeAttribute('src'); mounted.load(); audio = undefined;
      };
    },
    clearFailure() {
      if (status !== 'unavailable' && status !== 'error') return;
      generation++; request?.abort(); audio?.pause(); audio?.removeAttribute('src');
      track = null; status = 'idle'; error = ''; preparing = ''; elapsed = length = 0; ready = limited = canDownload = false;
    },
    select(next: Track) {
      if (track?.provider === next.provider && track.id === next.id) return;
      generation++; request?.abort(); audio?.pause(); audio?.removeAttribute('src');
      track = next; status = 'paused'; error = preparing = ''; elapsed = 0; length = next.durationMs / 1000; ready = limited = false;
    },
    pause() { generation++; request?.abort(); preparing = ''; audio?.pause(); if (status === 'loading' || status === 'playing') status = 'paused'; },
    async play(next: Track, jobs: DownloadJob[]) {
      if (!audio) return;
      if (track?.provider === next.provider && track.id === next.id && audio.src && status === 'paused') {
        if (elapsed >= length) { audio.currentTime = 0; elapsed = 0; }
        finished = false; error = '';
        try { await audio.play(); } catch { status = 'paused'; error = '音訊已準備好，按播放即可開始。'; }
        return;
      }
      const sequence = ++generation; request?.abort(); request = new AbortController(); audio.pause();
      audio.removeAttribute('src'); audio.load(); track = next; status = 'loading'; elapsed = 0; length = next.durationMs / 1000; ready = false; limited = false; canDownload = false; preparing = ''; error = ''; finished = false;
      try {
        const local = jobs.find((job) => job.status === 'completed' && job.track.provider === next.provider && job.track.id === next.id);
        const localUrl = local && telegramBridge()
          ? (await api<{ url: string }>(`/api/downloads/${local.id}/access`, { method: 'POST', body: JSON.stringify({ purpose: 'preview' }), signal: request.signal })).url
          : local ? `/api/downloads/${local.id}/preview` : undefined;
        let result = local ? { available: true, url: localUrl, limited: false, downloadable: true }
          : next.provider !== 'netease' ? { available: false, status: '', message: '', downloadable: true, url: undefined as string | undefined, limited: false } : await api<{ available: boolean; url?: string; limited?: boolean; downloadable?: boolean; message?: string; status?: string; remaining?: number }>(`/api/preview?provider=${next.provider}&id=${encodeURIComponent(next.id)}`, { signal: request.signal });
        if (!local && (next.provider !== 'netease' || !result.available || result.limited)) {
          type ListenResult = { available: boolean; url?: string; limited?: boolean; downloadable?: boolean; message?: string; status?: string; remaining?: number };
          result = await api<ListenResult>('/api/playback', { method: 'POST', body: JSON.stringify({ provider: next.provider, id: next.id }), signal: request.signal });
          const deadline = Date.now() + 600000;
          while (result.status === 'preparing') {
            if (sequence !== generation) return;
            preparing = result.message || '正在準備完整音訊…';
            await new Promise<void>((resolve, reject) => {
              const signal = request!.signal;
              const abort = () => { clearTimeout(timer); reject(signal.reason); };
              const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 2000);
              signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
            });
            if (Date.now() > deadline) throw new Error('音訊準備超時，請稍後重新按播放。');
            result = await api<ListenResult>(`/api/playback/${next.provider}/${encodeURIComponent(next.id)}`, { signal: request.signal });
          }
        }
        if (sequence !== generation || !audio) return;
        preparing = '';
        canDownload = !!result.downloadable;
        if (!result.available || !result.url) { status = 'unavailable'; error = 'message' in result && result.message || '此來源沒有可用的播放音訊。'; return; }
        limited = !!result.limited;
        audio.src = result.url;
        await audio.play();
      } catch (e) {
        if (sequence !== generation) return;
        preparing = ''; canDownload = true;
        if (e instanceof Error && e.name === 'NotAllowedError' && audio?.src) { status = 'paused'; error = '音訊已準備好，按播放即可開始。'; }
        else { status = 'error'; error = e instanceof Error ? e.message : '無法播放，請稍後重試。'; }
      }
    },
    seek(value: number) { if (audio && ready) { audio.currentTime = Math.max(0, Math.min(length, value)); elapsed = audio.currentTime; finished = false; } },
    setVolume(value: number) { volume = Math.max(0, Math.min(1, value)); if (audio) audio.volume = volume; },
  };
}
