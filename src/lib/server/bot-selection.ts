import { randomBytes } from 'node:crypto';
import { selectionCloseData } from './bot-close.js';
import type { Collection, MusicEntity, Track } from '../types.js';
import { ServiceError } from './errors.js';
import { botText, type BotLanguage } from './bot-i18n.js';
import { displayTrack, type AlbumLanguage } from './bot-settings.js';
import { botProviderName, searchableProviders } from './bot-providers.js';
import { recordingGroups, rankedSources, type RecordingGroup, type SourceEvidence } from './bot-recordings.js';

export const selectionLifetime = 30 * 60_000;
export const selectionPageSize = 8;
export interface MusicSelection {
  id: string; chatId: number; userId: number; requestId: number;
  messageThreadId?: number; menuId?: number; createdAt: number; collection: Collection; page: number; busy?: boolean; keepRequest?: boolean;
  history?: { collection: Collection; page: number }[]; userName?: string;
  groups: RecordingGroup[]; evidence: Map<string, SourceEvidence>;
  panel?: 'providers' | { group: number }; rich?: boolean; closed?: boolean;
  pendingSources?: Track[];
  previousSession?: MusicSelection;
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
    const session: MusicSelection = { id: randomBytes(8).toString('hex'), chatId, userId, requestId, messageThreadId, collection,
      groups: recordingGroups(collection), evidence: new Map(), createdAt: this.now(), page: 0, keepRequest };
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
    if (session.closed) throw new ServiceError('SELECTION_CLOSED', 'Selection closed');
    const next = this.create(session.chatId, session.userId, session.requestId, collection, session.messageThreadId, session.keepRequest);
    next.menuId = session.menuId; next.userName = session.userName; next.rich = session.rich;
    next.evidence = new Map(session.evidence);
    next.history = [...(session.history || []), ...(remember ? [{ collection: session.collection, page: session.page }] : [])].slice(-8);
    next.previousSession = session;
    return next;
  }
  commit(session: MusicSelection) {
    if (session.previousSession) this.drop(session.previousSession);
    delete session.previousSession;
  }
  abort(session: MusicSelection) {
    const previous = session.previousSession;
    this.drop(session);
    if (previous && !previous.closed && this.sessions.has(previous.id)) {
      previous.busy = false;
      this.latest.set(this.ownerKey(previous.chatId, previous.userId, previous.messageThreadId), previous.id);
      this.replies.set(this.key(previous.chatId, previous.requestId), previous);
    }
  }
  back(session: MusicSelection): MusicSelection {
    const history = [...(session.history || [])], previous = history.pop();
    if (!previous) throw new ServiceError('SELECTION_EXPIRED', 'No previous results');
    const next = this.replace(session, previous.collection, false);
    next.history = history; next.page = previous.page;
    return next;
  }
  close(session: MusicSelection): void {
    session.closed = true; this.drop(session);
    for (const pending of this.sessions.values()) if (pending.chatId === session.chatId && pending.userId === session.userId && pending.menuId === session.menuId && pending.requestId === session.requestId) { pending.closed = true; this.drop(pending); }
  }
  entity(session: MusicSelection, index: number): MusicEntity {
    const entity = session.collection.entities?.[index];
    if (!Number.isInteger(index) || !entity) throw new ServiceError('SELECTION_NUMBER', 'Invalid selection');
    return entity;
  }
  track(session: MusicSelection, index: number): Track {
    const track = this.sources(session, index)[0];
    if (!Number.isInteger(index) || !track) throw new ServiceError('SELECTION_NUMBER', '請使用列表中的曲目序號。');
    return track;
  }
  sources(session: MusicSelection, index: number): Track[] {
    const group = session.groups[index];
    if (!Number.isInteger(index) || !group) throw new ServiceError('SELECTION_NUMBER', 'Invalid recording');
    // Freeze ordering when a session is created/enriched, not while a user taps.
    return group.tracks;
  }
  rank(session: MusicSelection, evidence: Map<string, SourceEvidence>) {
    session.evidence = evidence;
    session.groups = session.groups.map(group => ({ tracks: rankedSources(group, evidence) }));
  }
  reply(session: MusicSelection, messageId: number) { this.replies.set(this.key(session.chatId, messageId), session); }
  request(chatId: number, userId: number, messageId: number, messageThreadId?: number) {
    this.prune();
    const session = this.replies.get(this.key(chatId, messageId));
    return session?.userId === userId && session.messageThreadId === messageThreadId && this.sessions.has(session.id) ? session : undefined;
  }
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

