import { resolve } from 'node:path';
import type { Collection, MusicEntity, MusicSearchKind, Track } from '../../types.js';
import { config } from '../config.js';
import { runCommand } from '../process.js';
import type { MusicLink } from '../links.js';
import { ServiceError } from '../errors.js';

interface YtmEntry { id: string; title: string; artist?: string; uploader?: string; album?: string; thumbnail?: string; thumbnails?: { url: string }[]; duration?: number; entries?: YtmEntry[]; playlist_count?: number }

interface CatalogueEntry {
  videoId?: string; browseId?: string; playlistId?: string; title?: string; name?: string; artist?: string;
  artists?: { name?: string; id?: string }[]; album?: { name?: string; id?: string };
  thumbnails?: { url?: string }[]; duration?: string; duration_seconds?: number; year?: string;
  isAvailable?: boolean; tracks?: CatalogueEntry[];
  songs?: { results?: CatalogueEntry[] }; albums?: { results?: CatalogueEntry[] }; singles?: { results?: CatalogueEntry[] };
}
const videoId = /^[a-zA-Z0-9_-]{11}$/;
const artistId = /^UC[a-zA-Z0-9_-]{22}$/;
const albumId = /^MPREb_[a-zA-Z0-9_-]{1,94}$/;
const playlistId = /^[a-zA-Z0-9_-]{10,100}$/;
const cover = (entry: CatalogueEntry) => entry.thumbnails?.findLast(t => typeof t?.url === 'string' && t.url.startsWith('https://'))?.url || '';
const names = (entry: CatalogueEntry) => (entry.artists || []).map(a => a?.name).filter((name): name is string => typeof name === 'string' && !!name);
function catalogueTrack(entry: CatalogueEntry): Track | undefined {
  if (!entry.videoId || !videoId.test(entry.videoId) || typeof entry.title !== 'string' || !entry.title || entry.isAvailable === false) return;
  const seconds = typeof entry.duration_seconds === 'number' ? entry.duration_seconds
    : (entry.duration || '').split(':').reduce((total, part) => total * 60 + Number(part), 0);
  return { provider: 'ytm', id: entry.videoId, title: entry.title, artists: names(entry), album: entry.album?.name || '',
    ...(entry.album?.id && albumId.test(entry.album.id) ? { albumUrl: `https://music.youtube.com/browse/${entry.album.id}` } : {}),
    cover: cover(entry), durationMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0,
    sourceUrl: `https://music.youtube.com/watch?v=${entry.videoId}` };
}
function catalogueEntity(entry: CatalogueEntry, kind: Exclude<MusicSearchKind, 'track'>): MusicEntity | undefined {
  const id = kind === 'playlist' ? entry.playlistId || entry.browseId?.replace(/^VL/, '') : entry.browseId;
  const title = kind === 'artist' ? entry.artist || entry.title : entry.title;
  if (!id || !({artist: artistId, album: albumId, playlist: playlistId})[kind].test(id) || typeof title !== 'string' || !title) return;
  return { provider: 'ytm', id, kind, title, artists: kind === 'artist' ? [title] : names(entry), cover: cover(entry), year: entry.year,
    sourceUrl: kind === 'playlist' ? `https://music.youtube.com/playlist?list=${id}` : `https://music.youtube.com/browse/${id}` };
}
export function mapYtmSearch(query: string, kind: MusicSearchKind, entries: CatalogueEntry[]): Collection {
  const tracks = kind === 'track' ? entries.map(catalogueTrack).filter((t): t is Track => !!t) : [];
  const entities = kind !== 'track' ? entries.map(e => catalogueEntity(e, kind)).filter((e): e is MusicEntity => !!e) : [];
  return { provider: 'ytm', kind: 'search', title: query, query, searchType: kind, tracks, entities,
    total: tracks.length || entities.length, warnings: [] };
}
async function catalogueRequest(operation: 'search' | 'artist' | 'album', input: string, kind: MusicSearchKind = 'track'): Promise<unknown> {
  try {
    return JSON.parse(await runCommand(config.ytmPythonBin, [resolve('scripts/ytm-search.py'), operation, input, kind], { timeout: 18_000 }));
  } catch { throw new ServiceError('YTM_SEARCH_UNAVAILABLE', 'YouTube Music 暫時無法取得音樂，請稍後重試。', 502); }
}
export async function searchYtm(query: string, kind: MusicSearchKind = 'track'): Promise<Collection> {
  const response = await catalogueRequest('search', query, kind);
  if (!Array.isArray(response)) throw new ServiceError('YTM_SEARCH_UNAVAILABLE', 'YouTube Music 暫時無法搜尋。', 502);
  return mapYtmSearch(query, kind, response.filter(e => e && typeof e === 'object').slice(0, 20));
}

