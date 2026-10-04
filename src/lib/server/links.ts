import type { Provider } from '../types.js';
import { ServiceError } from './errors.js';

export interface MusicLink { provider: Provider; kind: 'track' | 'album' | 'playlist'; id: string; url: string }

export function parseMusicLink(input: string): MusicLink | null {
  const value = input.trim();
  const uri = /^spotify:(track|album|playlist):([a-zA-Z0-9]{22})$/.exec(value);
  if (uri) return { provider: 'spotify', kind: uri[1] as MusicLink['kind'], id: uri[2]!, url: `https://open.spotify.com/${uri[1]}/${uri[2]}` };
  const raw = value.match(/https?:\/\/[^\s<>]+/)?.[0];
  if (!raw) {
    if (/^\d{1,16}$/.test(value)) return { provider: 'netease', kind: 'track', id: value, url: `https://music.163.com/song?id=${value}` };
    return null;
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new ServiceError('INVALID_URL', '這個連結格式不完整。'); }
  if (url.username || url.password || url.port) throw new ServiceError('INVALID_URL', '請使用平台的原始分享連結。');
  if (url.hostname === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
    if (!match) throw new ServiceError('UNSUPPORTED_LINK', 'Spotify 支援歌曲、專輯及公開歌單連結。');
    return { provider: 'spotify', kind: match[1] as MusicLink['kind'], id: match[2]!, url: `https://open.spotify.com/${match[1]}/${match[2]}` };
  }
  if (['music.163.com', 'y.music.163.com'].includes(url.hostname)) {
    const fragment = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
    const match = /^\/(?:m\/)?(song|album|playlist)\/?$/.exec(fragment.pathname);
    const id = fragment.searchParams.get('id');
    if (!match || !id || !/^\d{1,16}$/.test(id)) throw new ServiceError('UNSUPPORTED_LINK', '網易雲支援歌曲、專輯及歌單連結，請確認連結含有 id。');
    const kind = match[1] === 'song' ? 'track' : match[1] as MusicLink['kind'];
    return { provider: 'netease', kind, id, url: `https://music.163.com/${match[1]}?id=${id}` };
  }
  if (url.hostname === 'music.youtube.com') {
    const video = url.searchParams.get('v');
    const playlist = url.searchParams.get('list');
    if (url.pathname === '/watch' && video && /^[a-zA-Z0-9_-]{11}$/.test(video)) {
      return { provider: 'ytm', kind: 'track', id: video, url: `https://music.youtube.com/watch?v=${video}` };
    }
    if (url.pathname === '/playlist' && playlist && /^[a-zA-Z0-9_-]{10,100}$/.test(playlist)) {
      return { provider: 'ytm', kind: 'playlist', id: playlist, url: `https://music.youtube.com/playlist?list=${playlist}` };
    }
    throw new ServiceError('UNSUPPORTED_LINK', 'YTM 支援 YouTube Music 歌曲與歌單連結。');
  }
  if (['spotify.link', '163cn.tv'].includes(url.hostname)) throw new ServiceError('SHORT_LINK', '請在平台打開短連結，再複製完整的歌曲、專輯或歌單網址。');
  throw new ServiceError('UNSUPPORTED_HOST', '目前支援網易雲音樂、Spotify 與 YouTube Music 的分享連結。');
}

export function validateTrackId(provider: Provider, id: string): void {
  const pattern = provider === 'spotify' ? /^[a-zA-Z0-9]{22}$/ : provider === 'ytm' ? /^[a-zA-Z0-9_-]{11}$/ : /^\d{1,16}$/;
  if (!pattern.test(id)) {
    throw new ServiceError('INVALID_TRACK', '曲目識別碼無效，請重新解析連結。');
  }
}

export function safeFilename(name: string): string {
  return name.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/\.+/g, '.').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100) || 'ismusicnow';
}
