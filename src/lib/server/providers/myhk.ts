import type { Collection, Provider, Track } from '../../types.js';
import { config } from '../config.js';
import { ServiceError } from '../errors.js';
import { musicSourceUrl, validateTrackId, type MusicLink } from '../links.js';
import { Converter } from 'opencc-js';

export const myhkSources = { netease: 'wy', qq: 'qq', kuwo: 'kw', kugou: 'kg', migu: 'mg', qianqian: 'qi' } as const;
export type MyhkProvider = keyof typeof myhkSources;
export const isMyhkProvider = (provider: Provider): provider is MyhkProvider => provider in myhkSources;
export const myhkConfigured = () => !!config.myhkApiKey;
const cache = new Map<string, { until: number; value: Promise<unknown> }>();
const catalog = new Map<string, { until: number; track: Track; audioIds: string[] }>();
const simplified = Converter({ from: 'tw', to: 'cn' });
type Row = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.slice(0, 1000) : typeof value === 'number' ? String(value) : '';

// The fixed origin and non-redirecting POST keep credentials off URLs, client
// bundles and third-party redirect targets. Upstream messages are never public.
export async function myhkRequest(endpoint: 'search' | 'info' | 'url' | 'lrc' | 'album' | 'list', provider: MyhkProvider, params: Record<string, string>, ttl = 120_000): Promise<unknown> {
  if (!myhkConfigured()) throw new ServiceError('SOURCE_NOT_CONFIGURED', '此音樂來源尚未配置。', 503);
  const id = JSON.stringify([endpoint, provider, params]);
  for (const [key, item] of cache) if (item.until <= Date.now()) cache.delete(key);
  const saved = cache.get(id); if (saved) return saved.value;
  const value = (async () => {
    try {
      const response = await fetch(`https://myhkw.cn/open/music/${endpoint}`, { method: 'POST', redirect: 'error',
        body: new URLSearchParams({ ...params, type: myhkSources[provider], key: config.myhkApiKey }), signal: AbortSignal.timeout(endpoint === 'search' ? 3500 : 15_000) });
      if (!response.ok) throw new ServiceError(response.status === 429 ? 'RATE_LIMIT' : 'UPSTREAM_ERROR', '音樂來源暫時無法回應。', 502);
      const body: unknown = await response.json();
      if (Array.isArray(body)) return body;
      if (!body || typeof body !== 'object') throw new Error('Invalid response');
      // format=0 returns the provider's native search response. QQ uses code=0
      // for success; accept only its actual song list, never a failed envelope.
      if (endpoint === 'search' && params.format === '0' && nativeRows(body) !== undefined) return body;
      const envelope = body as Row;
      if (envelope.code !== 1 && envelope.code !== 200) throw new ServiceError(endpoint === 'url' ? 'NO_AUDIO' : 'UPSTREAM_ERROR', endpoint === 'url' ? '此曲暫無可用音源。' : '音樂來源暫時無法回應。', endpoint === 'url' ? 403 : 502);
      return envelope.data;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('UPSTREAM_ERROR', '音樂來源暫時無法回應。', 502);
    }
  })();
  if (cache.size >= 500) cache.delete(cache.keys().next().value!);
  const item = { until: Date.now() + ttl, value }; cache.set(id, item);
  // Briefly coalesce failures too: repeated Inline keystrokes must not hammer
  // an unavailable platform or consume the service quota in a retry loop.
  void value.catch(() => { if (cache.get(id) === item) item.until = Date.now() + 5000; });
  return value;
}

