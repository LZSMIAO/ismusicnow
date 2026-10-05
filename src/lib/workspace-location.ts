import { providerIds, type Provider, type SearchSource } from './types.js';
export type WorkspaceView = 'home' | 'search' | 'track' | 'album' | 'artist' | 'playlist' | 'guide' | 'downloads';
export interface WorkspaceLocation { view: WorkspaceView; provider: SearchSource; resource: string; query: string; lyrics?: string; lyricResource?: string }
export function isWorkspacePath(path: string): boolean { return path === '/' || /^\/(?:search|guide|downloads)$/.test(path) || /^\/(?:song|album|artist|playlist|lyrics)\/[^/]+\/.+/.test(path); }
export function sourceResource(provider: Provider, kind: string, id: string): string {
  const encoded = encodeURIComponent(id), track = kind === 'track' || kind === 'lyrics';
  if (provider === 'netease') return `https://music.163.com/${track ? 'song' : kind}?id=${encoded}`;
  if (provider === 'spotify') return `https://open.spotify.com/${track ? 'track' : kind}/${encoded}`;
  if (provider === 'qq') return `https://y.qq.com/n/ryqq/${track?'songDetail':kind==='album'?'albumDetail':'playlist'}/${encoded}`;
  if (provider === 'kuwo') return `https://www.kuwo.cn/${track?'play_detail':kind==='album'?'album_detail':'playlist_detail'}/${encoded}`;
  if (provider === 'kugou') return kind==='playlist'?`https://www.kugou.com/yy/special/single/${encoded}.html`:`https://www.kugou.com/song/#hash=${encoded}`;
  if (provider === 'migu') return `https://music.migu.cn/v3/music/song/${encoded}`;
  if (provider === 'qianqian') return `https://music.91q.com/song/${encoded}`;
  if (provider === 'ytm') return track?`https://music.youtube.com/watch?v=${encoded}`:kind==='playlist'?`https://music.youtube.com/playlist?list=${encoded}`:`https://music.youtube.com/browse/${encoded}`;
  if (provider === 'soundcloud') return id.startsWith('/')?`https://soundcloud.com${id}`:`https://api.soundcloud.com/tracks/${encoded}`;
  if (provider === 'bilibili') return `https://www.bilibili.com/video/${encoded}`;
  const [artist, slug] = id.split('~'); return `https://${artist}.bandcamp.com/${track?'track':'album'}/${slug}`;
}
function resourceId(provider: SearchSource, resource: string): string {
  if (/^\d+$/.test(resource)) return resource;
  const uri=/^spotify:(?:track|album|artist|playlist):([A-Za-z0-9]{22})$/.exec(resource); if(uri)return uri[1]!;
  try {
    const url = new URL(resource);
    if (provider==='netease') { const target=url.hash.startsWith('#/')?new URL(url.hash.slice(1),url.origin):url; return target.searchParams.get('id') || ''; }
    if (provider==='ytm') return url.searchParams.get('v') || url.searchParams.get('list') || url.pathname.split('/').filter(Boolean).at(-1) || '';
    if (provider==='kugou') return url.searchParams.get('hash') || new URLSearchParams(url.hash.slice(1)).get('hash') || /\/(\d+)\.html/.exec(url.pathname)?.[1] || '';
    if (provider==='soundcloud') return url.hostname==='api.soundcloud.com'?url.pathname.split('/').at(-1)!:url.pathname;
    if (provider==='bandcamp') return `${url.hostname.split('.')[0]}~${url.pathname.split('/').filter(Boolean).at(-1)}`;
    return url.searchParams.get('songmid') || url.pathname.split('/').filter(Boolean).at(-1)?.replace(/\.html$/,'') || '';
  } catch { return ''; }
}
export function workspaceUrl(state: WorkspaceLocation): string {
  if (state.lyrics) { const separator=state.lyrics.indexOf(':'); return `/lyrics/${state.lyrics.slice(0,separator)}/${encodeURIComponent(state.lyrics.slice(separator+1))}`; }
  if (state.view==='guide'||state.view==='downloads') return `/${state.view}`;
  if (state.view==='home') return '/';
  if (state.view==='search') { const p=new URLSearchParams({q:state.query||state.resource}); if(state.provider!=='all')p.set('source',state.provider); return `/search?${p}`; }
  const id=resourceId(state.provider,state.resource);
  return id?`/${state.view==='track'?'song':state.view}/${state.provider}/${encodeURIComponent(id)}`:'/';
}
export function readWorkspaceLocation(url: URL): WorkspaceLocation {
  const p=url.searchParams, parts=url.pathname.split('/').filter(Boolean), provider=p.get('source') || parts[1] || 'all';
  const source:SearchSource=provider==='all'||providerIds.includes(provider as Provider)?provider as SearchSource:'all';
  if(parts[0]==='search')return {view:'search',provider:source,resource:(p.get('q')||'').slice(0,1000),query:(p.get('q')||'').slice(0,1000)};
  if(parts[0]==='guide'||parts[0]==='downloads')return {view:parts[0],provider:source,resource:'',query:''};
  if(['song','album','artist','playlist','lyrics'].includes(parts[0]||'')&&source!=='all'&&parts.length===3){
    const id=decodeURIComponent(parts[2]!), kind=parts[0]==='song'||parts[0]==='lyrics'?'track':parts[0]!;
    const resource=sourceResource(source,kind,id);
    return {view:kind as WorkspaceView,provider:source,resource,query:'',...(parts[0]==='lyrics'?{lyrics:`${source}:${id}`,lyricResource:resource}:{})};
  }
  // Old links remain readable; all new navigation emits concise paths.
  const view=p.get('view') as WorkspaceView;
  return {view:['search','track','album','artist','playlist','guide','downloads'].includes(view)?view:'home',provider:source,resource:(p.get('resource')||'').slice(0,1000),query:(p.get('q')??p.get('resource')??'').slice(0,1000),lyrics:p.get('lyrics')||undefined,lyricResource:p.get('lyric-resource')||undefined};
}
