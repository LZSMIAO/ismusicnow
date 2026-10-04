import { createRequire } from 'node:module';
import type { Collection, DownloadFormat, MusicEntity, MusicSearchKind, Track } from '../../types.js';
import { config } from '../config.js';
import { ServiceError } from '../errors.js';
import { fetchJson } from '../http.js';
import type { MusicLink } from '../links.js';

type Song = { id: number; name: string; ar?: { id?: number; name: string }[]; artists?: { id?: number; name: string }[]; al?: { id?: number; name: string; picUrl?: string }; album?: { id?: number; name: string; picUrl?: string }; dt?: number; duration?: number };
type NeteaseEntity = { id: number; name: string; artist?: { name: string }; artists?: { name: string }[]; creator?: { nickname: string }; publishTime?: number; picUrl?: string; coverImgUrl?: string; img1v1Url?: string; size?: number; trackCount?: number; musicSize?: number; albumSize?: number };
interface Body {
  code?: number; songs?: Song[]; hotSongs?: Song[]; artist?: NeteaseEntity; hotAlbums?: NeteaseEntity[];
  result?: { songs?: Song[]; songCount?: number; albums?: NeteaseEntity[]; albumCount?: number; artists?: NeteaseEntity[]; artistCount?: number; playlists?: NeteaseEntity[]; playlistCount?: number };
  playlist?: { name: string; trackIds: { id: number }[]; trackCount: number };
  album?: { name: string }; lrc?: { lyric?: string };
  data?: { url: string | null; type: string; br: number; freeTrialInfo?: unknown }[];
}

const require = createRequire(import.meta.url);
let sdk: Record<string, (params: Record<string, unknown>) => Promise<{ body: Body }>> | undefined;

export async function neteaseRequest(method: string, params: Record<string, unknown>): Promise<Body> {
  try {
    let body: Body;
    const args = { ...params, cookie: config.neteaseCookie, timestamp: Date.now() };
    if (config.neteaseApiUrl) {
      body = await fetchJson<Body>(new URL(method.replaceAll('_', '/'), `${config.neteaseApiUrl.replace(/\/$/, '')}/`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args),
      });
    } else {
      sdk ||= require('@neteasecloudmusicapienhanced/api');
      const call = sdk![method];
      if (!call) throw new Error('Missing endpoint');
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        body = (await Promise.race([call(args), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new ServiceError('NETWORK_ERROR', '網易雲服務連接超時。', 504)), 20_000);
        })])).body;
      } finally { if (timeout) clearTimeout(timeout); }
    }
    if (body.code && body.code !== 200) throw new ServiceError('NETEASE_ERROR', '網易雲無法回應，請檢查帳號狀態或曲目權限。', 502);
    return body;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError('NETEASE_ERROR', '網易雲服務暫時無法連接，請稍後再試。', 502);
  }
}

export function mapNetease(song: Song): Track {
  const album = song.al || song.album;
  return { id: String(song.id), provider: 'netease', title: song.name,
    artists: (song.ar || song.artists || []).map((a) => a.name), album: album?.name || '',
    albumUrl: album?.id ? `https://music.163.com/album?id=${album.id}` : undefined,
    artistIds: (song.ar || song.artists || []).map((a) => a.id ? String(a.id) : ''),
    cover: album?.picUrl?.replace(/^http:/, 'https:') || '', durationMs: song.dt || song.duration || 0,
    sourceUrl: `https://music.163.com/song?id=${song.id}` };
}

function mapEntity(entity: NeteaseEntity, kind: MusicEntity['kind']): MusicEntity {
  return { id: String(entity.id), provider: 'netease', kind, title: entity.name,
    artists: entity.artists?.map(a => a.name) || (entity.artist ? [entity.artist.name] : entity.creator ? [entity.creator.nickname] : []),
    sourceUrl: `https://music.163.com/${kind}?id=${entity.id}`,
    cover: (entity.picUrl || entity.coverImgUrl || entity.img1v1Url || '').replace(/^http:/, 'https:'),
    year: entity.publishTime ? String(new Date(entity.publishTime).getUTCFullYear()) : undefined,
    count: kind === 'artist' ? entity.musicSize : kind === 'playlist' ? entity.trackCount : entity.size };
}
export async function searchNetease(query: string, searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const body = await neteaseRequest('cloudsearch', { keywords: query, type: { track: 1, album: 10, artist: 100, playlist: 1000 }[searchType], limit: 30 });
  const result = body.result;
  const entities = searchType === 'track' ? undefined : (result?.[searchType === 'album' ? 'albums' : searchType === 'artist' ? 'artists' : 'playlists'] || []).map(e => mapEntity(e, searchType));
  const total = result?.[searchType === 'track' ? 'songCount' : searchType === 'album' ? 'albumCount' : searchType === 'artist' ? 'artistCount' : 'playlistCount'] || 0;
  return { title: query, query, searchType, provider: 'netease', kind: 'search', tracks: searchType === 'track' ? (result?.songs || []).map(mapNetease) : [], entities, total, warnings: [] };
}

