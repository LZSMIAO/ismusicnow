import { createHmac, randomBytes } from 'node:crypto';
import { DownloadStore } from './downloads.js';
import { getTrack, serviceStatus } from './music.js';
import { mediaGrants, type MediaGrants } from './telegram-app.js';
import { ServiceError } from './errors.js';
import { browserAudio } from './browser-audio.js';
import type { DownloadJob, Provider, Track } from '../types.js';

interface Dependencies {
  list: () => Promise<DownloadJob[]>;
  create: (track: Track) => Promise<unknown>;
  file: (job: string) => Promise<{ path: string; job: DownloadJob }>;
  track: (provider: Provider, id: string) => Promise<Track>;
  compatible: (path: string) => Promise<string>;
  grants: MediaGrants;
  identity: (ip: string) => string;
}
/** Share prepared audio, but authorize every media request with an IP-bound, expiring grant. */
export class OnlinePlayback {
  private preparing = new Map<string, Promise<unknown>>();
  constructor(private deps: Dependencies) {}
  async start(ip: string, provider: Provider, id: string, origin: string) {
    const key = `${provider}:${id}`;
    if (!this.preparing.has(key)) this.preparing.set(key, (async () => {
      const existing = (await this.deps.list()).find(job => job.track.provider === provider && job.track.id === id && job.status !== 'failed');
      if (!existing) await this.deps.create(await this.deps.track(provider, id));
    })().finally(() => this.preparing.delete(key)));
    await this.preparing.get(key);
    return this.status(ip, provider, id, origin);
  }
  async status(ip: string, provider: Provider, id: string, origin: string) {
    const job = (await this.deps.list()).find(job => job.track.provider === provider && job.track.id === id);
    if (!job) throw new ServiceError('LISTEN_NOT_FOUND', '播放請求已失效，請重新按播放。', 404);
    if (job.status === 'failed') throw new ServiceError(job.errorCode || 'NO_AUDIO', job.error || '原音源暫時無法取得，請稍後重試。', 502);
    if (job.status !== 'completed') return { available: false, status: 'preparing', message: '正在準備完整音訊…', downloadable: true };
    await this.deps.compatible((await this.deps.file(job.id)).path);
    const url = new URL(`/api/playback/${provider}/${id}/audio`, origin);
    url.searchParams.set('job', job.id); url.searchParams.set('grant', this.deps.grants.issue(this.deps.identity(ip), job.id, 'listen'));
    return { available: true, status: 'completed', url: url.href, limited: false, downloadable: true, audioSource: job.audioSource };
  }
  async file(ip: string, provider: Provider, id: string, job: string, grant: string) {
    if (this.deps.grants.owner(grant, job, 'listen') !== this.deps.identity(ip)) throw new ServiceError('LISTEN_GRANT', '播放連結已失效，請重新按播放。', 403);
    const file = await this.deps.file(job);
    if (file.job.track.provider !== provider || file.job.track.id !== id) throw new ServiceError('LISTEN_GRANT', '播放連結與歌曲不符。', 403);
    return this.deps.compatible(file.path);
  }
}
const globals = globalThis as typeof globalThis & { muismOnlineStore?: DownloadStore; muismOnline?: OnlinePlayback; muismListenSecret?: Buffer };
const store = globals.muismOnlineStore ||= new DownloadStore('online-playback');
const owner = 'web-online-cache';
const secret = globals.muismListenSecret ||= process.env.BOT_TOKEN ? Buffer.from(process.env.BOT_TOKEN) : randomBytes(32);
export const onlinePlayback = globals.muismOnline ||= new OnlinePlayback({
  list: () => store.list(owner), create: track => store.create(owner, [track], 'original'), file: job => store.file(owner, job),
  track: getTrack, compatible: browserAudio, grants: mediaGrants, identity: ip => createHmac('sha256', secret).update(`muism:listen:${ip}`).digest('hex'),
});
export async function startOnlinePlayback(ip: string, provider: Provider, id: string, origin: string) {
  const services = await serviceStatus();
  const ready = provider === 'netease' ? services.netease.ready : services[provider].downloaderReady;
  if (!ready) throw new ServiceError('PLAYBACK_UNAVAILABLE', '此來源的播放服務尚未就緒，請稍後再試。', 503);
  return onlinePlayback.start(ip, provider, id, origin);
}
