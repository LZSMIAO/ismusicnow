import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import { isMyhkProvider, myhkConfigured } from './providers/myhk.js';
import type { Track } from '../types.js';
import type { MusicCacheKey } from './bot-cache.js';

// Telegram file IDs cannot change media types. Keep an additional Inline
// presentation of the same original/quality when FLAC needs a document ID.
export const inlinePresentationKey = (key: MusicCacheKey): MusicCacheKey => ({ ...key, quality: `${key.quality}:inline` });
export const telegramPlaybackKey = (key: MusicCacheKey): MusicCacheKey => ({ ...key, quality: `${key.quality}:telegram-mp3-320-v1` });

// Both private downloads and inline sharing must use the same quality identity.
export async function musicCacheKey(track: Pick<Track, 'provider' | 'id'>): Promise<MusicCacheKey> {
  let quality = isMyhkProvider(track.provider) && myhkConfigured() ? 'myhk-best-recording-v2' : track.provider === 'netease' ? 'original-lossless' : track.provider === 'ytm' ? 'original-bestaudio' : config.spotifyAudioQuality;
  if (track.provider === 'spotify' && config.votifyConfigPath) {
    const digest = await readFile(config.votifyConfigPath).then(bytes => createHash('sha256').update(bytes).digest('hex')).catch(() => 'unreadable');
    quality += `:${digest}`;
  }
  return { provider: track.provider, id: track.id, quality };
}