function safeCover(value: unknown): string {
  try {
    const url = new URL(text(value));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return '';
    const hosts = ['music.126.net', 'gtimg.cn', 'kuwo.cn', 'kugou.com', 'migu.cn', 'migufun.com', 'dmhmusic.com'];
    if (!hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) return '';
    url.protocol = 'https:'; return url.href;
  } catch { return ''; }
}
export function mapMyhkTrack(provider: MyhkProvider, row: Row, explicitId?: string): Track {
  const id = explicitId || text(row.id || row.songmid || row.MUSICRID || row.FileHash || row.songId || row.url_id).replace(/^MUSIC_/, ''); validateTrackId(provider, id);
  const singer = Array.isArray(row.singer) ? row.singer.map(value => text((value as Row).name)) : undefined;
  const artists = (singer || (Array.isArray(row.artist) ? row.artist.map(text) : [text(row.artist || row.artistName || row.ARTIST || row.SingerName)]))
    .flatMap(name => name.split(/[、/&;]/)).map(name => name.trim()).filter(Boolean);
  const albumId = text(provider === 'qq' ? row.albummid || row.pic_id || row.picid : row.ALBUMID || row.album_id);
  let albumUrl: string | undefined;
  if (albumId && ['qq', 'kuwo', 'netease'].includes(provider)) {
    try { albumUrl = musicSourceUrl(provider, 'album', albumId); } catch { /* No guessed references. */ }
  }
  const cover = safeCover(row.pic || row.cover || row.Image || row.AlbumImage) || (provider === 'qq' && /^[A-Za-z0-9]{14}$/.test(albumId) ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${albumId}.jpg` : '');
  const seconds = Number(row.interval || row.DURATION || row.Duration || 0);
  return { id, provider, title: text(row.name || row.songName || row.songname || row.NAME || row.SongName).replace(/<\/?em>/gi, ''), artists,
    album: text(row.album || row.albumName || row.albumname || row.ALBUM || row.AlbumName), albumUrl, cover,
    durationMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0, sourceUrl: musicSourceUrl(provider, 'track', id) };
}
function nativeRows(value: unknown): Row[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const data = value as Row, nested = data.data as Row | undefined;
  const song = nested?.song as Row | undefined;
  const list = Array.isArray(data.abslist) ? data.abslist : Array.isArray(nested?.lists) && data.status === 1 ? nested.lists : data.code === 0 && Array.isArray(song?.list) ? song.list : undefined;
  return list?.filter(row => row && typeof row === 'object') as Row[];
}
function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value.filter(row => row && typeof row === 'object');
  const native = nativeRows(value); if (native) return native;
  if (value && typeof value === 'object') {
    const data = value as Row;
    if (Array.isArray(data.songId)) return data.songId.map((id, i) => ({ id, name: (data.songName as unknown[])?.[i], album: (data.albumName as unknown[])?.[i], artist: (data.artistName as unknown[])?.[i] }));
  }
  throw new ServiceError('UPSTREAM_ERROR', '音樂來源回傳的列表格式無效。', 502);
}
export async function searchMyhk(query: string, provider: MyhkProvider): Promise<Collection> {
  // Native search retains recording durations and Kugou's quality-specific
  // hashes. Standardized Meting rows omit both, disabling safe source failover.
  const name = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query) ? query : simplified(query);
  const data = await myhkRequest('search', provider, { name, limit: '30', page: '1', pic: '1', ...(['qq', 'kuwo', 'kugou'].includes(provider) ? { format: '0' } : {}) });
  const raw = rows(data).slice(0, 30);
  const tracks = raw.flatMap(row => { try { const track = mapMyhkTrack(provider, row); return track.title ? [track] : []; } catch { return []; } });
  for (const [id, entry] of catalog) if (entry.until <= Date.now()) catalog.delete(id);
  const seen = new Set<string>();
  for (const row of raw) {
    try {
      const track = mapMyhkTrack(provider, row), key = `${provider}:${track.id}`;
      // A native list may repeat the same hash with incomplete release credits.
      // Keep the first canonical entry instead of overwriting it with a variant.
      if (!track.title || seen.has(key)) continue;
      seen.add(key);
      const audioIds = provider === 'kugou' ? [text(row.SQFileHash), text(row.HQFileHash), track.id].filter(id => /^[A-Fa-f0-9]{32}$/.test(id)) : [track.id];
      if (catalog.size >= 1000) catalog.delete(catalog.keys().next().value!);
      catalog.set(key, { track, audioIds: [...new Set(audioIds)], until: Date.now() + 3600_000 });
    } catch { /* Invalid platform identity. */ }
  }
  return { title: query, query, searchType: 'track', provider, kind: 'search', tracks, total: tracks.length, warnings: [] };
}
export async function myhkTrack(provider: MyhkProvider, id: string): Promise<Track> {
  validateTrackId(provider, id);
  const data = await myhkRequest('info', provider, { id, pic: '1' }, 300_000);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ServiceError('NOT_FOUND', '找不到這首歌曲。', 404);
  const track = mapMyhkTrack(provider, data as Row, id);
  if (!track.title) throw new ServiceError('NOT_FOUND', '找不到這首歌曲。', 404);
  let entry = catalog.get(`${provider}:${id}`);
  if ((!entry || entry.until <= Date.now() || !entry.track.durationMs) && ['qq', 'kuwo', 'kugou'].includes(provider)) {
    // A direct link or a process restart has no search catalog. Recover metadata
    // only by the exact provider ID, never by taking a title's first result.
    await searchMyhk(track.title, provider).catch(() => {});
    entry = catalog.get(`${provider}:${id}`);
  }
  return entry && entry.until > Date.now() ? { ...track, artists: entry.track.artists.length ? entry.track.artists : track.artists,
    album: entry.track.album || track.album, cover: track.cover || entry.track.cover, durationMs: entry.track.durationMs, albumUrl: track.albumUrl || entry.track.albumUrl } : track;
}
export async function resolveMyhk(link: MusicLink): Promise<Collection> {
  if (!isMyhkProvider(link.provider)) throw new ServiceError('UNSUPPORTED_LINK', '不支援此來源。');
  const provider = link.provider;
  if (link.kind === 'track') { const track = await myhkTrack(provider, link.id); return { title: track.title, provider, kind: 'track', tracks: [track], total: 1, warnings: [], sourceUrl: link.url }; }
  const supported = link.kind === 'album' ? ['netease', 'qq', 'kuwo'] : link.kind === 'playlist' ? ['netease', 'qq', 'kuwo', 'kugou'] : [];
  if (!supported.includes(provider)) throw new ServiceError('UNSUPPORTED_LINK', '此來源尚未提供這類合集接口。');
  // Album/list defaults are platform-native nested objects, unlike search.
  const data = rows(await myhkRequest(link.kind === 'album' ? 'album' : 'list', provider, { id: link.id, format: '1', pic: '1' }, 300_000));
  const tracks = data.slice(0, config.maxCollectionTracks).flatMap(row => { try { const track = mapMyhkTrack(provider, row); return [{ ...track, ...(link.kind === 'album' ? { albumUrl: link.url } : {}) }]; } catch { return []; } });
  if (!tracks.length) throw new ServiceError('NOT_FOUND', '找不到這份合集。', 404);
  return { title: link.kind === 'album' ? tracks[0]!.album || '專輯' : '歌單', provider, kind: link.kind, tracks, total: data.length, warnings: [], sourceUrl: link.url };
}
export async function myhkAudio(provider: MyhkProvider, id: string): Promise<{ url: string; extension: string }> {
  validateTrackId(provider, id);
  const entry = catalog.get(`${provider}:${id}`);
  const ids = entry && entry.until > Date.now() ? entry.audioIds : [id];
  let failure: unknown;
  for (const audioId of ids) {
    try {
      const data = await myhkRequest('url', provider, { id: audioId }, 30_000);
      if (typeof data !== 'string' || !/^https?:\/\//.test(data)) throw new ServiceError('NO_AUDIO', '此曲暫無可用音源。', 403);
      const url = validateMyhkAudioUrl(data, provider);
      const extension = /\.(mp3|flac|m4a|aac|ogg|opus)$/i.exec(url.pathname)?.[1]?.toLowerCase() || 'mp3';
      return { url: url.href, extension };
    } catch (error) {
      if (!(error instanceof ServiceError) || !['NO_AUDIO', 'UPSTREAM_ERROR'].includes(error.code)) throw error;
      failure = error;
    }
  }
  throw failure || new ServiceError('NO_AUDIO', '此曲暫無可用音源。', 403);
}
export function validateMyhkAudioUrl(raw: string, provider: MyhkProvider): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ServiceError('INVALID_AUDIO_HOST', '音源地址無效。', 502); }
  const hosts: Record<MyhkProvider, string[]> = { netease: ['music.126.net', 'music.163.com'], qq: ['tc.qq.com', 'qqmusic.qq.com', 'qqmusic.com'], kuwo: ['kuwo.cn'], kugou: ['kugou.com'], migu: ['migu.cn', 'migufun.com'], qianqian: ['dmhmusic.com', 'taihe.com'] };
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port || !hosts[provider].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new ServiceError('INVALID_AUDIO_HOST', '音源地址未通過平台來源檢查。', 502);
  return url;
}
export async function myhkLyrics(provider: MyhkProvider, id: string): Promise<string> {
  validateTrackId(provider, id);
  const data = await myhkRequest('lrc', provider, { id }, 3600_000);
  return typeof data === 'string' ? data.slice(0, 200_000) : '';
}
