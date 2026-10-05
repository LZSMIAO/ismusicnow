import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { parseFile } from 'music-metadata';
import type { DownloadJob, Track } from '../types.js';
import { runCommand } from './process.js';
import { ServiceError } from './errors.js';
import { botText, type BotLanguage } from './bot-i18n.js';
import { escapeHtml, shortText } from './bot-selection.js';
import { parseMusicLink } from './links.js';

export class TelegramRequestError extends ServiceError {
  constructor(public errorCode: number, public description: string) {
    super('TELEGRAM_ERROR', errorCode === 429 ? 'Telegram 請求過於頻繁，請稍後重試。' : 'Telegram 暫時無法處理請求。', 502);
  }
}

const sourceNames = { netease: '網易雲音樂', qq: 'QQ Music', kuwo: 'Kuwo', kugou: 'Kugou', migu: 'Migu', qianqian: 'Qianqian', spotify: 'Spotify', ytm: 'YouTube Music', soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', bilibili: 'Bilibili' };
function audioTag(codec: string): string {
  if (/mp3|mpeg.*layer[ -]?3/i.test(codec)) return 'mp3';
  if (/flac/i.test(codec)) return 'flac';
  if (/alac/i.test(codec)) return 'alac';
  if (/aac/i.test(codec)) return 'aac';
  if (/vorbis/i.test(codec)) return 'ogg';
  return codec.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, '');
}
export function musicCaption(track: Track, job: DownloadJob, language: BotLanguage = 'zh-Hant', botUsername = 'muismbot', recipient?: { id?: number; name?: string }): string {
  const audio = job.audio;
  const source = job.audioSource === 'netease' ? language === 'zh-Hans' ? '网易云音乐' : language === 'zh-Hant' ? '網易雲音樂' : 'NetEase' : sourceNames[job.audioSource];
  const title = escapeHtml(shortText(track.title, 100)), artists = escapeHtml(shortText(track.artists.join(' / ') || botText(language, 'unknownArtist'), 120));
  const album = escapeHtml(shortText(track.album || botText(language, 'unknownAlbum'), 120));
  const technical = [`#${source.replace(/[^\p{L}\p{N}_]/gu, '')}`,
    audio?.codec ? `#${audioTag(audio.codec)}` : '',
    job.bytes ? `${(job.bytes / 1024 / 1024).toFixed(2)}MB` : '',
    audio?.bitrate ? `${(audio.bitrate / 1000).toFixed(2)}kbps` : '',
  ].filter(Boolean).join(' ');
  // Build the full details without spacers. BotCaptionDetails supplies compact
  // and expanded captions with explicit controls, independent of client layout.
  const details = [
    `${escapeHtml(botText(language, 'album'))}：${album}`,
    escapeHtml(technical),
    job.presentation === 'telegram-playback' ? escapeHtml(botText(language, 'playbackVersion')) : '',
    `via @${escapeHtml(botUsername)}`,
  ].filter(Boolean).join('\n');
  return [recipient?.id ? `<a href="tg://user?id=${recipient.id}">${escapeHtml(shortText(recipient.name || String(recipient.id), 40))}</a>` : '',
    `<b>「${title}」</b> — ${artists}`,
    `<blockquote expandable>${details}</blockquote>`].filter(Boolean).join('\n');
}
export function musicTrack(track: Track, job: Pick<DownloadJob, 'audioTrack'>): Track {
  const actual = job.audioTrack;
  return actual ? { ...track, provider: actual.provider, id: actual.id, sourceUrl: actual.sourceUrl, albumUrl: actual.albumUrl, artistIds: actual.artistIds } : track;
}
function musicButtons(track: Track, language: BotLanguage, playback = false) {
  const row: { text: string; url?: string; callback_data?: string }[] = [];
  try {
    const album = track.albumUrl ? parseMusicLink(track.albumUrl) : undefined;
    if (album?.kind === 'album' && album.provider === track.provider) row.push({ text: botText(language, 'album'), callback_data: `browse:${album.provider}:album:${album.id}` });
  } catch { /* Skip malformed upstream album references. */ }
  const id = track.artistIds?.[0];
  if (id && (track.provider === 'netease' ? /^\d{1,16}$/ : /^[a-zA-Z0-9]{22}$/).test(id) && ['netease', 'spotify'].includes(track.provider)) row.push({ text: shortText(track.artists[0] || botText(language, 'artist'), 20), callback_data: `browse:${track.provider}:artist:${id}` });
  if (playback) row.push({ text: botText(language, 'originalFile'), callback_data: `raw:${track.provider}:${track.id}` });
  return { inline_keyboard: [...(row.length ? [row] : []), [
    { text: `${botText(language, 'source')} ↗`, url: track.sourceUrl }, { text: botText(language, 'share'), switch_inline_query: track.sourceUrl }]] };
}

