import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/lib/server/config.js';
import { botTransport, botRequestTimeout, checkBotUpload, botUploadFile } from '../src/lib/server/bot-transport.js';
import { canCloseSelection } from '../src/lib/server/bot-close.js';
import { DownloadStore } from '../src/lib/server/downloads.js';
import { publicError, ServiceError } from '../src/lib/server/errors.js';
import { artistAlbums, resolveMusic, getTrack } from '../src/lib/server/music.js';
import { resolveBotMusic, type BotSource } from '../src/lib/server/bot-search.js';
import { neteaseLyrics } from '../src/lib/server/providers/netease.js';
import { isMyhkProvider, myhkLyrics } from '../src/lib/server/providers/myhk.js';
import { musicSourceUrl } from '../src/lib/server/links.js';
import { safeFilename } from '../src/lib/server/links.js';
import { resolveNeteaseCommand } from '../src/lib/server/bot-input.js';
import { BotLanguageSettings, BotSettingsStore, displayTrack, type AlbumLanguage } from '../src/lib/server/bot-settings.js';
import { audioPresentation, musicReferencePayload, sendMusic, TelegramRequestError } from '../src/lib/server/bot-media.js';
import { BotCaptionDetails } from '../src/lib/server/bot-caption-details.js';
import { BotGroupReplies, withGroupReply } from '../src/lib/server/bot-group-replies.js';
import { BotDeleteEvents } from '../src/lib/server/bot-delete-events.js';
import { BotMusicCache, rejectedFileId, type CachedMusic } from '../src/lib/server/bot-cache.js';
import { BotDispatch } from '../src/lib/server/bot-dispatch.js';
import { BotPlayback } from '../src/lib/server/bot-playback.js';
import { BotAudioNames } from '../src/lib/server/bot-audio-names.js';
import { BotInline, parseInlineStart, parseBrowseStart, type InlineQuery } from '../src/lib/server/bot-inline.js';
import { musicCacheKey, telegramPlaybackKey } from '../src/lib/server/bot-cache-key.js';
import { BotMessageCleanup } from '../src/lib/server/bot-cleanup.js';
import { BotSelections, selectionLifetime, selectionPageSize, selectionCount, type MusicSelection } from '../src/lib/server/bot-selection.js';
import { BotSelectionDelivery } from '../src/lib/server/bot-selection-delivery.js';
import { searchableProviders } from '../src/lib/server/bot-providers.js';
import { trackIdentity, sourceFallbackAllowed, type SourceEvidence } from '../src/lib/server/bot-recordings.js';
import { metadataForDisplay } from '../src/lib/server/bot-metadata.js';
import { botCommands, botHelp, botText, botError } from '../src/lib/server/bot-i18n.js';
import type { Track, Provider, Collection, MusicSearchKind } from '../src/lib/types.js';

const token = process.env.BOT_TOKEN;
if (!token) { console.error('請在 .env 配置 BOT_TOKEN。'); process.exit(1); }
const webAppUrl = new URL(process.env.BOT_WEB_APP_URL || 'https://music.ism.tw');
if (webAppUrl.protocol !== 'https:' || webAppUrl.username || webAppUrl.password) throw new Error('BOT_WEB_APP_URL 必須是 HTTPS 網址。');
const transport = botTransport();
const endpoint = `${transport.base}bot${token}/`;
const allowed = new Set((process.env.BOT_ALLOWED_USERS || '').split(',').map((v) => v.trim()).filter(Boolean));
const store = new DownloadStore('bot', undefined, undefined, Math.max(config.maxFileBytes, transport.maxUploadBytes));
const mediaCache = new BotMusicCache(token.split(':')[0]!);
const selections = new BotSelections();
const lastRequest = new Map<number, number>();
let stopping = false, offset = 0;
const dispatch = new BotDispatch();
let botUsername = 'muismbot';
const statePath = resolve(process.env.DATA_DIR || '.data', 'bot-offset', `${token.split(':')[0]}.json`);

interface User { id: number; language_code?: string; is_bot?: boolean; first_name?: string; username?: string }
interface Message { message_id: number; message_thread_id?: number; is_topic_message?: boolean; sender_chat?: { id: number }; via_bot?: { id: number; is_bot?: boolean }; chat: { id: number; type?: string }; audio?: { duration: number }; from?: User; text?: string; entities?: { type: string; offset: number; url?: string; user?: { id: number } }[]; reply_to_message?: { message_id: number; from?: { username?: string } } }
interface Update { update_id: number; message?: Message; callback_query?: { id: string; from: User; data?: string; message?: Message; inline_message_id?: string }; inline_query?: InlineQuery; chosen_inline_result?: { result_id: string; from: User; inline_message_id?: string; query: string } }
const topicThread = (message: Message) => message.is_topic_message ? message.message_thread_id : undefined;

