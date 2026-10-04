import type { Provider, DownloadJob } from './types';
export const providerNames: Record<Provider, string> = { netease: '網易雲音樂', spotify: 'Spotify', ytm: 'YouTube Music' };
export function duration(ms: number): string { return ms ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` : '—'; }
export function audioLabel(job: DownloadJob): string {
  if (!job.audio) return job.format === 'original' ? '原始音源' : job.format.toUpperCase();
  const audio = job.audio;
  return [audio.codec, audio.lossless ? '無損' : audio.bitrate ? `${Math.round(audio.bitrate / 1000)} kbps` : '',
    audio.bitsPerSample ? `${audio.bitsPerSample} bit` : '', audio.sampleRate ? `${audio.sampleRate / 1000} kHz` : ''].filter(Boolean).join(' · ');
}
export async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
  let body;
  try { body = await response.json(); }
  catch {
    throw new Error(response.status === 504 ? '音樂服務回應超時，請稍後重試。' : response.ok ? '服務回應格式異常，請重新整理後再試。' : '音樂服務暫時無法連接，請稍後重試。');
  }
  if (!response.ok) throw new Error(typeof body?.message === 'string' ? body.message : '操作失敗，請稍後再試。');
  return body as T;
}
