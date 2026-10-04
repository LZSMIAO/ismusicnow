import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { downloads } from '#lib/server/downloads.js';
import { mediaGrants } from '#lib/server/telegram-app.js';
import { apiError, readInput } from '#lib/server/api.js';
import type { RequestHandler } from './$types';
const schema = z.object({ purpose: z.enum(['file', 'preview']) });
export const POST: RequestHandler = async ({ locals, params, request, url }) => {
  try {
    const { purpose } = await readInput(request, schema);
    const { job } = await downloads.file(locals.sessionId, params.id);
    const path = `/api/downloads/${job.id}/${purpose}?grant=${encodeURIComponent(mediaGrants.issue(locals.sessionId, job.id, purpose))}`;
    return json({ url: new URL(path, url.origin).href, filename: job.filename });
  } catch (error) { return apiError(error); }
};
