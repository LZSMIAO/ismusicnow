import type { Collection, MusicSearchKind, Provider, ServiceStatus, Track } from '../types.js';
import { config } from './config.js';
import { ServiceError } from './errors.js';
import { parseMusicLink, validateTrackId } from './links.js';
import { commandAvailable } from './process.js';
import { neteaseArtistAlbums, primaryNeteaseTrack, resolveNetease, searchNetease } from './providers/netease.js';
import { resolveSpotify, searchSpotify, spotifyArtistAlbums, spotifyDownloaderReady, spotifyMetadataConfigured, spotifyTrack } from './providers/spotify.js';
import { resolvePublic, searchPublic, getPublicTrack, type PublicProvider } from './providers/public-audio.js';
import { resolveYtm, searchYtm } from './providers/ytm.js';
import { isMyhkProvider, myhkConfigured, myhkTrack, resolveMyhk, searchMyhk } from './providers/myhk.js';

export async function resolveMusic(input: string, provider: Provider, searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const text = input.trim();
  if (!text || text.length > 1000) throw new ServiceError('INVALID_INPUT', '請輸入 1 至 1000 字的連結或搜尋關鍵字。');
  const link = parseMusicLink(text);
  if (link) {
    if (link.provider === 'netease') return resolveNetease(link);
    if (link.provider === 'spotify') return resolveSpotify(link);
    if (link.provider === 'ytm') return resolveYtm(link);
    if (isMyhkProvider(link.provider)) return resolveMyhk(link);
    return resolvePublic(link);
  }
  if (provider === 'netease') return searchNetease(text, searchType);
  if (provider === 'spotify') return searchSpotify(text, searchType);
  if (provider === 'ytm') return searchYtm(text, searchType);
  if (isMyhkProvider(provider)) {
    if (searchType !== 'track') throw new ServiceError('UNSUPPORTED_SEARCH', '此來源目前提供歌曲搜尋；專輯與歌單請貼上連結。');
    return searchMyhk(text, provider);
  }
  return searchPublic(provider as PublicProvider, text, searchType);
}

export async function artistAlbums(sourceUrl: string): Promise<Collection> {
  const link = parseMusicLink(sourceUrl);
  if (!link || link.kind !== 'artist' || !['netease', 'spotify', 'ytm'].includes(link.provider)) throw new ServiceError('UNSUPPORTED_LINK', '請使用藝術家連結。');
  if (link.provider === 'ytm') return resolveYtm(link);
  return link.provider === 'netease' ? neteaseArtistAlbums(link.id) : spotifyArtistAlbums(link.id);
}

export async function getTrack(provider: Provider, id: string): Promise<Track> {
  validateTrackId(provider, id);
  if (provider === 'spotify') return spotifyTrack(id);
  if (provider === 'ytm') return (await resolveYtm({ provider, kind: 'track', id, url: `https://music.youtube.com/watch?v=${id}` })).tracks[0]!;
  if (provider === 'netease') return primaryNeteaseTrack(id);
  if (isMyhkProvider(provider)) return myhkTrack(provider, id);
  return getPublicTrack(provider as PublicProvider, id);
}

let cachedStatus: { value: ServiceStatus; expires: number } | undefined;
export async function serviceStatus(): Promise<ServiceStatus> {
  if (cachedStatus && cachedStatus.expires > Date.now()) return cachedStatus.value;
  const [spotify, ytm] = await Promise.all([spotifyDownloaderReady(), commandAvailable(config.ytdlpBin)]);
  const extra = { downloaderReady: myhkConfigured() };
  const value = { qq: extra, kuwo: extra, kugou: extra, migu: extra, qianqian: extra, netease: { ready: true, accountConfigured: !!config.neteaseCookie },
    spotify: { metadataConfigured: spotifyMetadataConfigured(), downloaderReady: spotify }, ytm: { downloaderReady: ytm }, soundcloud: { downloaderReady: ytm }, bandcamp: { downloaderReady: ytm }, bilibili: { downloaderReady: ytm } };
  cachedStatus = { value, expires: Date.now() + 60_000 };
  return value;
}
