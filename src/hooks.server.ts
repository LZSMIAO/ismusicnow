import { randomUUID, timingSafeEqual } from 'node:crypto';
import { telegramOwner, telegramUserAllowed, mediaGrants } from './lib/server/telegram-app.js';
import { apiError } from './lib/server/api.js';
import { ServiceError } from './lib/server/errors.js';
import type { Handle } from '@sveltejs/kit/hooks';

function equal(left: string, right: string): boolean {
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const handle: Handle = async ({ event, resolve }) => {
  const user = process.env.HTTP_AUTH_USER, password = process.env.HTTP_AUTH_PASSWORD;
  if (user && password) {
    const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    if (!equal(event.request.headers.get('authorization') || '', expected)) {
      return new Response('Authentication required', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="ismusicnow", charset="UTF-8"' } });
    }
  }
  if (event.request.method !== 'GET' && event.request.method !== 'HEAD') {
    const origin = event.request.headers.get('origin');
    if (!origin || origin !== event.url.origin) return new Response('Invalid origin', { status: 403 });
  }
  const initData = event.request.headers.get('x-telegram-init-data');
  const media = /^\/api\/downloads\/([a-f0-9-]{36})\/(file|preview)$/.exec(event.url.pathname);
  const grant = event.url.searchParams.get('grant');
  try {
    if (initData) {
      event.locals.sessionId = telegramOwner(initData, process.env.BOT_TOKEN || '');
      if (!telegramUserAllowed(initData)) throw new ServiceError('FORBIDDEN', '此 bot 尚未開放給此帳號。', 403);
    } else if (media && grant && ['GET', 'HEAD'].includes(event.request.method)) {
      event.locals.sessionId = mediaGrants.owner(grant, media[1]!, media[2]!);
    } else {
      const cookie = event.cookies.get('imn_session');
      event.locals.sessionId = cookie && /^[a-f0-9-]{36}$/.test(cookie) ? cookie : randomUUID();
      if (cookie !== event.locals.sessionId) event.cookies.set('imn_session', event.locals.sessionId, {
        path: '/', httpOnly: true, sameSite: 'strict', secure: event.url.protocol === 'https:', maxAge: 30 * 86400,
      });
    }
  } catch (error) { return apiError(error); }
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.delete('X-Frame-Options');
  response.headers.set('Content-Security-Policy', "frame-ancestors 'self' https://web.telegram.org;");
  if (event.url.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
