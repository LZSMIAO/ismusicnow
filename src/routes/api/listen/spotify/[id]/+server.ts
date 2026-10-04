import { json } from '@sveltejs/kit';
import { apiError } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { clientAddress } from '#lib/server/client-address.js';
import { spotifyListenStatus } from '#lib/server/spotify-listen.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async event => {
  try { validateTrackId('spotify', event.params.id); return json(await spotifyListenStatus(clientAddress(event), event.params.id, event.url.origin)); }
  catch (error) { return apiError(error); }
};
