import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DownloadStore } from '../src/lib/server/downloads.js';
import { publicError, ServiceError } from '../src/lib/server/errors.js';
import { resolveMusic, getTrack } from '../src/lib/server/music.js';
import { neteaseLyrics } from '../src/lib/server/providers/netease.js';
import { safeFilename } from '../src/lib/server/links.js';
import { resolveNeteaseCommand } from '../src/lib/server/bot-input.js';
import { BotLanguageSettings, BotSettingsStore, displayTrack, type AlbumLanguage } from '../src/lib/server/bot-settings.js';
import { audioPresentation, musicReferencePayload, sendMusic, TelegramRequestError } from '../src/lib/server/bot-media.js';
import { BotMusicCache, type CachedMusic } from '../src/lib/server/bot-cache.js';
import { BotMessageCleanup } from '../src/lib/server/bot-cleanup.js';
import { BotSelections, selectionLifetime, selectionPageSize, selectionMessage } from '../src/lib/server/bot-selection.js';
import { config } from '../src/lib/server/config.js';
import { metadataForDisplay } from '../src/lib/server/bot-metadata.js';
import { botCommands, botHelp, botText, botError } from '../src/lib/server/bot-i18n.js';
import type { Track, Provider, Collection } from '../src/lib/types.js';

const token = process.env.BOT_TOKEN;
if (!token) { console.error('請在 .env 配置 BOT_TOKEN。'); process.exit(1); }
const endpoint = `https://api.telegram.org/bot${token}/`;
const allowed = new Set((process.env.BOT_ALLOWED_USERS || '').split(',').map((v) => v.trim()).filter(Boolean));
const store = new DownloadStore('bot');
const mediaCache = new BotMusicCache(token.split(':')[0]!);
const selections = new BotSelections();
const lastRequest = new Map<number, number>();
let stopping = false, offset = 0, handlers = 0;
let botUsername = 'ismusicnow_bot';
const statePath = resolve(process.env.DATA_DIR || '.data', 'bot-offset.json');

interface User { id: number; language_code?: string; is_bot?: boolean }
interface Message { message_id: number; message_thread_id?: number; sender_chat?: { id: number }; chat: { id: number; type?: string }; from?: User; text?: string; reply_to_message?: { message_id: number; from?: { username?: string } } }
interface Update { update_id: number; message?: Message; callback_query?: { id: string; from: User; data?: string; message?: Message }; inline_query?: { id: string; from: User; query: string } }

export async function telegram<T>(method: string, body: Record<string, unknown> | FormData = {}): Promise<T> {
  const response = await fetch(`${endpoint}${method}`, { method: 'POST',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 120_000) });
  const data = await response.json() as { ok: boolean; result: T; error_code?: number; description?: string };
  if (!data.ok) throw new TelegramRequestError(data.error_code || response.status, data.description || '');
  return data.result;
}
const cleanup = new BotMessageCleanup(token.split(':')[0]!, (chatId, messageId) => telegram('deleteMessage', { chat_id: chatId, message_id: messageId }));
const deleteLater = (chatId: number, messageId: number, delayMs: number) => cleanup.schedule(chatId, messageId, delayMs).catch(() => console.error('Bot 訊息清理排程失敗。'));
const replyContext = new AsyncLocalStorage<{ chatId: number; messageId: number; messageThreadId?: number }>();
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
  if (commandLanguages.size >= 1000) commandLanguages.delete(commandLanguages.keys().next().value!);
  commandLanguages.set(key, language);
}
const preferences = new BotLanguageSettings(new BotSettingsStore(), send, sendTrack, updateCommands);

