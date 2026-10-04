import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { DownloadJob, Track } from '../types.js';
import type { DownloadStore } from './downloads.js';
import { BotMusicCache, type CachedMusic } from './bot-cache.js';
import { musicCacheKey, telegramPlaybackKey } from './bot-cache-key.js';
import { audioPresentation, sendMusic } from './bot-media.js';
import { safeFilename } from './links.js';
import { runCommand } from './process.js';
import { ServiceError } from './errors.js';

export const isMp3 = (audio: DownloadJob['audio']) => !!audio && !audio.lossless && /mp3|mpeg.*layer[ -]?3/i.test(audio.codec);
interface Prepared { path: string; job: DownloadJob; release: () => Promise<void> }
// Playback is a separate derivative. Never replace, relabel, or change the
// original download, and never mix its Telegram file ID with this cache key.
export async function prepareTelegramPlayback(path: string, job: DownloadJob): Promise<Prepared> {
  if (isMp3(job.audio)) return { path, job, release: async () => {} };
  const directory = await mkdtemp(join(tmpdir(), 'muism-playback-'));
  const output = join(directory, 'playback.mp3');
  const release = () => rm(directory, { recursive: true, force: true });
  try {
    await runCommand('ffmpeg', ['-nostdin', '-y', '-i', path, '-map', '0:a:0', '-vn', '-map_metadata', '0',
      '-metadata', `title=${job.track.title}`, '-metadata', `artist=${job.track.artists.join(' / ')}`, '-metadata', `album=${job.track.album}`,
      '-c:a', 'libmp3lame', '-b:a', '320k', '-threads', '1', output], { timeout: 120_000 });
    const { format } = await parseFile(output, { duration: true });
    if (!isMp3({ codec: format.codec || '', lossless: false }) || !format.duration || format.duration * 1000 < job.track.durationMs * 0.9) throw new ServiceError('INVALID_AUDIO', 'Playback preparation failed');
    return { path: output, release, job: { ...job, format: 'mp3', presentation: 'telegram-playback', bytes: (await stat(output)).size,
      audio: { codec: format.codec!, bitrate: format.bitrate, sampleRate: format.sampleRate, lossless: false } } };
  } catch (error) { await release(); throw error; }
}

type Telegram = (method: string, form: FormData) => Promise<unknown>;
type Store = Pick<DownloadStore, 'create' | 'list' | 'file' | 'remove'>;
export class BotPlayback {
  constructor(private store: Store, private cache: BotMusicCache, private telegram: Telegram,
    private cacheChat: () => number | undefined, private username: () => string,
    private prepare = prepareTelegramPlayback, private presentation = audioPresentation, private stopping = () => false) {}
  async invalidate(track: Track, record: CachedMusic): Promise<void> {
    const key = await musicCacheKey(track);
    await Promise.all([this.cache.invalidate(key, record.fileId), this.cache.invalidate(telegramPlaybackKey(key), record.fileId)]);
  }
  async get(track: Track, preferOriginalAudio = false): Promise<CachedMusic> {
    const native = preferOriginalAudio && track.provider === 'netease';
    const primaryKey = await musicCacheKey(track), playbackKey = telegramPlaybackKey(primaryKey);
    const key = native ? primaryKey : playbackKey;
    const original = await this.cache.get(primaryKey);
    // A document ID cannot be resent as audio. Keep it for the original-file
    // action and use the independent playable cache for ordinary requests.
    if (native && original?.kind === 'audio') return original;
    if (native && original?.kind === 'document') return this.get(track);
    if (original?.kind === 'audio' && isMp3(original.audio)) {
      await this.cache.put(key, original); return original;
    }
    let result: CachedMusic | undefined;
    await this.cache.deliver(key, async record => { result = native && record.kind === 'document' ? await this.get(track) : record; }, async () => {
      const chatId = this.cacheChat();
      if (!chatId) throw new ServiceError('INLINE_CACHE_SETUP', 'Telegram cache channel not configured');
      const owner = `telegram-playback:${track.provider}:${track.id}`;
      const [created] = await this.store.create(owner, [track], 'original');
      let ready: DownloadJob | undefined, derivative: Prepared | undefined;
      try {
        const until = Date.now() + 360_000;
        while (Date.now() < until && !this.stopping()) {
          const job = (await this.store.list(owner)).find(item => item.id === created!.id)!;
          if (job.status === 'failed') throw new ServiceError(job.errorCode || 'ADAPTER_FAILED', 'Audio download failed');
          if (job.status === 'completed') { ready = job; break; }
          await new Promise(done => setTimeout(done, 1500));
        }
        if (!ready) throw new ServiceError('DOWNLOAD_TIMEOUT', 'Audio download timed out');
        const { path } = await this.store.file(owner, ready.id);
        const presentation = await this.presentation(path, track);
        const upload = async (audioPath: string, job: DownloadJob, document: boolean) => {
          if ((await stat(audioPath)).size > 49 * 1024 * 1024) throw new ServiceError('FILE_TOO_LARGE', 'Audio exceeds Telegram upload limit');
          let cached: CachedMusic | undefined;
          await sendMusic(async (method, form) => {
            form.set('disable_notification', 'true');
            // Inline-query buttons are forbidden in channel posts. Only user
            // cards need controls; the cache channel stores media references.
            form.delete('reply_markup');
            return this.telegram(method, form);
          }, {
            chatId, job, track, ...presentation, asDocument: document, botUsername: this.username(), uiLanguage: 'en',
            bytes: new Uint8Array(await readFile(audioPath)), filename: `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}${extname(audioPath)}`,
            onDelivered: (kind, message: any) => { if (message?.[kind]?.file_id) cached = { kind, fileId: message[kind].file_id, duration: presentation.duration, bytes: job.bytes!, audioSource: job.audioSource, audio: job.audio, presentation: job.presentation }; },
          });
          if (!cached) throw new ServiceError('TELEGRAM_ERROR', 'No Telegram file reference');
          return cached;
        };
        const playable = async () => {
          derivative = await this.prepare(path, ready!);
          const record = await upload(derivative.path, derivative.job, false);
          if (record.kind !== 'audio' || !isMp3(record.audio)) throw new ServiceError('TELEGRAM_ERROR', 'Playback must be native MP3 audio');
          return record;
        };
        if (native) {
          // Probe the original in the private cache channel first. Recipients
          // never receive a document followed by a replacement audio message.
          const record = await upload(path, ready, false);
          if (record.kind === 'audio') { result = record; return record; }
          await this.cache.put(primaryKey, record);
          await this.cache.deliver(playbackKey, async cached => { result = cached; }, async () => {
            result = await playable(); return result;
          });
          return record;
        }
        // Keep the original alongside its playable derivative in Telegram.
        if (!original && !isMp3(ready.audio)) await this.cache.put(primaryKey, await upload(path, ready, true));
        result = await playable();
        if (!original && isMp3(ready.audio)) await this.cache.put(primaryKey, result);
        return result;
      } finally {
        await derivative?.release().catch(() => console.error('Telegram 播放暫存清理失敗。'));
        if (ready) await this.store.remove(owner, ready.id).catch(() => console.error('Telegram 原始暫存清理失敗。'));
      }
    });
    if (!result) throw new ServiceError('TELEGRAM_ERROR', 'Playback cache unavailable');
    return result;
  }
}
