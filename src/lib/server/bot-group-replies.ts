import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { botText, type BotLanguage } from './bot-i18n.js';
import { TelegramRequestError } from './bot-media.js';
import { escapeHtml, shortText } from './bot-selection.js';

type Body = Record<string, unknown> | FormData;
export type GroupReplyRequest = <T>(method: string, body: Body) => Promise<T>;
export interface GroupReply { userId: number; name?: string; username?: string; requestId: number; language: BotLanguage }
interface Saved { reply: GroupReply; content: Record<string, unknown>; fallback: boolean }
interface ReplyMessage {
  message_id: number; date?: number; from?: { id: number }; chat: { id: number; type?: string };
  reply_to_message?: { message_id: number };
}
const field = (body: Body, key: string) => body instanceof FormData ? body.get(key) : body[key];
const set = (body: Body, key: string, value: unknown) => body instanceof FormData ? body.set(key, typeof value === 'string' ? value : JSON.stringify(value)) : body[key] = value;
const remove = (body: Body, key: string) => body instanceof FormData ? body.delete(key) : delete body[key];
const value = (item: unknown): unknown => typeof item === 'string' ? JSON.parse(item) : item;
export function withGroupReply(body: Body, reply: GroupReply): Body { set(body, 'muism_group_reply', reply); return body; }
function attribution(reply: GroupReply): string {
  const label = reply.username && /^[a-zA-Z0-9_]{1,32}$/.test(reply.username) ? `@${reply.username}` : shortText(reply.name || String(reply.userId), 40);
  const user = `<a href="tg://user?id=${reply.userId}">${escapeHtml(label)}</a>`;
  return botText(reply.language, 'requestedBy', { user });
}
function content(body: Body): Record<string, unknown> {
  return Object.fromEntries(['caption', 'text', 'parse_mode', 'rich_message', 'link_preview_options', 'reply_markup'].flatMap(key => {
    const item = field(body, key); return item === undefined || item === null ? [] : [[key, ['rich_message', 'reply_markup', 'link_preview_options'].includes(key) ? value(item) : item]];
  }));
}
function addAttribution(body: Body, reply: GroupReply): void {
  const line = attribution(reply), rich = field(body, 'rich_message');
  if (rich && typeof rich === 'object' && typeof (rich as { html?: string }).html === 'string') {
    set(body, 'rich_message', { ...rich, html: (rich as { html: string }).html + `<p>${line}</p>` });
  } else {
    const key = field(body, 'caption') !== undefined && field(body, 'caption') !== null || field(body, 'audio') || field(body, 'document') ? 'caption' : 'text';
    const source = String(field(body, key) || '');
    set(body, key, [field(body, 'parse_mode') === 'HTML' ? source : escapeHtml(source), line].filter(Boolean).join('\n'));
    set(body, 'parse_mode', 'HTML');
  }
}
const missingReply = (error: unknown) => error instanceof TelegramRequestError && error.errorCode === 400 && /message to be replied.*not found|reply.*message.*not found|reply_message_id_invalid/i.test(error.description);

