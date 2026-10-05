import type { Provider } from '../types.js';
import { ServiceError } from './errors.js';

export interface MusicLink { provider: Provider; kind: 'track' | 'album' | 'playlist' | 'artist'; id: string; url: string }

export function musicSourceUrl(provider: Provider, kind: MusicLink['kind'], id: string): string {
  if (provider === 'netease') { validateTrackId(provider, id); return `https://music.163.com/${kind === 'track' ? 'song' : kind}?id=${id}`; }
  if (provider === 'spotify') { validateTrackId(provider, id); return `https://open.spotify.com/${kind}/${id}`; }
  if (provider === 'qq') {
    if (kind === 'playlist' ? !/^\d{1,16}$/.test(id) : !/^[A-Za-z0-9]{14}$/.test(id)) throw new ServiceError('INVALID_TRACK', 'QQ 音樂識別碼無效。');
    return `https://y.qq.com/n/ryqq/${kind === 'track' ? 'songDetail' : kind === 'album' ? 'albumDetail' : kind === 'playlist' ? 'playlist' : 'singer'}/${id}`;
  }
  if (provider === 'kuwo') { validateTrackId(provider, id); return `https://www.kuwo.cn/${kind === 'track' ? 'play_detail' : kind === 'album' ? 'album_detail' : 'playlist_detail'}/${id}`; }
  if (provider === 'kugou') {
    if (kind === 'playlist') { if (!/^\d{1,16}$/.test(id)) throw new ServiceError('INVALID_TRACK', '酷狗歌單識別碼無效。'); return `https://www.kugou.com/yy/special/single/${id}.html`; }
    validateTrackId(provider, id); return `https://www.kugou.com/song/#hash=${id}`;
  }
  if (provider === 'migu') { validateTrackId(provider, id); return `https://music.migu.cn/v3/music/song/${id}`; }
  if (provider === 'qianqian') { validateTrackId(provider, id); return `https://music.91q.com/song/${id}`; }
  throw new ServiceError('UNSUPPORTED_LINK', '此來源不支援這類連結。');
}

