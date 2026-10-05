import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { providerIds } from '#lib/types.js';
import { apiError } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { clientAddress } from '#lib/server/client-address.js';
import { onlinePlayback } from '#lib/server/online-playback.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async event => {
  try {
    const provider = z.enum(providerIds).parse(event.params.provider);
    validateTrackId(provider, event.params.id);
    return json(await onlinePlayback.status(clientAddress(event), provider, event.params.id, event.url.origin));
  } catch (error) { return apiError(error); }
};
