import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { DownloadJob, Track } from '../types.js';
import { runCommand } from './process.js';
import { ServiceError } from './errors.js';

export class TelegramRequestError extends ServiceError {
  constructor(public errorCode: number, public description: string) {
    super('TELEGRAM_ERROR', errorCode === 429 ? 'Telegram 請求過於頻繁，請稍後重試。' : 'Telegram 暫時無法處理請求。', 502);
  }
}

const sourceNames = { netease: '網易雲音樂', spotify: 'Spotify', ytm: 'YouTube Music' };
export function musicCaption(track: Track, job: DownloadJob): string {
  const audio = job.audio;
  return [`「${track.title}」— ${track.artists.join(' / ') || '未知歌手'}`.slice(0, 400),
    `專輯：${track.album || '未提供專輯名稱'}`.slice(0, 300),
    `來源：${sourceNames[job.audioSource]}`,
    `${audio?.codec || '原始音源'}${job.bytes ? ` · ${(job.bytes / 1024 / 1024).toFixed(2)} MB` : ''}${audio?.bitrate ? ` · ${Math.round(audio.bitrate / 1000)} kbps` : ''}`,
    'via @ismusicnow_bot · 音樂主義'].join('\n');
}

// Cover URLs originate upstream. Limit them to platform CDNs, including redirects.
export function coverUrl(raw: string): URL {
  const url = new URL(raw);
  const hosts = ['music.126.net', 'scdn.co', 'ytimg.com', 'googleusercontent.com', 'ggpht.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error('Untrusted cover URL');
  }
  return url;
}
async function fetchCover(raw: string): Promise<Uint8Array> {
  let url = coverUrl(raw);
  for (let i = 0; i < 4; i++) {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get('location');
      if (!location) break;
      url = coverUrl(new URL(location, url).href); continue;
    }
    if (!response.ok || !response.body || Number(response.headers.get('content-length') || 0) > 5 * 1024 * 1024) {
      await response.body?.cancel(); throw new Error('Cover unavailable');
    }
    const reader = response.body.getReader(), chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 5 * 1024 * 1024) { await reader.cancel(); throw new Error('Cover too large'); }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  throw new Error('Cover redirect limit');
}
export async function audioPresentation(path: string, track: Track): Promise<{ duration: number; thumbnail?: Uint8Array }> {
  const metadata = await parseFile(path, { duration: true });
  const duration = Math.round(metadata.format.duration || track.durationMs / 1000);
  let directory: string | undefined;
  try {
    const embedded = metadata.common.picture?.[0]?.data;
    const picture = track.cover ? await fetchCover(track.cover).catch(() => embedded) : embedded;
    if (!picture?.length) return { duration };
    directory = await mkdtemp(join(tmpdir(), 'ismusicnow-cover-'));
    const input = join(directory, 'cover'), output = join(directory, 'thumbnail.jpg');
    await writeFile(input, picture, { mode: 0o600 });
    await runCommand('ffmpeg', ['-nostdin', '-y', '-i', input, '-frames:v', '1', '-vf', 'scale=320:320:force_original_aspect_ratio=decrease', '-q:v', '5', output], { timeout: 10_000 });
    const thumbnail = new Uint8Array(await readFile(output));
    return { duration, ...(thumbnail.length < 200_000 ? { thumbnail } : {}) };
  } catch { return { duration }; }
  finally { if (directory) await rm(directory, { recursive: true, force: true }); }
}

type Telegram = (method: string, form: FormData) => Promise<unknown>;
export interface MusicUpload {
  chatId: number; replyTo: number; job: DownloadJob; track: Track;
  bytes: Uint8Array; filename: string; duration: number; thumbnail?: Uint8Array;
}
export function musicPayload(upload: MusicUpload, document = false, withThumbnail = true): FormData {
  const form = new FormData(), extension = extname(upload.filename).toLowerCase();
  const mime: Record<string, string> = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.webm': 'audio/webm' };
  form.set('chat_id', String(upload.chatId));
  form.set(document ? 'document' : 'audio', new Blob([new Uint8Array(upload.bytes)], { type: mime[extension] || 'application/octet-stream' }), upload.filename);
  form.set('caption', musicCaption(upload.track, upload.job));
  form.set('reply_parameters', JSON.stringify({ message_id: upload.replyTo, allow_sending_without_reply: true }));
  form.set('reply_markup', JSON.stringify({ inline_keyboard: [[{ text: '在來源平台開啟', url: upload.track.sourceUrl }], [{ text: 'Album 顯示語言', callback_data: 'open-settings' }]] }));
  if (!document) {
    form.set('title', upload.track.title.slice(0, 256));
    form.set('performer', upload.track.artists.join(' / ').slice(0, 256));
    if (upload.duration > 0) form.set('duration', String(upload.duration));
  }
  if (withThumbnail && upload.thumbnail) form.set('thumbnail', new Blob([new Uint8Array(upload.thumbnail)], { type: 'image/jpeg' }), 'cover.jpg');
  return form;
}
export async function sendMusic(telegram: Telegram, upload: MusicUpload): Promise<'audio' | 'document'> {
  // The original bot also sends FLAC through sendAudio. Never transcode the song.
  const delivered = (result: unknown) => result && typeof result === 'object' && 'document' in result && !('audio' in result) ? 'document' as const : 'audio' as const;
  let rejected: unknown;
  try { return delivered(await telegram('sendAudio', musicPayload(upload))); }
  catch (error) { rejected = error; }
  if (rejected instanceof TelegramRequestError && rejected.errorCode === 400 && upload.thumbnail && /thumbnail|thumb|image|photo/i.test(rejected.description)) {
    try { return delivered(await telegram('sendAudio', musicPayload(upload, false, false))); }
    catch (error) { rejected = error; }
  }
  if (!(rejected instanceof TelegramRequestError) || rejected.errorCode !== 400 || !/audio|file type|wrong file|failed to process/i.test(rejected.description)) throw rejected;
  await telegram('sendDocument', musicPayload(upload, true)); return 'document';
}
