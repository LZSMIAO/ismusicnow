import { randomBytes } from 'node:crypto';
import type { Collection, MusicEntity, Track } from '../types.js';
import { ServiceError } from './errors.js';
import { botText, type BotLanguage } from './bot-i18n.js';

export const selectionLifetime = 30 * 60_000;
export const selectionPageSize = 5;
export interface MusicSelection {
  id: string; chatId: number; userId: number; requestId: number;
  messageThreadId?: number; menuId?: number; createdAt: number; collection: Collection; page: number; busy?: boolean; keepRequest?: boolean;
  history?: { collection: Collection; page: number }[]; userName?: string;
}
export class BotSelections {
  private sessions = new Map<string, MusicSelection>();
  private latest = new Map<string, string>();
  private replies = new Map<string, MusicSelection>();
  constructor(private now = Date.now) {}
  private key(chatId: number, id: number) { return `${chatId}:${id}`; }
  private ownerKey(chatId: number, userId: number, thread?: number) { return `${chatId}:${thread ?? 0}:${userId}`; }
  private prune() {
    for (const session of this.sessions.values()) if (this.now() - session.createdAt >= selectionLifetime) this.drop(session);
  }
  private drop(session: MusicSelection) {
    this.sessions.delete(session.id);
    if (this.latest.get(this.ownerKey(session.chatId, session.userId, session.messageThreadId)) === session.id) this.latest.delete(this.ownerKey(session.chatId, session.userId, session.messageThreadId));
    for (const [key, value] of this.replies) if (value === session) this.replies.delete(key);
  }
  create(chatId: number, userId: number, requestId: number, collection: Collection, messageThreadId?: number, keepRequest = false): MusicSelection {
    this.prune();
    if (this.sessions.size >= 1000) this.drop(this.sessions.values().next().value!);
    const session = { id: randomBytes(8).toString('hex'), chatId, userId, requestId, messageThreadId, collection, createdAt: this.now(), page: 0, keepRequest };
    this.sessions.set(session.id, session);
    this.latest.set(this.ownerKey(chatId, userId, messageThreadId), session.id);
    this.replies.set(this.key(chatId, requestId), session);
    return session;
  }
  get(chatId: number, userId: number, id: string, menuId?: number, messageThreadId?: number): MusicSelection {
    this.prune();
    const session = this.sessions.get(id);
    if (!session) throw new ServiceError('SELECTION_EXPIRED', '選曲列表已過期，請重新搜尋。');
    if (session.chatId !== chatId || session.userId !== userId || session.messageThreadId !== messageThreadId || (menuId !== undefined && session.menuId !== menuId)) throw new ServiceError('SELECTION_OWNER', '請開啟自己的選曲列表。', 403);
    return session;
  }
  number(chatId: number, userId: number, text: string, replyTo?: number, messageThreadId?: number): { session: MusicSelection; track?: Track; entity?: MusicEntity } | undefined {
    this.prune();
    if (!/^\d{1,3}$/.test(text)) return undefined;
    const session = replyTo === undefined
      ? this.sessions.get(this.latest.get(this.ownerKey(chatId, userId, messageThreadId)) || '')
      : [...this.sessions.values()].find((item) => item.chatId === chatId && item.menuId === replyTo);
    if (!session) return undefined;
    this.get(chatId, userId, session.id, undefined, messageThreadId);
    return session.collection.entities ? { session, entity: this.entity(session, Number(text) - 1) } : { session, track: this.track(session, Number(text) - 1) };
  }
  replace(session: MusicSelection, collection: Collection, remember = true): MusicSelection {
    const next = this.create(session.chatId, session.userId, session.requestId, collection, session.messageThreadId, session.keepRequest);
    next.menuId = session.menuId; next.userName = session.userName;
    next.history = [...(session.history || []), ...(remember ? [{ collection: session.collection, page: session.page }] : [])].slice(-8);
    this.drop(session);
    return next;
  }
  back(session: MusicSelection): MusicSelection {
    const history = [...(session.history || [])], previous = history.pop();
    if (!previous) throw new ServiceError('SELECTION_EXPIRED', 'No previous results');
    const next = this.replace(session, previous.collection, false);
    next.history = history; next.page = previous.page;
    return next;
  }
  close(session: MusicSelection): void { this.drop(session); }
  entity(session: MusicSelection, index: number): MusicEntity {
    const entity = session.collection.entities?.[index];
    if (!Number.isInteger(index) || !entity) throw new ServiceError('SELECTION_NUMBER', 'Invalid selection');
    return entity;
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
    if (session.collection.kind === 'search' || replyTo !== session.requestId) this.replies.delete(this.key(chatId, replyTo));
    session.busy = false;
    // Album/playlist selectors stay usable for additional tracks until expiry.
    if (session.collection.kind === 'search') this.drop(session);
    return { inputIds: [...new Set([replyTo, session.requestId])].filter(id => !session.keepRequest || id !== session.requestId), menuId: session.collection.kind === 'search' ? session.menuId : undefined };
  }
}

