import type { Collection, MusicSearchKind, Provider } from '../types.js';
import { ServiceError } from './errors.js';
import { providerNames } from '../ui.js';
import { searchRelevance, searchTie } from './search-ranking.js';

export async function combineSearches(query: string, sources: { provider: Provider; search: () => Promise<Collection> }[], warnings: string[] = [], searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const results = await Promise.allSettled(sources.map((source) => source.search()));
  const collections: Collection[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') collections.push(result.value);
    else warnings.push(`${providerNames[sources[i]!.provider]}：${result.reason instanceof ServiceError ? result.reason.message : '暫時無法搜尋。'}`);
  });
  if (!collections.length) throw new ServiceError('SEARCH_UNAVAILABLE', warnings.join(' ') || '暫時無法搜尋，請稍後重試。', 503);
  const rank = <T extends Collection['tracks'][number] | NonNullable<Collection['entities']>[number]>(items: { item: T; index: number }[]) =>
    items.sort((a, b) => searchRelevance(query, b.item) - searchRelevance(query, a.item) || a.index - b.index ||
      searchTie(`${a.item.provider}:${a.item.id}`) - searchTie(`${b.item.provider}:${b.item.id}`)).map(row => row.item);
  const tracks = rank(collections.flatMap(c => c.tracks.map((item, index) => ({ item, index }))));
  const entities = searchType !== 'track' ? rank(collections.flatMap(c => (c.entities || []).map((item, index) => ({ item, index })))) : [];
  const best = (collection: Collection) => {
    const items = searchType === 'track' ? collection.tracks : collection.entities || [];
    return Math.max(-Infinity, ...items.map(item => searchRelevance(query, item)));
  };
  const rankedCollections = [...collections].sort((a, b) => best(b) - best(a) || searchTie(`${query}:${a.provider}`) - searchTie(`${query}:${b.provider}`));
  return { title: query, kind: 'search', provider: rankedCollections[0]!.provider, providers: rankedCollections.map((c) => c.provider), tracks,
    query, searchType, ...(searchType !== 'track' ? { entities } : {}),
    total: collections.reduce((sum, c) => sum + c.total, 0), warnings: [...warnings, ...collections.flatMap((c) => c.warnings)] };
}