async function sendTrack(chatId: number, userId: number, track: Track, language: AlbumLanguage, messageId: number, messageThreadId?: number): Promise<void> {
  const owner = `tg:${chatId}:${userId}`;
  const ui = await preferences.locale(userId);
  const visible = displayTrack(language !== 'original' ? await metadataForDisplay(track) : track, language);
  let quality = track.provider === 'netease' ? 'original-lossless' : track.provider === 'ytm' ? 'original-bestaudio' : config.spotifyAudioQuality;
  if (track.provider === 'spotify' && config.votifyConfigPath) {
    const digest = await readFile(config.votifyConfigPath).then((bytes) => createHash('sha256').update(bytes).digest('hex')).catch(() => 'unreadable');
    quality += `:${digest}`;
  }
  await mediaCache.deliver({ provider: track.provider, id: track.id, quality }, async (record) => {
    const job = { ...record, id: 'telegram-cache', track, format: 'original' as const, status: 'completed' as const,
      stage: '', createdAt: '', updatedAt: '' };
    await telegram(record.kind === 'audio' ? 'sendAudio' : 'sendDocument', musicReferencePayload({
      chatId, messageThreadId, replyTo: messageId, track: visible, job, fileId: record.fileId, kind: record.kind, duration: record.duration, uiLanguage: ui,
    }));
  }, async () => {
    const progress = await send(chatId, botText(ui, 'fetching', { title: visible.title, source: track.provider === 'ytm' ? 'YTM' : track.provider }), { message_thread_id: messageThreadId, deleteAfterMs: 7 * 60_000, reply_parameters: replyParameters(messageId) });
    try {
    const [created] = await store.create(owner, [track], 'original');
    const until = Date.now() + 360_000;
    while (Date.now() < until && !stopping) {
      const job = (await store.list(owner)).find((j) => j.id === created!.id)!;
      if (job.status === 'failed') throw new ServiceError(job.errorCode || 'ADAPTER_FAILED', '下載失敗。', 502);
      if (job.status === 'completed') {
        const { path } = await store.file(owner, job.id);
        if ((await stat(path)).size > 49 * 1024 * 1024) throw new ServiceError('FILE_TOO_LARGE', '音訊超過 Telegram 上限。', 413);
        const presentation = await audioPresentation(path, track);
        let record: CachedMusic | undefined;
        const delivery = await sendMusic(telegram, { chatId, messageThreadId, replyTo: messageId, job, track: visible, uiLanguage: ui,
          bytes: new Uint8Array(await readFile(path)),
          filename: `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}${extname(path)}`, ...presentation,
          onDelivered: (kind, result) => {
            const message = result as { audio?: { file_id?: string }; document?: { file_id?: string } } | undefined;
            const fileId = message?.[kind]?.file_id;
            if (fileId) record = { fileId, kind, duration: presentation.duration, bytes: job.bytes!, audioSource: job.audioSource, audio: job.audio };
          },
        });
        // Telegram now holds the file. Do not keep a duplicate on this VPS.
        await store.remove(owner, job.id).catch(() => console.error('Bot 暫存音訊清理失敗。'));
        if (delivery === 'document') await send(chatId, botText(ui, 'documentFallback'), { message_thread_id: messageThreadId, reply_parameters: replyParameters(messageId), deleteAfterMs: 30_000 }).catch(() => {});
        return record;
      }
      await new Promise((done) => setTimeout(done, 1500));
    }
    throw new ServiceError('DOWNLOAD_TIMEOUT', '下載等待超時。', 504);
    } finally { await deleteLater(chatId, progress.message_id, 2000); }
  });
  // Reply first, then remove only the request that was actually fulfilled.
  const delivered = selections.delivered(chatId, messageId);
  for (const inputId of delivered.inputIds) await deleteLater(chatId, inputId, 2000);
  if (delivered.menuId) await deleteLater(chatId, delivered.menuId, 2000);
}

async function listTracks(chatId: number, userId: number, input: string, provider: Provider, messageId: number): Promise<void> {
  const collection = await resolveMusic(input, provider);
  await sendCollection(chatId, userId, collection, messageId);
}

async function sendCollection(chatId: number, userId: number, collection: Collection, messageId: number): Promise<void> {
  const ui = await preferences.locale(userId);
  if (!collection.tracks.length) { await notice(chatId, botText(ui, 'notFound'), messageId); return; }
  if (collection.kind === 'track') return preferences.request(chatId, userId, collection.tracks[0]!, messageId, replyContext.getStore()?.messageThreadId);
  const messageThreadId = replyContext.getStore()?.messageThreadId;
  const session = selections.create(chatId, userId, messageId, collection, messageThreadId);
  const { text, reply_markup } = selectionMessage(session, ui);
  const menu = await send(chatId, text, { reply_parameters: replyParameters(messageId), reply_markup, deleteAfterMs: selectionLifetime });
  session.menuId = menu.message_id;
}

export async function handle(update: Update): Promise<void> {
  const message = update.message || update.callback_query?.message;
  if (!message) return handleUpdate(update);
  return replyContext.run({ chatId: message.chat.id, messageId: message.message_id, messageThreadId: message.message_thread_id }, () => handleUpdate(update));
}

