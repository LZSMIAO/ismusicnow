import { join } from 'node:path';
import { DownloadStore } from './downloads.js';
import { ListenQuota } from './listen-quota.js';
import { config } from './config.js';
import { getTrack, serviceStatus } from './music.js';
import { mediaGrants } from './telegram-app.js';
import { ServiceError } from './errors.js';
import { browserAudio } from './browser-audio.js';
const owner = 'spotify-online-cache';
const globalListen = globalThis as typeof globalThis & { spotifyListenCache?: DownloadStore; spotifyListenQuota?: ListenQuota };
export const listenCache = globalListen.spotifyListenCache ||= new DownloadStore('spotify-listen');
export const listenQuota = globalListen.spotifyListenQuota ||= new ListenQuota(join(config.dataDir, 'spotify-listening'));
const preparing = new Map<string, Promise<unknown>>();
async function prepare(id: string) {
  if (!preparing.has(id)) preparing.set(id, (async () => {
    const existing = (await listenCache.list(owner)).find(j => j.track.id === id && j.status !== 'failed');
    if (!existing) await listenCache.create(owner, [await getTrack('spotify', id)], 'original');
  })().finally(() => preparing.delete(id)));
  await preparing.get(id);
}
async function compatible(job: string): Promise<string> { return browserAudio((await listenCache.file(owner, job)).path); }
export async function startSpotifyListen(ip: string, id: string, origin: string) {
  if (!(await serviceStatus()).spotify.downloaderReady) throw new ServiceError('SPOTIFY_UNAVAILABLE', 'Spotify 完整在線播放尚未就緒，請稍後再試。', 503);
  const quota = await listenQuota.reserve(ip, id);
  try { await prepare(id); return await spotifyListenStatus(ip, id, origin, quota); }
  catch (error) { await listenQuota.release(ip, id); throw error; }
}
export async function spotifyListenStatus(ip: string, id: string, origin: string, quota?: { remaining: number; limit: number; resetsAt: number }) {
  if (!await listenQuota.has(ip, id)) throw new ServiceError('LISTEN_NOT_FOUND', '播放請求已失效，請重新按播放。', 404);
  const job = (await listenCache.list(owner)).find(j => j.track.id === id && j.status !== 'failed');
  if (!job) { await listenQuota.release(ip, id); throw new ServiceError('SPOTIFY_AUDIO', 'Spotify 原音源準備失敗，未扣播放額度。請下載或稍後重試。', 502); }
  if (job.status !== 'completed') return { available: false, status: 'preparing', message: '正在準備 Spotify 完整音訊…', downloadable: true, ...quota };
  try {
    await compatible(job.id);
    const budget = await listenQuota.commit(ip, id), key = await listenQuota.key(ip);
    const url = new URL(`/api/listen/spotify/${id}/audio`, origin); url.searchParams.set('job', job.id); url.searchParams.set('grant', mediaGrants.issue(key, job.id, 'listen'));
    return { available: true, status: 'completed', url: url.href, limited: false, downloadable: true, ...budget };
  } catch (error) { await listenQuota.release(ip, id); throw error; }
}
export async function spotifyListenFile(ip: string, track: string, job: string, grant: string) {
  const key = await listenQuota.key(ip);
  if (mediaGrants.owner(grant, job, 'listen') !== key || !await listenQuota.has(ip, track, true)) throw new ServiceError('LISTEN_GRANT', '播放連結已失效，請重新按播放。', 403);
  const file = await listenCache.file(owner, job);
  if (file.job.track.id !== track) throw new ServiceError('LISTEN_GRANT', '播放連結與歌曲不符。', 403);
  return compatible(job);
}
