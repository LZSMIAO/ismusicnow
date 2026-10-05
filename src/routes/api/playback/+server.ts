import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { providerIds } from '#lib/types.js';
import { apiError, readInput, rateLimit } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { clientAddress } from '#lib/server/client-address.js';
import { startOnlinePlayback } from '#lib/server/online-playback.js';
import type { RequestHandler } from './$types';
export const POST: RequestHandler = async event => {
  try {
    rateLimit(event);
    const { provider, id } = await readInput(event.request, z.object({ provider: z.enum(providerIds), id: z.string().max(240) }));
    validateTrackId(provider, id);
    return json(await startOnlinePlayback(clientAddress(event), provider, id, event.url.origin));
  } catch (error) { return apiError(error); }
};
