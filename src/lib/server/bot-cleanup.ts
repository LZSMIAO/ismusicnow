import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const entrySchema = z.object({ chatId: z.number().int(), messageId: z.number().int().positive(),
  due: z.number(), expires: z.number(), attempts: z.number().int().nonnegative() });
type Entry = z.infer<typeof entrySchema>;

// Keep delayed deletions across a bot/container restart. Only IDs explicitly
// scheduled by this bot are eligible; this never scans or purges chat history.
export class BotMessageCleanup {
  private path: string;
  private entries?: Entry[];
  private pending = Promise.resolve();
  constructor(botId: string, private remove: (chatId: number, messageId: number) => Promise<unknown>,
    root = process.env.DATA_DIR || '.data', private now = Date.now) {
    if (!/^\d+$/.test(botId)) throw new Error('Invalid bot ID');
    this.path = resolve(root, 'bot-cleanup', `${botId}.json`);
  }
  private change(mutate: (entries: Entry[]) => Promise<void> | void): Promise<void> {
    const next = this.pending.catch(() => {}).then(async () => {
      if (!this.entries) {
        try { this.entries = z.array(entrySchema).parse(JSON.parse(await readFile(this.path, 'utf8'))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; this.entries = []; }
      }
      const before = JSON.stringify(this.entries);
      const entries = this.entries.filter((entry) => entry.expires > this.now()).map((entry) => ({ ...entry }));
      await mutate(entries);
      const after = JSON.stringify(entries);
      if (before === after) return;
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      await writeFile(temporary, after, { mode: 0o600 });
      await rename(temporary, this.path);
      this.entries = entries;
    });
    this.pending = next;
    return next;
  }
  schedule(chatId: number, messageId: number, delayMs: number): Promise<void> {
    if (!Number.isSafeInteger(chatId) || !Number.isSafeInteger(messageId) || messageId <= 0 || !Number.isFinite(delayMs) || delayMs < 0) throw new Error('Invalid deletion');
    return this.change((entries) => {
      const due = this.now() + delayMs;
      const existing = entries.find((entry) => entry.chatId === chatId && entry.messageId === messageId);
      if (existing) existing.due = Math.min(existing.due, due);
      else {
        if (entries.length >= 10_000) throw new Error('Cleanup queue is full');
        entries.push({ chatId, messageId, due, expires: this.now() + 47 * 3600_000, attempts: 0 });
      }
    });
  }
  async removeNow(chatId: number, messageId: number): Promise<void> {
    await this.schedule(chatId, messageId, 0);
    await this.flush({ chatId, messageId });
  }
  flush(target?: { chatId: number; messageId: number }): Promise<void> {
    return this.change(async (entries) => {
      const due = entries.filter((entry) => entry.due <= this.now() && (!target || (entry.chatId === target.chatId && entry.messageId === target.messageId))).slice(0, 20);
      for (const entry of due) {
        let finished = false;
        try { await this.remove(entry.chatId, entry.messageId); finished = true; }
        catch (error) {
          const code = (error as { errorCode?: number }).errorCode;
          // Missing messages and insufficient permissions must not affect music
          // delivery, or keep retrying a deletion Telegram has refused.
          finished = code === 400 || code === 403 || ++entry.attempts >= 5;
          if (!finished) entry.due = this.now() + Math.min(300_000, 30_000 * 2 ** entry.attempts);
        }
        if (finished) entries.splice(entries.indexOf(entry), 1);
      }
    });
  }
}