export function mapYtmBrowse(link: MusicLink, entry: CatalogueEntry): Collection {
  const title = entry.name || entry.title || 'YouTube Music';
  const tracks = (link.kind === 'artist' ? entry.songs?.results || [] : entry.tracks || []).slice(0, config.maxCollectionTracks)
    .map(e => catalogueTrack({ ...e, artists: e.artists?.length ? e.artists : link.kind === 'artist' ? [{name: title}] : entry.artists,
      album: e.album || (link.kind === 'album' ? { name: title, id: link.id } : undefined),
      thumbnails: e.thumbnails?.length ? e.thumbnails : entry.thumbnails })).filter((t): t is Track => !!t);
  const entities = link.kind === 'artist' ? [...(entry.albums?.results || []), ...(entry.singles?.results || [])]
    .map(e => catalogueEntity({...e, artists: e.artists || [{name: title}]}, 'album')).filter((e): e is MusicEntity => !!e) : [];
  return { provider: 'ytm', kind: link.kind, title, tracks, entities, total: tracks.length, warnings: [], sourceUrl: link.url };
}

function cookieArgs(): string[] { return config.ytmCookiesPath ? ['--cookies', resolve(config.ytmCookiesPath)] : []; }
function mapYtm(entry: YtmEntry): Track {
  return { id: entry.id, provider: 'ytm', title: entry.title, artists: [entry.artist || entry.uploader || ''].filter(Boolean),
    album: entry.album || '', cover: entry.thumbnail || entry.thumbnails?.at(-1)?.url || '', durationMs: (entry.duration || 0) * 1000,
    sourceUrl: `https://music.youtube.com/watch?v=${entry.id}` };
}

export async function resolveYtm(link: MusicLink): Promise<Collection> {
  if (link.kind === 'artist' || link.kind === 'album') {
    const response = await catalogueRequest(link.kind, link.id);
    if (!response || typeof response !== 'object' || Array.isArray(response)) throw new ServiceError('NOT_FOUND', '找不到這個 YouTube Music 頁面。', 404);
    return mapYtmBrowse(link, response as CatalogueEntry);
  }
  const output = await runCommand(config.ytdlpBin, ['--ignore-config', ...cookieArgs(), '--dump-single-json', '--skip-download',
    '--flat-playlist', '--playlist-end', String(config.maxCollectionTracks), '--', link.url], { timeout: 45_000 });
  const info = JSON.parse(output) as YtmEntry;
  const tracks = (info.entries || [info]).filter((t) => /^[a-zA-Z0-9_-]{11}$/.test(t.id)).map(mapYtm);
  const total = info.playlist_count || tracks.length;
  return { title: info.title, kind: link.kind, provider: 'ytm', total, tracks,
    warnings: total > tracks.length ? [`共有 ${total} 首，本次載入前 ${tracks.length} 首。`] : [] };
}

export async function downloadYtm(track: Track, directory: string): Promise<void> {
  await runCommand(config.ytdlpBin, ['--ignore-config', ...cookieArgs(), '--no-playlist', '--no-progress',
    '--max-filesize', '256M', '--format', 'bestaudio', '--output', resolve(directory, 'audio.%(ext)s'), '--', track.sourceUrl], { cwd: directory, timeout: 300_000 });
}
