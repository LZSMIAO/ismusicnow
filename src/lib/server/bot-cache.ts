import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { Provider } from '../types.js';
import { TelegramRequestError } from './bot-media.js';

export interface MusicCacheKey { provider: Provider; id: string; quality: string }
const recordSchema = z.object({
  fileId: z.string().min(1), kind: z.enum(['audio', 'document']), duration: z.number().nonnegative(),
  bytes: z.number().int().positive(), audioSource: z.enum(['netease', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili']),
  presentation: z.enum(['original', 'telegram-playback']).optional(), nativeAudioRejected: z.boolean().optional(),
  audio: z.object({ codec: z.string(), bitrate: z.number().optional(), sampleRate: z.number().optional(),
    bitsPerSample: z.number().optional(), lossless: z.boolean() }).optional(),
});
export type CachedMusic = z.infer<typeof recordSchema>;

export function rejectedFileId(error: unknown): boolean {
  return error instanceof TelegramRequestError && error.errorCode === 400 &&
    /wrong (remote )?file (identifier|id)|invalid file[_ ]?id|file[_ ]?id.*(invalid|expired)|file reference.*expired|file_reference_expired/i.test(error.description);
}

// Only Telegram references and measured audio metadata are kept, never audio bytes
// or recipient captions. file_id is scoped to the bot that originally uploaded it.
export class BotMusicCache {
  private root: string;
  private inFlight = new Map<string, Promise<CachedMusic | undefined>>();
  constructor(botId: string, root = process.env.DATA_DIR || '.data') {
    if (!/^\d+$/.test(botId)) throw new Error('Invalid Telegram bot ID');
    this.root = resolve(root, 'telegram-media', botId);
  }
  private key(selection: MusicCacheKey): string {
    return createHash('sha256').update(JSON.stringify([selection.provider, selection.id, selection.quality])).digest('hex');
  }
  private path(selection: MusicCacheKey): string { return resolve(this.root, `${this.key(selection)}.json`); }
  async get(selection: MusicCacheKey): Promise<CachedMusic | undefined> {
    let raw: string;
    try { raw = await readFile(this.path(selection), 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    try { const result = recordSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : undefined; }
    catch { return undefined; }
  }
  async put(selection: MusicCacheKey, record: CachedMusic): Promise<void> {
    const value = recordSchema.parse(record), path = this.path(selection);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
      await rename(temporary, path);
    } finally { await rm(temporary, { force: true }); }
  }
  async invalidate(selection: MusicCacheKey, fileId: string): Promise<void> {
    if ((await this.get(selection))?.fileId === fileId) await rm(this.path(selection), { force: true });
  }
  async deliver(selection: MusicCacheKey, sendCached: (record: CachedMusic) => Promise<void>,
    upload: () => Promise<CachedMusic | undefined>): Promise<'hit' | 'miss'> {
    const key = this.key(selection);
    for (;;) {
      // Another user's upload (or refresh of a stale reference) owns this key.
      const pending = this.inFlight.get(key);
      const record = pending ? await pending : await this.get(selection);
      if (record) {
        try { await sendCached(record); return 'hit'; }
        catch (error) {
          // An ambiguous network failure or recipient failure must not trigger
          // another upload or duplicate a message that Telegram may have sent.
          if (!rejectedFileId(error)) throw error;
          await this.invalidate(selection, record.fileId);
        }
      }
      if (this.inFlight.has(key)) continue;
      const work = (async () => {
        const fresh = await upload();
        if (fresh) {
          // The recipient already received the file; storage failure must not
          // retry sending it. Waiting recipients can still reuse this reference.
          await this.put(selection, fresh).catch(() => console.error('Telegram 快取索引保存失敗。'));
        }
        return fresh;
      })();
      this.inFlight.set(key, work);
      try { await work; return 'miss'; }
      finally { if (this.inFlight.get(key) === work) this.inFlight.delete(key); }
    }
  }
}
