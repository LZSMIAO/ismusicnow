import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { config } from './config.js';
import type { Track } from '../types.js';
import type { MusicCacheKey } from './bot-cache.js';

// Both private downloads and inline sharing must use the same quality identity.
export async function musicCacheKey(track: Pick<Track, 'provider' | 'id'>): Promise<MusicCacheKey> {
  let quality = track.provider === 'netease' ? 'original-lossless' : track.provider === 'ytm' ? 'original-bestaudio' : config.spotifyAudioQuality;
  if (track.provider === 'spotify' && config.votifyConfigPath) {
    const digest = await readFile(config.votifyConfigPath).then(bytes => createHash('sha256').update(bytes).digest('hex')).catch(() => 'unreadable');
    quality += `:${digest}`;
  }
  return { provider: track.provider, id: track.id, quality };
}
