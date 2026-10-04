import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Converter } from 'opencc-js';
import { z } from 'zod';
import type { Track } from '../types.js';

const languageSchema = z.enum(['original', 'zh-Hant', 'zh-Hans']);
export type AlbumLanguage = z.infer<typeof languageSchema>;
export const languageNames: Record<AlbumLanguage, string> = {
  original: 'Original（中文保留原樣）', 'zh-Hant': '中文統一繁體（TC）', 'zh-Hans': '中文统一简体（SC）',
};
const pendingSchema = z.object({
  chatId: z.number().int(), messageId: z.number().int().positive(), createdAt: z.number(),
  track: z.object({ id: z.string(), provider: z.enum(['netease', 'spotify', 'ytm']), title: z.string(),
    artists: z.array(z.string()), album: z.string(), cover: z.string(), durationMs: z.number(), sourceUrl: z.string(),
    artistIds: z.array(z.string()).optional(),
    metadataLanguages: z.object({ title: z.string().optional(), album: z.string().optional(), artists: z.array(z.string()).optional() }).optional() }),
});
const settingsSchema = z.object({ language: languageSchema.optional(), pending: pendingSchema.optional() });
type UserSettings = z.infer<typeof settingsSchema>;
export type PendingTrack = z.infer<typeof pendingSchema>;
const pendingLifetime = 30 * 60_000;

export function displayTrack(track: Track, language: AlbumLanguage): Track {
  if (language === 'original') return { ...track, artists: [...track.artists] };
  const convert = converters[language] ||= Converter(language === 'zh-Hant' ? { from: 'cn', to: 'tw' } : { from: 'tw', to: 'cn' });
  const languages = track.metadataLanguages;
  const nativeContext = track.artists.some((name, i) => /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(name) || /^(ja|ko)(-|$)/i.test(languages?.artists?.[i] || ''));
  const chineseOnly = (text: string, hint?: string) => {
    if (!/\p{Script=Han}/u.test(text) || /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return text;
    if (hint && hint !== 'und' && !/^zh(-|$)/i.test(hint)) return text;
    if ((!hint || hint === 'und') && nativeContext) return text;
    return convert(text);
  };
  return { ...track, title: chineseOnly(track.title, languages?.title),
    artists: track.artists.map((name, i) => chineseOnly(name, languages?.artists?.[i])), album: chineseOnly(track.album, languages?.album) };
}
const converters: Partial<Record<Exclude<AlbumLanguage, 'original'>, (text: string) => string>> = {};

// Preferences live outside expiring downloads, and survive container restarts.
export class BotSettingsStore {
  private root: string;
  private writes = new Map<number, Promise<unknown>>();
  constructor(root = process.env.DATA_DIR || '.data', private now = Date.now) { this.root = resolve(root, 'bot-users'); }
  private path(userId: number): string {
    if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error('Invalid Telegram user ID');
    return resolve(this.root, `${userId}.json`);
  }
  async get(userId: number): Promise<UserSettings> {
    const path = this.path(userId);
    let raw: string;
    try { raw = await readFile(path, 'utf8'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
    const result = settingsSchema.safeParse(JSON.parse(raw));
    if (!result.success) throw new Error('Invalid bot settings record');
    const settings = result.data;
    if (settings.pending && this.now() - settings.pending.createdAt > pendingLifetime) delete settings.pending;
    return settings;
  }
  private change<T>(userId: number, mutate: (settings: UserSettings) => T): Promise<T> {
    const previous = this.writes.get(userId) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const path = this.path(userId), settings = await this.get(userId);
      const result = mutate(settings);
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(settings), { mode: 0o600 });
      await rename(temporary, path);
      return result;
    });
    this.writes.set(userId, next);
    void next.finally(() => { if (this.writes.get(userId) === next) this.writes.delete(userId); }).catch(() => {});
    return next;
  }
  stage(userId: number, pending: Omit<PendingTrack, 'createdAt'>): Promise<AlbumLanguage | undefined> {
    return this.change(userId, (settings) => {
      if (settings.language) return settings.language;
      settings.pending = { ...pending, createdAt: this.now() };
      return undefined;
    });
  }
  choose(userId: number, language: AlbumLanguage): Promise<PendingTrack | undefined> {
    languageSchema.parse(language);
    return this.change(userId, (settings) => {
      settings.language = language;
      const pending = settings.pending;
      delete settings.pending;
      return pending;
    });
  }
}

type Send = (chatId: number, text: string, extra?: Record<string, unknown>) => Promise<unknown>;
type Acquire = (chatId: number, userId: number, track: Track, language: AlbumLanguage, messageId: number) => Promise<void>;

export class BotLanguageSettings {
  constructor(private store: BotSettingsStore, private send: Send, private acquire: Acquire) {}
  async show(chatId: number, userId: number, first = false): Promise<void> {
    const current = (await this.store.get(userId)).language;
    const callback = (action: string) => `lang:${userId}:${action}`;
    const rows = [
      [{ text: languageNames.original, callback_data: callback('original') }],
      [{ text: languageNames['zh-Hant'], callback_data: callback('zh-Hant') }],
      [{ text: languageNames['zh-Hans'], callback_data: callback('zh-Hans') }],
    ];
    const text = `${first ? '首次獲取：請選擇中文顯示字形。選完會自動繼續剛才的歌曲。' : 'Bot settings · 中文顯示字形'}\n\n目前：${current ? languageNames[current] : '尚未設定'}\n只統一中文歌名、歌手名、專輯名的繁簡字形。英文、日文、韓文等名稱保留原文，不翻譯。\n可隨時使用 /settings 更改。`;
    await this.send(chatId, text, { reply_markup: { inline_keyboard: rows } });
  }
  async request(chatId: number, userId: number, track: Track, messageId: number): Promise<void> {
    const language = await this.store.stage(userId, { chatId, messageId, track });
    if (!language) return this.show(chatId, userId, true);
    await this.acquire(chatId, userId, track, language, messageId);
  }
  async callback(chatId: number, userId: number, data: string): Promise<boolean> {
    if (!data.startsWith('lang:')) return false;
    const match = /^lang:(\d+):(original|zh-Hant|zh-Hans)$/.exec(data);
    if (!match || Number(match[1]) !== userId) {
      await this.send(chatId, '這是其他用戶的設定按鈕，請使用 /settings 開啟自己的設定。');
      return true;
    }
    const action = match[2]!;
    const language = languageSchema.parse(action);
    const pending = await this.store.choose(userId, language);
    await this.send(chatId, `已設定中文顯示字形：${languageNames[language]}。\n其他語言名稱保留原文；可用 /settings 更改。`);
    if (pending) await this.acquire(pending.chatId, userId, pending.track, language, pending.messageId);
    return true;
  }
}