// Only our reply relationships are retained. Deletion events never recreate a
// deleted bot message, and callbacks remain a fallback if an event was missed.
export class BotGroupReplies {
  private root: string;
  private index = new Map<string, number>();
  private deletedRequests = new Set<string>();
  private locks = new Map<string, Promise<unknown>>();
  private ready: Promise<void>;
  constructor(private botId: string, root = process.env.DATA_DIR || '.data') {
    if (!/^\d+$/.test(botId)) throw new Error('Invalid Telegram bot ID');
    this.root = resolve(root, 'group-replies', botId);
    this.ready = this.restore();
  }
  private key(chat: number, message: number) { return `${chat}:${message}`; }
  private async restore() {
    try {
      for (const file of await readdir(this.root)) {
        const match = /^(-\d+)-(\d+)\.json$/.exec(file); if (!match) continue;
        const chat = Number(match[1]), message = Number(match[2]), saved = await this.load(chat, message);
        if (saved && Number.isSafeInteger(saved.reply?.requestId)) this.index.set(this.key(chat, message), saved.reply.requestId);
      }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Group reply index could not be restored.'); }
  }
  private async serial<T>(key: string, work: () => Promise<T>): Promise<T> {
    const prior = this.locks.get(key) || Promise.resolve();
    const next = prior.catch(() => {}).then(work); this.locks.set(key, next);
    try { return await next; } finally { if (this.locks.get(key) === next) this.locks.delete(key); }
  }
  private async forget(chat: number, message: number) {
    this.index.delete(this.key(chat, message));
    const path = this.path(chat, message); if (path) await rm(path, { force: true }).catch(() => {});
  }
  private path(chat: number, message: number) {
    if (!Number.isSafeInteger(chat) || chat >= 0 || !Number.isSafeInteger(message) || message <= 0) return;
    return resolve(this.root, `${chat}-${message}.json`);
  }
  private async load(chat: number, message: number): Promise<Saved | undefined> {
    const path = this.path(chat, message); if (!path) return;
    try { return JSON.parse(await readFile(path, 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.error('Group reply state could not be read.'); }
  }
  private async save(chat: number, message: number, saved: Saved) {
    const path = this.path(chat, message); if (!path) return;
    const temporary = `${path}.${randomUUID()}.tmp`;
    this.index.set(this.key(chat, message), saved.reply.requestId);
    try {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }); await rename(temporary, path);
    } catch { console.error('Group reply state could not be saved.'); }
    finally { await rm(temporary, { force: true }).catch(() => {}); }
  }
  async run<T>(method: string, source: Body, request: GroupReplyRequest): Promise<T> {
    await this.ready;
    const body: Body = source instanceof FormData ? source : { ...source };
    const metadata = field(body, 'muism_group_reply'); remove(body, 'muism_group_reply');
    const chat = Number(field(body, 'chat_id')), message = Number(field(body, 'message_id'));
    if (/^send(?:Message|RichMessage|Audio|Document)$/.test(method) && chat < 0 && metadata) {
      const reply = value(metadata) as GroupReply;
      if (!Number.isSafeInteger(reply.userId) || reply.userId <= 0 || !Number.isSafeInteger(reply.requestId) || reply.requestId <= 0) throw new Error('Invalid group reply');
      const saved: Saved = { reply, content: content(body), fallback: false };
      set(body, 'reply_parameters', { message_id: reply.requestId, allow_sending_without_reply: false });
      let result: T;
      try { result = await request<T>(method, body); }
      catch (error) {
        if (!missingReply(error)) throw error;
        remove(body, 'reply_parameters'); addAttribution(body, reply); saved.fallback = true;
        result = await request<T>(method, body);
      }
      if (result && typeof result === 'object' && 'message_id' in result) {
        const deliveredId = Number(result.message_id);
        await this.serial(this.key(chat, deliveredId), async () => {
          await this.save(chat, deliveredId, saved);
          if (this.deletedRequests.has(this.key(chat, reply.requestId))) await this.disclose(chat, deliveredId, request);
        });
      }
      return result;
    }
    const work = async () => {
      const saved = /^editMessage(?:Text|Caption)$/.test(method) ? await this.load(chat, message) : undefined;
      const updated = saved ? { ...saved, content: content(body) } : undefined;
      if (saved?.fallback) addAttribution(body, saved.reply);
      const result = await request<T>(method, body);
      if (updated) await this.save(chat, message, updated);
      if (method === 'deleteMessage') await this.forget(chat, message);
      return result;
    };
    return chat < 0 && message > 0 ? this.serial(this.key(chat, message), work) : work();
  }
  private async disclose(chat: number, message: number, request: GroupReplyRequest): Promise<void> {
    const saved = await this.load(chat, message); if (!saved || saved.fallback) return;
    const body = { chat_id: chat, message_id: message, ...saved.content }; addAttribution(body, saved.reply);
    try { await request(saved.content.caption !== undefined ? 'editMessageCaption' : 'editMessageText', body); }
    catch (error) {
      if (error instanceof TelegramRequestError && /message to edit not found|message_id_invalid/i.test(error.description)) { await this.forget(chat, message); return; }
      if (!(error instanceof TelegramRequestError && /message is not modified/i.test(error.description))) { console.error('Group requester attribution could not be updated.'); return; }
    }
    await this.save(chat, message, { ...saved, fallback: true });
  }
  async deleted(chat: number | undefined, messages: number[], request: GroupReplyRequest): Promise<void> {
    await this.ready;
    const ids = new Set(messages.filter(id => Number.isSafeInteger(id) && id > 0));
    // Non-channel MTProto IDs belong to the bot's basic-group/private inbox.
    // They must never match IDs in supergroups or channels without a peer ID.
    const matchesChat = (id: number) => chat === undefined ? id > -1000000000000 && id < 0 : id === chat;
    if (chat !== undefined && chat < 0) for (const id of ids) this.deletedRequests.add(this.key(chat, id));
    while (this.deletedRequests.size > 1000) this.deletedRequests.delete(this.deletedRequests.values().next().value!);
    for (const [key, requestId] of [...this.index]) {
      const [peer, message] = key.split(':').map(Number); if (!matchesChat(peer!)) continue;
      if (ids.has(message!)) await this.serial(key, () => this.forget(peer!, message!));
      else if (ids.has(requestId)) {
        this.deletedRequests.add(this.key(peer!, requestId));
        await this.serial(key, () => this.disclose(peer!, message!, request));
      }
    }
  }
  async observe(message: ReplyMessage, request: GroupReplyRequest): Promise<void> {
    await this.ready;
    if (message.from?.id !== Number(this.botId) || message.date === 0 || !['group', 'supergroup'].includes(message.chat.type || '')) return;
    await this.serial(this.key(message.chat.id, message.message_id), async () => {
      const saved = await this.load(message.chat.id, message.message_id);
      if (!saved || saved.fallback || message.reply_to_message?.message_id === saved.reply.requestId) return;
      await this.disclose(message.chat.id, message.message_id, request);
    });
  }
  async selectionCloseOwner(chat: number, message: number, user: number, data: string): Promise<boolean | undefined> {
    await this.ready;
    const saved = await this.load(chat, message); if (!saved) return;
    const markup = saved.content.reply_markup as { inline_keyboard?: { callback_data?: string }[][] } | undefined;
    return saved.reply.userId === user && !!markup?.inline_keyboard?.flat().some(button => button.callback_data === data);
  }
}
