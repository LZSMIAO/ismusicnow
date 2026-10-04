import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServiceError } from './errors.js';

function matches(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function denied(): never { throw new ServiceError('TELEGRAM_AUTH', 'Telegram 驗證已失效，請關閉後從 bot 重新開啟。', 401); }
/** Only signed initData is accepted; initDataUnsafe never establishes ownership. */
export function telegramOwner(raw: string, token: string, now = Date.now()): string {
  if (!token || raw.length > 16384) denied();
  const data = new URLSearchParams(raw), hash = data.get('hash');
  const keys = [...data.keys()];
  if (new Set(keys).size !== keys.length || !hash || !/^[a-f0-9]{64}$/.test(hash)) denied();
  data.delete('hash');
  const check = [...data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  if (!matches(hash, createHmac('sha256', secret).update(check).digest('hex'))) denied();
  const date = Number(data.get('auth_date'));
  if (!Number.isSafeInteger(date) || date <= 0 || now / 1000 - date > 86400 || date > now / 1000 + 60) denied();
  let user: { id?: number; is_bot?: boolean };
  try { user = JSON.parse(data.get('user') || '{}'); } catch { denied(); }
  if (!user || !Number.isSafeInteger(user.id) || user.id! <= 0 || user.is_bot) denied();
  return `tg:${createHmac('sha256', token).update(`ismusicnow:miniapp:${user.id}`).digest('hex')}`;
}
export function telegramUserAllowed(raw: string, allowed = process.env.BOT_ALLOWED_USERS || ''): boolean {
  const ids = allowed.split(',').map(value => value.trim()).filter(Boolean);
  // Call only after telegramOwner has verified the signature.
  return !ids.length || ids.includes(String(JSON.parse(new URLSearchParams(raw).get('user')!).id));
}

/** Scoped bearer grants let Telegram fetch audio without browser cookies.
 * No user data or bot credentials are placed in the URL. */
export class MediaGrants {
  constructor(private secret: string | Buffer = randomBytes(32)) {}
  issue(owner: string, job: string, purpose: 'file' | 'preview' | 'listen', now = Date.now()): string {
    const payload = Buffer.from(JSON.stringify({ owner, job, purpose, expires: now + (purpose === 'file' ? 600_000 : 3_600_000) })).toString('base64url');
    return `${payload}.${createHmac('sha256', this.secret).update(`ismusicnow:media:${payload}`).digest('base64url')}`;
  }
  owner(grant: string, job: string, purpose: string, now = Date.now()): string {
    const invalid = () => { throw new ServiceError('MEDIA_GRANT', '音訊連結已失效，請重新按播放或保存。', 403); };
    if (grant.length > 1024) return invalid();
    const [payload, signature, extra] = grant.split('.');
    if (!payload || !signature || extra || !matches(signature, createHmac('sha256', this.secret).update(`ismusicnow:media:${payload}`).digest('base64url'))) return invalid();
    let data: { owner: string; job: string; purpose: string; expires: number };
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return invalid(); }
    if (typeof data.owner !== 'string' || !data.owner || data.job !== job || data.purpose !== purpose || !Number.isFinite(data.expires) || data.expires <= now) return invalid();
    return data.owner;
  }
}
export const mediaGrants = new MediaGrants(process.env.BOT_TOKEN || undefined);
