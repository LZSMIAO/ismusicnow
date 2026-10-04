import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, rateLimit, readInput } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { trackLyrics } from '#lib/server/lyrics.js';
import type { RequestHandler } from './$types';
const schema = z.object({ provider: z.enum(['netease', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili']), id: z.string().max(225), title: z.string().min(1).max(500), artists: z.array(z.string().max(200)).max(20), album: z.string().max(500), durationMs: z.number().min(0).max(86400000) });
export const POST: RequestHandler = async (event) => {
  try { rateLimit(event); const track = await readInput(event.request, schema); validateTrackId(track.provider, track.id); return json(await trackLyrics(track)); }
  catch (error) { return apiError(error); }
};
