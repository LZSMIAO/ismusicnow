import { parseLrc, type Lyrics } from '../lyrics.js';
import type { Provider } from '../types.js';
import { isMyhkProvider, myhkLyrics } from './providers/myhk.js';
import { neteaseLyrics } from './providers/netease.js';
import { ServiceError } from './errors.js';
import { fetchJson } from './http.js';
const cache = new Map<string, { until: number; value: Lyrics }>();
export async function trackLyrics(track: { provider: Provider; id: string; title: string; artists: string[]; album: string; durationMs: number }): Promise<Lyrics> {
  const key = JSON.stringify(track), saved = cache.get(key);
  if (saved && saved.until > Date.now()) return saved.value;
  let value: Lyrics;
  if (isMyhkProvider(track.provider)) {
    const text = track.provider === 'netease' ? await neteaseLyrics(track.id) : await myhkLyrics(track.provider, track.id);
    value = { source: track.provider, lines: parseLrc(text), plain: text.replace(/\[[^\]]*\]/g, '').trim() };
  } else {
    const query = new URLSearchParams({ track_name: track.title, artist_name: track.artists[0] || '' });
    if (track.album) query.set('album_name', track.album);
    const seconds = track.durationMs / 1000;
    if (seconds >= 1 && seconds <= 3600) query.set('duration', String(seconds));
    try {
      const body = await fetchJson<{ syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean }>(`https://lrclib.net/api/get?${query}`, { headers: { 'User-Agent': 'MUISM/1.0 (https://music.ism.tw)' } });
      value = { source: 'lrclib', lines: parseLrc(body.syncedLyrics || ''), plain: (body.plainLyrics || '').slice(0, 200_000), instrumental: !!body.instrumental };
    } catch (error) {
      if (!(error instanceof ServiceError) || error.code !== 'NOT_FOUND') throw error;
      value = { source: 'lrclib', lines: [], plain: '' };
    }
  }
  for (const [id, item] of cache) if (item.until < Date.now()) cache.delete(id);
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  cache.set(key, { value, until: Date.now() + 60 * 60_000 }); return value;
}
