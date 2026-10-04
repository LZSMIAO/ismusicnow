import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import { downloads } from '#lib/server/downloads.js';
import { browserAudio } from '#lib/server/browser-audio.js';
import { audioRange } from '#lib/server/audio-range.js';
import { apiError } from '#lib/server/api.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  try {
    const file = await downloads.file(locals.sessionId, params.id);
    const path = file.job.track.provider === 'spotify' ? await browserAudio(file.path) : file.path;
    const { size } = await stat(path);
    const mime: Record<string, string> = { '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.webm': 'audio/webm', '.wav': 'audio/wav' };
    const headers: Record<string, string> = { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Accept-Ranges': 'bytes' };
    let start = 0, end = size - 1, status = 200;
    const range = request.headers.get('range');
    if (range) {
      const bounds = audioRange(range, size);
      if (!bounds) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      ({ start, end } = bounds);
      status = 206; headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status, headers });
  } catch (error) { return apiError(error); }
};
