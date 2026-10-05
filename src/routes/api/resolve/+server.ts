import { providerIds } from '#lib/types.js';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, rateLimit, readInput } from '#lib/server/api.js';
import { resolveMusic } from '#lib/server/music.js';
import { parseMusicLink } from '#lib/server/links.js';
import { combineSearches } from '#lib/server/search.js';
import { searchPublic } from '#lib/server/providers/public-audio.js';
import { searchYtm } from '#lib/server/providers/ytm.js';
import { searchNetease } from '#lib/server/providers/netease.js';
import { myhkConfigured, myhkSources, searchMyhk } from '#lib/server/providers/myhk.js';
import { searchSpotify, spotifyMetadataConfigured } from '#lib/server/providers/spotify.js';
import type { RequestHandler } from './$types';

const schema = z.object({ input: z.string().trim().min(1).max(1000), provider: z.enum(['all', ...providerIds]), searchType: z.enum(['track', 'artist']).default('track') });
export const POST: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const data = await readInput(event.request, schema);
    if (data.provider !== 'all' || parseMusicLink(data.input)) return json(await resolveMusic(data.input, data.provider === 'all' ? 'netease' : data.provider, data.searchType));
    const sources: Parameters<typeof combineSearches>[1] = [{ provider: 'netease', search: () => searchNetease(data.input, data.searchType) }];
    const warnings: string[] = [];
    if (data.searchType === 'track' && myhkConfigured()) for (const provider of Object.keys(myhkSources).filter(id => id !== 'netease') as (keyof typeof myhkSources)[]) sources.push({ provider, search: () => searchMyhk(data.input, provider) });
    const searches: Parameters<typeof combineSearches>[1] = [...sources];
    searches.push({ provider: 'ytm', search: () => searchYtm(data.input, data.searchType) });
    if (data.searchType === 'track') for (const provider of ['soundcloud', 'bilibili'] as const) searches.push({ provider, search: () => searchPublic(provider, data.input) });
    if (spotifyMetadataConfigured()) searches.push({ provider: 'spotify', search: () => searchSpotify(data.input, data.searchType) });
    else warnings.push('Spotify 搜尋尚未配置，貼上單曲連結仍可解析。');
    return json(await combineSearches(data.input, searches, warnings, data.searchType));
  } catch (error) { return apiError(error); }
};
