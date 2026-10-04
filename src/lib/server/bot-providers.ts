import type { MusicSearchKind, Provider } from '../types.js';

// Add a provider's implemented capabilities here when its adapter is connected.
// Link-only adapters must not appear in the keyword-search source filter.
export const botProviders: readonly { id: Provider; name: string; search: readonly MusicSearchKind[] }[] = [
  { id: 'netease', name: 'NetEase', search: ['track', 'album', 'artist', 'playlist'] },
  { id: 'spotify', name: 'Spotify', search: ['track', 'album', 'artist', 'playlist'] },
  { id: 'ytm', name: 'YTM', search: [] },
];
export const searchableProviders = (kind: MusicSearchKind) => botProviders.filter(provider => provider.search.includes(kind));
export const botProviderName = (id: Provider) => botProviders.find(provider => provider.id === id)?.name || id;