export function selectionMessage(session: MusicSelection, ui: BotLanguage) {
  const { collection, page } = session, start = page * selectionPageSize;
  const items = collection.entities || collection.tracks;
  const visible = items.slice(start, start + selectionPageSize);
  const source = collection.provider === 'netease' ? 'NetEase' : collection.provider === 'ytm' ? 'YTM' : 'Spotify';
  const key = collection.kind === 'search' ? collection.searchType || 'track' : collection.kind;
  const kind = botText(ui, key === 'album' ? 'album' : key === 'playlist' ? 'playlist' : key === 'artist' ? 'artist' : 'single');
  const details = visible.map((item, i) => {
    const title = `<b>${escapeHtml(shortText(item.title, 35))}</b>`;
    const extra = 'durationMs' in item
      ? [shortText(item.artists.join(' / '), 18), shortText(item.album, 16), duration(item.durationMs)]
      : [shortText(item.artists.join(' / '), 45), item.year, item.count === undefined ? '' : botText(ui, 'tracksCount', { count: item.count })];
    return `${start + i + 1}. ${title}\n${escapeHtml(extra.filter(Boolean).join(' · '))}`;
  });
  const rows: { text: string; callback_data: string }[][] = [];
  if (collection.kind === 'search' && collection.provider !== 'ytm') rows.push((['track', 'album', 'artist', 'playlist'] as const).map(type => ({
    text: `${(collection.searchType || 'track') === type ? '✓ ' : ''}${botText(ui, type === 'track' ? 'single' : type)}`,
    callback_data: `type:${session.id}:${type}`,
  })));
  if (collection.kind === 'artist' && collection.provider === 'netease') rows.push([
    { text: `${!collection.entities ? '✓ ' : ''}${botText(ui, 'hotTracks')}`, callback_data: `view:${session.id}:track` },
    { text: `${collection.entities ? '✓ ' : ''}${botText(ui, 'album')}`, callback_data: `view:${session.id}:album` },
  ]);
  if (visible.length) rows.push(visible.map((_, i) => ({ text: String(start + i + 1), callback_data: `pick:${session.id}:${start + i}` })));
  const navigation = [];
  if (session.history?.length) navigation.push({ text: `↩ ${botText(ui, 'backResults')}`, callback_data: `back:${session.id}` });
  if (page > 0) navigation.push({ text: `‹ ${botText(ui, 'previousPage')}`, callback_data: `page:${session.id}:${page - 1}` });
  navigation.push({ text: botText(ui, 'close'), callback_data: `close:${session.id}` });
  if (start + visible.length < items.length) navigation.push({ text: `${botText(ui, 'nextPage')} ›`, callback_data: `page:${session.id}:${page + 1}` });
  rows.push(navigation);
  const summary = [source, kind, visible.length ? `${start + 1}–${start + visible.length} / ${items.length}` : ''].filter(Boolean).join(' · ');
  const artistView = collection.kind === 'artist' ? botText(ui, collection.entities ? 'album' : 'hotTracks') : '';
  return { text: [session.chatId < 0 ? `<a href="tg://user?id=${session.userId}">${escapeHtml(shortText(session.userName || String(session.userId), 40))}</a>` : '', `<b>${escapeHtml(shortText(collection.title, 90))}</b>`, escapeHtml(summary), artistView ? escapeHtml(artistView) : '', '',
    ...(details.length ? details : [escapeHtml(botText(ui, 'noResults')), '']),
    details.length && session.chatId < 0 ? escapeHtml(botText(ui, 'chooseNumberGroup')) : '',
    collection.total > items.length ? `<blockquote expandable>${escapeHtml(botText(ui, 'resultsLimit', { total: collection.total, loaded: items.length }))}</blockquote>` : '',
  ].filter((text, index, all) => text || (index > 0 && all[index - 1])).join('\n'), parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: rows } };
}
export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function shortText(value: string, max: number): string { const chars = [...value.replace(/[\r\n\t]+/g, ' ').trim()]; return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); }
function duration(ms: number): string { const seconds = Math.floor(ms / 1000); return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''; }
