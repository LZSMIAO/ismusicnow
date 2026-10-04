import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { ServiceError } from '#lib/server/errors.js';
import { apiError, rateLimit } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { validateAudioUrl } from '#lib/server/downloads.js';
import { neteasePreview } from '#lib/server/providers/netease.js';
import { spotifyPreview } from '#lib/server/providers/spotify.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
  try {
    rateLimit(event);
    const source = z.enum(['netease', 'spotify', 'ytm']).safeParse(event.url.searchParams.get('provider'));
    if (!source.success) throw new ServiceError('INVALID_PROVIDER', '請選擇有效的音樂來源。', 400);
    const provider = source.data;
    const id = event.url.searchParams.get('id') || '';
    validateTrackId(provider, id);
    let raw = provider === 'netease' ? await neteasePreview(id) : provider === 'spotify' ? await spotifyPreview(id) : null;
    if (raw && provider === 'netease') { const url = validateAudioUrl(raw); url.protocol = 'https:'; raw = url.href; }
    if (raw && provider === 'spotify') {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['scdn.co', 'spotifycdn.com', 'akamaized.net'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) raw = null;
    }
    return json(raw ? { available: true, url: raw, maxSeconds: 30 } : { available: false, message: '此來源未提供本站可用的試聽片段。可在原平台播放，或下載完成後預覽。' });
  } catch (error) { return apiError(error); }
};
