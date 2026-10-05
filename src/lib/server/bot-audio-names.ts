import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseFile } from 'music-metadata';
import type { Track } from '../types.js';
import { BotMusicCache, type CachedMusic, type MusicCacheKey } from './bot-cache.js';
import { audioPresentation, musicPayload } from './bot-media.js';
import { botTransport, botUploadFile, checkBotUpload } from './bot-transport.js';
import { safeFilename } from './links.js';
import { ServiceError } from './errors.js';
import { runCommand } from './process.js';

type Telegram = (method: string, body: Record<string, unknown> | FormData) => Promise<any>;
interface PreparedNames { path: string; audio: NonNullable<CachedMusic['audio']>; duration: number; thumbnail?: Uint8Array; release: () => Promise<void> }
const performer = (track: Track) => track.artists.join(' / ').slice(0, 256);
export const changedAudioNames = (track: Track, visible: Track) => track.title.slice(0, 256) !== visible.title.slice(0, 256) || performer(track) !== performer(visible);
export function namedMusicCacheKey(track: Track, visible: Track, record: CachedMusic): MusicCacheKey {
  const hash = createHash('sha256').update(JSON.stringify([record.fileId, visible.title.slice(0, 256), performer(visible), visible.album])).digest('hex');
  return { provider: track.provider, id: track.id, quality: `names-v1:${hash}` };
}

