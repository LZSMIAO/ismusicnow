import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { downloads } from '#lib/server/downloads.js';
import { apiError } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params }) => {
  try {
    const { path, job } = await downloads.file(locals.sessionId, params.id);
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream, { headers: {
      'Content-Type': 'application/octet-stream', 'Content-Length': String(job.bytes),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(job.filename!)}`,
    } });
  } catch (error) { return apiError(error); }
};
