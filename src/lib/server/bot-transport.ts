import { openAsBlob } from 'node:fs';
import { extname } from 'node:path';
import { ServiceError } from './errors.js';

export function botTransport(env: NodeJS.ProcessEnv = process.env) {
  const base = new URL(env.BOT_API_BASE_URL || 'https://api.telegram.org');
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('Invalid BOT_API_BASE_URL');
  const local = env.BOT_API_LOCAL === '1';
  if (local && base.hostname === 'api.telegram.org') throw new Error('Local Bot API requires its own endpoint');
  if (!local && base.protocol !== 'https:') throw new Error('Cloud Bot API requires HTTPS');
  if (local && base.protocol === 'http:' && !['telegram-api', 'localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('Unencrypted Local Bot API must use the internal service or loopback');
  return { base: base.href, local, maxUploadBytes: (local ? 2000 : 50) * 1024 * 1024 };
}
export function checkBotUpload(bytes: number, env: NodeJS.ProcessEnv = process.env): void {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new ServiceError('INVALID_FILE', 'Invalid audio file');
  if (bytes > botTransport(env).maxUploadBytes) throw new ServiceError('FILE_TOO_LARGE', 'Audio exceeds the configured Bot API upload limit', 413);
}
// File-backed multipart blobs stream from disk. A 2 GB upload must not allocate
// the whole recording (and another Blob copy) inside the Bot's 1 GB container.
export function botUploadFile(path: string): Promise<Blob> {
  const mime: Record<string, string> = { '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.webm': 'audio/webm' };
  return openAsBlob(path, { type: mime[extname(path).toLowerCase()] || 'application/octet-stream' });
}
export function botRequestTimeout(method: string, body: Record<string, unknown> | FormData, local = botTransport().local): number {
  if (method === 'getUpdates') return 40_000;
  if (local && body instanceof FormData && ['sendAudio', 'sendDocument'].includes(method)) return 30 * 60_000;
  return 120_000;
}
