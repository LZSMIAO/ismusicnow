import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseFile } from 'music-metadata';
import type { DownloadFormat, DownloadJob, Track } from '../types.js';
import { config } from './config.js';
import { publicError, ServiceError } from './errors.js';
import { safeFilename } from './links.js';
import { neteaseAudio } from './providers/netease.js';
import { downloadSpotify } from './providers/spotify.js';
import { downloadPublic } from './providers/public-audio.js';
import { downloadYtm } from './providers/ytm.js';

interface StoredJob extends DownloadJob { owner: string; path?: string }
type Executor = (job: DownloadJob, directory: string, maxFileBytes: number) => Promise<string>;

export function validateAudioUrl(raw: string): URL {
  const url = new URL(raw);
  if (!['https:', 'http:'].includes(url.protocol) || url.port || url.username || url.password ||
    !['music.126.net', 'music.163.com'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new ServiceError('INVALID_AUDIO_HOST', '網易雲回傳的音源地址未通過來源檢查。', 502);
  }
  return url;
}

async function saveNeteaseAudio(url: string, path: string, maxFileBytes: number): Promise<void> {
  let current = validateAudioUrl(url);
  for (let i = 0; i < 4; i++) {
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) break;
      current = validateAudioUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok || !response.body) throw new ServiceError('AUDIO_UNAVAILABLE', '平台音源暫時無法下載。', 502);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > maxFileBytes) { await response.body.cancel(); throw new ServiceError('FILE_TOO_LARGE', '音訊檔案超過下載大小限制。', 413); }
    let received = 0;
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      callback(received > maxFileBytes ? new ServiceError('FILE_TOO_LARGE', '音訊檔案超過下載大小限制。', 413) : null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), limiter, createWriteStream(path, { mode: 0o600 }));
    return;
  }
  throw new ServiceError('AUDIO_REDIRECT', '音源重定向次數過多，請稍後重試。', 502);
}

async function findAudio(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || entry.name === 'temp') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await findAudio(path));
    else if (/\.(ogg|oga|opus|m4a|mp3|flac|aac|webm)$/i.test(entry.name)) files.push(path);
  }
  return files;
}

export async function executeDownload(job: DownloadJob, directory: string, maxFileBytes = config.maxFileBytes): Promise<string> {
  if (job.track.provider === 'netease') {
    const audio = await neteaseAudio(job.track.id, job.format);
    const path = join(directory, `audio.${audio.extension}`);
    await saveNeteaseAudio(audio.url, path, maxFileBytes);
    return path;
  }
  if (job.format !== 'original') throw new ServiceError('ORIGINAL_ONLY', '此來源只保留平台可用音源，不提供音質轉換。');
  if (job.track.provider === 'spotify') await downloadSpotify(job.track, directory);
  else if (job.track.provider === 'ytm') await downloadYtm(job.track, directory);
  else await downloadPublic(job.track, directory);
  const files = await findAudio(directory);
  // Some upstream CLIs return exit code 0 even after an authentication failure.
  if (files.length !== 1) throw new ServiceError('NO_OUTPUT', '適配器沒有產生完整音訊，請檢查登入、訂閱權限及下載設定。', 502);
  return files[0]!;
}

