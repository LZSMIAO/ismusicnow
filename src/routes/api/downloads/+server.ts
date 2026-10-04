import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { downloads } from '#lib/server/downloads.js';
import { getTrack } from '#lib/server/music.js';
import { apiError, readInput, rateLimit } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  try { return json(await downloads.list(locals.sessionId)); } catch (error) { return apiError(error); }
};
const schema = z.object({ tracks: z.array(z.object({ provider: z.enum(['netease', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili']), id: z.string().max(225) })).min(1).max(20), format: z.enum(['original', 'mp3', 'flac']) });
export const POST: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const body = await readInput(event.request, schema);
    const tracks = [];
    // Re-resolve authoritative metadata: never trust a submitted source URL or filename.
    for (const item of body.tracks) tracks.push(await getTrack(item.provider, item.id));
    return json(await downloads.create(event.locals.sessionId, tracks, body.format), { status: 202 });
  } catch (error) { return apiError(error); }
};
export const DELETE: RequestHandler = async ({ locals }) => {
  try { await downloads.clear(locals.sessionId); return json({ ok: true }); } catch (error) { return apiError(error); }
};
