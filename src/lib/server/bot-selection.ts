import { randomBytes } from 'node:crypto';
import type { Collection, Track } from '../types.js';
import { ServiceError } from './errors.js';
import { botText, type BotLanguage } from './bot-i18n.js';

export const selectionLifetime = 30 * 60_000;
export const selectionPageSize = 8;
export interface MusicSelection {
  id: string; chatId: number; userId: number; requestId: number;
  menuId?: number; createdAt: number; collection: Collection; page: number;
}
export class BotSelections {
  private sessions = new Map<string, MusicSelection>();
  private latest = new Map<string, string>();
  private replies = new Map<string, MusicSelection>();
  constructor(private now = Date.now) {}
  private key(chatId: number, id: number) { return `${chatId}:${id}`; }
  private prune() {
    for (const session of this.sessions.values()) if (this.now() - session.createdAt >= selectionLifetime) this.drop(session);
  }
  private drop(session: MusicSelection) {
    this.sessions.delete(session.id);
    if (this.latest.get(this.key(session.chatId, session.userId)) === session.id) this.latest.delete(this.key(session.chatId, session.userId));
    for (const [key, value] of this.replies) if (value === session) this.replies.delete(key);
  }
  create(chatId: number, userId: number, requestId: number, collection: Collection): MusicSelection {
    this.prune();
    if (this.sessions.size >= 1000) this.drop(this.sessions.values().next().value!);
    const session = { id: randomBytes(8).toString('hex'), chatId, userId, requestId, collection, createdAt: this.now(), page: 0 };
    this.sessions.set(session.id, session);
    this.latest.set(this.key(chatId, userId), session.id);
    this.replies.set(this.key(chatId, requestId), session);
    return session;
  }
  get(chatId: number, userId: number, id: string, menuId?: number): MusicSelection {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) throw new ServiceError('SELECTION_EXPIRED', '選曲列表已過期，請重新搜尋。');
    if (session.chatId !== chatId || session.userId !== userId || (menuId !== undefined && session.menuId !== menuId)) throw new ServiceError('SELECTION_OWNER', '請開啟自己的選曲列表。', 403);
    return session;
  }
  number(chatId: number, userId: number, text: string, replyTo?: number): { session: MusicSelection; track: Track } | undefined {
    this.prune();
    if (!/^\d{1,3}$/.test(text)) return undefined;
    const session = replyTo === undefined
      ? this.sessions.get(this.latest.get(this.key(chatId, userId)) || '')
      : [...this.sessions.values()].find((item) => item.chatId === chatId && item.menuId === replyTo);
    if (!session) return undefined;
    this.get(chatId, userId, session.id);
    return { session, track: this.track(session, Number(text) - 1) };
  }
  track(session: MusicSelection, index: number): Track {
    const track = session.collection.tracks[index];
    if (!Number.isInteger(index) || !track) throw new ServiceError('SELECTION_NUMBER', '請使用列表中的曲目序號。');
    return track;
  }
  reply(session: MusicSelection, messageId: number) { this.replies.set(this.key(session.chatId, messageId), session); }
  delivered(chatId: number, replyTo: number): { inputIds: number[]; menuId?: number } {
    const session = this.replies.get(this.key(chatId, replyTo));
    if (!session) return { inputIds: [replyTo] };
    this.replies.delete(this.key(chatId, replyTo));
    // Album/playlist selectors stay usable for additional tracks until expiry.
    if (session.collection.kind === 'search') this.drop(session);
    return { inputIds: [...new Set([replyTo, session.requestId])], menuId: session.collection.kind === 'search' ? session.menuId : undefined };
  }
}

export function selectionMessage(session: MusicSelection, ui: BotLanguage) {
  const { collection, page } = session, start = page * selectionPageSize;
  const tracks = collection.tracks.slice(start, start + selectionPageSize);
  const source = collection.provider === 'netease' ? 'NetEase' : collection.provider === 'ytm' ? 'YTM' : 'Spotify';
  const kind = botText(ui, collection.kind === 'album' ? 'album' : collection.kind === 'playlist' ? 'playlist' : 'songs');
  const details = tracks.map((track, i) => {
    const seconds = Math.floor(track.durationMs / 1000), duration = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '';
    return `${start + i + 1}. ${track.title.slice(0, 90)} — ${track.artists.join(' / ').slice(0, 90)}\n${[track.album.slice(0, 90), duration].filter(Boolean).join(' · ')}`;
  });
  const rows = tracks.map((track, i) => [{ text: `${start + i + 1}. ${track.title}`.slice(0, 60), callback_data: `pick:${session.id}:${start + i}` }]);
  const navigation = [];
  if (page > 0) navigation.push({ text: `‹ ${botText(ui, 'previousPage')}`, callback_data: `page:${session.id}:${page - 1}` });
  if (start + tracks.length < collection.tracks.length) navigation.push({ text: `${botText(ui, 'nextPage')} ›`, callback_data: `page:${session.id}:${page + 1}` });
  if (navigation.length) rows.push(navigation);
  return { text: [collection.title.slice(0, 120), botText(ui, 'selectTracks', { kind, source, start: start + 1, end: start + tracks.length, loaded: collection.tracks.length }),
    collection.total > collection.tracks.length ? botText(ui, 'collectionLimit', { total: collection.total, loaded: collection.tracks.length }) : '',
    '', ...details].filter((text) => text !== '').join('\n'), reply_markup: { inline_keyboard: rows } };
}
