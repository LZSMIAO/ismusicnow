import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { apiError, rateLimit, readInput } from '#lib/server/api.js';
import { resolveMusic } from '#lib/server/music.js';
import type { RequestHandler } from './$types';

const schema = z.object({ input: z.string().trim().min(1).max(1000), provider: z.enum(['netease', 'spotify', 'ytm']) });
export const POST: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const data = await readInput(event.request, schema);
    return json(await resolveMusic(data.input, data.provider));
  } catch (error) { return apiError(error); }
};
