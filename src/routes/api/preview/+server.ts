import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { ServiceError } from '#lib/server/errors.js';
import { apiError, rateLimit } from '#lib/server/api.js';
import { validateTrackId } from '#lib/server/links.js';
import { validateAudioUrl } from '#lib/server/downloads.js';
import { neteasePreview } from '#lib/server/providers/netease.js';
import { serviceStatus } from '#lib/server/music.js';
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
    const netease = provider === 'netease' ? await neteasePreview(id) : null;
    let raw = netease?.url || (provider === 'spotify' ? await spotifyPreview(id) : null);
    const limited = provider === 'netease' ? !!netease?.limited : true;
    if (raw && provider === 'netease') { const url = validateAudioUrl(raw); url.protocol = 'https:'; raw = url.href; }
    if (raw && provider === 'spotify') {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port || !['scdn.co', 'spotifycdn.com', 'akamaized.net'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) raw = null;
    }
    const services = await serviceStatus();
    const downloadable = provider === 'netease' ? services.netease.ready : services[provider].downloaderReady;
    const message = provider === 'spotify' ? 'Spotify 未提供此曲試聽。'
      : provider === 'ytm' ? 'YouTube Music 不提供直接試聽。'
      : '網易雲暫無可用音源，請檢查帳號或地區權限。';
    return json(raw ? { available: true, url: raw, limited, downloadable }
      : { available: false, downloadable, message: message + (downloadable ? '可下載後播放。' : '請在原平台播放。') });
  } catch (error) { return apiError(error); }
};