// Local getFile returns an absolute server path; only this bot's music folder
// is mounted read-only. Cloud getFile uses Telegram's ordinary file endpoint.
export async function cachedMusicPath(record: CachedMusic, telegram: Telegram, directory: string, env = process.env): Promise<string> {
  const file = await telegram('getFile', { file_id: record.fileId });
  if (typeof file.file_path !== 'string') throw new ServiceError('TELEGRAM_ERROR', 'Cached music is unavailable');
  const transport = botTransport(env);
  checkBotUpload(record.bytes, env);
  if (transport.local) {
    const prefix = `/var/lib/telegram-bot-api/${env.BOT_TOKEN}/music/`;
    if (!env.BOT_API_MUSIC_DIR || !file.file_path.startsWith(prefix) || basename(file.file_path) !== file.file_path.slice(prefix.length)) throw new ServiceError('TELEGRAM_ERROR', 'Local music cache is unavailable');
    const root = await realpath(env.BOT_API_MUSIC_DIR);
    const path = await realpath(resolve(root, basename(file.file_path)));
    if (!path.startsWith(root + sep)) throw new ServiceError('TELEGRAM_ERROR', 'Invalid cached music path');
    const info = await stat(path);
    if (!info.isFile() || info.size !== record.bytes) throw new ServiceError('INVALID_AUDIO', 'Cached music is incomplete');
    checkBotUpload(info.size, env);
    return path;
  }
  if (!/^[\w/-]+\.[\w]+$/.test(file.file_path) || file.file_path.split('/').includes('..')) throw new ServiceError('TELEGRAM_ERROR', 'Invalid Telegram file path');
  const response = await fetch(`${transport.base}file/bot${env.BOT_TOKEN}/${file.file_path}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new ServiceError('TELEGRAM_ERROR', 'Cached music download failed');
  const path = join(directory, 'source');
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(path, { flags: 'wx', mode: 0o600 }));
  if ((await stat(path)).size !== record.bytes) throw new ServiceError('INVALID_AUDIO', 'Cached music is incomplete');
  return path;
}

export async function prepareNamedAudio(record: CachedMusic, visible: Track, telegram: Telegram): Promise<PreparedNames> {
  const directory = await mkdtemp(join(tmpdir(), 'muism-names-'));
  const release = () => rm(directory, { recursive: true, force: true });
  try {
    const source = await cachedMusicPath(record, telegram, directory);
    const { format: original } = await parseFile(source, { duration: true });
    const extension = /flac/i.test(original.codec || '') ? '.flac' : /mp3|mpeg.*layer[ -]?3/i.test(original.codec || '') ? '.mp3' :
      /WAVE/i.test(original.container || '') ? '.wav' : /Ogg/i.test(original.container || '') ? '.ogg' : '.m4a';
    const path = join(directory, `names${extension}`);
    // Copy every audio/artwork stream. Only metadata is changed; no encoder.
    await runCommand('ffmpeg', ['-nostdin', '-y', '-i', source, '-map', '0', '-c', 'copy', '-map_metadata', '0',
      '-metadata', `title=${visible.title}`, '-metadata', `artist=${visible.artists.join(' / ')}`, '-metadata', `album=${visible.album}`, path], { timeout: 180_000 });
    const { format } = await parseFile(path, { duration: true });
    if (!format.codec || !format.duration || !original.duration || Math.abs(format.duration - original.duration) > 1 || format.lossless !== original.lossless) throw new ServiceError('INVALID_AUDIO', 'Named music validation failed');
    const presentation = await audioPresentation(path, visible);
    return { path, release, ...presentation, audio: { codec: format.codec, bitrate: format.bitrate, sampleRate: format.sampleRate,
      bitsPerSample: format.bitsPerSample, lossless: format.lossless === true } };
  } catch (error) { await release(); throw error; }
}

export class BotAudioNames {
  constructor(private cache: BotMusicCache, private telegram: Telegram, private cacheChat: () => number | undefined,
    private username: () => string, private prepare = prepareNamedAudio) {}
  async peek(track: Track, visible: Track, source: CachedMusic): Promise<CachedMusic | undefined> {
    if (source.kind !== 'audio' || !changedAudioNames(track, visible)) return source;
    return this.cache.get(namedMusicCacheKey(track, visible, source));
  }
  async invalidate(track: Track, record: CachedMusic): Promise<void> {
    if (record.names) await this.cache.invalidate({ provider: track.provider, id: track.id, quality: record.names.key }, record.fileId);
  }
  async get(track: Track, visible: Track, source: CachedMusic): Promise<CachedMusic> {
    if (source.kind !== 'audio' || !changedAudioNames(track, visible)) return source;
    const key = namedMusicCacheKey(track, visible, source);
    let result: CachedMusic | undefined;
    await this.cache.deliver(key, async cached => { result = cached; }, async () => {
      const chatId = this.cacheChat();
      if (!chatId) throw new ServiceError('INLINE_CACHE_SETUP', 'Telegram cache channel not configured');
      const prepared = await this.prepare(source, visible, this.telegram);
      try {
        const bytes = (await stat(prepared.path)).size;
        checkBotUpload(bytes);
        const job = { ...source, audio: prepared.audio, bytes, track, id: 'names', format: 'original' as const, status: 'completed' as const, stage: '', createdAt: '', updatedAt: '' };
        const form = musicPayload({ chatId, track: visible, job, botUsername: this.username(), uiLanguage: 'en', ...prepared,
          file: await botUploadFile(prepared.path), filename: `${safeFilename(`${performer(visible)} - ${visible.title}`)}${prepared.path.slice(prepared.path.lastIndexOf('.'))}` });
        form.delete('reply_markup');
        form.set('disable_notification', 'true');
        const message = await this.telegram('sendAudio', form);
        if (!message.audio?.file_id || message.audio.title !== visible.title.slice(0, 256) || message.audio.performer !== performer(visible)) throw new ServiceError('TELEGRAM_ERROR', 'Named audio was not accepted');
        result = { ...source, fileId: message.audio.file_id, duration: prepared.duration, bytes, audio: prepared.audio,
          names: { key: key.quality, title: visible.title.slice(0, 256), performer: performer(visible) } };
        return result;
      } finally { await prepared.release(); }
    });
    if (!result) throw new ServiceError('TELEGRAM_ERROR', 'Named audio cache is unavailable');
    return result;
  }
}
