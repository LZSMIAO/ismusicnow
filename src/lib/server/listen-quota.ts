import { createHmac, randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ServiceError } from './errors.js';
const DAY = 86400000, OFFSET = 8 * 3600000;
export const LISTEN_LIMIT = 5;
type Entry = { charged: boolean; reservedAt: number };
type State = { salt: string; day: number; ips: Record<string, Record<string, Entry>> };
/** One web process owns the disk file. Serial writes keep parallel tabs within the limit. */
export class ListenQuota {
  private state?: State;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private root: string) {}
  private async locked<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation, operation); this.tail = next.catch(() => {}); return next;
  }
  private async load(now: number) {
    if (!this.state) {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      try { this.state = JSON.parse(await readFile(join(this.root, 'quota.json'), 'utf8')); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new ServiceError('QUOTA_STORE', '播放額度暫時無法讀取，請稍後再試。', 503);
        this.state = { salt: randomBytes(32).toString('hex'), day: -1, ips: {} };
      }
    }
    const day = Math.floor((now + OFFSET) / DAY);
    if (this.state!.day !== day) { this.state!.day = day; this.state!.ips = {}; }
    return this.state!;
  }
  private async save() {
    const file = join(this.root, 'quota.json');
    await writeFile(file + '.tmp', JSON.stringify(this.state), { mode: 0o600 }); await rename(file + '.tmp', file);
  }
  private hash(ip: string) { return createHmac('sha256', this.state!.salt).update(ip).digest('hex'); }
  async key(ip: string, now = Date.now()) { return this.locked(async () => { await this.load(now); await this.save(); return this.hash(ip); }); }
  private metadata(records: Record<string, Entry>, now: number) {
    return { remaining: Math.max(0, LISTEN_LIMIT - Object.keys(records).length), limit: LISTEN_LIMIT, resetsAt: (Math.floor((now + OFFSET) / DAY) + 1) * DAY - OFFSET };
  }
  async reserve(ip: string, track: string, now = Date.now()) {
    return this.locked(async () => {
      const state = await this.load(now), key = this.hash(ip), records = state.ips[key] ||= {};
      for (const [id, entry] of Object.entries(records)) if (!entry.charged && now - entry.reservedAt > 30 * 60000) delete records[id];
      if (!records[track]) {
        if (Object.keys(records).length >= LISTEN_LIMIT) throw new ServiceError('SPOTIFY_LISTEN_LIMIT', '今日 5 首 Spotify 已用完，請下載後播放。', 429);
        if (Object.keys(state.ips).length > 10000) throw new ServiceError('LISTEN_BUSY', '播放服務忙碌，請稍後再試。', 503);
        records[track] = { charged: false, reservedAt: now };
      }
      await this.save(); return this.metadata(records, now);
    });
  }
  async has(ip: string, track: string, charged = false, now = Date.now()) {
    return this.locked(async () => { const state = await this.load(now), entry = state.ips[this.hash(ip)]?.[track]; return !!entry && (!charged || entry.charged); });
  }
  async commit(ip: string, track: string, now = Date.now()) {
    return this.locked(async () => {
      const state = await this.load(now), records = state.ips[this.hash(ip)] || {}, entry = records[track];
      if (!entry) throw new ServiceError('LISTEN_EXPIRED', '播放額度已重置，請重新按播放。', 409);
      entry.charged = true; await this.save(); return this.metadata(records, now);
    });
  }
  async release(ip: string, track: string, now = Date.now()) {
    return this.locked(async () => { const state = await this.load(now), records = state.ips[this.hash(ip)]; if (records?.[track] && !records[track].charged) { delete records[track]; await this.save(); } });
  }
}
