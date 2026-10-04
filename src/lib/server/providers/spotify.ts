import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Collection, MusicEntity, MusicSearchKind, Track } from '../../types.js';
import { config } from '../config.js';
import { ServiceError } from '../errors.js';
import { fetchJson } from '../http.js';
import type { MusicLink } from '../links.js';
import { commandAvailable, runCommand } from '../process.js';

interface Artist { id?: string; name: string; images?: { url: string }[] }
interface Album { id?: string; name: string; images?: { url: string }[]; tracks?: Page<SpotifyTrack>; artists?: Artist[]; release_date?: string; total_tracks?: number }
interface SpotifyTrack { id: string; name: string; type?: string; is_local?: boolean; artists: Artist[]; album?: Album; duration_ms: number; preview_url?: string | null }
interface SpotifyEntity extends Album { owner?: { display_name?: string }; followers?: { total: number } }
interface Page<T> { items: T[]; total: number; next: string | null }
let token: { value: string; expires: number } | undefined;

export function spotifyMetadataConfigured(): boolean {
  return !!process.env.SPOTIFY_ACCESS_TOKEN || !!(config.spotifyClientId && config.spotifyClientSecret);
}

async function spotifyToken(): Promise<string> {
  if (process.env.SPOTIFY_ACCESS_TOKEN) return process.env.SPOTIFY_ACCESS_TOKEN;
  if (!spotifyMetadataConfigured()) throw new ServiceError('SPOTIFY_SETUP', 'Spotify 搜尋、專輯及歌單解析需要在服務端配置 Spotify API 憑證。單曲連結仍可解析。', 503);
  if (token && token.expires > Date.now()) return token.value;
  const auth = Buffer.from(`${config.spotifyClientId}:${config.spotifyClientSecret}`).toString('base64');
  const body = await fetchJson<{ access_token: string; expires_in: number }>('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  token = { value: body.access_token, expires: Date.now() + Math.max(0, body.expires_in - 60) * 1000 };
  return token.value;
}

async function spotifyRequest<T>(path: string): Promise<T> {
  try { return await fetchJson<T>(`https://api.spotify.com/v1/${path}`, { headers: { Authorization: `Bearer ${await spotifyToken()}` } }); }
  catch (error) { if (error instanceof ServiceError && error.code === 'ACCOUNT_REQUIRED') token = undefined; throw error; }
}

export function mapSpotify(track: SpotifyTrack, album?: Album): Track {
  const record = track.album || album;
  return { id: track.id, provider: 'spotify', title: track.name, artists: track.artists.map((a) => a.name),
    artistIds: track.artists.map((a) => a.id || ''),
    album: record?.name || '', albumUrl: record?.id ? `https://open.spotify.com/album/${record.id}` : undefined, cover: record?.images?.[0]?.url || '', durationMs: track.duration_ms || 0,
    sourceUrl: `https://open.spotify.com/track/${track.id}` };
}

function mapEntity(entity: SpotifyEntity, kind: MusicEntity['kind']): MusicEntity {
  return { id: entity.id!, provider: 'spotify', kind, title: entity.name,
    artists: entity.artists?.map(a => a.name) || (entity.owner?.display_name ? [entity.owner.display_name] : []),
    sourceUrl: `https://open.spotify.com/${kind}/${entity.id}`, cover: entity.images?.[0]?.url || '',
    year: entity.release_date?.slice(0, 4), count: kind === 'album' ? entity.total_tracks : kind === 'playlist' ? entity.tracks?.total : undefined };
}
export async function searchSpotify(query: string, searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const body = await spotifyRequest<Record<string, Page<SpotifyTrack | SpotifyEntity>>>(`search?type=${searchType}&limit=10&q=${encodeURIComponent(query)}`);
  const page = body[`${searchType}s`]!;
  const items = page.items.filter(item => item?.id);
  return { title: query, query, searchType, kind: 'search', provider: 'spotify',
    tracks: searchType === 'track' ? (items as SpotifyTrack[]).map(t => mapSpotify(t)) : [],
    entities: searchType === 'track' ? undefined : (items as SpotifyEntity[]).map(e => mapEntity(e, searchType)), total: page.total, warnings: [] };
}

export async function spotifyTrack(id: string): Promise<Track> {
  if (spotifyMetadataConfigured()) return mapSpotify(await spotifyRequest<SpotifyTrack>(`tracks/${id}`));
  const url = `https://open.spotify.com/track/${id}`;
  const embed = await fetchJson<{ title: string; thumbnail_url?: string }>(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  return { id, title: embed.title, provider: 'spotify', artists: [], album: '', cover: embed.thumbnail_url || '', durationMs: 0, sourceUrl: url };
}

export async function spotifyPreview(id: string): Promise<string | null> {
  if (!spotifyMetadataConfigured()) return null;
  return (await spotifyRequest<SpotifyTrack>(`tracks/${id}`)).preview_url || null;
}

export async function resolveSpotify(link: MusicLink): Promise<Collection> {
  const tracks: Track[] = [];
  let title: string, total: number;
  if (link.kind === 'track') {
    tracks.push(await spotifyTrack(link.id)); title = tracks[0]!.title; total = 1;
  } else if (link.kind === 'album') {
    const album = await spotifyRequest<Album>(`albums/${link.id}`);
    title = album.name;
    let page = album.tracks || await spotifyRequest<Page<SpotifyTrack>>(`albums/${link.id}/tracks?limit=50`);
    total = page.total;
    while (true) {
      tracks.push(...page.items.slice(0, config.maxCollectionTracks - tracks.length).map((t) => mapSpotify(t, album)));
      if (!page.next || tracks.length >= config.maxCollectionTracks) break;
      page = await spotifyRequest<Page<SpotifyTrack>>(new URL(page.next).pathname.replace(/^\/v1\//, '') + new URL(page.next).search);
    }
  } else if (link.kind === 'artist') {
    const artist = await spotifyRequest<Artist>(`artists/${link.id}`);
    let result: { tracks: SpotifyTrack[] };
    try { result = await spotifyRequest<{ tracks: SpotifyTrack[] }>(`artists/${link.id}/top-tracks?market=TW`); }
    catch (error) {
      if (error instanceof ServiceError && error.code === 'ACCOUNT_REQUIRED') return spotifyArtistAlbums(link.id);
      throw error;
    }
    title = artist.name; tracks.push(...result.tracks.map(t => mapSpotify(t))); total = tracks.length;
  } else {
    const playlist = await spotifyRequest<{ name: string }>(`playlists/${link.id}`);
    title = playlist.name;
    let page = await spotifyRequest<Page<{ item?: SpotifyTrack; track?: SpotifyTrack }>>(`playlists/${link.id}/items?limit=50`);
    total = page.total;
    let inspected = 0;
    while (true) {
      for (const entry of page.items) {
        inspected++;
        const track = entry.item || entry.track;
        if (track?.id && !track.is_local && (!track.type || track.type === 'track')) tracks.push(mapSpotify(track));
        if (inspected >= config.maxCollectionTracks) break;
      }
      if (!page.next || inspected >= config.maxCollectionTracks) break;
      page = await spotifyRequest<Page<{ item?: SpotifyTrack; track?: SpotifyTrack }>>(new URL(page.next).pathname.replace(/^\/v1\//, '') + new URL(page.next).search);
    }
  }
  const warnings = total > tracks.length ? [`共 ${total} 個項目，本次載入 ${tracks.length} 首可用歌曲（最多 ${config.maxCollectionTracks} 首）。`] : [];
  if (!spotifyMetadataConfigured()) warnings.push('已透過公開連結取得單曲資料；完整藝人、專輯和時長需配置 Spotify API。下載時由 Spotify 適配器寫入完整標籤。');
  return { title, total, tracks, provider: 'spotify', kind: link.kind, warnings, sourceUrl: link.url };
}

export async function spotifyArtistAlbums(id: string): Promise<Collection> {
  const [artist, page] = await Promise.all([spotifyRequest<Artist>(`artists/${id}`), spotifyRequest<Page<Album>>(`artists/${id}/albums?include_groups=album,single&limit=50`)]);
  const entities = page.items.filter(a => a.id).map(a => mapEntity(a, 'album'));
  return { title: artist.name, provider: 'spotify', kind: 'artist', searchType: 'album', tracks: [], entities, total: page.total, warnings: [], sourceUrl: `https://open.spotify.com/artist/${id}` };
}

export async function spotifyDownloaderReady(): Promise<boolean> {
  if (!config.spotifyCookiesPath) return false;
  try { await access(config.spotifyCookiesPath); } catch { return false; }
  // Click-based Votify has no --version flag; --help also validates its Python imports.
  return commandAvailable(config.votifyBin, ['--help']);
}

export function spotifyDownloadArgs(track: Track, directory: string): string[] {
  const qualities = ['vorbis-low', 'vorbis-medium', 'vorbis-high', 'aac-medium', 'aac-high', 'flac-flac', 'flac-flac-24', 'flac-mp4', 'flac-mp4-24'];
  if (!qualities.includes(config.spotifyAudioQuality)) throw new ServiceError('INVALID_QUALITY', 'Spotify 原始音質設定不受支援。', 503);
  const args = config.votifyConfigPath ? ['--config-path', resolve(config.votifyConfigPath)] : ['--no-config-file', '--session-type', 'librespot'];
  return [...args, '--cookies-path', resolve(config.spotifyCookiesPath), '--audio-quality', config.spotifyAudioQuality,
    '--output', directory, '--temp', resolve(directory, 'temp'), '--no-synced-lyrics-file', '--wait-interval', '0', track.sourceUrl];
}

export async function downloadSpotify(track: Track, directory: string): Promise<void> {
  if (!config.spotifyCookiesPath) throw new ServiceError('SPOTIFY_COOKIES', 'Spotify 原始音源下載需要服務端的帳號 cookies 設定。', 503);
  try { await access(config.spotifyCookiesPath); } catch { throw new ServiceError('SPOTIFY_COOKIES', 'Spotify cookies 檔案不存在，請檢查服務端設定。', 503); }
  await runCommand(config.votifyBin, spotifyDownloadArgs(track, directory), { cwd: directory, timeout: 300_000 });
}
