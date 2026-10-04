import type { Collection, MusicSearchKind, Provider, ServiceStatus, Track } from '../types.js';
import { config } from './config.js';
import { ServiceError } from './errors.js';
import { parseMusicLink, validateTrackId } from './links.js';
import { commandAvailable } from './process.js';
import { neteaseArtistAlbums, neteaseTracks, resolveNetease, searchNetease } from './providers/netease.js';
import { resolveSpotify, searchSpotify, spotifyArtistAlbums, spotifyDownloaderReady, spotifyMetadataConfigured, spotifyTrack } from './providers/spotify.js';
import { resolvePublic, searchPublic, getPublicTrack, type PublicProvider } from './providers/public-audio.js';
import { resolveYtm } from './providers/ytm.js';

export async function resolveMusic(input: string, provider: Provider, searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const text = input.trim();
  if (!text || text.length > 1000) throw new ServiceError('INVALID_INPUT', '請輸入 1 至 1000 字的連結或搜尋關鍵字。');
  const link = parseMusicLink(text);
  if (link) {
    if (link.provider === 'netease') return resolveNetease(link);
    if (link.provider === 'spotify') return resolveSpotify(link);
    if (link.provider === 'ytm') return resolveYtm(link);
    return resolvePublic(link);
  }
  if (provider === 'netease') return searchNetease(text, searchType);
  if (provider === 'spotify') return searchSpotify(text, searchType);
  if (provider !== 'ytm') return searchPublic(provider as PublicProvider, text, searchType);
  throw new ServiceError('YTM_LINK_REQUIRED', 'YTM 目前支援連結獲取，請貼上 YouTube Music 歌曲或歌單網址。');
}

export async function artistAlbums(sourceUrl: string): Promise<Collection> {
  const link = parseMusicLink(sourceUrl);
  if (!link || link.kind !== 'artist' || !['netease', 'spotify'].includes(link.provider)) throw new ServiceError('UNSUPPORTED_LINK', '請使用藝術家連結。');
  return link.provider === 'netease' ? neteaseArtistAlbums(link.id) : spotifyArtistAlbums(link.id);
}

export async function getTrack(provider: Provider, id: string): Promise<Track> {
  validateTrackId(provider, id);
  if (provider === 'spotify') return spotifyTrack(id);
  if (provider === 'ytm') return (await resolveYtm({ provider, kind: 'track', id, url: `https://music.youtube.com/watch?v=${id}` })).tracks[0]!;
  if (provider !== 'netease') return getPublicTrack(provider as PublicProvider, id);
  const track = (await neteaseTracks([id]))[0];
  if (!track) throw new ServiceError('NOT_FOUND', '找不到這首歌曲。', 404);
  return track;
}

let cachedStatus: { value: ServiceStatus; expires: number } | undefined;
export async function serviceStatus(): Promise<ServiceStatus> {
  if (cachedStatus && cachedStatus.expires > Date.now()) return cachedStatus.value;
  const [spotify, ytm] = await Promise.all([spotifyDownloaderReady(), commandAvailable(config.ytdlpBin)]);
  const value = { netease: { ready: true, accountConfigured: !!config.neteaseCookie },
    spotify: { metadataConfigured: spotifyMetadataConfigured(), downloaderReady: spotify }, ytm: { downloaderReady: ytm }, soundcloud: { downloaderReady: ytm }, bandcamp: { downloaderReady: ytm }, bilibili: { downloaderReady: ytm } };
  cachedStatus = { value, expires: Date.now() + 60_000 };
  return value;
}
