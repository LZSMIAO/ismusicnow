import type { DownloadJob, Track } from './types.js';
import { api } from './ui.js';

export function createPreviewState(onfinish: () => void) {
  let track = $state<Track | null>(null);
  let status = $state<'idle' | 'loading' | 'playing' | 'paused' | 'unavailable' | 'error'>('idle');
  let elapsed = $state(0), length = $state(30), volume = $state(.7), error = $state(''), ready = $state(false);
  let audio: HTMLAudioElement | undefined, request: AbortController | undefined, generation = 0, finished = false;
  function finish() {
    if (finished) return;
    finished = true; audio?.pause(); status = 'paused'; onfinish();
  }
  return {
    get track() { return track; }, get status() { return status; }, get elapsed() { return elapsed; },
    get length() { return length; }, get volume() { return volume; }, get error() { return error; }, get ready() { return ready; },
    mount() {
      audio = new Audio(); audio.preload = 'metadata'; audio.volume = volume;
      audio.onplaying = () => status = 'playing';
      audio.onpause = () => { if (status === 'playing') status = 'paused'; };
      audio.onwaiting = () => { if (status === 'playing') status = 'loading'; };
      audio.onloadedmetadata = () => { ready = true; length = Number.isFinite(audio!.duration) ? Math.min(30, audio!.duration) : 30; };
      audio.ontimeupdate = () => { elapsed = Math.min(length, audio!.currentTime); if (length > 0 && audio!.currentTime >= length) finish(); };
      audio.onended = finish;
      audio.onerror = () => { status = 'error'; error = '此音訊無法在瀏覽器播放，請改用原平台播放。'; ready = false; };
      return () => { generation++; request?.abort(); audio!.pause(); audio!.removeAttribute('src'); audio!.load(); audio = undefined; };
    },
    pause() { generation++; request?.abort(); audio?.pause(); if (status === 'loading' || status === 'playing') status = 'paused'; },
    async play(next: Track, jobs: DownloadJob[]) {
      if (!audio) return;
      if (track?.provider === next.provider && track.id === next.id && ready && status === 'paused') {
        if (elapsed >= length) { audio.currentTime = 0; elapsed = 0; }
        finished = false;
        try { await audio.play(); } catch { status = 'error'; error = '播放被瀏覽器阻止，請再按一次播放。'; }
        return;
      }
      const sequence = ++generation; request?.abort(); request = new AbortController(); audio.pause();
      audio.removeAttribute('src'); audio.load(); track = next; status = 'loading'; elapsed = 0; length = 30; ready = false; error = ''; finished = false;
      try {
        const local = jobs.find((job) => job.status === 'completed' && job.track.provider === next.provider && job.track.id === next.id);
        const result = local ? { available: true, url: `/api/downloads/${local.id}/preview` }
          : await api<{ available: boolean; url?: string; message?: string }>(`/api/preview?provider=${next.provider}&id=${encodeURIComponent(next.id)}`, { signal: request.signal });
        if (sequence !== generation || !audio) return;
        if (!result.available || !result.url) { status = 'unavailable'; error = 'message' in result && result.message || '此來源沒有可用的試聽片段。'; return; }
        audio.src = result.url;
        await audio.play();
      } catch (e) {
        if (sequence !== generation) return;
        status = 'error'; error = e instanceof Error ? e.message : '無法播放，請稍後重試。';
      }
    },
    seek(value: number) { if (audio && ready) { audio.currentTime = Math.max(0, Math.min(length, value)); elapsed = audio.currentTime; finished = false; } },
    setVolume(value: number) { volume = Math.max(0, Math.min(1, value)); if (audio) audio.volume = volume; },
  };
}
