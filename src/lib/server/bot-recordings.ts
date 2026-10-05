import { createHash } from 'node:crypto';
import { Converter } from 'opencc-js';
import type { Collection, Track } from '../types.js';

export interface SourceEvidence {
  availability?: 'complete' | 'unavailable';
  lossless?: boolean; codec?: string; bitrate?: number; sampleRate?: number; bitsPerSample?: number;
  cached?: boolean;
}
export interface RecordingGroup { tracks: Track[] }
export const trackIdentity = (track: Pick<Track, 'provider' | 'id'>) => `${track.provider}:${track.id}`;
const toSimplified = Converter({ from: 'tw', to: 'cn' });
function normalize(value: string, language?: string): string {
  let text = value.normalize('NFKC').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) && (!language || /^zh(-|$)/i.test(language))) text = toSimplified(text);
  return text;
}
const artists = (track: Track) => track.artists.map((name, index) => normalize(name, track.metadataLanguages?.artists?.[index])).sort();
const isrc = (track: Track) => /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc || '') ? track.isrc : undefined;
export function sameRecording(a: Track, b: Track): boolean {
  if (a.provider === b.provider) return a.id === b.id;
  // Titles include version qualifiers. Never strip Live, Remix, remaster, etc.
  if (!a.title.trim() || normalize(a.title, a.metadataLanguages?.title) !== normalize(b.title, b.metadataLanguages?.title)) return false;
  const aa = artists(a), bb = artists(b);
  if (!aa.length || aa.some(name => !name) || JSON.stringify(aa) !== JSON.stringify(bb)) return false;
  if (!Number.isFinite(a.durationMs) || !Number.isFinite(b.durationMs) || !(a.durationMs > 0 && b.durationMs > 0) || Math.abs(a.durationMs - b.durationMs) > 1000) return false;
  const ai = isrc(a), bi = isrc(b);
  if (ai && bi) return ai === bi;
  // Missing recording identifiers need a matching release, not just a name.
  return !!a.album.trim() && normalize(a.album, a.metadataLanguages?.album) === normalize(b.album, b.metadataLanguages?.album);
}
export function recordingGroups(collection: Collection): RecordingGroup[] {
  // Album/playlist order is authoritative; only search results are coalesced.
  if (collection.kind !== 'search') return collection.tracks.map(track => ({ tracks: [track] }));
  const groups: RecordingGroup[] = [], seen = new Set<string>();
  for (const track of collection.tracks) {
    if (seen.has(trackIdentity(track))) continue;
    seen.add(trackIdentity(track));
    // Complete-link matching prevents a 0s→1s→2s chain from merging recordings.
    const group = groups.find(group => group.tracks.every(existing => sameRecording(existing, track)));
    if (group) group.tracks.push(track); else groups.push({ tracks: [track] });
  }
  return groups;
}
function priority(track: Track, evidence: ReadonlyMap<string, SourceEvidence>): number[] {
  const info = evidence.get(trackIdentity(track));
  return [info?.availability === 'complete' ? 2 : info?.availability === 'unavailable' ? 0 : 1,
    info?.lossless === true ? 2 : info?.lossless === false ? 1 : 0,
    info?.lossless ? info.bitsPerSample || 0 : 0, info?.lossless ? info.sampleRate || 0 : 0];
}
export function rankedSources(group: RecordingGroup, evidence: ReadonlyMap<string, SourceEvidence> = new Map()): Track[] {
  return [...group.tracks].sort((a, b) => {
    const ap = priority(a, evidence), bp = priority(b, evidence);
    for (let i = 0; i < ap.length; i++) if (ap[i] !== bp[i]) return bp[i]! - ap[i]!;
    const ae = evidence.get(trackIdentity(a)), be = evidence.get(trackIdentity(b));
    if (ae?.lossless === false && be?.lossless === false && ae.codec && ae.codec === be.codec && ae.bitrate && be.bitrate && ae.bitrate !== be.bitrate) return be.bitrate - ae.bitrate;
    if (!!ae?.cached !== !!be?.cached) return be?.cached ? 1 : -1;
    // An identity-derived tie break is stable and has no fixed platform order.
    const tie = (track: Track) => createHash('sha256').update(trackIdentity(track)).digest('hex');
    return tie(a).localeCompare(tie(b));
  });
}
export const sourceFallbackAllowed = (error: unknown): boolean => !!error && typeof error === 'object' &&
  'code' in error && ['NO_AUDIO', 'PREVIEW_ONLY', 'INCOMPLETE_AUDIO', 'LOSSLESS_UNAVAILABLE', 'SPOTIFY_COOKIES', 'ACCOUNT_REQUIRED', 'TOOL_MISSING', 'UPSTREAM_ERROR', 'AUDIO_UNAVAILABLE', 'INVALID_AUDIO', 'INVALID_AUDIO_HOST'].includes(String(error.code));
