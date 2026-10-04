import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { apiError } from '#lib/server/api.js';
import { audioRange } from '#lib/server/audio-range.js';
import { clientAddress } from '#lib/server/client-address.js';
import { validateTrackId } from '#lib/server/links.js';
import { spotifyListenFile } from '#lib/server/spotify-listen.js';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async event => {
  try {
    validateTrackId('spotify', event.params.id);
    const path = await spotifyListenFile(clientAddress(event), event.params.id, event.url.searchParams.get('job') || '', event.url.searchParams.get('grant') || '');
    const { size } = await stat(path), range = event.request.headers.get('range');
    let start = 0, end = size - 1;
    const headers: Record<string, string> = { 'Content-Type': 'audio/mp4', 'Accept-Ranges': 'bytes' };
    if (range) { const bounds = audioRange(range, size); if (!bounds) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } }); ({ start, end } = bounds); headers['Content-Range'] = `bytes ${start}-${end}/${size}`; }
    headers['Content-Length'] = String(end - start + 1);
    return new Response(Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream, { status: range ? 206 : 200, headers });
  } catch (error) { return apiError(error); }
};
