import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Converter } from 'opencc-js';
import { z } from 'zod';
import type { Track } from '../types.js';
import { botHelp, botLanguages, botLanguageLabel, botText, telegramLanguage, type BotLanguage } from './bot-i18n.js';

const languageSchema = z.enum(['original', 'zh-Hant', 'zh-Hans']);
export type AlbumLanguage = z.infer<typeof languageSchema>;
export const languageNames: Record<AlbumLanguage, string> = {
  original: 'Original（中文保留原樣）', 'zh-Hant': '中文統一繁體（TC）', 'zh-Hans': '中文统一简体（SC）',
};
const pendingSchema = z.object({
  chatId: z.number().int(), messageId: z.number().int().positive(), messageThreadId: z.number().int().positive().optional(), keepRequest: z.boolean().optional(), inlineMode: z.boolean().optional(), createdAt: z.number(),
  track: z.object({ id: z.string(), provider: z.enum(['netease', 'spotify', 'ytm', 'soundcloud', 'bandcamp', 'bilibili']), title: z.string(),
    artists: z.array(z.string()), album: z.string(), cover: z.string(), durationMs: z.number(), sourceUrl: z.string(),
    artistIds: z.array(z.string()).optional(), albumUrl: z.string().optional(),
    metadataLanguages: z.object({ title: z.string().optional(), album: z.string().optional(), artists: z.array(z.string()).optional() }).optional() }),
});
const uiLanguageSchema = z.enum(botLanguages);
const settingsSchema = z.object({ language: languageSchema.optional(), uiLanguage: uiLanguageSchema.optional(), telegramLanguage: uiLanguageSchema.optional(), pending: pendingSchema.optional() });
type UserSettings = z.infer<typeof settingsSchema>;
export type PendingTrack = z.infer<typeof pendingSchema>;
const pendingLifetime = 30 * 60_000;

