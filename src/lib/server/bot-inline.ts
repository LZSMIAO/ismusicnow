import { createHash } from 'node:crypto';
import type { Collection, DownloadJob, MusicEntity, MusicSearchKind, Provider, Track } from '../types.js';
import type { CachedMusic } from './bot-cache.js';
import { rejectedFileId } from './bot-cache.js';
import { botError, botText, type BotLanguage } from './bot-i18n.js';
import { coverUrl, musicCaption, TelegramRequestError } from './bot-media.js';
import { displayTrack, type AlbumLanguage } from './bot-settings.js';
import { escapeHtml, shortText } from './bot-selection.js';
import { parseMusicLink, validateTrackId } from './links.js';
import { publicError, ServiceError } from './errors.js';
import { searchText, type BotSource } from './bot-search.js';
import { botProviders, searchableProviders, botProviderName } from './bot-providers.js';
import { recordingGroups, rankedSources, trackIdentity, type SourceEvidence } from './bot-recordings.js';

export interface InlineQuery { id: string; from: { id: number; language_code?: string; is_bot?: boolean }; query: string; offset?: string; chat_type?: string }
export interface ChosenInline { result_id: string; from: { id: number }; inline_message_id?: string; query: string }
type Telegram = (method: string, body: Record<string, unknown>) => Promise<unknown>;
interface InlinePreferences { ui: BotLanguage; names?: AlbumLanguage }
interface Dependencies {
  telegram: Telegram; username: () => string;
  preferences: (userId: number) => Promise<InlinePreferences>;
  resolve: (input: string, provider: BotSource, kind: MusicSearchKind) => Promise<Collection>;
  albums: (url: string) => Promise<Collection>;
  getTrack: (provider: Provider, id: string) => Promise<Track>;
  cache: (track: Track) => Promise<CachedMusic | undefined>;
  metadata: (track: Track) => Promise<Track>;
  acquire?: (track: Track) => Promise<CachedMusic>;
  invalidate?: (track: Track, record: CachedMusic) => Promise<void>;
  chooseNames?: (userId: number, language: AlbumLanguage) => Promise<void>;
}
export function cachedInlineAudio(record: CachedMusic): boolean {
  // CachedAudio is MP3-only. A FLAC accepted by sendAudio is still rejected
  // here, and one unsupported result rejects the entire inline response.
  return /mp3|mpeg.*layer[ -]?3/i.test(record.audio?.codec || '') && !record.audio?.lossless;
}
const providers = botProviders.map(provider => provider.id);
const kinds: MusicSearchKind[] = ['track', 'album', 'artist', 'playlist'];
const codes: Partial<Record<Provider, string>> = { netease: 'n', spotify: 's', ytm: 'y' };
const codeProviders: Record<string, Provider> = { n: 'netease', s: 'spotify', y: 'ytm' };
export function inlineStart(track: Pick<Track, 'provider' | 'id'>): string {
  validateTrackId(track.provider, track.id);
  if (!codes[track.provider]) throw new ServiceError('UNSUPPORTED_LINK', '此來源請使用網頁播放器。');
  return `in_${codes[track.provider]}_${track.id}`;
}
export function parseInlineStart(value: string): Pick<Track, 'provider' | 'id'> | undefined {
  const match = /^in_([nsy])_([a-zA-Z0-9_-]{1,22})$/.exec(value);
  if (!match) return;
  const provider = codeProviders[match[1]!]!;
  validateTrackId(provider, match[2]!);
  return { provider, id: match[2]! };
}
export function parseInlineQuery(value: string) {
  let input = value.trim(), provider: BotSource = 'all', kind: MusicSearchKind = 'track', albums = false;
  let hasProvider = false, hasKind = false;
  for (let i = 0; i < 2; i++) {
    const match = /^(all|netease|spotify|ytm|track|song|album|albums|artist|playlist)(?:\s+|$)/i.exec(input);
    if (!match) break;
    const word = match[1]!.toLowerCase();
    const isProvider = word === 'all' || providers.includes(word as Provider);
    if (isProvider && !hasProvider) { provider = word as BotSource; hasProvider = true; }
    else if (!hasKind && !isProvider) { kind = word === 'song' ? 'track' : word === 'albums' ? 'album' : word as MusicSearchKind; albums = word === 'albums'; hasKind = true; }
    else break;
    input = input.slice(match[0].length).trim();
  }
  const link = parseMusicLink(input);
  if (link && !providers.includes(link.provider)) throw new ServiceError('UNSUPPORTED_LINK', '此來源請使用網頁播放器。');
  if (link) provider = link.provider;
  return { input, provider, kind, albums: albums && link?.kind === 'artist' };
}
function thumbnail(raw: string): Record<string, string> {
  try {
    if (!raw) return {};
    const url = coverUrl(raw);
    if (url.hostname.endsWith('.music.126.net')) url.searchParams.set('param', '160y160');
    return { thumbnail_url: url.href };
  } catch { return {}; }
}
const content = (text: string) => ({ message_text: text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
function job(record: CachedMusic, track: Track): DownloadJob {
  return { ...record, track, id: 'inline-cache', format: 'original', status: 'completed', stage: '', createdAt: '', updatedAt: '' };
}
const label = (kind: MusicSearchKind) => kind === 'track' ? 'single' : kind;
const source = botProviderName;

// Telegram does not support switch_inline_query_current_chat in channels.
// Keep browsing usable there by offering the native destination chooser.
function forInlineChat<T>(results: T[], type?: string): T[] {
  if (type !== 'channel') return results;
  return results.map(result => {
    const value = result as T & { reply_markup?: { inline_keyboard: Record<string, unknown>[][] } };
    if (!value.reply_markup) return result;
    return { ...value, reply_markup: { inline_keyboard: value.reply_markup.inline_keyboard.map(row => row.map(button => {
      if (typeof button.switch_inline_query_current_chat === 'string') {
        const { switch_inline_query_current_chat: query, ...rest } = button;
        return { ...rest, switch_inline_query_chosen_chat: { query, allow_user_chats: true, allow_bot_chats: true, allow_group_chats: true, allow_channel_chats: true } };
      }
      if (typeof button.callback_data === 'string' && button.callback_data.startsWith('ix:')) return { ...button, callback_data: button.callback_data.replace('ix:', 'ic:') };
      return button;
    })) } };
  });
}

// Typing only searches metadata. Selecting a result acquires a Telegram
// playback reference and replaces that same inline message with native audio.
export class BotInline {
  private queries = new Map<string, { until: number; value: Promise<Collection> }>();
  private latest = new Map<number, string>();
  private preparing = new Map<string, Promise<void>>();
  constructor(private deps: Dependencies, private timeoutMs = 7000) {}
  private privateUrl(track?: Track) { return `https://t.me/${this.deps.username()}?start=${track ? inlineStart(track) : 'inline'}`; }
  private async visible(track: Track, names?: AlbumLanguage): Promise<Track> {
    return displayTrack(track.provider === 'netease' && names && names !== 'original' ? await this.deps.metadata(track) : track, names || 'original');
  }
  private keyboard(track: Track, ui: BotLanguage, acquire?: Record<string, string>, playback = false) {
    const rows: Record<string, string>[][] = [];
    if (acquire) rows.push([{ text: botText(ui, acquire.callback_data?.startsWith('ip:') ? 'play' : 'acquire'), ...acquire }]);
    const row: Record<string, string>[] = [];
    try {
      const album = track.albumUrl ? parseMusicLink(track.albumUrl) : undefined;
      if (album?.kind === 'album' && album.provider === track.provider) row.push({ text: botText(ui, 'album'), switch_inline_query_current_chat: album.url });
    } catch { /* Untrusted upstream reference. */ }
    const artist = track.artistIds?.[0];
    if (artist && (track.provider === 'netease' ? /^\d{1,16}$/ : /^[a-zA-Z0-9]{22}$/).test(artist) && track.provider !== 'ytm') row.push({ text: shortText(track.artists[0] || botText(ui, 'artist'), 20), switch_inline_query_current_chat: track.provider === 'netease' ? `https://music.163.com/artist?id=${artist}` : `https://open.spotify.com/artist/${artist}` });
    row.push({ text: `${botText(ui, 'source')} ↗`, url: track.sourceUrl });
    rows.push(row);
    rows.push([...(playback ? [{ text: botText(ui, 'originalFile'), url: `https://t.me/${this.deps.username()}?start=${inlineStart(track).replace(/^in_/, 'raw_')}` }] : []), { text: botText(ui, 'share'), switch_inline_query: track.sourceUrl }]);
    return { inline_keyboard: rows };
  }
  private article(track: Track, visible: Track, ui: BotLanguage, userId: number, record?: CachedMusic, privateOnly = false) {
    const description = [visible.artists.join(' / '), visible.album, source(track.provider), botText(ui, record && !privateOnly ? 'inlineReady' : 'play')].filter(Boolean).join(' · ');
    const text = `<b>「${escapeHtml(shortText(visible.title, 100))}」</b> — ${escapeHtml(shortText(visible.artists.join(' / '), 120))}\n<i>${escapeHtml(botText(ui, 'preparePlayback'))}</i>`;
    return { type: 'article', id: `${track.provider}:${track.id}`, title: shortText(visible.title, 100), description: shortText(description, 250), ...thumbnail(track.cover), input_message_content: content(text),
      reply_markup: this.keyboard(visible, ui, { callback_data: `ip:${userId}:${codes[track.provider]}:${track.id}` }) };
  }
  private async trackResult(track: Track, ui: BotLanguage, names: AlbumLanguage | undefined, userId: number) {
    const [visible, record] = await Promise.all([this.visible(track, names), this.deps.cache(track)]);
    const firstNames = track.provider === 'netease' && !names;
    const privateOnly = record?.kind !== 'audio' || !cachedInlineAudio(record);
    const fallback = this.article(track, visible, ui, userId, firstNames ? undefined : record, privateOnly);
    if (!record || firstNames || privateOnly) return { result: fallback, fallback };
    const shared = { id: `${fallback.id}:audio`, caption: musicCaption(visible, job(record, track), ui, this.deps.username()), parse_mode: 'HTML', reply_markup: this.keyboard(visible, ui, undefined, record.presentation === 'telegram-playback') };
    return { result: { type: 'audio', audio_file_id: record.fileId, ...shared }, fallback };
  }
  private entity(entity: MusicEntity, ui: BotLanguage) {
    const description = [botText(ui, label(entity.kind)), entity.artists.join(' / '), entity.year, entity.count !== undefined ? botText(ui, 'tracksCount', { count: entity.count }) : '', source(entity.provider)].filter(Boolean).join(' · ');
    const rows = [[{ text: botText(ui, 'browseInline'), switch_inline_query_current_chat: entity.sourceUrl }]];
    if (entity.kind === 'artist') rows.push([{ text: botText(ui, 'album'), switch_inline_query_current_chat: `albums ${entity.sourceUrl}` }]);
    return { type: 'article', id: `${entity.provider}:${entity.kind}:${entity.id}`, title: shortText(entity.title, 100), description: shortText(description, 250), ...thumbnail(entity.cover),
      input_message_content: content(`<b>${escapeHtml(shortText(entity.title, 100))}</b>\n${escapeHtml(description)}\n<blockquote expandable>${source(entity.provider)}</blockquote>`), reply_markup: { inline_keyboard: [...rows, [{ text: `${botText(ui, 'source')} ↗`, url: entity.sourceUrl }]] } };
  }
  private choices(input: string, provider: BotSource, ui: BotLanguage, text?: string) {
    const keyboard = { inline_keyboard: [kinds.map(kind => ({ text: botText(ui, label(kind)), switch_inline_query_current_chat: `${provider} ${kind} ${input}`.trim() })),
      (['all', ...searchableProviders('track').map(provider => provider.id)] as BotSource[]).map(value => ({ text: value === 'all' ? botText(ui, 'allSources') : source(value), switch_inline_query_current_chat: `${value} ${input}`.trim() }))] };
    return [{ type: 'article', id: 'inline-search', title: text || botText(ui, 'inlineSearch'), description: botText(ui, 'inlineHint'),
      input_message_content: content(escapeHtml(text || botText(ui, 'inlineHint'))), reply_markup: keyboard }];
  }
  private collection(input: ReturnType<typeof parseInlineQuery>): Promise<Collection> {
    const key = JSON.stringify(input), now = Date.now();
    for (const [id, entry] of this.queries) if (entry.until < now) this.queries.delete(id);
    const cached = this.queries.get(key);
    if (cached) return cached.value;
    if (this.queries.size >= 32) throw new ServiceError('RATE_LIMIT', 'Inline search busy');
    // NetEase indexes Chinese names in SC. Normalize search terms only;
    // platform links and source/display metadata keep their original text.
    const search = input.provider === 'netease' && !parseMusicLink(input.input) ? searchText(input.input, 'netease') : input.input;
    const value = input.albums ? this.deps.albums(input.input) : this.deps.resolve(search, input.provider, input.kind);
    const entry = { until: now + 120_000, value };
    this.queries.set(key, entry);
    void value.catch(() => { if (this.queries.get(key) === entry) this.queries.delete(key); });
    return value;
  }
  async answer(query: InlineQuery, permitted = true): Promise<void> {
    const base = { inline_query_id: query.id, cache_time: 0, is_personal: true };
    if (!permitted) { await this.deps.telegram('answerInlineQuery', { ...base, results: [], next_offset: '' }); return; }
    this.latest.delete(query.from.id); this.latest.set(query.from.id, query.id);
    if (this.latest.size > 1000) this.latest.delete(this.latest.keys().next().value!);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let ui: BotLanguage = 'en';
    try {
      const work = async () => {
        const prefs = await this.deps.preferences(query.from.id); ui = prefs.ui;
        const parsed = parseInlineQuery(query.query);
        const hash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex').slice(0, 12);
        const offset = query.offset || '';
        if (offset && !new RegExp(`^${hash}:[0-9]{1,3}$`).test(offset)) return { results: [], next_offset: '' };
        if (!parsed.input) return { results: this.choices('', parsed.provider, ui), next_offset: '' };
        const collection = await this.collection(parsed);
        const evidence = new Map<string, SourceEvidence>();
        if (!collection.entities) await Promise.all(collection.tracks.map(async track => {
          const record = await this.deps.cache(track);
          if (record) evidence.set(trackIdentity(track), { availability: 'complete', ...record.audio, cached: record.kind === 'audio' && cachedInlineAudio(record) });
        }));
        const items = collection.entities || recordingGroups(collection).map(group => rankedSources(group, evidence)[0]!);
        const start = offset ? Number(offset.split(':')[1]) : 0;
        if (!items.length) return { results: this.choices(parsed.input, parsed.provider, ui, botText(ui, 'noResults')), next_offset: '' };
        const page = items.slice(start, start + 10);
        const results = collection.entities ? page.map(item => ({ result: this.entity(item as MusicEntity, ui), fallback: this.entity(item as MusicEntity, ui) })) :
          await Promise.all(page.map(item => this.trackResult(item as Track, ui, prefs.names, query.from.id)));
        const navigation = start === 0 && collection.kind === 'search' ? this.choices(parsed.input, parsed.provider, ui) : [];
        return { results: [...results.map(item => item.result), ...navigation], fallback: [...results.map(item => item.fallback), ...navigation], next_offset: start + 10 < items.length ? `${hash}:${start + 10}` : '' };
      };
      const response = await Promise.race([work(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ServiceError('UPSTREAM_TIMEOUT', 'Inline search timeout')), this.timeoutMs); })]);
      if (this.latest.get(query.from.id) !== query.id) return;
      const { fallback, ...body } = response;
      try { await this.deps.telegram('answerInlineQuery', { ...base, ...body, results: forInlineChat(body.results, query.chat_type), button: { text: botText(ui, 'settings'), start_parameter: 'inline_settings' } }); }
      catch (error) {
        // Some Telegram audio formats are accepted in chats but not in cached
        // inline results. A text result can still start the playback flow.
        if (!fallback || !(rejectedFileId(error) || error instanceof TelegramRequestError && error.errorCode === 400 && /file type|audio|document/i.test(error.description))) throw error;
        await this.deps.telegram('answerInlineQuery', { ...base, results: forInlineChat(fallback, query.chat_type), next_offset: response.next_offset, button: { text: botText(ui, 'settings'), start_parameter: 'inline_settings' } });
      }
    } catch (error) {
      if (this.latest.get(query.from.id) !== query.id) return;
      if (error instanceof TelegramRequestError) {
        if (!/query (is )?too old|query[_ ]id[_ ]invalid|query ID is invalid/i.test(error.description)) {
          // Only Telegram's error category is logged; never include a query,
          // user, payload, file_id or credential in diagnostics.
          console.error('Telegram Inline response rejected:', error.errorCode,
            error.description.replace(/https?:\/\/\S+/g, '[URL]').replace(/[\w-]{30,}/g, '[reference]').slice(0, 180));
        }
        return;
      }
      await this.deps.telegram('answerInlineQuery', { ...base, results: this.choices('', 'all', ui, botError(ui, publicError(error).code)), next_offset: '', button: { text: botText(ui, 'settings'), start_parameter: 'inline_settings' } }).catch(() => {});
    } finally { if (timer) clearTimeout(timer); if (this.latest.get(query.from.id) === query.id) this.latest.delete(query.from.id); }
  }
  private async finish(track: Track, userId: number, inlineId: string, selected?: AlbumLanguage): Promise<void> {
    const prefs = await this.deps.preferences(userId), names = selected || prefs.names, ui = prefs.ui;
    if (track.provider === 'netease' && !names) {
      await this.deps.telegram('editMessageText', { inline_message_id: inlineId, text: botText(ui, 'firstNames'), reply_markup: { inline_keyboard:
        (['original', 'zh-Hant', 'zh-Hans'] as const).map(language => [{ text: botText(ui, language === 'original' ? 'original' : language === 'zh-Hant' ? 'traditional' : 'simplified'), callback_data: `inlang:${userId}:${codes[track.provider]}:${track.id}:${language}` }]) } });
      return;
    }
    const visible = await this.visible(track, names);
    try {
      await this.deps.telegram('editMessageText', { inline_message_id: inlineId,
        text: `<b>「${escapeHtml(visible.title)}」</b> — ${escapeHtml(visible.artists.join(' / '))}\n<i>${escapeHtml(botText(ui, 'preparePlayback'))}</i>`, parse_mode: 'HTML',
        reply_markup: forInlineChat([{ reply_markup: this.keyboard(visible, ui, { callback_data: `ip:${userId}:${codes[track.provider]}:${track.id}` }) }], 'channel')[0]!.reply_markup,
      }).catch(error => { if (!(error instanceof TelegramRequestError && /message is not modified/i.test(error.description))) throw error; });
      const acquire = this.deps.acquire;
      if (!acquire) throw new ServiceError('INLINE_CACHE_SETUP', 'Playback acquisition unavailable');
      const edit = async (record: CachedMusic) => this.deps.telegram('editMessageMedia', { inline_message_id: inlineId,
        media: { type: 'audio', media: record.fileId, caption: musicCaption(visible, job(record, track), ui, this.deps.username()), parse_mode: 'HTML', title: visible.title, performer: visible.artists.join(' / '), duration: record.duration },
        reply_markup: forInlineChat([{ reply_markup: this.keyboard(visible, ui, undefined, record.presentation === 'telegram-playback') }], 'channel')[0]!.reply_markup });
      let record = await acquire(track);
      try { await edit(record); }
      catch (error) {
        if (!rejectedFileId(error) || !this.deps.invalidate) throw error;
        await this.deps.invalidate(track, record); record = await acquire(track); await edit(record);
      }
    } catch (error) {
      if (error instanceof TelegramRequestError && /message is not modified/i.test(error.description)) return;
      await this.deps.telegram('editMessageText', { inline_message_id: inlineId, text: `${escapeHtml(visible.title)}\n${escapeHtml(botError(ui, publicError(error).code))}`, parse_mode: 'HTML', reply_markup: forInlineChat([{ reply_markup: this.keyboard(visible, ui, { callback_data: `ip:${userId}:${codes[track.provider]}:${track.id}` }) }], 'channel')[0]!.reply_markup }).catch(() => {});
    }
  }
  async chosen(result: ChosenInline): Promise<void> {
    if (!result.inline_message_id) return;
    const match = /^(netease|spotify|ytm):([a-zA-Z0-9_-]{1,22})(:audio)?$/.exec(result.result_id);
    if (!match || match[3]) return; // Telegram already inserted a cached native player.
    await this.startPlayback(match[1] as Provider, match[2]!, result.from.id, result.inline_message_id);
  }
  private async startPlayback(provider: Provider, id: string, userId: number, inlineId: string, selected?: AlbumLanguage): Promise<void> {
    const pending = this.preparing.get(inlineId);
    if (pending) return pending;
    const work = (async () => {
      try {
        validateTrackId(provider, id);
        await this.finish(await this.deps.getTrack(provider, id), userId, inlineId, selected);
      } catch (error) {
        const { ui } = await this.deps.preferences(userId);
        await this.deps.telegram('editMessageText', { inline_message_id: inlineId, text: botError(ui, publicError(error).code),
          reply_markup: { inline_keyboard: [[{ text: botText(ui, 'play'), callback_data: `ip:${userId}:${codes[provider]}:${id}` }]] } }).catch(() => {});
      }
    })();
    this.preparing.set(inlineId, work);
    try { await work; } finally { if (this.preparing.get(inlineId) === work) this.preparing.delete(inlineId); }
  }
  async callback(callback: { id: string; from: { id: number }; inline_message_id: string; data?: string }): Promise<void> {
    const { ui, names } = await this.deps.preferences(callback.from.id);
    const type = callback.data?.startsWith('ic:') ? 'channel' : undefined;
    const markup = (track: Track, acquire?: Record<string, string>) => forInlineChat([{ reply_markup: this.keyboard(track, ui, acquire) }], type)[0]!.reply_markup;
    const playback = /^ip:(\d+):([nsy]):([a-zA-Z0-9_-]{1,22})$/.exec(callback.data || '');
    const language = /^inlang:(\d+):([nsy]):([a-zA-Z0-9_-]{1,22}):(original|zh-Hant|zh-Hans)$/.exec(callback.data || '');
    const match = playback || language || /^ix:(\d+):([nsy]):([a-zA-Z0-9_-]{1,22})$/.exec((callback.data || '').replace(/^ic:/, 'ix:'));
    if (!match || Number(match[1]) !== callback.from.id) {
      await this.deps.telegram('answerCallbackQuery', { callback_query_id: callback.id, text: botText(ui, 'wrongOwner'), show_alert: true }); return;
    }
    await this.deps.telegram('answerCallbackQuery', { callback_query_id: callback.id });
    if (playback || language || this.deps.acquire) {
      if (language) await this.deps.chooseNames?.(callback.from.id, language[4] as AlbumLanguage);
      await this.startPlayback(codeProviders[match[2]!]!, match[3]!, callback.from.id, callback.inline_message_id, language?.[4] as AlbumLanguage | undefined);
      return;
    }
    try {
      const track = await this.deps.getTrack(codeProviders[match[2]!]!, match[3]!);
      const [record, visible] = await Promise.all([this.deps.cache(track), this.visible(track, names)]);
      if (!record || record.kind === 'audio' && !cachedInlineAudio(record)) {
        await this.deps.telegram('editMessageText', { inline_message_id: callback.inline_message_id, text: `${escapeHtml(visible.title)}\n${escapeHtml(botText(ui, 'inlinePrivate'))}`, parse_mode: 'HTML', reply_markup: markup(visible, { url: this.privateUrl(track) }) }); return;
      }
      await this.deps.telegram('editMessageMedia', { inline_message_id: callback.inline_message_id,
        media: { type: record.kind, media: record.fileId, caption: musicCaption(visible, job(record, track), ui, this.deps.username()), parse_mode: 'HTML', ...(record.kind === 'audio' ? { title: visible.title, performer: visible.artists.join(' / '), duration: record.duration } : {}) }, reply_markup: markup(visible) });
    } catch (error) {
      if (error instanceof TelegramRequestError && /message is not modified/i.test(error.description)) return;
      await this.deps.telegram('editMessageText', { inline_message_id: callback.inline_message_id, text: botError(ui, publicError(error).code), reply_markup: { inline_keyboard: [[{ text: botText(ui, 'acquire'), url: `https://t.me/${this.deps.username()}?start=in_${match[2]}_${match[3]}` }]] } }).catch(() => {});
    }
  }
}
