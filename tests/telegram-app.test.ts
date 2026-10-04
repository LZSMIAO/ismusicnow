import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { telegramOwner, telegramUserAllowed, MediaGrants } from '../src/lib/server/telegram-app.js';
import { mountTelegram, setTelegramBack, downloadTelegramFile, telegramHeaders, type TelegramBridge } from '../src/lib/telegram.js';

const token = '123456:test-secret', now = 1800000000000;
function signed(fields: Record<string, string>, bot = token) {
  const data = new URLSearchParams(fields);
  const check = [...data].sort(([a], [b]) => a < b ? -1 : 1).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(bot).digest();
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return data.toString();
}
const fields = { user: JSON.stringify({ id: 42, first_name: 'Test' }), auth_date: String(now / 1000), query_id: 'one', signature: 'new-sdk-signature' };

test('Telegram ownership is signed, stable across openings and isolated by user and bot', () => {
  const data = signed(fields), owner = telegramOwner(data, token, now);
  assert.equal(owner, telegramOwner(signed({ ...fields, query_id: 'two' }), token, now));
  assert.notEqual(owner, telegramOwner(signed({ ...fields, user: '{"id":43}' }), token, now));
  assert.notEqual(owner, telegramOwner(signed(fields, 'another:bot'), 'another:bot', now));
  assert.equal(telegramUserAllowed(data, '42,43'), true);
  assert.equal(telegramUserAllowed(data, '43'), false);
});
test('Telegram rejects forged, expired, future, duplicate and malformed identities', () => {
  const valid = signed(fields);
  for (const raw of [valid.replace('query_id=one', 'query_id=forged'), `${valid}&user=%7B%22id%22%3A43%7D`, signed({ ...fields, auth_date: String(now / 1000 - 86401) }), signed({ ...fields, auth_date: String(now / 1000 + 61) }), signed({ ...fields, user: 'null' }), signed({ ...fields, user: '{"id":"42"}' }), signed({ ...fields, user: '{"id":42,"is_bot":true}' })]) {
    assert.throws(() => telegramOwner(raw, token, now), /Telegram 驗證/);
  }
  assert.throws(() => telegramOwner(valid, 'wrong', now));
  assert.throws(() => telegramOwner(valid, '', now));
});
test('media grants are bound to owner, file, purpose and expiry; tampering never grants access', () => {
  const grants = new MediaGrants('secret'), ticket = grants.issue('owner-a', 'job-1', 'file', now);
  assert.equal(grants.owner(ticket, 'job-1', 'file', now + 599999), 'owner-a');
  assert.throws(() => grants.owner(ticket, 'job-1', 'file', now + 600000));
  assert.throws(() => grants.owner(ticket, 'job-2', 'file', now));
  assert.throws(() => grants.owner(ticket, 'job-1', 'preview', now));
  assert.throws(() => grants.owner(ticket.replace(/^./, 'A'), 'job-1', 'file', now));
  assert.throws(() => new MediaGrants('other').owner(ticket, 'job-1', 'file', now));
  const preview = grants.issue('owner-b', 'job-2', 'preview', now);
  assert.equal(grants.owner(preview, 'job-2', 'preview', now + 3599999), 'owner-b');
  assert.throws(() => grants.owner(preview, 'job-2', 'preview', now + 3600000));
});
function harness(version = '8.0') {
  const events = new Map<string, () => void>(), back = new Set<() => void>(), calls: unknown[] = [], css = new Map<string, string>(), classes = new Set<string>();
  const app: TelegramBridge = {
    initData: 'signed', viewportHeight: 700, viewportStableHeight: 700, safeAreaInset: { top: 20, bottom: 34 }, contentSafeAreaInset: { top: 40 },
    ready: () => calls.push('ready'), expand: () => calls.push('expand'), isVersionAtLeast: value => Number(version) >= Number(value),
    setHeaderColor: value => calls.push(['header', value]), setBackgroundColor: value => calls.push(['background', value]), setBottomBarColor: value => calls.push(['bottom', value]),
    onEvent: (name, fn) => { events.set(name, fn); }, offEvent: (name, fn) => { if (events.get(name) === fn) events.delete(name); },
    BackButton: { show: () => calls.push('show'), hide: () => calls.push('hide'), onClick: fn => { back.add(fn); }, offClick: fn => { back.delete(fn); } },
    downloadFile: params => calls.push(['download', params]), openLink: url => calls.push(['open', url]),
  };
  const root = { style: { setProperty: (key: string, value: string) => css.set(key, value), removeProperty: (key: string) => css.delete(key) }, classList: { add: (key: string) => classes.add(key), remove: (...keys: string[]) => keys.forEach(key => classes.delete(key)), toggle: (key: string, value: boolean) => value ? classes.add(key) : classes.delete(key) } } as unknown as HTMLElement;
  return { app, root, events, back, calls, css, classes };
}
test('Mini App tracks safe areas, keyboard and themes; removes all listeners on unmount', () => {
  const h = harness(), stop = mountTelegram(h.app, h.root);
  assert.equal(h.css.get('--imn-safe-top'), '60px'); assert.equal(h.css.get('--imn-safe-bottom'), '34px');
  assert.ok(h.calls.includes('ready')); assert.ok(h.calls.includes('expand'));
  h.app.viewportHeight = 400; h.events.get('viewportChanged')!();
  assert.equal(h.classes.has('telegram-keyboard'), true); assert.equal(h.css.get('--imn-height'), '400px');
  h.app.safeAreaInset = { top: 0, bottom: 0, left: 25 }; h.events.get('safeAreaChanged')!();
  assert.equal(h.css.get('--imn-safe-left'), '25px');
  h.events.get('themeChanged')!();
  stop(); assert.equal(h.events.size, 0); assert.equal(h.classes.size, 0); assert.equal(h.css.size, 0);
});
test('native back callbacks cleanly hand off; old Telegram downloads use a scoped URL fallback', () => {
  const h = harness(); let count = 0;
  const stop = setTelegramBack(() => count++, h.app);
  for (const fn of h.back) fn(); assert.equal(count, 1); stop(); assert.equal(h.back.size, 0);
  downloadTelegramFile('https://music.ism.tw/file?grant=one', 'music.flac', h.app);
  assert.deepEqual(h.calls.at(-1), ['download', { url: 'https://music.ism.tw/file?grant=one', file_name: 'music.flac' }]);
  const old = harness('7.0'); downloadTelegramFile('https://music.ism.tw/file?grant=one', 'music.flac', old.app);
  assert.deepEqual(old.calls.at(-1), ['open', 'https://music.ism.tw/file?grant=one']);
  assert.deepEqual(telegramHeaders(), {}); // Normal browser/SSR never gains a Telegram identity.
});