export function displayTrack(track: Track, language: AlbumLanguage): Track {
  if (track.provider !== 'netease' || language === 'original') return { ...track, artists: [...track.artists] };
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
  async knownLocales(): Promise<{ userId: number; language: BotLanguage }[]> {
    const files = await readdir(this.root).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    const result: { userId: number; language: BotLanguage }[] = [];
    for (const file of files.filter(name => /^\d+\.json$/.test(name)).slice(0, 1000)) {
      const userId = Number(file.slice(0, -5));
      const settings = await this.get(userId).catch(() => undefined);
      if (settings) result.push({ userId, language: settings.uiLanguage || settings.telegramLanguage || 'en' });
    }
    return result;
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
  setUiLanguage(userId: number, language: BotLanguage): Promise<void> {
    uiLanguageSchema.parse(language);
    return this.change(userId, (settings) => { settings.uiLanguage = language; });
  }
  setNamesLanguage(userId: number, language: AlbumLanguage): Promise<void> {
    languageSchema.parse(language);
    return this.change(userId, settings => { settings.language = language; });
  }
  async observeLanguage(userId: number, code?: string): Promise<void> {
    if (!code) return;
    const language = telegramLanguage(code);
    if ((await this.get(userId)).telegramLanguage === language) return;
    await this.change(userId, (settings) => { settings.telegramLanguage = language; });
  }
}

type Send = (chatId: number, text: string, extra?: Record<string, unknown>) => Promise<unknown>;
type Acquire = (chatId: number, userId: number, track: Track, language: AlbumLanguage, messageId: number, messageThreadId?: number, keepRequest?: boolean, inlineMode?: boolean) => Promise<void>;

export class BotLanguageSettings {
  constructor(private store: BotSettingsStore, private send: Send, private acquire: Acquire,
    private onUiChange?: (chatId: number, language: BotLanguage, userId: number) => Promise<void>) {}
  async observeLanguage(userId: number, code?: string): Promise<void> { await this.store.observeLanguage(userId, code); }
  async locale(userId: number): Promise<BotLanguage> {
    const settings = await this.store.get(userId);
    return settings.uiLanguage || settings.telegramLanguage || 'en';
  }
  async start(chatId: number, userId: number, botUsername = 'muismbot'): Promise<void> {
    const ui = await this.locale(userId);
    await this.onUiChange?.(chatId, ui, userId).catch(() => {});
    await this.send(chatId, botHelp(ui, chatId < 0, botUsername), { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
      [{ text: `${botLanguageLabel(ui)} ｜ 🌐 ${botText(ui, 'changeLanguage')}`, callback_data: `setting:${userId}:ui` }],
    ] } });
  }
  private name(language: AlbumLanguage, ui: BotLanguage): string {
    return botText(ui, language === 'original' ? 'original' : language === 'zh-Hant' ? 'traditional' : 'simplified');
  }
  async show(chatId: number, userId: number): Promise<void> {
    const settings = await this.store.get(userId), ui = settings.uiLanguage || settings.telegramLanguage || 'en';
    await this.send(chatId, `${botText(ui, 'settings')}\n\n🌐 ${botText(ui, 'uiLanguage')}：${botLanguageLabel(ui)}\n${botText(ui, 'namesSetting')}：${settings.language ? this.name(settings.language, ui) : botText(ui, 'unset')}\n\n${botText(ui, 'scope')}`, {
      deleteAfterMs: 30 * 60_000, reply_markup: { inline_keyboard: [
        [{ text: `🌐 ${botText(ui, 'uiLanguage')}`, callback_data: `setting:${userId}:ui` }],
        [{ text: botText(ui, 'namesSetting'), callback_data: `setting:${userId}:names` }],
        [{ text: botText(ui, 'close'), callback_data: `setting:${userId}:close` }],
      ] },
    });
  }
  async showNames(chatId: number, userId: number, first = false, replyTo?: number): Promise<void> {
    const settings = await this.store.get(userId), current = settings.language, ui = settings.uiLanguage || settings.telegramLanguage || 'en';
    const callback = (action: string) => `lang:${userId}:${action}`;
    const rows = [
      ...(['original', 'zh-Hant', 'zh-Hans'] as const).map((language) => [{ text: `${current === language ? '✓ ' : ''}${this.name(language, ui)}`, callback_data: callback(language) }]),
      [{ text: botText(ui, 'back'), callback_data: `setting:${userId}:home` }],
    ];
    const text = `${first ? botText(ui, 'firstNames') : botText(ui, 'namesSetting')}\n\n${botText(ui, 'current', { value: current ? this.name(current, ui) : botText(ui, 'unset') })}\n${botText(ui, 'namesScope')}`;
    await this.send(chatId, text, { deleteAfterMs: 30 * 60_000, ...(replyTo ? { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } } : {}), reply_markup: { inline_keyboard: rows } });
  }
  async showUi(chatId: number, userId: number): Promise<void> {
    const ui = await this.locale(userId);
    const buttons = botLanguages.map((language) => ({ text: `${ui === language ? '✓ ' : ''}${botLanguageLabel(language)}`, callback_data: `ui:${userId}:${language}` }));
    const rows = Array.from({ length: Math.ceil(buttons.length / 2) }, (_v, i) => buttons.slice(i * 2, i * 2 + 2));
    rows.push([{ text: botText(ui, 'back'), callback_data: `setting:${userId}:home` }]);
    await this.send(chatId, `🌐 ${botText(ui, 'uiLanguage')}\n\n${botText(ui, 'current', { value: botLanguageLabel(ui) })}\n${botText(ui, 'uiScope')}`, { deleteAfterMs: 30 * 60_000, reply_markup: { inline_keyboard: rows } });
  }
  async request(chatId: number, userId: number, track: Track, messageId: number, messageThreadId?: number, keepRequest = false, inlineMode = false): Promise<void> {
    const thread: [number?, boolean?, boolean?] = inlineMode ? [messageThreadId, keepRequest, true] : keepRequest ? [messageThreadId, true] : messageThreadId === undefined ? [] : [messageThreadId];
    if (track.provider !== 'netease') return this.acquire(chatId, userId, track, 'original', messageId, ...thread);
    const language = await this.store.stage(userId, { chatId, messageId, messageThreadId, keepRequest: keepRequest || undefined, inlineMode: inlineMode || undefined, track });
    if (!language) return this.showNames(chatId, userId, true, messageId);
    await this.acquire(chatId, userId, track, language, messageId, ...thread);
  }
  async callback(chatId: number, userId: number, data: string, dismiss?: () => Promise<void>): Promise<boolean> {
    if (!/^(lang|ui|setting):/.test(data)) return false;
    const match = /^(lang|ui|setting):(\d+):([a-zA-Z-]+)$/.exec(data);
    const ui = await this.locale(userId);
    if (!match || Number(match[2]) !== userId) {
      await this.send(chatId, botText(ui, 'wrongOwner'), { deleteAfterMs: 30_000 });
      return true;
    }
    const action = match[3]!;
    if (match[1] === 'setting') {
      if (action === 'ui') await this.showUi(chatId, userId);
      else if (action === 'names') await this.showNames(chatId, userId);
      else if (action === 'home') await this.show(chatId, userId);
      else if (action === 'close') await dismiss?.();
      return true;
    }
    if (match[1] === 'ui') {
      const parsed = uiLanguageSchema.safeParse(action);
      if (!parsed.success) return true;
      await this.store.setUiLanguage(userId, parsed.data);
      // Group command menus are scoped to this member, not the whole group.
      // A menu API failure must not discard a successfully saved preference.
      await this.onUiChange?.(chatId, parsed.data, userId).catch(() => {});
      await this.show(chatId, userId);
      return true;
    }
    if (!languageSchema.safeParse(action).success) return true;
    const language = languageSchema.parse(action);
    const pending = await this.store.choose(userId, language);
    if (pending) {
      await dismiss?.();
      const context: [number?, boolean?, boolean?] = pending.inlineMode ? [pending.messageThreadId, !!pending.keepRequest, true] : pending.keepRequest ? [pending.messageThreadId, true] : pending.messageThreadId === undefined ? [] : [pending.messageThreadId];
      await this.acquire(pending.chatId, userId, pending.track, pending.track.provider === 'netease' ? language : 'original', pending.messageId, ...context);
    } else await this.showNames(chatId, userId);
    return true;
  }
}