export async function neteaseTracks(ids: string[]): Promise<Track[]> {
  const body = await neteaseRequest('song_detail', { ids: ids.join(',') });
  return (body.songs || []).map(mapNetease);
}

export async function resolveNetease(link: MusicLink): Promise<Collection> {
  let title = '', tracks: Track[], total: number;
  if (link.kind === 'track') {
    tracks = await neteaseTracks([link.id]); title = tracks[0]?.title || ''; total = tracks.length;
  } else if (link.kind === 'album') {
    const body = await neteaseRequest('album', { id: link.id });
    title = body.album?.name || '專輯'; total = body.songs?.length || 0;
    tracks = (body.songs || []).slice(0, config.maxCollectionTracks).map(mapNetease);
  } else if (link.kind === 'artist') {
    const body = await neteaseRequest('artists', { id: link.id });
    title = body.artist?.name || ''; tracks = (body.hotSongs || []).slice(0, config.maxCollectionTracks).map(mapNetease); total = body.hotSongs?.length || 0;
  } else {
    const body = await neteaseRequest('playlist_detail', { id: link.id });
    const playlist = body.playlist;
    if (!playlist) throw new ServiceError('NOT_FOUND', '找不到這份網易雲歌單。', 404);
    title = playlist.name; total = playlist.trackCount;
    const ids = playlist.trackIds.slice(0, config.maxCollectionTracks).map((t) => String(t.id));
    tracks = ids.length ? await neteaseTracks(ids) : [];
  }
  if (!tracks.length && link.kind === 'track') throw new ServiceError('NOT_FOUND', '找不到這首歌曲。', 404);
  return { title, tracks, total, provider: 'netease', kind: link.kind, sourceUrl: link.url,
    warnings: total > tracks.length ? [`此歌單共有 ${total} 首，本次載入前 ${tracks.length} 首。`] : [] };
}

export async function neteaseArtistAlbums(id: string): Promise<Collection> {
  const body = await neteaseRequest('artist_album', { id, limit: 100 });
  const entities = (body.hotAlbums || []).slice(0, config.maxCollectionTracks).map(e => mapEntity(e, 'album'));
  return { title: body.artist?.name || '', provider: 'netease', kind: 'artist', searchType: 'album', tracks: [], entities, total: body.artist?.albumSize || entities.length, warnings: [], sourceUrl: `https://music.163.com/artist?id=${id}` };
}

export async function neteaseAudio(id: string, format: DownloadFormat): Promise<{ url: string; extension: string }> {
  // The SDK's xeapi default needs a separately bootstrapped key cache. The
  // supported eapi transport works when the SDK is embedded without its server.
  const body = await neteaseRequest('song_url_v1', { id, crypto: 'eapi', level: format === 'flac' ? 'lossless' : format === 'mp3' ? 'exhigh' : 'lossless' });
  const audio = body.data?.[0];
  if (!audio?.url) throw new ServiceError('NO_AUDIO', '這首歌曲目前沒有可下載音源，請檢查帳號或地區權限。', 403);
  if (audio.freeTrialInfo) throw new ServiceError('PREVIEW_ONLY', '平台只提供試聽片段，無法作為完整歌曲下載。', 403);
  const extension = audio.type.toLowerCase();
  if (!['mp3', 'flac', 'm4a', 'aac'].includes(extension)) throw new ServiceError('UNSUPPORTED_AUDIO', '平台回傳了未支援的音訊格式。', 502);
  if (format === 'flac' && extension !== 'flac') throw new ServiceError('LOSSLESS_UNAVAILABLE', '帳號或曲目未提供原生 FLAC，可改用原始可用音質。', 403);
  return { url: audio.url, extension };
}

export async function neteaseLyrics(id: string): Promise<string> {
  const body = await neteaseRequest('lyric', { id });
  return body.lrc?.lyric || '';
}

export async function neteasePreview(id: string): Promise<{ url: string; limited: boolean } | null> {
  const body = await neteaseRequest('song_url_v1', { id, crypto: 'eapi', level: 'standard' });
  // Preserve the platform's access level; the player does not impose a time cap.
  const audio = body.data?.[0];
  return audio?.url ? { url: audio.url, limited: !!audio.freeTrialInfo } : null;
}
