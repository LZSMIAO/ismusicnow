import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, rateLimit, readInput } from '#lib/server/api.js';
import { resolveMusic } from '#lib/server/music.js';
import { parseMusicLink } from '#lib/server/links.js';
import { combineSearches } from '#lib/server/search.js';
import { searchPublic } from '#lib/server/providers/public-audio.js';
import { searchNetease } from '#lib/server/providers/netease.js';
import { searchSpotify, spotifyMetadataConfigured } from '#lib/server/providers/spotify.js';
import type { RequestHandler } from './$types';

const schema = z.object({ input: z.string().trim().min(1).max(1000), provider: z.enum(['all', 'netease', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili']), searchType: z.enum(['track', 'artist']).default('track') });
export const POST: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const data = await readInput(event.request, schema);
    if (data.provider !== 'all' || parseMusicLink(data.input)) return json(await resolveMusic(data.input, data.provider === 'all' ? 'netease' : data.provider, data.searchType));
    const sources = [{ provider: 'netease' as const, search: () => searchNetease(data.input, data.searchType) }];
    const warnings = ['YouTube Music 支援連結獲取；關鍵字搜尋暫未開放。'];
    const searches: Parameters<typeof combineSearches>[1] = [...sources];
    if (data.searchType === 'track') for (const provider of ['soundcloud', 'bilibili'] as const) searches.push({ provider, search: () => searchPublic(provider, data.input) });
    if (spotifyMetadataConfigured()) searches.push({ provider: 'spotify', search: () => searchSpotify(data.input, data.searchType) });
    else warnings.push('Spotify 搜尋尚未配置，貼上單曲連結仍可解析。');
    return json(await combineSearches(data.input, searches, warnings, data.searchType));
  } catch (error) { return apiError(error); }
};