const captionDetails = new BotCaptionDetails(token.split(':')[0]!);
const groupReplies = new BotGroupReplies(token.split(':')[0]!);
const deleteEvents = new BotDeleteEvents();
export async function telegram<T>(method: string, body: Record<string, unknown> | FormData = {}): Promise<T> {
  const context = replyContext.getStore();
  const read = (key: string) => body instanceof FormData ? body.get(key) : body[key];
  const parameters = read('reply_parameters');
  if (/^send(?:Message|RichMessage|Audio|Document)$/.test(method) && context?.userId && context.chatId < 0 && Number(read('chat_id')) === context.chatId && parameters) {
    const reply = typeof parameters === 'string' ? JSON.parse(parameters) : parameters as { message_id: number };
    body = withGroupReply(body, { userId: context.userId, name: context.userName, username: context.userUsername, requestId: reply.message_id, language: await preferences.locale(context.userId) });
  }
  return groupReplies.run<T>(method, body, requestTelegram);
}
async function requestTelegram<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
  body = await captionDetails.prepare(method, body);
  const response = await fetch(`${endpoint}${method}`, { method: 'POST',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(botRequestTimeout(method, body, transport.local)) });
  const data = await response.json() as { ok: boolean; result: T; error_code?: number; description?: string };
  if (!data.ok) throw new TelegramRequestError(data.error_code || response.status, data.description || '');
  return data.result;
}
const cleanup = new BotMessageCleanup(token.split(':')[0]!, (chatId, messageId) => telegram('deleteMessage', { chat_id: chatId, message_id: messageId }));
const removeNow = (chatId: number, messageId: number) => cleanup.removeNow(chatId, messageId).catch(() => console.error('Bot 訊息清理稍後重試。'));
const deleteLater = (chatId: number, messageId: number, delayMs: number) => cleanup.schedule(chatId, messageId, delayMs).catch(() => console.error('Bot 訊息清理排程失敗。'));
const replyContext = new AsyncLocalStorage<{ chatId: number; messageId: number; messageThreadId?: number; userId?: number; userName?: string; userUsername?: string }>();
async function send(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const context = replyContext.getStore();
  const defaults = context?.chatId === chatId ? { message_thread_id: context.messageThreadId, reply_parameters: replyParameters(context.messageId) } : {};
  const { deleteAfterMs, ...body } = extra;
  const message = await telegram<{ message_id: number }>('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...defaults, ...body });
  if (typeof deleteAfterMs === 'number') await deleteLater(chatId, message.message_id, deleteAfterMs);
  return message;
}
const replyParameters = (messageId: number) => ({ message_id: messageId, allow_sending_without_reply: true });
const notice = (chatId: number, text: string, messageId: number) => send(chatId, text, { deleteAfterMs: 60_000, reply_parameters: replyParameters(messageId) });
function permitted(id: number): boolean { return !allowed.size || allowed.has(String(id)); }
const commandLanguages = new Map<string, string>();
async function updateCommands(chatId: number, language: Parameters<typeof botCommands>[0], userId: number) {
  const key = `${chatId}:${chatId < 0 ? userId : 0}`;
  if (commandLanguages.get(key) === language) return;
  const scope = chatId < 0 ? { type: 'chat_member', chat_id: chatId, user_id: userId } : { type: 'chat', chat_id: chatId };
  await telegram('setMyCommands', { commands: botCommands(language), scope });
  if (chatId > 0) await telegram('setChatMenuButton', { chat_id: chatId, menu_button: {
    type: 'web_app', text: botText(language, 'openPlayer'), web_app: { url: webAppUrl.href },
  } });
  if (commandLanguages.size >= 1000) commandLanguages.delete(commandLanguages.keys().next().value!);
  commandLanguages.set(key, language);
}
const settingsPanel = new AsyncLocalStorage<{ chatId: number; messageId: number } | undefined>();
async function sendSettings(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  const panel = settingsPanel.getStore();
  if (panel?.chatId === chatId && extra.reply_markup) {
    const { deleteAfterMs, reply_parameters, ...body } = extra;
    try { await telegram('editMessageText', { chat_id: chatId, message_id: panel.messageId, text, ...body }); }
    catch (error) { if (!(error instanceof TelegramRequestError && /message is not modified/i.test(error.description))) throw error; }
    return { message_id: panel.messageId };
  }
  return send(chatId, text, { ...extra, ...(chatId > 0 ? { reply_parameters: undefined } : {}) });
}
const settingsStore = new BotSettingsStore();
const selectionDelivery = new BotSelectionDelivery(telegram);
const preferences = new BotLanguageSettings(settingsStore, sendSettings, sendTrack, updateCommands);
const cacheChat = () => {
  const value = process.env.BOT_CACHE_CHAT_ID;
  return value && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
};
const playback = new BotPlayback(store, mediaCache, telegram, cacheChat, () => botUsername, undefined, undefined, () => stopping);
const audioNames = new BotAudioNames(mediaCache, telegram, cacheChat, () => botUsername);
async function namedPlayback(track: Track, visible = track, preferOriginal = true): Promise<CachedMusic> {
  const record = await playback.get(track, preferOriginal);
  try { return await audioNames.get(track, visible, record); }
  catch (error) {
    if (!rejectedFileId(error)) throw error;
    await playback.invalidate(track, record);
    return audioNames.get(track, visible, await playback.get(track, preferOriginal));
  }
}
const inline = new BotInline({
  telegram, username: () => botUsername, resolve: resolveBotMusic, albums: artistAlbums, getTrack,
  preferences: async userId => ({ ui: await preferences.locale(userId), names: (await settingsStore.get(userId)).language }),
  cache: async (track, visible) => {
    const key = await musicCacheKey(track);
    const original = await mediaCache.get(key);
    const record = original?.kind === 'audio' ? original : await mediaCache.get(telegramPlaybackKey(key)) || original;
    return record && visible ? await audioNames.peek(track, visible, record) || record : record;
  }, metadata: track => metadataForDisplay(track, 250),
  acquire: (track, visible) => namedPlayback(track, visible), fallbackPlayback: (track, visible) => namedPlayback(track, visible, false),
  invalidate: async (track, record) => { await audioNames.invalidate(track, record); await playback.invalidate(track, record); },
  chooseNames: (userId, language) => settingsStore.setNamesLanguage(userId, language),
});

async function sendTrack(chatId: number, userId: number, track: Track, language: AlbumLanguage, messageId: number, messageThreadId?: number, keepRequest = false, inlineMode = false, originalFile = false): Promise<void> {
  const owner = `tg:${chatId}:${userId}`;
  const ui = await preferences.locale(userId);
  let visible = displayTrack(language !== 'original' ? await metadataForDisplay(track) : track, language);
  let primaryKey = await musicCacheKey(track);
  const sendRecord = async (record: CachedMusic) => {
    const job = { ...record, id: 'telegram-cache', track, format: 'original' as const, status: 'completed' as const,
      stage: '', createdAt: '', updatedAt: '' };
    await telegram(record.kind === 'audio' ? 'sendAudio' : 'sendDocument', musicReferencePayload({
      chatId, messageThreadId, replyTo: chatId < 0 ? messageId : undefined, track: visible, job, fileId: record.fileId, kind: record.kind, duration: record.duration, uiLanguage: ui, botUsername,
    }));
  };
  if (!originalFile) {
    const source = await mediaCache.get(primaryKey);
    const cached = source?.kind === 'audio' ? source : await mediaCache.get(telegramPlaybackKey(primaryKey));
    const progress = cached?.kind === 'audio' ? undefined : await send(chatId, botText(ui, 'fetching', { title: visible.title, source: track.provider }), { message_thread_id: messageThreadId, deleteAfterMs: 7 * 60_000, reply_parameters: replyParameters(messageId) });
    try {
      let record: CachedMusic | undefined;
      const candidates = selections.request(chatId, userId, messageId, messageThreadId)?.pendingSources || [track];
      for (let index = 0; index < candidates.length; index++) {
        const candidate = candidates[index]!;
        try { record = await playback.get(candidate); }
        catch (error) {
          if (index === candidates.length - 1 || !sourceFallbackAllowed(error)) throw error;
          continue;
        }
        track = candidate;
        primaryKey = await musicCacheKey(track);
        const names = (await settingsStore.get(userId)).language || language;
        visible = displayTrack(names !== 'original' ? await metadataForDisplay(track) : track, names);
        break;
      }
      if (!record) throw new ServiceError('NO_AUDIO', 'No complete source');
      try { record = await audioNames.get(track, visible, record); }
      catch (error) {
        if (!rejectedFileId(error)) throw error;
        await playback.invalidate(track, record); record = await namedPlayback(track, visible);
      }
      try { await sendRecord(record); }
      catch (error) {
        if (!rejectedFileId(error)) throw error;
        await audioNames.invalidate(track, record); await playback.invalidate(track, record); await sendRecord(await namedPlayback(track, visible));
      }
    }
    finally { if (progress) await removeNow(chatId, progress.message_id); }
  } else await mediaCache.deliver(primaryKey, sendRecord, async () => {
    const progress = await send(chatId, botText(ui, 'fetching', { title: visible.title, source: track.provider === 'ytm' ? 'YTM' : track.provider }), { message_thread_id: messageThreadId, deleteAfterMs: 7 * 60_000, reply_parameters: replyParameters(messageId) });
    try {
    const [created] = await store.create(owner, [track], 'original');
    const until = Date.now() + 360_000;
    while (Date.now() < until && !stopping) {
      const job = (await store.list(owner)).find((j) => j.id === created!.id)!;
      if (job.status === 'failed') throw new ServiceError(job.errorCode || 'ADAPTER_FAILED', '下載失敗。', 502);
      if (job.status === 'completed') {
        const { path } = await store.file(owner, job.id);
        checkBotUpload((await stat(path)).size);
        const presentation = await audioPresentation(path, track);
        let record: CachedMusic | undefined;
        const asDocument = originalFile;
        const delivery = await sendMusic(telegram, { chatId, messageThreadId, replyTo: chatId < 0 ? messageId : undefined, job, track: visible, uiLanguage: ui, botUsername, asDocument,
          file: await botUploadFile(path),
          filename: `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}${extname(path)}`, ...presentation,
          onDelivered: (kind, result) => {
            const message = result as { audio?: { file_id?: string }; document?: { file_id?: string } } | undefined;
            const fileId = message?.[kind]?.file_id;
            if (fileId) record = { fileId, kind, duration: presentation.duration, bytes: job.bytes!, audioSource: job.audioSource, audio: job.audio, ...(job.audioTrack ? { audioTrack: job.audioTrack } : {}) };
          },
        });
        // Telegram now holds the file. Do not keep a duplicate on this VPS.
        await store.remove(owner, job.id).catch(() => console.error('Bot 暫存音訊清理失敗。'));
        if (delivery === 'document' && !asDocument) await send(chatId, botText(ui, 'documentFallback'), { message_thread_id: messageThreadId, reply_parameters: replyParameters(messageId), deleteAfterMs: 30_000 }).catch(() => {});
        return record;
      }
      await new Promise((done) => setTimeout(done, 1500));
    }
    throw new ServiceError('DOWNLOAD_TIMEOUT', '下載等待超時。', 504);
    } finally { await removeNow(chatId, progress.message_id); }
  });
  // Reply first, then remove only the request that was actually fulfilled.
  const delivered = selections.delivered(chatId, messageId);
  if (chatId > 0) for (const inputId of delivered.inputIds.filter(id => !keepRequest || id !== messageId)) await removeNow(chatId, inputId);
  if (delivered.menuId) await removeNow(chatId, delivered.menuId);
}

async function listTracks(chatId: number, userId: number, input: string, provider: BotSource, messageId: number, searchType: MusicSearchKind = 'track'): Promise<void> {
  const collection = await resolveBotMusic(input, provider, searchType);
  await sendCollection(chatId, userId, collection, messageId);
}

async function prepareSelection(session: MusicSelection) {
  session.busy = true;
  const evidence = new Map<string, SourceEvidence>();
  try { await Promise.all(session.collection.tracks.map(async track => {
    const key = await musicCacheKey(track);
    const original = await mediaCache.get(key), playable = await mediaCache.get(telegramPlaybackKey(key));
    const measured = original?.audio;
    if (original || playable) evidence.set(trackIdentity(track), {
      availability: 'complete', lossless: measured?.lossless, codec: measured?.codec, bitrate: measured?.bitrate,
      sampleRate: measured?.sampleRate, bitsPerSample: measured?.bitsPerSample,
      cached: original?.kind === 'audio' || playable?.kind === 'audio',
    });
  })); } catch (error) { selections.abort(session); throw error; }
  selections.rank(session, evidence);
}
async function showSelection(session: MusicSelection, ui: Parameters<typeof botText>[0], edit = false) {
  const settings = await settingsStore.get(session.userId);
  const names = settings.language || 'original';
  session.rich ??= settings.richSearch;
  if (session.closed || session.previousSession?.closed) throw new ServiceError('SELECTION_CLOSED', 'Selection closed');
  let menu: { message_id: number };
  try { menu = await selectionDelivery.show(session, ui, names, edit); }
  catch (error) { if (session.previousSession || !session.menuId) selections.abort(session); throw error; }
  if (session.closed || session.previousSession?.closed) { await removeNow(session.chatId, menu.message_id); throw new ServiceError('SELECTION_CLOSED', 'Selection closed'); }
  selections.commit(session);
  session.busy = false;
  if (!edit) {
    session.menuId = menu.message_id;
    await deleteLater(session.chatId, menu.message_id, selectionLifetime);
  }
}
async function sendCollection(chatId: number, userId: number, collection: Collection, messageId: number, keepRequest = false): Promise<void> {
  const ui = await preferences.locale(userId);
  await updateCommands(chatId, ui, userId).catch(() => {});
  if (!collection.tracks.length && !collection.entities?.length && collection.kind !== 'search' && collection.kind !== 'artist') { await notice(chatId, botText(ui, 'notFound'), messageId); return; }
  if (collection.kind === 'track') return preferences.request(chatId, userId, collection.tracks[0]!, messageId, replyContext.getStore()?.messageThreadId);
  const messageThreadId = replyContext.getStore()?.messageThreadId;
  const session = selections.create(chatId, userId, messageId, collection, messageThreadId, keepRequest);
  session.userName = replyContext.getStore()?.userName;
  await prepareSelection(session);
  await showSelection(session, ui);
  if (chatId > 0 && !keepRequest && (collection.entities?.length || collection.tracks.length)) await removeNow(chatId, messageId);
}

async function chooseSelection(session: MusicSelection, index: number, ui: Parameters<typeof botText>[0], inputId = session.requestId, sourceIndex?: number): Promise<void> {
  if (session.busy) return;
  session.busy = true;
  const { chatId, userId, messageThreadId } = session;
  try {
    if (session.collection.entities) {
      const entity = selections.entity(session, index);
      const collection = await resolveMusic(entity.sourceUrl, entity.provider);
      const replacement = selections.replace(session, collection);
      await prepareSelection(replacement);
      await showSelection(replacement, ui, true);
      if (chatId > 0 && inputId !== session.requestId) await removeNow(chatId, inputId);
      return;
    }
    const sources = selections.sources(session, index);
    const track = sourceIndex === undefined ? sources[0]! : sources[sourceIndex];
    if (!track || !Number.isInteger(sourceIndex ?? index)) throw new ServiceError('SELECTION_NUMBER', 'Invalid source');
    session.pendingSources = sourceIndex === undefined ? sources : [track];
    session.panel = undefined;
    if (session.collection.kind === 'search' && session.menuId) await removeNow(chatId, session.menuId);
    await preferences.request(chatId, userId, track, inputId, messageThreadId, !!session.keepRequest && inputId === session.requestId);
  } catch (error) {
    session.busy = false;
    if (!session.closed && session.collection.kind === 'search' && !session.collection.entities) {
      const replacement = selections.replace(session, session.collection, false);
      replacement.page = session.page;
      await prepareSelection(replacement);
      await showSelection(replacement, ui);
    }
    throw error;
  } finally { session.busy = false; }
}

export async function handle(update: Update): Promise<void> {
  const message = update.message || update.callback_query?.message;
  if (!message) return handleUpdate(update);
  const user = update.callback_query?.from || message.from;
  return replyContext.run({ chatId: message.chat.id, messageId: message.message_id, messageThreadId: topicThread(message), userId: user?.id, userName: user?.first_name, userUsername: user?.username }, () => handleUpdate(update));
}

async function handleUpdate(update: Update): Promise<void> {
  // Inline shares are messages authored by the user, with via_bot marking
  // their origin. They are already results, never a new text search or an
  // input eligible for cleanup. Keep callback and ordinary reply handling.
  if (update.message?.via_bot) return;
  const user = update.message?.from || update.callback_query?.from || update.inline_query?.from || update.chosen_inline_result?.from;
  const userId = user?.id;
  // Inline queries have no chat ID and must always receive an answer, even
  // when the sender is outside an allowlist. They never enter chat cleanup.
  if (update.inline_query) {
    const permittedSender = !!userId && !user?.is_bot && permitted(userId);
    if (permittedSender) await preferences.observeLanguage(userId, user?.language_code).catch(() => {});
    await inline.answer(update.inline_query, permittedSender); return;
  }
  // Anonymous group senders cannot own personal settings or selection lists.
  if (!userId || user.is_bot || update.message?.sender_chat || !permitted(userId)) return;
  await preferences.observeLanguage(userId, user.language_code);
  if (update.callback_query?.data?.startsWith('md:')) {
    const callback = update.callback_query;
    await telegram('answerCallbackQuery', { callback_query_id: callback.id });
    const payload = await captionDetails.toggle(callback.data!, callback.message?.audio?.duration);
    if (payload) {
      const address = callback.inline_message_id ? { inline_message_id: callback.inline_message_id } : callback.message ? { chat_id: callback.message.chat.id, message_id: callback.message.message_id } : undefined;
      if (address) {
        await captionDetails.remember(callback.data!, address).catch(() => console.error('音樂卡片位置保存失敗。'));
        await telegram('editMessageCaption', { ...address, ...payload }).catch(error => {
          if (!(error instanceof TelegramRequestError && /message is not modified/i.test(error.description))) throw error;
        });
      }
    }
    return;
  }
  if (update.chosen_inline_result) { await inline.chosen(update.chosen_inline_result); return; }
  if (update.callback_query?.inline_message_id) {
    await inline.callback({ ...update.callback_query, inline_message_id: update.callback_query.inline_message_id }); return;
  }
  const message = update.message || update.callback_query?.message;
  if (!message) return;
  const chatId = message.chat.id, messageThreadId = topicThread(message);
  const ui = await preferences.locale(userId);
  try {
    if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id });
    if (update.callback_query && !update.callback_query.data?.startsWith('close:')) await groupReplies.observe(message, requestTelegram);
    let text = message.text?.trim() || '';
    const isPrivate = message.chat.type === 'private' || (message.chat.type === undefined && chatId > 0);
    const replyToBot = message.reply_to_message?.from?.username?.toLowerCase() === botUsername.toLowerCase();
    const ownMention = new RegExp(`(^|\\s)@${botUsername}(?=\\s|$)`, 'ig');
    const mentionsBot = ownMention.test(text);
    if (!update.callback_query && !text.startsWith('/')) text = text.replace(ownMention, '$1').trim();
    const [command, ...rest] = text.split(/\s+/); const args = rest.join(' ');
    const cmd = command?.split('@')[0];
    if (!update.callback_query && command?.startsWith('/') && command.includes('@') && command.split('@')[1]?.toLowerCase() !== botUsername.toLowerCase()) return;
    if (!update.callback_query) {
      if (cmd?.startsWith('/') && !['/start', '/app', '/help', '/about', '/settings', '/setting', '/lyric', '/netease', '/music', '/musicid', '/search', '/spotify', '/ytm', '/download', '/album', '/artist', '/playlist'].includes(cmd)) return;
      if (!cmd?.startsWith('/') && !/https?:\/\/|^spotify:/.test(text) && !isPrivate && !replyToBot && !mentionsBot) return;
      if (!text || (isPrivate && /^@[a-zA-Z0-9_]+$/.test(text))) { await preferences.start(chatId, userId, botUsername); return; }
    }
    await updateCommands(chatId, ui, userId).catch(() => {});
    if (update.callback_query?.data === 'open-settings') { await preferences.show(chatId, userId); return; }
    const original = update.callback_query?.data?.match(/^raw:(netease|spotify|ytm|qq|kuwo|kugou|migu|qianqian):([a-zA-Z0-9_-]{1,32})$/);
    if (original) {
      const track = await getTrack(original[1] as Provider, original[2]!);
      await sendTrack(chatId, userId, track, (await settingsStore.get(userId)).language || 'original', message.message_id, messageThreadId, true, false, true); return;
    }
    if (update.callback_query && /^(lang|ui|setting):/.test(update.callback_query.data || '')) {
      const own = Number(update.callback_query.data?.split(':')[1]) === userId;
      await settingsPanel.run(own ? { chatId, messageId: message.message_id } : undefined, () => preferences.callback(chatId, userId, update.callback_query!.data || '', () => removeNow(chatId, message.message_id)));
      return;
    }
    if (!update.callback_query && (cmd === '/settings' || cmd === '/setting')) { await preferences.show(chatId, userId); return; }
    const browse = update.callback_query?.data?.match(/^browse:(netease|spotify|qq|kuwo):(album|artist):([a-zA-Z0-9]{1,22})$/);
    if (browse) {
      const url = musicSourceUrl(browse[1] as Provider, browse[2] as 'album' | 'artist', browse[3]!);
      await sendCollection(chatId, userId, await resolveMusic(url, browse[1] as Provider), message.message_id, true);
      return;
    }
    const close = update.callback_query?.data?.match(/^close:([a-f0-9]{16})(?::\d{1,16}:[a-f0-9]{16})?$/);
    if (close) {
      let session: MusicSelection | undefined;
      try { session = selections.callback(chatId, userId, close[1]!, message.message_id); }
      catch (error) {
        if (!(error instanceof ServiceError && error.code === 'SELECTION_EXPIRED')) throw error;
        const knownOwner = chatId < 0 ? await groupReplies.selectionCloseOwner(chatId, message.message_id, userId, update.callback_query!.data!) : undefined;
        if (knownOwner === false || !canCloseSelection(message, userId, update.callback_query!.data!, Number(token!.split(':')[0]), token!, chatId < 0 && knownOwner === undefined)) throw new ServiceError('SELECTION_OWNER', 'Wrong close owner', 403);
      }
      if (session) selections.close(session);
      await removeNow(chatId, message.message_id); return;
    }
    const layout = update.callback_query?.data?.match(/^layout:([a-f0-9]{16}):(buttons|rich)$/);
    if (layout) {
      const session = selections.callback(chatId, userId, layout[1]!, message.message_id);
      if (session.busy) return;
      const previous = session.rich;
      session.busy = true; session.rich = layout[2] === 'rich';
      try { await showSelection(session, ui, true); await settingsStore.setRichSearch(userId, session.rich!); }
      catch (error) { session.rich = previous; throw error; }
      finally { session.busy = false; }
      return;
    }
    const back = update.callback_query?.data?.match(/^back:([a-f0-9]{16})$/);
    if (back) {
      const session = selections.callback(chatId, userId, back[1]!, message.message_id);
      if (session.busy) return;
      session.busy = true;
      try {
        const previous = selections.back(session);
        await prepareSelection(previous); await showSelection(previous, ui, true);
      } finally { session.busy = false; }
      return;
    }
    const category = update.callback_query?.data?.match(/^(type|view):([a-f0-9]{16}):(track|album|artist|playlist)$/);
    if (category) {
      const session = selections.callback(chatId, userId, category[2]!, message.message_id);
      if (session.busy) return;
      session.busy = true;
      try {
        const type = category[3] as MusicSearchKind;
        const currentType = category[1] === 'view' ? session.collection.entities ? 'album' : 'track' : session.collection.searchType || 'track';
        if (type === currentType) return;
        const collection = category[1] === 'type' && session.collection.kind === 'search'
          ? await resolveBotMusic(session.collection.query || session.collection.title, session.collection.searchScope || session.collection.provider, type)
          : category[1] === 'view' && session.collection.kind === 'artist' && session.collection.sourceUrl
            ? type === 'album' ? await artistAlbums(session.collection.sourceUrl) : await resolveMusic(session.collection.sourceUrl, session.collection.provider)
            : undefined;
        if (!collection) throw new ServiceError('SELECTION_EXPIRED', 'Invalid category');
        const replacement = selections.replace(session, collection, false);
        await prepareSelection(replacement);
        await showSelection(replacement, ui, true);
      } finally { session.busy = false; }
      return;
    }
    const panel = update.callback_query?.data?.match(/^(filter|list):([a-f0-9]{16})$/);
    const sourcePanel = update.callback_query?.data?.match(/^sources:([a-f0-9]{16}):(\d{1,3})$/);
    if (panel || sourcePanel) {
      const session = selections.callback(chatId, userId, (panel?.[2] || sourcePanel?.[1])!, message.message_id);
      if (session.busy) return;
      if (panel?.[1] === 'filter' && session.collection.kind !== 'search') throw new ServiceError('SELECTION_NUMBER', 'No source filter');
      if (sourcePanel) selections.sources(session, Number(sourcePanel[2]));
      session.panel = sourcePanel ? { group: Number(sourcePanel[2]) } : panel?.[1] === 'filter' ? 'providers' : undefined;
      session.busy = true;
      try { await showSelection(session, ui, true); } finally { session.busy = false; }
      return;
    }
    const sourceScope = update.callback_query?.data?.match(/^scope:([a-f0-9]{16}):([a-z]+)$/);
    if (sourceScope) {
      const session = selections.callback(chatId, userId, sourceScope[1]!, message.message_id);
      if (session.busy) return;
      const source = sourceScope[2] as BotSource, kind = session.collection.searchType || 'track';
      if (session.collection.kind !== 'search' || source !== 'all' && !searchableProviders(kind).some(provider => provider.id === source)) throw new ServiceError('SELECTION_NUMBER', 'Invalid search source');
      session.busy = true;
      try {
        const collection = await resolveBotMusic(session.collection.query || session.collection.title, source, kind);
        const replacement = selections.replace(session, collection, false);
        await prepareSelection(replacement); await showSelection(replacement, ui, true);
      } finally { session.busy = false; }
      return;
    }
    const selectionCallback = update.callback_query?.data?.match(/^(pick|page):([a-f0-9]{16}):(\d{1,3})$/);
    const explicitSource = update.callback_query?.data?.match(/^from:([a-f0-9]{16}):(\d{1,3}):(\d{1,3})$/);
    if (selectionCallback?.[1] === 'page') {
      const session = selections.callback(chatId, userId, selectionCallback[2]!, message.message_id);
      const page = Number(selectionCallback[3]);
      if (session.busy) return;
      if (page >= Math.ceil(selectionCount(session) / selectionPageSize)) throw new ServiceError('SELECTION_NUMBER', '頁碼無效。');
      session.page = page; session.panel = undefined;
      session.busy = true;
      try { await showSelection(session, ui, true); } finally { session.busy = false; }
      return;
    }
    const numberChoice = !update.callback_query && !cmd?.startsWith('/') && (isPrivate || replyToBot) ? selections.number(chatId, userId, text, message.reply_to_message?.message_id, messageThreadId) : undefined;
    if (Date.now() - (lastRequest.get(userId) || 0) < (selectionCallback || explicitSource || numberChoice ? 500 : 3000)) { await notice(chatId, botText(ui, 'rateLimited'), message.message_id); return; }
    lastRequest.set(userId, Date.now());
    for (const [id, time] of lastRequest) if (Date.now() - time > 60_000) lastRequest.delete(id);
    if (update.callback_query) {
      if (selectionCallback?.[1] === 'pick') {
        const session = selections.callback(chatId, userId, selectionCallback[2]!, message.message_id);
        await chooseSelection(session, Number(selectionCallback[3]), ui);
      } else if (explicitSource) {
        const session = selections.callback(chatId, userId, explicitSource[1]!, message.message_id);
        await chooseSelection(session, Number(explicitSource[2]), ui, session.requestId, Number(explicitSource[3]));
      } else if (/^dl:/.test(update.callback_query.data || '')) {
        // Old cards lack a request/owner context. Ask for a fresh list rather
        // than downloading a different user's selection or deleting a card.
        await notice(chatId, botText(ui, 'selectionExpired'), message.message_id);
      }
      return;
    }
    if (cmd === '/start' && isPrivate && args.startsWith('browse_')) {
      const selected = parseBrowseStart(args);
      if (!selected) throw new ServiceError('INVALID_INPUT', 'Invalid browse link');
      await sendCollection(chatId, userId, selected.albums ? await artistAlbums(selected.url) : await resolveMusic(selected.url, selected.provider), message.message_id); return;
    }
    if (cmd === '/start' && isPrivate && args.startsWith('raw_')) {
      const selected = parseInlineStart(args.replace(/^raw_/, 'in_'));
      if (!selected) throw new ServiceError('INVALID_TRACK', 'Invalid original track');
      await sendTrack(chatId, userId, await getTrack(selected.provider, selected.id), (await settingsStore.get(userId)).language || 'original', message.message_id, undefined, false, false, true);
    } else if (cmd === '/start' && isPrivate && args.startsWith('in_')) {
      const selected = parseInlineStart(args);
      if (!selected) throw new ServiceError('INVALID_TRACK', 'Invalid inline track');
      const track = await getTrack(selected.provider, selected.id);
      await preferences.request(chatId, userId, track, message.message_id, undefined, false, true);
    } else if (cmd === '/start' && isPrivate && args === 'inline_settings') {
      await preferences.show(chatId, userId);
    } else if (cmd === '/start' && /^\d{1,16}$/.test(args)) {
      await preferences.start(chatId, userId, botUsername);
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (cmd === '/start' && args === 'app') {
      await send(chatId, 'MUISM · 音樂主義', { reply_markup: { inline_keyboard: [[isPrivate ? { text: botText(ui, 'openPlayer'), web_app: { url: webAppUrl.href } } : { text: botText(ui, 'openPlayer'), url: `https://t.me/${botUsername}?start=app` }]] } });
    } else if (cmd === '/start') {
      await preferences.start(chatId, userId, botUsername);
    } else if (cmd === '/app') {
      await send(chatId, 'MUISM · 音樂主義', { reply_markup: { inline_keyboard: [[isPrivate ? { text: botText(ui, 'openPlayer'), web_app: { url: webAppUrl.href } } : { text: botText(ui, 'openPlayer'), url: `https://t.me/${botUsername}?start=app` }]] } });
    } else if (['/help', '/about'].includes(cmd || '')) {
      await send(chatId, botHelp(ui, !isPrivate, botUsername), { parse_mode: 'HTML', reply_parameters: replyParameters(message.message_id) });
    } else if (cmd === '/lyric') {
      if (!args) { await notice(chatId, botText(ui, 'lyricInput'), message.message_id); return; }
      const collection = await resolveBotMusic(args);
      const track = collection.tracks[0];
      if (!track || !isMyhkProvider(track.provider)) { await notice(chatId, botText(ui, 'noLyric'), message.message_id); return; }
      const lyric = track.provider === 'netease' ? await neteaseLyrics(track.id) : await myhkLyrics(track.provider, track.id);
      if (!lyric) { await notice(chatId, botText(ui, 'noLyric'), message.message_id); return; }
      const form = new FormData(); form.set('chat_id', String(chatId)); form.set('document', new Blob([lyric], { type: 'text/plain' }), `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}.lrc`);
      if (messageThreadId !== undefined) form.set('message_thread_id', String(messageThreadId));
      if (chatId < 0) { form.set('reply_parameters', JSON.stringify(replyParameters(message.message_id))); form.set('caption', ''); form.set('parse_mode', 'HTML'); }
      await telegram('sendDocument', form);
      if (chatId > 0) await removeNow(chatId, message.message_id);
    } else if (cmd === '/netease' || cmd === '/musicid') {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (cmd === '/album' || cmd === '/artist' || cmd === '/playlist') {
      if (!args) { await notice(chatId, botText(ui, 'queryInput'), message.message_id); return; }
      await listTracks(chatId, userId, args, 'all', message.message_id, cmd.slice(1) as MusicSearchKind);
    } else if (cmd === '/search' || cmd === '/music' || cmd === '/spotify' || cmd === '/ytm' || cmd === '/download') {
      if (!args) { await notice(chatId, botText(ui, 'queryInput'), message.message_id); return; }
      await listTracks(chatId, userId, args, cmd === '/spotify' ? 'spotify' : cmd === '/ytm' ? 'ytm' : 'all', message.message_id);
    } else if (/https?:\/\/|^spotify:/.test(text)) {
      await listTracks(chatId, userId, text, 'all', message.message_id);
    } else {
      const choice = numberChoice;
      if (choice) {
        selections.reply(choice.session, message.message_id);
        await chooseSelection(choice.session, Number(text) - 1, ui, message.message_id);
      } else if (/^\d{1,3}$/.test(text)) {
        await notice(chatId, botText(ui, 'selectionExpired'), message.message_id);
      } else {
        await listTracks(chatId, userId, text, 'all', message.message_id);
      }
    }
  } catch (error) { if (error instanceof ServiceError && error.code === 'SELECTION_CLOSED') return; await notice(chatId, botError(ui, publicError(error).code), message.message_id); }
}

async function main(): Promise<void> {
  const me = await telegram<{ username: string; supports_inline_queries?: boolean }>('getMe');
  botUsername = me.username;
  if (!me.supports_inline_queries) console.log('Inline Mode 尚未在 BotFather 啟用。');
  const webhook = await telegram<{ url: string }>('getWebhookInfo');
  if (webhook.url) throw new Error('此 bot 已設定 webhook，請先確認其用途；輪詢模式沒有更改現有 webhook。');
  void deleteEvents.start(token!, groupReplies, requestTelegram);
  for (const type of ['default', 'all_private_chats', 'all_group_chats']) await telegram('setMyCommands', { commands: botCommands('en'), scope: { type } });
  // Telegram command menus accept ISO 639-1 codes; Chinese script preferences
  // are applied separately with each user's private/chat-member scope.
  for (const [code, language] of [['en', 'en'], ['zh', 'zh-Hans'], ['ja', 'ja'], ['ko', 'ko'], ['es', 'es'], ['fr', 'fr'], ['ru', 'ru']] as const) {
    for (const type of ['default', 'all_private_chats', 'all_group_chats']) await telegram('setMyCommands', { commands: botCommands(language), language_code: code, scope: { type } });
  }
  await telegram('setChatMenuButton', { menu_button: { type: 'web_app', text: botText('en', 'openPlayer'), web_app: { url: webAppUrl.href } } });
  await cleanup.flush().catch(() => console.error('Bot 訊息清理失敗，稍後重試。'));
  let cleaning = false;
  const cleanupTimer = setInterval(() => {
    if (cleaning) return;
    cleaning = true;
    void cleanup.flush().catch(() => console.error('Bot 訊息清理失敗，稍後重試。')).finally(() => cleaning = false);
  }, 1000);
  cleanupTimer.unref();
  try { offset = JSON.parse(await readFile(statePath, 'utf8')).offset || 0; } catch { /* First launch. */ }
  console.log(`MUISM bot @${me.username} 已啟動（long polling）`);
  // Private menu buttons have no language_code parameter. Restore each
  // known user's override without blocking the polling loop.
  void settingsStore.knownLocales().then(async users => {
    for (const { userId, language } of users) {
      if (stopping) break;
      await updateCommands(userId, language, userId).catch(() => {});
    }
  }).catch(() => console.error('Bot 語言選單同步稍後重試。'));
  while (!stopping) {
    try {
      const updates = await telegram<Update[]>('getUpdates', { offset, timeout: 25, limit: 10, allowed_updates: ['message', 'callback_query', 'inline_query', 'chosen_inline_result'] });
      for (const update of updates) {
        // Inline searches have a short response window; do not queue them
        // behind downloads that may run for several minutes.
        if (update.inline_query) {
          void handle(update).catch(() => console.error('Inline 搜尋失敗。'));
          offset = update.update_id + 1; continue;
        }
        if (stopping) break;
        if (!dispatch.run(() => handle(update))) {
          const user = update.message?.from || update.callback_query?.from;
          if (user && !user.is_bot && permitted(user.id)) {
            void preferences.locale(user.id).then(ui => update.callback_query
              ? telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id, text: botText(ui, 'rateLimited'), show_alert: true })
              : update.message?.chat.type === 'private' ? notice(update.message.chat.id, botText(ui, 'rateLimited'), update.message.message_id) : undefined).catch(() => {});
          }
        }
        offset = update.update_id + 1;
      }
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(resolve(statePath, '..'), { recursive: true, mode: 0o700 });
      await writeFile(statePath, JSON.stringify({ offset }), { mode: 0o600 });
    } catch { if (!stopping) { console.error('Telegram 連線中斷，5 秒後重試。'); await new Promise((done) => setTimeout(done, 5000)); } }
  }
  clearInterval(cleanupTimer);
  await deleteEvents.stop();
}
process.on('SIGINT', () => stopping = true); process.on('SIGTERM', () => stopping = true);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch(async (e) => { await deleteEvents.stop(); console.error(e instanceof ServiceError ? e.message : 'Bot 無法啟動，請检查設定或現有 webhook。'); process.exitCode = 1; });
}
