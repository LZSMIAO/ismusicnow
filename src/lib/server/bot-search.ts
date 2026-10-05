import { Converter } from 'opencc-js';
import type { Collection, MusicSearchKind, Provider } from '../types.js';
import { ServiceError } from './errors.js';
import { parseMusicLink } from './links.js';
import { resolveMusic } from './music.js';
import { combineSearches } from './search.js';
import { isMyhkProvider } from './providers/myhk.js';
import { botProviders, searchableProviders } from './bot-providers.js';

export type BotSource = Provider | 'all';
const toSimplified = Converter({ from: 'tw', to: 'cn' });
export function searchText(input: string, provider: Provider): string {
  return isMyhkProvider(provider) && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(input) ? toSimplified(input) : input;
}
async function bounded<T>(value: Promise<T>, timeout: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([value, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ServiceError('UPSTREAM_TIMEOUT', 'Music search timeout')), timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
// All generic commands share this route. Platform links remain authoritative;
// YTM supports links, and is never used as a substitute for Spotify audio.
export async function resolveBotMusic(input: string, source: BotSource = 'all', kind: MusicSearchKind = 'track',
  resolver = resolveMusic, timeout = 4500): Promise<Collection> {
  let text = input.trim();
  const prefix = /^(\S+)\s+/.exec(text);
  if (prefix && ['all', ...botProviders.map(provider => provider.id)].includes(prefix[1]!.toLowerCase())) {
    source = prefix[1]!.toLowerCase() as BotSource; text = text.slice(prefix[0].length).trim();
  }
  const link = parseMusicLink(text);
  if (link) return resolver(text, link.provider, kind);
  if (!text) throw new ServiceError('INVALID_INPUT', 'Empty music search');
  if (source !== 'all') {
    const value = await bounded(resolver(searchText(text, source), source, kind), timeout);
    return { ...value, query: text, searchScope: source };
  }
  const value = await combineSearches(text, searchableProviders(kind).map(({ id: provider }) => ({ provider,
    search: () => bounded(resolver(searchText(text, provider), provider, kind), timeout),
  })), [], kind);
  return { ...value, query: text, searchScope: 'all' };
}
