import { randomUUID } from 'node:crypto';
import { fetchJson } from '../http.js';
import { resolve } from 'node:path';
import type { Collection, MusicSearchKind, Track } from '../../types.js';
import { config } from '../config.js';
import { ServiceError } from '../errors.js';
import { parseMusicLink, validateTrackId, type MusicLink } from '../links.js';
import { runCommand } from '../process.js';

export type PublicProvider = 'soundcloud' | 'bandcamp' | 'bilibili';
interface Entry {
  id?: string; title?: string; track?: string; artist?: string; artists?: string[]; uploader?: string;
  album?: string; thumbnail?: string; thumbnails?: {url: string}[]; duration?: number;
  webpage_url?: string; url?: string; entries?: Entry[]; playlist_count?: number;
}
const names = { soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', bilibili: 'Bilibili' };
function cookies(provider: PublicProvider): string[] {
  const file = process.env[`${provider.toUpperCase()}_COOKIES_PATH`];
  return file ? ['--cookies', resolve(file)] : [];
}
export function publicTrackUrl(provider: PublicProvider, id: string): string {
  validateTrackId(provider, id);
  if (provider === 'soundcloud') return `https://api.soundcloud.com/tracks/${id}`;
  if (provider === 'bilibili') return `https://www.bilibili.com/video/${id}`;
  const [artist, slug] = id.split('~');
  return `https://${artist}.bandcamp.com/track/${slug}`;
}
export function mapPublicTrack(provider: PublicProvider, entry: Entry, fallback = ''): Track | null {
  if (!entry.title) return null;
  let id = String(entry.id || ''), url = entry.webpage_url || entry.url || fallback;
  try {
    if (provider === 'bandcamp') {
      const link = parseMusicLink(url);
      if (link?.provider !== provider || link.kind !== 'track') return null;
      id = link.id; url = link.url;
    } else if (provider === 'bilibili') {
      const link = url ? parseMusicLink(url) : null;
      id = link?.provider === provider ? link.id : id;
      url = publicTrackUrl(provider, id);
    } else {
      validateTrackId(provider, id);
      const link = url ? parseMusicLink(url) : null;
      url = link?.provider === provider ? link.url : publicTrackUrl(provider, id);
    }
    validateTrackId(provider, id);
  } catch { return null; }
  return { id, provider, title: entry.track || entry.title, artists: entry.artists?.filter(Boolean) || [entry.artist || entry.uploader || ''].filter(Boolean),
    album: entry.album || '', cover: entry.thumbnail || entry.thumbnails?.at(-1)?.url || '',
    durationMs: Math.max(0, Number(entry.duration) || 0) * 1000, sourceUrl: url };
}
async function extract(provider: PublicProvider, target: string, timeout: number, limit: number): Promise<Entry> {
  const output = await runCommand(config.ytdlpBin, ['--ignore-config', ...cookies(provider), '--dump-single-json', '--skip-download', '--flat-playlist',
    '--socket-timeout', '5', '--retries', '1', '--playlist-end', String(limit), '--', target], { timeout });
  return JSON.parse(output) as Entry;
}
function decodeTitle(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/&(?:amp|quot|apos|lt|gt);/g, entity => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'})[entity]!)
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (_, digits) => { const n = digits[0].toLowerCase() === 'x' ? parseInt(digits.slice(1),16) : Number(digits); return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''; });
}
async function searchBilibili(query: string): Promise<Track[]> {
  const params = new URLSearchParams({ search_type: 'video', keyword: query, page: '1' });
  const body = await fetchJson<{ code: number; data?: { result?: { bvid?: string; title?: string; author?: string; pic?: string; duration?: string }[] } }>(`https://api.bilibili.com/x/web-interface/search/type?${params}`, {
    headers: { 'Referer': 'https://www.bilibili.com/', 'User-Agent': 'Mozilla/5.0', 'Cookie': `buvid3=${randomUUID()}infoc` },
  });
  if (body.code !== 0) throw new ServiceError('UPSTREAM_ERROR', 'Bilibili 搜尋暫時無法回應。', 502);
  return (body.data?.result || []).slice(0,10).map(row => {
    const seconds = (row.duration || '').split(':').reduce((total, part) => total * 60 + (Number(part) || 0),0);
    return mapPublicTrack('bilibili', { id: row.bvid, title: decodeTitle(row.title || ''), uploader: row.author, duration: seconds,
      thumbnail: row.pic?.startsWith('//') ? `https:${row.pic}` : row.pic });
  }).filter((t): t is Track => !!t);
}
export async function searchPublic(provider: PublicProvider, query: string, kind: MusicSearchKind = 'track'): Promise<Collection> {
  if (provider === 'bandcamp') throw new ServiceError('LINK_REQUIRED', 'Bandcamp 請貼上歌曲或專輯連結。');
  if (kind !== 'track') return { title: query, provider, kind: 'search', query, searchType: kind, tracks: [], entities: [], total: 0, warnings: [] };
  const tracks = provider === 'bilibili' ? await searchBilibili(query) : (await extract(provider, `scsearch10:${query}`, 9000, 10)).entries?.map(entry => mapPublicTrack(provider, entry)).filter((t): t is Track => !!t) || [];
  return { title: query, provider, kind: 'search', query, tracks, total: tracks.length, warnings: [] };
}
export async function resolvePublic(link: MusicLink): Promise<Collection> {
  const provider = link.provider as PublicProvider;
  const info = await extract(provider, link.url, 30_000, config.maxCollectionTracks);
  const tracks = (info.entries || [info]).map(entry => mapPublicTrack(provider, entry, link.url)).filter((t): t is Track => !!t);
  if (!tracks.length) throw new ServiceError('NOT_FOUND', `${names[provider]} 沒有回傳可用的歌曲資料。`, 404);
  const total = info.playlist_count || tracks.length;
  return { title: info.title || tracks[0]!.title, provider, kind: link.kind, tracks, total, sourceUrl: link.url,
    warnings: total > tracks.length ? [`共有 ${total} 首，本次載入前 ${tracks.length} 首。`] : [] };
}
export async function getPublicTrack(provider: PublicProvider, id: string): Promise<Track> {
  return (await resolvePublic({ provider, id, kind: 'track', url: publicTrackUrl(provider, id) })).tracks[0]!;
}
export async function downloadPublic(track: Track, directory: string): Promise<void> {
  const link = parseMusicLink(track.sourceUrl);
  if (link?.provider !== track.provider || link.kind !== 'track') throw new ServiceError('INVALID_TRACK', '來源連結與曲目不一致，請重新解析。');
  await runCommand(config.ytdlpBin, ['--ignore-config', ...cookies(track.provider as PublicProvider), '--no-playlist', '--no-progress',
    '--max-filesize', '256M', '--format', 'bestaudio', '--output', resolve(directory, 'audio.%(ext)s'), '--', link.url], { cwd: directory, timeout: 300_000 });
}
