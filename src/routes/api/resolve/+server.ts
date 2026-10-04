import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, rateLimit, readInput } from '#lib/server/api.js';
import { resolveMusic } from '#lib/server/music.js';
import { parseMusicLink } from '#lib/server/links.js';
import { combineSearches } from '#lib/server/search.js';
import { searchNetease } from '#lib/server/providers/netease.js';
import { searchSpotify, spotifyMetadataConfigured } from '#lib/server/providers/spotify.js';
import type { RequestHandler } from './$types';

const schema = z.object({ input: z.string().trim().min(1).max(1000), provider: z.enum(['all', 'netease', 'spotify', 'ytm']) });
export const POST: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const data = await readInput(event.request, schema);
    if (data.provider !== 'all' || parseMusicLink(data.input)) return json(await resolveMusic(data.input, data.provider === 'all' ? 'netease' : data.provider));
    const sources = [{ provider: 'netease' as const, search: () => searchNetease(data.input) }];
    const warnings = ['YouTube Music 支援連結獲取；關鍵字搜尋暫未開放。'];
    const searches: Parameters<typeof combineSearches>[1] = [...sources];
    if (spotifyMetadataConfigured()) searches.push({ provider: 'spotify', search: () => searchSpotify(data.input) });
    else warnings.push('Spotify 搜尋尚未配置，貼上單曲連結仍可解析。');
    return json(await combineSearches(data.input, searches, warnings));
  } catch (error) { return apiError(error); }
};
