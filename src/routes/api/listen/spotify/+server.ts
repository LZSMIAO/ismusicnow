import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, readInput, rateLimit } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { clientAddress } from '#lib/server/client-address.js';
import { startSpotifyListen } from '#lib/server/spotify-listen.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async event => {
  try {
    rateLimit(event); const { id } = await readInput(event.request, z.object({ id: z.string().length(22) })); validateTrackId('spotify', id);
    return json(await startSpotifyListen(clientAddress(event), id, event.url.origin));
  } catch (error) { return apiError(error); }
};