export function parseMusicLink(input: string): MusicLink | null {
  const value = input.trim();
  const uri = /^spotify:(track|album|playlist|artist):([a-zA-Z0-9]{22})$/.exec(value);
  if (uri) return { provider: 'spotify', kind: uri[1] as MusicLink['kind'], id: uri[2]!, url: `https://open.spotify.com/${uri[1]}/${uri[2]}` };
  const raw = value.match(/https?:\/\/[^\s<>]+/)?.[0];
  if (!raw) {
    if (/^\d{1,16}$/.test(value)) return { provider: 'netease', kind: 'track', id: value, url: `https://music.163.com/song?id=${value}` };
    return null;
  }
  let url: URL;
  try { url = new URL(raw); } catch { throw new ServiceError('INVALID_URL', '這個連結格式不完整。'); }
  if (url.username || url.password || url.port) throw new ServiceError('INVALID_URL', '請使用平台的原始分享連結。');
  let chinese: { provider: Provider; kind: MusicLink['kind']; id: string } | undefined;
  if (url.hostname === 'y.qq.com') {
    const path = /^\/n\/ryqq\/(songDetail|albumDetail|playlist)\/([A-Za-z0-9]+)\/?$/.exec(url.pathname);
    const old = /^\/n\/yqq\/(song|album)\/([A-Za-z0-9]+)\.html$/.exec(url.pathname);
    if (path) chinese = { provider: 'qq', kind: path[1] === 'songDetail' ? 'track' : path[1] === 'albumDetail' ? 'album' : 'playlist', id: path[2]! };
    else if (old) chinese = { provider: 'qq', kind: old[1] === 'song' ? 'track' : 'album', id: old[2]! };
    else if (url.searchParams.get('songmid')) chinese = { provider: 'qq', kind: 'track', id: url.searchParams.get('songmid')! };
  }
  if (['www.kuwo.cn', 'kuwo.cn'].includes(url.hostname)) {
    const match = /^\/(play_detail|album_detail|playlist_detail)\/(\d{1,16})\/?$/.exec(url.pathname);
    if (match) chinese = { provider: 'kuwo', kind: match[1] === 'play_detail' ? 'track' : match[1] === 'album_detail' ? 'album' : 'playlist', id: match[2]! };
  }
  if (['www.kugou.com', 'kugou.com'].includes(url.hostname)) {
    const hash = url.searchParams.get('hash') || new URLSearchParams(url.hash.replace(/^#/, '')).get('hash');
    const list = /^\/yy\/special\/single\/(\d{1,16})\.html$/.exec(url.pathname);
    if (hash) chinese = { provider: 'kugou', kind: 'track', id: hash };
    else if (list) chinese = { provider: 'kugou', kind: 'playlist', id: list[1]! };
  }
  if (url.hostname === 'music.migu.cn') { const match = /^\/v3\/music\/song\/([A-Za-z0-9]{1,32})\/?$/.exec(url.pathname); if (match) chinese = { provider: 'migu', kind: 'track', id: match[1]! }; }
  if (['music.91q.com', 'music.taihe.com'].includes(url.hostname)) { const match = /^\/song\/(T?\d{1,20})\/?$/.exec(url.pathname); if (match) chinese = { provider: 'qianqian', kind: 'track', id: match[1]! }; }
  if (chinese) return { ...chinese, url: musicSourceUrl(chinese.provider, chinese.kind, chinese.id) };
  if (url.hostname === 'open.spotify.com') {
    const match = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|artist)\/([a-zA-Z0-9]{22})\/?$/.exec(url.pathname);
    if (!match) throw new ServiceError('UNSUPPORTED_LINK', 'Spotify 支援歌曲、專輯、藝術家及公開歌單連結。');
    return { provider: 'spotify', kind: match[1] as MusicLink['kind'], id: match[2]!, url: `https://open.spotify.com/${match[1]}/${match[2]}` };
  }
  if (['music.163.com', 'y.music.163.com'].includes(url.hostname)) {
    const fragment = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : url;
    const match = /^\/(?:m\/)?(song|album|playlist|artist)\/?$/.exec(fragment.pathname);
    const id = fragment.searchParams.get('id');
    if (!match || !id || !/^\d{1,16}$/.test(id)) throw new ServiceError('UNSUPPORTED_LINK', '網易雲支援歌曲、專輯、藝術家及歌單連結，請確認連結含有 id。');
    const kind = match[1] === 'song' ? 'track' : match[1] as MusicLink['kind'];
    return { provider: 'netease', kind, id, url: `https://music.163.com/${match[1]}?id=${id}` };
  }
  if (url.hostname === 'music.youtube.com') {
    const browse = /^\/(?:browse|channel)\/(UC[a-zA-Z0-9_-]{22}|MPREb_[a-zA-Z0-9_-]{1,94})\/?$/.exec(url.pathname);
    if (browse) return { provider: 'ytm', kind: browse[1]!.startsWith('UC') ? 'artist' : 'album', id: browse[1]!, url: `https://music.youtube.com/browse/${browse[1]}` };
    const video = url.searchParams.get('v');
    const playlist = url.searchParams.get('list');
    if (url.pathname === '/watch' && video && /^[a-zA-Z0-9_-]{11}$/.test(video)) {
      return { provider: 'ytm', kind: 'track', id: video, url: `https://music.youtube.com/watch?v=${video}` };
    }
    if (url.pathname === '/playlist' && playlist && /^[a-zA-Z0-9_-]{10,100}$/.test(playlist)) {
      return { provider: 'ytm', kind: 'playlist', id: playlist, url: `https://music.youtube.com/playlist?list=${playlist}` };
    }
    throw new ServiceError('UNSUPPORTED_LINK', 'YTM 支援歌曲、歌單、專輯與藝術家連結。');
  }
  if (['soundcloud.com', 'www.soundcloud.com'].includes(url.hostname)) {
    const path = url.pathname.replace(/\/$/, '');
    if (!/^\/[a-zA-Z0-9_-]+\/(?:sets\/)?[a-zA-Z0-9_-]+$/.test(path)) throw new ServiceError('UNSUPPORTED_LINK', 'SoundCloud 支援公開歌曲及 sets 歌單連結。');
    return { provider: 'soundcloud', kind: path.includes('/sets/') ? 'playlist' : 'track', id: path, url: `https://soundcloud.com${path}` };
  }
  if (url.hostname === 'api.soundcloud.com' && /^\/tracks\/\d{1,16}$/.test(url.pathname)) return { provider: 'soundcloud', kind: 'track', id: url.pathname.split('/')[2]!, url: `https://api.soundcloud.com${url.pathname}` };
  if (['www.bilibili.com', 'bilibili.com'].includes(url.hostname)) {
    const match = /^\/video\/(BV[a-zA-Z0-9]{10})\/?$/.exec(url.pathname);
    if (!match) throw new ServiceError('UNSUPPORTED_LINK', 'Bilibili 請使用含 BV 識別碼的完整影片連結。');
    return { provider: 'bilibili', kind: 'track', id: match[1]!, url: `https://www.bilibili.com/video/${match[1]}` };
  }
  const bandcampHost = /^([a-z0-9][a-z0-9-]{0,62})\.bandcamp\.com$/.exec(url.hostname);
  if (bandcampHost) {
    const match = /^\/(track|album)\/([a-z0-9][a-z0-9-]{0,160})\/?$/.exec(url.pathname);
    if (!match) throw new ServiceError('UNSUPPORTED_LINK', 'Bandcamp 支援藝術家頁面的歌曲及專輯連結。');
    return { provider: 'bandcamp', kind: match[1] === 'track' ? 'track' : 'album', id: `${bandcampHost[1]}~${match[2]}`, url: `https://${url.hostname}/${match[1]}/${match[2]}` };
  }
  if (['spotify.link', '163cn.tv'].includes(url.hostname)) throw new ServiceError('SHORT_LINK', '請在平台打開短連結，再複製完整的歌曲、專輯或歌單網址。');
  throw new ServiceError('UNSUPPORTED_HOST', '請使用已支援音樂平台的完整歌曲、專輯或歌單連結。');
}

export function validateTrackId(provider: Provider, id: string): void {
  const pattern = provider === 'qq' ? /^[A-Za-z0-9]{14}$/ : provider === 'kugou' ? /^[A-Fa-f0-9]{32}$/ : provider === 'migu' ? /^[A-Za-z0-9]{1,32}$/ : provider === 'qianqian' ? /^T?\d{1,20}$/ : provider === 'spotify' ? /^[a-zA-Z0-9]{22}$/ : provider === 'ytm' ? /^[a-zA-Z0-9_-]{11}$/ : provider === 'bilibili' ? /^BV[a-zA-Z0-9]{10}$/ : provider === 'bandcamp' ? /^[a-z0-9][a-z0-9-]{0,62}~[a-z0-9][a-z0-9-]{0,160}$/ : /^\d{1,16}$/;
  if (!pattern.test(id)) {
    throw new ServiceError('INVALID_TRACK', '曲目識別碼無效，請重新解析連結。');
  }
}

export function safeFilename(name: string): string {
  return name.normalize('NFKC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/\.+/g, '.').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 100) || 'ismusicnow';
}