// Cover URLs originate upstream. Limit them to platform CDNs, including redirects.
export function coverUrl(raw: string): URL {
  const url = new URL(raw);
  const hosts = ['music.126.net', 'scdn.co', 'ytimg.com', 'googleusercontent.com', 'ggpht.com', 'gtimg.cn', 'kuwo.cn', 'kugou.com', 'migu.cn', 'migufun.com', 'dmhmusic.com'];
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
  chatId: number; messageThreadId?: number; replyTo?: number; job: DownloadJob; track: Track;
  bytes?: Uint8Array; file?: Blob; filename: string; duration: number; thumbnail?: Uint8Array;
  uiLanguage?: BotLanguage; botUsername?: string; recipientId?: number; recipientName?: string;
  asDocument?: boolean;
  onDelivered?: (kind: 'audio' | 'document', result: unknown) => void;
}
export interface MusicReference {
  chatId: number; messageThreadId?: number; replyTo?: number; job: DownloadJob; track: Track;
  fileId: string; kind: 'audio' | 'document'; duration: number; uiLanguage?: BotLanguage; botUsername?: string; recipientId?: number; recipientName?: string;
}
export function musicReferencePayload(reference: MusicReference): FormData {
  const form = new FormData(), language = reference.uiLanguage || 'zh-Hant';
  form.set('muism_caption_language', language);
  form.set('chat_id', String(reference.chatId));
  if (reference.messageThreadId !== undefined) form.set('message_thread_id', String(reference.messageThreadId));
  form.set(reference.kind, reference.fileId);
  form.set('caption', musicCaption(reference.track, reference.job, language, reference.botUsername, { id: reference.recipientId, name: reference.recipientName }));
  form.set('parse_mode', 'HTML');
  if (reference.replyTo !== undefined) form.set('reply_parameters', JSON.stringify({ message_id: reference.replyTo, allow_sending_without_reply: true }));
  form.set('reply_markup', JSON.stringify(musicButtons(musicTrack(reference.track, reference.job), language, reference.job.presentation === 'telegram-playback')));
  if (reference.kind === 'audio') {
    form.set('title', reference.track.title.slice(0, 256));
    form.set('performer', reference.track.artists.join(' / ').slice(0, 256));
    if (reference.duration > 0) form.set('duration', String(reference.duration));
  }
  return form;
}
export function musicPayload(upload: MusicUpload, document = false, withThumbnail = true): FormData {
  const form = new FormData(), extension = extname(upload.filename).toLowerCase();
  const language = upload.uiLanguage || 'zh-Hant';
  form.set('muism_caption_language', language);
  const mime: Record<string, string> = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.webm': 'audio/webm' };
  form.set('chat_id', String(upload.chatId));
  if (upload.messageThreadId !== undefined) form.set('message_thread_id', String(upload.messageThreadId));
  if (!upload.file && !upload.bytes) throw new ServiceError('INVALID_FILE', 'No audio file');
  form.set(document ? 'document' : 'audio', upload.file || new Blob([new Uint8Array(upload.bytes!)], { type: mime[extension] || 'application/octet-stream' }), upload.filename);
  if (document) form.set('disable_content_type_detection', 'true');
  form.set('caption', musicCaption(upload.track, upload.job, language, upload.botUsername, { id: upload.recipientId, name: upload.recipientName }));
  form.set('parse_mode', 'HTML');
  if (upload.replyTo !== undefined) form.set('reply_parameters', JSON.stringify({ message_id: upload.replyTo, allow_sending_without_reply: true }));
  form.set('reply_markup', JSON.stringify(musicButtons(musicTrack(upload.track, upload.job), language, upload.job.presentation === 'telegram-playback')));
  if (!document) {
    form.set('title', upload.track.title.slice(0, 256));
    form.set('performer', upload.track.artists.join(' / ').slice(0, 256));
    if (upload.duration > 0) form.set('duration', String(upload.duration));
  }
  if (withThumbnail && upload.thumbnail) form.set('thumbnail', new Blob([new Uint8Array(upload.thumbnail)], { type: 'image/jpeg' }), 'cover.jpg');
  return form;
}
export async function sendMusic(telegram: Telegram, upload: MusicUpload): Promise<'audio' | 'document'> {
  // Compatible original audio, including FLAC, is tried before a derivative.
  // Playback derivatives are prepared
  // separately by BotPlayback and explicitly labelled in their caption.
  const delivered = (result: unknown, fallback: 'audio' | 'document' = 'audio') => {
    const kind = result && typeof result === 'object' && 'document' in result && !('audio' in result) ? 'document' as const : fallback;
    upload.onDelivered?.(kind, result);
    return kind;
  };
  if (upload.asDocument) return delivered(await telegram('sendDocument', musicPayload(upload, true)), 'document');
  let rejected: unknown;
  try { return delivered(await telegram('sendAudio', musicPayload(upload))); }
  catch (error) { rejected = error; }
  if (rejected instanceof TelegramRequestError && rejected.errorCode === 400 && upload.thumbnail && /thumbnail|thumb|image|photo/i.test(rejected.description)) {
    try { return delivered(await telegram('sendAudio', musicPayload(upload, false, false))); }
    catch (error) { rejected = error; }
  }
  if (!(rejected instanceof TelegramRequestError) || rejected.errorCode !== 400 || !/audio|file type|wrong file|failed to process/i.test(rejected.description)) throw rejected;
  return delivered(await telegram('sendDocument', musicPayload(upload, true)), 'document');
}