async function handleUpdate(update: Update): Promise<void> {
  const user = update.message?.from || update.callback_query?.from || update.inline_query?.from;
  const userId = user?.id;
  // Anonymous group senders cannot own personal settings or selection lists.
  if (!userId || user.is_bot || update.message?.sender_chat || !permitted(userId)) return;
  await preferences.observeLanguage(userId, user.language_code);
  if (update.inline_query) {
    const q = update.inline_query;
    if (q.query.trim().length < 2) { await telegram('answerInlineQuery', { inline_query_id: q.id, results: [], cache_time: 1, is_personal: true }); return; }
    const result = await resolveMusic(q.query, 'netease');
    await telegram('answerInlineQuery', { inline_query_id: q.id, cache_time: 60, is_personal: true,
      results: result.tracks.slice(0, 8).map((t) => ({ type: 'article', id: `${t.provider}:${t.id}`, title: t.title,
        description: t.artists.join(' / '), input_message_content: { message_text: `${t.title} — ${t.artists.join(' / ')}\n${t.sourceUrl}` } })) });
    return;
  }
  const message = update.message || update.callback_query?.message;
  if (!message) return;
  const chatId = message.chat.id;
  const ui = await preferences.locale(userId);
  try {
    if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id });
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
      if (cmd?.startsWith('/') && !['/start', '/help', '/about', '/settings', '/setting', '/lyric', '/netease', '/music', '/musicid', '/search', '/spotify', '/ytm', '/download'].includes(cmd)) return;
      if (!cmd?.startsWith('/') && !/https?:\/\/|^spotify:/.test(text) && !isPrivate && !replyToBot && !mentionsBot) return;
      if (!text) return;
    }
    await updateCommands(chatId, ui, userId).catch(() => {});
    if (update.callback_query?.data === 'open-settings') { await preferences.show(chatId, userId); return; }
    if (update.callback_query && /^(lang|ui|setting):/.test(update.callback_query.data || '')) {
      const own = Number(update.callback_query.data?.split(':')[1]) === userId;
      try { await preferences.callback(chatId, userId, update.callback_query.data || ''); }
      finally { if (own && !text.startsWith('ismusicnow · 音樂主義\n')) await deleteLater(chatId, message.message_id, 2000); }
      return;
    }
    if (!update.callback_query && (cmd === '/settings' || cmd === '/setting')) { await preferences.show(chatId, userId); return; }
    const selectionCallback = update.callback_query?.data?.match(/^(pick|page):([a-f0-9]{16}):(\d{1,3})$/);
    if (selectionCallback?.[1] === 'page') {
      const session = selections.get(chatId, userId, selectionCallback[2]!, message.message_id, message.message_thread_id);
      const page = Number(selectionCallback[3]);
      if (page >= Math.ceil(session.collection.tracks.length / selectionPageSize)) throw new ServiceError('SELECTION_NUMBER', '頁碼無效。');
      session.page = page;
      await telegram('editMessageText', { chat_id: chatId, message_id: message.message_id, ...selectionMessage(session, ui) });
      return;
    }
    const numberChoice = !update.callback_query && !cmd?.startsWith('/') && (isPrivate || replyToBot) ? selections.number(chatId, userId, text, message.reply_to_message?.message_id, message.message_thread_id) : undefined;
    if (Date.now() - (lastRequest.get(userId) || 0) < (selectionCallback || numberChoice ? 500 : 3000)) { await notice(chatId, botText(ui, 'rateLimited'), message.message_id); return; }
    lastRequest.set(userId, Date.now());
    for (const [id, time] of lastRequest) if (Date.now() - time > 60_000) lastRequest.delete(id);
    if (update.callback_query) {
      if (selectionCallback?.[1] === 'pick') {
        const session = selections.get(chatId, userId, selectionCallback[2]!, message.message_id, message.message_thread_id);
        await preferences.request(chatId, userId, selections.track(session, Number(selectionCallback[3])), session.requestId, session.messageThreadId);
      } else if (/^dl:/.test(update.callback_query.data || '')) {
        // Old cards lack a request/owner context. Ask for a fresh list rather
        // than downloading a different user's selection or deleting a card.
        await notice(chatId, botText(ui, 'selectionExpired'), message.message_id);
      }
      return;
    }
    if (cmd === '/start' && /^\d{1,16}$/.test(args)) {
      await preferences.start(chatId, userId);
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (cmd === '/start') {
      await preferences.start(chatId, userId);
    } else if (['/help', '/about'].includes(cmd || '')) {
      await send(chatId, botHelp(ui, !isPrivate), { reply_parameters: replyParameters(message.message_id) });
    } else if (cmd === '/lyric') {
      if (!args) { await notice(chatId, botText(ui, 'lyricInput'), message.message_id); return; }
      const collection = await resolveNeteaseCommand(args);
      const track = collection.tracks[0]!;
      const lyric = await neteaseLyrics(track.id);
      if (!lyric) { await notice(chatId, botText(ui, 'noLyric'), message.message_id); return; }
      const form = new FormData(); form.set('chat_id', String(chatId)); form.set('document', new Blob([lyric], { type: 'text/plain' }), `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}.lrc`);
      if (message.message_thread_id !== undefined) form.set('message_thread_id', String(message.message_thread_id));
      form.set('reply_parameters', JSON.stringify(replyParameters(message.message_id)));
      await telegram('sendDocument', form);
      await deleteLater(chatId, message.message_id, 2000);
    } else if (cmd === '/netease' || cmd === '/music' || cmd === '/musicid') {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (cmd === '/search' || cmd === '/spotify' || cmd === '/ytm' || cmd === '/download') {
      if (!args) { await notice(chatId, botText(ui, 'queryInput'), message.message_id); return; }
      await listTracks(chatId, userId, args, cmd === '/spotify' ? 'spotify' : cmd === '/ytm' ? 'ytm' : 'netease', message.message_id);
    } else if (/https?:\/\/|^spotify:/.test(text)) {
      await listTracks(chatId, userId, text, 'netease', message.message_id);
    } else {
      const choice = numberChoice;
      if (choice) {
        selections.reply(choice.session, message.message_id);
        await preferences.request(chatId, userId, choice.track, message.message_id, message.message_thread_id);
      } else if (/^\d{1,3}$/.test(text)) {
        await notice(chatId, botText(ui, 'selectionExpired'), message.message_id);
      } else {
        await listTracks(chatId, userId, text, 'netease', message.message_id);
      }
    }
  } catch (error) { await notice(chatId, botError(ui, publicError(error).code), message.message_id); }
}

