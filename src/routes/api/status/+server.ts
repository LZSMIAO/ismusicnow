import { json } from '@sveltejs/kit';
import { serviceStatus } from '#lib/server/music.js';
import { apiError } from '#lib/server/api.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async () => {
  try { return json(await serviceStatus()); } catch (error) { return apiError(error); }
};
