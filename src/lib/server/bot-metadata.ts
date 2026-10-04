import { Converter } from 'opencc-js';
import type { Track } from '../types.js';
import { neteaseRequest } from './providers/netease.js';

interface Artist { name?: string; alias?: string[]; identifyTag?: string[]; briefDesc?: string }
const artists = new Map<string, { expires: number; value: Promise<Artist | undefined> }>();
const toSimplified = Converter({ from: 'tw', to: 'cn' });

export function artistLanguage(artist: Artist): string | undefined {
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(artist.name || '')) return 'ja';
  if (/\p{Script=Hangul}/u.test(artist.name || '')) return 'ko';
  const description = [...(artist.identifyTag || []), (artist.briefDesc || '').slice(0, 160)].join(' ');
  if (/(華語|华语|台灣|台湾|中國|中国|香港).{0,25}(歌手|樂團|乐团|音樂人|音乐人)/.test(description)) return 'zh';
  if (/日本.{0,25}(歌手|音樂人|音乐人|作曲|樂隊|乐队)/.test(description)) return 'ja';
  if (/(韓國|韩国).{0,25}(歌手|音樂人|音乐人|組合|组合)/.test(description)) return 'ko';
  return undefined;
}
export function artistDisplayName(original: string, artist: Artist): string {
  // Use a native-script spelling supplied by the source only when it is the
  // same name. Nicknames/translated aliases must never replace an artist.
  if (artistLanguage(artist) !== 'ja') return original;
  return [artist.name || '', ...(artist.alias || [])].find((name) => name && name !== original && toSimplified(name) === toSimplified(original)) || original;
}
async function artistDetails(id: string): Promise<Artist | undefined> {
  if (!/^\d{1,16}$/.test(id)) return undefined;
  let cached = artists.get(id);
  if (!cached || cached.expires < Date.now()) {
    if (artists.size > 500) artists.clear();
    const value = neteaseRequest('artist_detail', { id }).then((body) => (body as unknown as { data?: { artist?: Artist } }).data?.artist).catch(() => undefined);
    cached = { expires: Date.now() + 6 * 60 * 60_000, value }; artists.set(id, cached);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([cached.value, new Promise<undefined>((done) => { timer = setTimeout(() => done(undefined), 2500); })]); }
  finally { if (timer) clearTimeout(timer); }
}
export async function metadataForDisplay(track: Track): Promise<Track> {
  if (track.provider !== 'netease' || !track.artistIds?.length) return track;
  const details = await Promise.all(track.artistIds.slice(0, 8).map(artistDetails));
  return { ...track, artists: track.artists.map((name, i) => details[i] ? artistDisplayName(name, details[i]!) : name),
    metadataLanguages: { ...track.metadataLanguages, artists: track.artists.map((_name, i) => track.metadataLanguages?.artists?.[i] || (details[i] ? artistLanguage(details[i]!) : undefined) || 'und') } };
}
