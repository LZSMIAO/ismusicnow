import { randomUUID, timingSafeEqual } from 'node:crypto';
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
  const cookie = event.cookies.get('imn_session');
  event.locals.sessionId = cookie && /^[a-f0-9-]{36}$/.test(cookie) ? cookie : randomUUID();
  if (cookie !== event.locals.sessionId) event.cookies.set('imn_session', event.locals.sessionId, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: event.url.protocol === 'https:', maxAge: 30 * 86400,
  });
  const response = await resolve(event);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Frame-Options', 'DENY');
  if (event.url.pathname.startsWith('/api/')) response.headers.set('Cache-Control', 'private, no-store');
  return response;
};