type Button = { text: string; callback_data: string };
const chunks = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
const versionTitle = (value: string, max = 72) => { const text = value.replace(/[\r\n\t]+/g, ' ').trim(); const chars = [...text]; return chars.length <= max ? text : chars.slice(0, Math.floor(max / 2)).join('') + '…' + chars.slice(-Math.floor(max / 2) + 1).join(''); };
const richButton = (button: Button) => `<tg-button type="callback_data" style="link" data="${escapeHtml(button.callback_data)}">${escapeHtml(button.text)}</tg-button>`;
export const selectionCount = (session: MusicSelection) => session.collection.entities?.length ?? session.groups.length;
export function selectionMessage(session: MusicSelection, ui: BotLanguage, names: AlbumLanguage = 'original') {
  const { collection, page } = session, start = page * selectionPageSize;
  const items = collection.entities || session.groups.map(group => group.tracks[0]!);
  const visible = items.slice(start, start + selectionPageSize);
  const search = collection.kind === 'search', scope = collection.searchScope || collection.provider;
  const source = scope === 'all' ? botText(ui, 'allSources') : botProviderName(collection.provider);
  const key = search ? collection.searchType || 'track' : collection.kind;
  const kind = botText(ui, key === 'album' ? 'album' : key === 'playlist' ? 'playlist' : key === 'artist' ? 'artist' : 'single');
  const summary = [source, kind, visible.length ? `${start + 1}–${start + visible.length} / ${items.length}` : ''].filter(Boolean).join(' · ');
  const title = shortText(collection.title, 90);
  const owner = session.chatId < 0 ? `<a href="tg://user?id=${session.userId}">${escapeHtml(shortText(session.userName || String(session.userId), 40))}</a>` : '';
  const header = [owner, `<b>${escapeHtml(title)}</b>`, escapeHtml(summary)].filter(Boolean).join('\n');
  const navigation: Button[] = [];
  if (session.history?.length) navigation.push({ text: `↩ ${botText(ui, 'backResults')}`, callback_data: `back:${session.id}` });
  if (page > 0) navigation.push({ text: `‹ ${botText(ui, 'previousPage')}`, callback_data: `page:${session.id}:${page - 1}` });
  navigation.push({ text: botText(ui, 'close'), callback_data: selectionCloseData(session) });
  if (start + visible.length < items.length) navigation.push({ text: `${botText(ui, 'nextPage')} ›`, callback_data: `page:${session.id}:${page + 1}` });
  const layout: Button = { text: botText(ui, session.rich === false ? 'richLayout' : 'compatLayout'), callback_data: `layout:${session.id}:${session.rich === false ? 'rich' : 'buttons'}` };
  const footer = search && collection.total > collection.tracks.length + (collection.entities?.length || 0) ? botText(ui, 'partialResults') : '';
  const tabs: Button[] = search && collection.provider !== 'ytm' ? (['track', 'album', 'artist', 'playlist'] as const).filter(type => scope === 'all' || searchableProviders(type).some(provider => provider.id === scope)).map(type => ({
    text: `${(collection.searchType || 'track') === type ? '✓ ' : ''}${botText(ui, type === 'track' ? 'single' : type)}`, callback_data: `type:${session.id}:${type}`,
  })) : collection.kind === 'artist' && collection.provider === 'netease' ? [
    { text: `${!collection.entities ? '✓ ' : ''}${botText(ui, 'hotTracks')}`, callback_data: `view:${session.id}:track` },
    { text: `${collection.entities ? '✓ ' : ''}${botText(ui, 'album')}`, callback_data: `view:${session.id}:album` },
  ] : [];
  const filter: Button = { text: `${source} ▾`, callback_data: `filter:${session.id}` };
  if (session.panel) {
    const providers = session.panel === 'providers';
    const groupIndex = session.panel === 'providers' ? undefined : session.panel.group;
    const tracks = groupIndex === undefined ? [] : session.groups[groupIndex]?.tracks;
    if (!providers && !tracks?.length) throw new ServiceError('SELECTION_NUMBER', 'Invalid source panel');
    const buttons: Button[] = providers ? [{ text: `${scope === 'all' ? '✓ ' : ''}${botText(ui, 'allSources')}`, callback_data: `scope:${session.id}:all` },
      ...searchableProviders(collection.searchType || 'track').map(provider => ({ text: `${scope === provider.id ? '✓ ' : ''}${provider.name}`, callback_data: `scope:${session.id}:${provider.id}` }))]
      : tracks!.map((track, i) => ({ text: `${botProviderName(track.provider)}${i === 0 ? ` · ${botText(ui, 'automatic')}` : ''}`, callback_data: `from:${session.id}:${groupIndex}:${i}` }));
    const panelTitle = providers ? botText(ui, 'chooseSource') : `「${versionTitle(tracks![0]!.title, 70)}」`;
    const note = botText(ui, providers ? 'sourceSearchScope' : 'sourceAvailability');
    const rows = chunks(buttons, 2);
    rows.push([{ text: botText(ui, 'backResults'), callback_data: `list:${session.id}` }, { text: botText(ui, 'close'), callback_data: selectionCloseData(session) }]);
    return { text: [owner, `<b>${escapeHtml(panelTitle)}</b>`, escapeHtml(note)].filter(Boolean).join('\n'), parse_mode: 'HTML' as const,
      link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [...rows, [layout]] }, rich_message: { html: `<p>${[owner, `<b>${escapeHtml(panelTitle)}</b>`, escapeHtml(note)].filter(Boolean).join('<br>')}</p>` + rows.slice(0, -1).map(row => `<tg-button-row>${row.map(richButton).join('')}</tg-button-row>`).join(''), skip_entity_detection: true },
      rich_keyboard: { inline_keyboard: [rows.at(-1)!, [layout]] } };
  }
  const details: string[] = [], tableRows: string[] = [], fallbackRows: Button[][] = [];
  visible.forEach((item, i) => {
    const index = start + i;
    const track = 'durationMs' in item ? displayTrack(item, names) : undefined;
    const shown = track || displayTrack({ ...item, durationMs: 0, album: '', artists: item.artists }, names);
    const pick = { text: versionTitle(shown.title), callback_data: `pick:${session.id}:${index}` };
    const artists = shortText(shown.artists.join(' / '), 42);
    const extra = 'durationMs' in item ? duration(item.durationMs) || '—' : [item.year, item.count === undefined ? '' : botText(ui, 'tracksCount', { count: item.count })].filter(Boolean).join(' · ') || '—';
    const candidates = track ? session.groups[index]!.tracks : [];
    const sourcePick = { text: botProviderName(item.provider), callback_data: track ? `from:${session.id}:${index}:0` : pick.callback_data };
    const more = candidates.length > 1 ? { text: botText(ui, 'moreSources', { count: candidates.length - 1 }), callback_data: `sources:${session.id}:${index}` } : undefined;
    // Keep all versions/releases accessible, while only the active eight rows
    // occupy the table. Disclosure is a sibling block, never required to pick.
    details.push((candidates.length ? candidates : [shown]).map(candidate => {
      const value = displayTrack(candidate, names);
      return `<b>${escapeHtml(versionTitle(value.title, 128))}</b><br>${escapeHtml(shortText(value.artists.join(' / '), 160))}<br>${escapeHtml(botProviderName(value.provider))} · ${escapeHtml(duration(value.durationMs))}${value.album ? `<br>${escapeHtml(botText(ui, 'album'))}：${escapeHtml(shortText(value.album, 128))}` : ''}`;
    }).join('<br><br>'));
    tableRows.push(`<tr><td valign="top">${richButton(pick)}${artists ? `<br>${escapeHtml(artists)}` : ''}</td><td valign="top" align="right">${escapeHtml(extra)}</td><td valign="top">${richButton(sourcePick)}${more ? `<br>${richButton(more)}` : ''}</td></tr>`);
    fallbackRows.push([{ text: versionTitle(shown.title, 56), callback_data: pick.callback_data }, sourcePick, ...(more ? [more] : [])]);
  });
  const rows = [...(search ? [[filter]] : []), ...(tabs.length ? [tabs] : []), ...fallbackRows, navigation, [layout]];
  const heading = `<tr><th>${escapeHtml(botText(ui, collection.entities ? key === 'artist' ? 'artist' : key === 'playlist' ? 'playlist' : 'album' : 'songArtist'))}</th><th align="right">${escapeHtml(botText(ui, collection.entities ? 'details' : 'duration'))}</th><th>${escapeHtml(botText(ui, 'source'))}</th></tr>`;
  const rich = `<p>${[owner, `<b>${escapeHtml(title)}</b>`, search ? richButton(filter) + ` · ${escapeHtml(kind)} · ${visible.length ? `${start + 1}–${start + visible.length} / ${items.length}` : ''}` : escapeHtml(summary)].filter(Boolean).join('<br>')}</p>` +
    (tabs.length ? `<p>${tabs.map(richButton).join(' · ')}</p>` : '') +
    (tableRows.length ? `<table compact>${heading}${tableRows.join('')}</table><details><summary>${escapeHtml(botText(ui, 'releaseDetails'))}</summary>${details.map(text => `<p>${text}</p>`).join('')}</details>` : `<p>${escapeHtml(botText(ui, 'noResults'))}</p>`) +
    (footer ? `<footer>${escapeHtml(footer)}</footer>` : '') +
    (collection.warnings.length ? `<footer>${escapeHtml(botText(ui, 'partialSources'))}</footer>` : '');
  return { text: [header, collection.kind === 'artist' ? escapeHtml(botText(ui, collection.entities ? 'album' : 'hotTracks')) : '',
    ...visible.map(item => { const shown = displayTrack('durationMs' in item ? item : { ...item, album: '', durationMs: 0 }, names); const extra = 'durationMs' in item ? [shortText(shown.album, 48), duration(item.durationMs)] : [item.year, item.count === undefined ? '' : botText(ui, 'tracksCount', { count: item.count })]; return `${escapeHtml(versionTitle(shown.title, 72))} · ${escapeHtml([shortText(shown.artists.join(' / '), 64), ...extra, botProviderName(item.provider)].filter(Boolean).join(' · '))}`; }),
    !visible.length ? escapeHtml(botText(ui, 'noResults')) : '', footer,
    collection.warnings.length ? escapeHtml(botText(ui, 'partialSources')) : '',
  ].filter(Boolean).join('\n'), parse_mode: 'HTML' as const, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: rows },
    rich_message: { html: rich, skip_entity_detection: true }, rich_keyboard: { inline_keyboard: [navigation, [layout]] } };
}
export const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
export function shortText(value: string, max: number): string { const chars = [...value.replace(/[\r\n\t]+/g, ' ').trim()]; return chars.length > max ? chars.slice(0, max - 1).join('') + '…' : chars.join(''); }
function duration(ms: number): string { const seconds = Math.floor(ms / 1000); return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : ''; }
