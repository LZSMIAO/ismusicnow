import type { Collection, MusicSearchKind, Provider } from '../types.js';
import { ServiceError } from './errors.js';
import { providerNames } from '../ui.js';

export async function combineSearches(query: string, sources: { provider: Provider; search: () => Promise<Collection> }[], warnings: string[] = [], searchType: MusicSearchKind = 'track'): Promise<Collection> {
  const results = await Promise.allSettled(sources.map((source) => source.search()));
  const collections: Collection[] = [];
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') collections.push(result.value);
    else warnings.push(`${providerNames[sources[i]!.provider]}：${result.reason instanceof ServiceError ? result.reason.message : '暫時無法搜尋。'}`);
  });
  if (!collections.length) throw new ServiceError('SEARCH_UNAVAILABLE', warnings.join(' ') || '暫時無法搜尋，請稍後重試。', 503);
  // Interleave results without replacing or deduplicating independent sources.
  const tracks: Collection['tracks'] = [];
  const entities: NonNullable<Collection['entities']> = [];
  for (let i = 0; i < Math.max(...collections.map((c) => c.tracks.length)); i++) {
    for (const collection of collections) if (collection.tracks[i]) tracks.push(collection.tracks[i]!);
  }
  if (searchType !== 'track') {
    for (let i = 0; i < Math.max(0, ...collections.map(c => c.entities?.length || 0)); i++) {
      for (const collection of collections) if (collection.entities?.[i]) entities.push(collection.entities[i]!);
    }
  }
  return { title: query, kind: 'search', provider: collections[0]!.provider, providers: collections.map((c) => c.provider), tracks,
    query, searchType, ...(searchType !== 'track' ? { entities } : {}),
    total: collections.reduce((sum, c) => sum + c.total, 0), warnings: [...warnings, ...collections.flatMap((c) => c.warnings)] };
}