export class DownloadStore {
  private jobs = new Map<string, StoredJob>();
  private active = false;
  private initialized?: Promise<void>;
  private root: string;
  constructor(namespace = 'web', private executor: Executor = executeDownload, root = config.dataDir, private maxFileBytes = config.maxFileBytes) {
    this.root = resolve(root, namespace);
  }
  private initialize(): Promise<void> {
    return this.initialized ||= this.load();
  }
  private async load(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.root)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      try {
        const job = JSON.parse(await readFile(join(this.root, name), 'utf8')) as StoredJob;
        if (Date.now() - Date.parse(job.createdAt) > config.jobRetentionMs) {
          await rm(join(this.root, job.id), { recursive: true, force: true });
          await rm(join(this.root, name), { force: true });
          continue;
        }
        if (['queued', 'downloading'].includes(job.status)) {
          job.status = 'failed'; job.error = '服務已重啟，請重新加入下載。'; job.errorCode = 'SERVICE_RESTARTED'; job.stage = '服務中斷';
          await this.persist(job);
        }
        this.jobs.set(job.id, job);
      } catch { /* Ignore incomplete/corrupt records; never expose them. */ }
    }
  }
  private async persist(job: StoredJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    const path = join(this.root, `${job.id}.json`);
    await writeFile(`${path}.tmp`, JSON.stringify(job), { mode: 0o600 });
    await rename(`${path}.tmp`, path);
  }
  private publicJob(job: StoredJob): DownloadJob {
    const { owner: _owner, path: _path, ...visible } = job;
    return visible;
  }
  private async prune(): Promise<void> {
    for (const job of this.jobs.values()) {
      if (!['queued', 'downloading'].includes(job.status) && Date.now() - Date.parse(job.createdAt) > config.jobRetentionMs) {
        this.jobs.delete(job.id);
        await rm(join(this.root, `${job.id}.json`), { force: true });
        await rm(join(this.root, job.id), { force: true, recursive: true });
      }
    }
  }
  async create(owner: string, tracks: Track[], format: DownloadFormat): Promise<DownloadJob[]> {
    await this.initialize(); await this.prune();
    if (this.jobs.size + tracks.length > 200) throw new ServiceError('QUEUE_FULL', '下載佇列已滿，請清除完成項目後再試。', 429);
    if (!tracks.length || tracks.length > 20) throw new ServiceError('BATCH_LIMIT', '每次可獲取 1 至 20 首歌曲。');
    if (tracks.some((t) => t.provider !== 'netease') && format !== 'original') throw new ServiceError('ORIGINAL_ONLY', '此來源只保留平台可用音源。');
    const created: StoredJob[] = [];
    for (const track of tracks) {
      const existing = [...this.jobs.values()].find((j) => j.owner === owner && j.track.provider === track.provider && j.track.id === track.id && j.format === format && ['queued', 'downloading'].includes(j.status));
      if (existing) { created.push(existing); continue; }
      const job: StoredJob = { id: randomUUID(), owner, track, format, status: 'queued', stage: '等待獲取',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audioSource: track.provider };
      await this.persist(job); this.jobs.set(job.id, job); created.push(job);
    }
    void this.drain();
    return created.map((j) => this.publicJob(j));
  }
  private async drain(): Promise<void> {
    if (this.active) return;
    this.active = true;
    try {
      for (;;) {
        const job = [...this.jobs.values()].find((j) => j.status === 'queued');
        if (!job) break;
        const directory = join(this.root, job.id);
        try {
          await mkdir(directory, { recursive: true, mode: 0o700 });
          job.status = 'downloading'; job.stage = '正在獲取原始音源'; await this.persist(job);
          const output = await this.executor(this.publicJob(job), directory, this.maxFileBytes);
          const size = (await stat(output)).size;
          if (!size) throw new ServiceError('INVALID_FILE', '音訊檔案為空。', 502);
          if (size > this.maxFileBytes) throw new ServiceError('FILE_TOO_LARGE', '音訊檔案超過下載大小限制。', 413);
          const metadata = await parseFile(output, { duration: true });
          if (!metadata.format.codec || !metadata.format.duration || metadata.format.duration < 1) throw new ServiceError('INVALID_AUDIO', '下載的檔案不是完整可辨識音訊。', 502);
          if (job.track.durationMs && metadata.format.duration * 1000 < job.track.durationMs * 0.9) throw new ServiceError('INCOMPLETE_AUDIO', '音源長度不足，可能是試聽或未完成下載。', 502);
          if (job.format === 'flac' && metadata.format.lossless !== true) throw new ServiceError('NOT_LOSSLESS', '音訊不是原生無損檔，下載已停止。', 502);
          job.audio = { codec: metadata.format.codec, bitrate: metadata.format.bitrate, sampleRate: metadata.format.sampleRate,
            bitsPerSample: metadata.format.bitsPerSample, lossless: metadata.format.lossless === true };
          job.filename = `${safeFilename(`${job.track.artists.join(', ')}${job.track.artists.length ? ' - ' : ''}${job.track.title}`)}${extname(output)}`;
          const finalPath = join(directory, job.filename);
          if (resolve(output) !== resolve(finalPath)) await rename(output, finalPath);
          job.path = finalPath; job.bytes = size; job.status = 'completed'; job.stage = '可以保存';
        } catch (error) {
          const failure = publicError(error);
          job.status = 'failed'; job.stage = '獲取失敗'; job.error = failure.message; job.errorCode = failure.code;
          await rm(directory, { recursive: true, force: true });
        }
        await this.persist(job);
      }
    } finally { this.active = false; }
  }
  async list(owner: string): Promise<DownloadJob[]> {
    await this.initialize(); await this.prune();
    return [...this.jobs.values()].filter((j) => j.owner === owner).reverse().map((j) => this.publicJob(j));
  }
  async file(owner: string, id: string): Promise<{ path: string; job: DownloadJob }> {
    await this.initialize();
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner) throw new ServiceError('NOT_FOUND', '找不到此下載項目。', 404);
    if (Date.now() - Date.parse(job.createdAt) > config.jobRetentionMs) throw new ServiceError('EXPIRED', '檔案已過期，請重新獲取。', 410);
    if (job.status !== 'completed' || !job.path) throw new ServiceError('NOT_READY', '音訊尚未準備完成。', 409);
    const path = resolve(job.path);
    if (!path.startsWith(`${resolve(this.root, id)}/`) || basename(path) !== job.filename) throw new ServiceError('INVALID_FILE', '檔案路徑無效。', 500);
    try { await stat(path); } catch { throw new ServiceError('EXPIRED', '音訊檔案已不存在，請重新獲取。', 410); }
    return { path, job: this.publicJob(job) };
  }
  async remove(owner: string, id: string): Promise<void> {
    await this.initialize();
    const job = this.jobs.get(id);
    if (!job || job.owner !== owner || ['queued', 'downloading'].includes(job.status)) return;
    this.jobs.delete(id);
    await rm(join(this.root, `${id}.json`), { force: true });
    await rm(join(this.root, id), { force: true, recursive: true });
  }
  async clear(owner: string): Promise<void> {
    await this.initialize();
    for (const job of this.jobs.values()) {
      if (job.owner !== owner || ['queued', 'downloading'].includes(job.status)) continue;
      this.jobs.delete(job.id);
      await rm(join(this.root, `${job.id}.json`), { force: true });
      await rm(join(this.root, job.id), { force: true, recursive: true });
    }
  }
}

// Preserve the singleton across Vite HMR updates; unfinished jobs must not reset.
const globalStore = globalThis as typeof globalThis & { ismusicnowDownloads?: DownloadStore };
export const downloads = globalStore.ismusicnowDownloads ||= new DownloadStore();
