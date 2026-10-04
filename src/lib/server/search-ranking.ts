import { Converter } from 'opencc-js';
import type { MusicEntity, Track } from '../types.js';

const simplified = Converter({ from: 'tw', to: 'cn' });
const versions = [/(?:\bcover\b|翻唱|翻唱版|カバー)/iu, /(?:\bkaraoke\b|伴奏|卡拉\s*ok)/iu,
  /(?:\binstrumental\b|純音樂|纯音乐)/iu, /(?:\blive\b|現場|现场|演唱會|演唱会)/iu,
  /(?:\bremix\b|混音|重混)/iu];
function normalize(value: string): string {
  const text = value.normalize('NFKC').toLowerCase();
  return /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? text : simplified(text);
}
const compact = (value: string) => normalize(value).replace(/[^\p{L}\p{N}]/gu, '');

// Relevance is evidence from the supplied metadata, never an assertion of
// original authorship or full audio availability. Keep every provider identity.
export function searchRelevance(query: string, item: Track | MusicEntity): number {
  const q = compact(query), title = compact(item.title);
  if (!q || !title) return 0;
  const artistNames = item.artists.map(compact).filter(Boolean);
  let score = title === q ? 1000 : 0;
  let withoutArtists = q;
  for (const artist of artistNames) {
    if (artist.length >= 2 && q.includes(artist)) {
      score += 160;
      withoutArtists = withoutArtists.replaceAll(artist, '');
    } else if (q.length >= 2 && artist.includes(q)) score += 300;
  }
  if (withoutArtists && withoutArtists !== q && title === withoutArtists) score += 1000;
  else if (Math.min(title.length, q.length) >= 2 && (title.includes(q) || q.includes(title))) score += 450;
  const tokens = normalize(query).split(/[^\p{L}\p{N}]+/u).map(compact).filter(Boolean);
  const haystack = title + artistNames.join('');
  if (tokens.length) score += Math.round(300 * tokens.filter(token => haystack.includes(token)).length / tokens.length);
  // Qualifiers only lower an unsolicited version. Explicit "Live" / "cover"
  // searches retain those results. Album names are not used as qualifiers.
  if ('durationMs' in item) for (const version of versions) {
    if (version.test(item.title) && !version.test(query)) score -= 400;
  }
  return score;
}

// Stable identity tie-break avoids assigning the same platform first whenever
// two results have equal relevance and equal upstream rank.
export function searchTie(identity: string): number {
  let hash = 2166136261;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}