async function main(): Promise<void> {
  const me = await telegram<{ username: string }>('getMe');
  botUsername = me.username;
  const webhook = await telegram<{ url: string }>('getWebhookInfo');
  if (webhook.url) throw new Error('此 bot 已設定 webhook，請先確認其用途；輪詢模式沒有更改現有 webhook。');
  await telegram('setMyCommands', { commands: botCommands('en') });
  await cleanup.flush().catch(() => console.error('Bot 訊息清理失敗，稍後重試。'));
  let cleaning = false;
  const cleanupTimer = setInterval(() => {
    if (cleaning) return;
    cleaning = true;
    void cleanup.flush().catch(() => console.error('Bot 訊息清理失敗，稍後重試。')).finally(() => cleaning = false);
  }, 1000);
  cleanupTimer.unref();
  try { offset = JSON.parse(await readFile(statePath, 'utf8')).offset || 0; } catch { /* First launch. */ }
  console.log(`ismusicnow bot @${me.username} 已啟動（long polling）`);
  while (!stopping) {
    try {
      const updates = await telegram<Update[]>('getUpdates', { offset, timeout: 25, limit: 10, allowed_updates: ['message', 'callback_query', 'inline_query'] });
      for (const update of updates) {
        while (handlers >= 4 && !stopping) await new Promise((done) => setTimeout(done, 500));
        if (stopping) break;
        handlers++;
        void handle(update).catch(() => console.error('Bot 請求失敗。')).finally(() => handlers--);
        offset = update.update_id + 1;
      }
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(resolve(statePath, '..'), { recursive: true, mode: 0o700 });
      await writeFile(statePath, JSON.stringify({ offset }), { mode: 0o600 });
    } catch { if (!stopping) { console.error('Telegram 連線中斷，5 秒後重試。'); await new Promise((done) => setTimeout(done, 5000)); } }
  }
  clearInterval(cleanupTimer);
}
process.on('SIGINT', () => stopping = true); process.on('SIGTERM', () => stopping = true);
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((e) => { console.error(e instanceof ServiceError ? e.message : 'Bot 無法啟動，請检查設定或現有 webhook。'); process.exitCode = 1; });
}
