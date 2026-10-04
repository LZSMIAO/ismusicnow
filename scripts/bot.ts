import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { DownloadStore } from '../src/lib/server/downloads.js';
import { publicError, ServiceError } from '../src/lib/server/errors.js';
import { resolveMusic, getTrack } from '../src/lib/server/music.js';
import { neteaseLyrics } from '../src/lib/server/providers/netease.js';
import { safeFilename } from '../src/lib/server/links.js';
import { resolveNeteaseCommand } from '../src/lib/server/bot-input.js';
import { BotLanguageSettings, BotSettingsStore, displayTrack, type AlbumLanguage } from '../src/lib/server/bot-settings.js';
import { audioPresentation, sendMusic, TelegramRequestError } from '../src/lib/server/bot-media.js';
import { metadataForDisplay } from '../src/lib/server/bot-metadata.js';
import { botCommands, botHelp, botText, botError } from '../src/lib/server/bot-i18n.js';
import type { Track, Provider, Collection } from '../src/lib/types.js';

const token = process.env.BOT_TOKEN;
if (!token) { console.error('請在 .env 配置 BOT_TOKEN。'); process.exit(1); }
const endpoint = `https://api.telegram.org/bot${token}/`;
const allowed = new Set((process.env.BOT_ALLOWED_USERS || '').split(',').map((v) => v.trim()).filter(Boolean));
const store = new DownloadStore('bot');
const lastRequest = new Map<number, number>();
let stopping = false, offset = 0, handlers = 0;
const statePath = resolve(process.env.DATA_DIR || '.data', 'bot-offset.json');

interface Message { message_id: number; chat: { id: number }; from?: { id: number }; text?: string }
interface Update { update_id: number; message?: Message; callback_query?: { id: string; from: { id: number }; data?: string; message?: Message }; inline_query?: { id: string; from: { id: number }; query: string } }

export async function telegram<T>(method: string, body: Record<string, unknown> | FormData = {}): Promise<T> {
  const response = await fetch(`${endpoint}${method}`, { method: 'POST',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 120_000) });
  const data = await response.json() as { ok: boolean; result: T; error_code?: number; description?: string };
  if (!data.ok) throw new TelegramRequestError(data.error_code || response.status, data.description || '');
  return data.result;
}
const send = (chatId: number, text: string, extra: Record<string, unknown> = {}) => telegram('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...extra });
function permitted(id: number): boolean { return !allowed.size || allowed.has(String(id)); }
const preferences = new BotLanguageSettings(new BotSettingsStore(), send, sendTrack, async (chatId, language) => {
  if (chatId > 0) await telegram('setMyCommands', { commands: botCommands(language), scope: { type: 'chat', chat_id: chatId } });
});

async function sendTrack(chatId: number, userId: number, track: Track, language: AlbumLanguage, messageId: number): Promise<void> {
  const owner = `tg:${chatId}:${userId}`;
  const ui = await preferences.locale(userId);
  let visible = displayTrack(track, language);
  await send(chatId, botText(ui, 'fetching', { title: visible.title, source: track.provider === 'ytm' ? 'YTM' : track.provider }));
  const [created] = await store.create(owner, [track], 'original');
  if (language !== 'original') visible = displayTrack(await metadataForDisplay(track), language);
  const until = Date.now() + 360_000;
  while (Date.now() < until && !stopping) {
    const job = (await store.list(owner)).find((j) => j.id === created!.id)!;
    if (job.status === 'failed') { await send(chatId, botError(ui, job.errorCode)); return; }
    if (job.status === 'completed') {
      const { path } = await store.file(owner, job.id);
      if ((await stat(path)).size > 49 * 1024 * 1024) { await send(chatId, botText(ui, 'tooLarge')); return; }
      const presentation = await audioPresentation(path, track);
      const delivery = await sendMusic(telegram, { chatId, replyTo: messageId, job, track: visible, uiLanguage: ui,
        bytes: new Uint8Array(await readFile(path)),
        filename: `${safeFilename(`${visible.artists.join(' - ')} - ${visible.title}`)}${extname(path)}`, ...presentation });
      if (delivery === 'document') await send(chatId, botText(ui, 'documentFallback'));
      return;
    }
    await new Promise((done) => setTimeout(done, 1500));
  }
  if (!stopping) await send(chatId, botText(ui, 'pending'));
}

async function listTracks(chatId: number, userId: number, input: string, provider: Provider, messageId: number): Promise<void> {
  const collection = await resolveMusic(input, provider);
  await sendCollection(chatId, userId, collection, messageId);
}

async function sendCollection(chatId: number, userId: number, collection: Collection, messageId: number): Promise<void> {
  const ui = await preferences.locale(userId);
  if (!collection.tracks.length) { await send(chatId, botText(ui, 'notFound')); return; }
  if (collection.kind === 'track') return preferences.request(chatId, userId, collection.tracks[0]!, messageId);
  const rows = collection.tracks.slice(0, 8).map((track, i) => [{ text: `${i + 1}. ${track.title} — ${track.artists.join(' / ')}`.slice(0, 60), callback_data: `dl:${track.provider}:${track.id}` }]);
  await send(chatId, `${collection.title}\n${botText(ui, 'selectTracks', { source: collection.provider, count: rows.length })}`, { reply_markup: { inline_keyboard: rows } });
}

async function handle(update: Update): Promise<void> {
  const userId = update.message?.from?.id || update.callback_query?.from.id || update.inline_query?.from.id;
  if (!userId || !permitted(userId)) return;
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
    const text = message.text?.trim() || '';
    const [command, ...rest] = text.split(/\s+/); const args = rest.join(' ');
    const cmd = command?.split('@')[0];
    if (update.callback_query?.data === 'open-settings') { await preferences.show(chatId, userId); return; }
    if (update.callback_query && await preferences.callback(chatId, userId, update.callback_query.data || '')) return;
    if (!update.callback_query && (cmd === '/settings' || cmd === '/setting')) { await preferences.show(chatId, userId); return; }
    if (Date.now() - (lastRequest.get(userId) || 0) < 3000) { await send(chatId, botText(ui, 'rateLimited')); return; }
    lastRequest.set(userId, Date.now());
    for (const [id, time] of lastRequest) if (Date.now() - time > 60_000) lastRequest.delete(id);
    if (update.callback_query) {
      const [, provider, id] = update.callback_query.data?.match(/^dl:(netease|spotify|ytm):([a-zA-Z0-9_-]+)$/) || [];
      if (provider && id) await preferences.request(chatId, userId, await getTrack(provider as Provider, id), message.message_id);
      return;
    }
    if (cmd === '/start' && /^\d{1,16}$/.test(args)) {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (['/start', '/help', '/about'].includes(cmd || '')) {
      await send(chatId, botHelp(ui));
    } else if (cmd === '/lyric') {
      if (!args) { await send(chatId, botText(ui, 'lyricInput')); return; }
      const collection = await resolveNeteaseCommand(args);
      const track = collection.tracks[0]!;
      const lyric = await neteaseLyrics(track.id);
      if (!lyric) { await send(chatId, botText(ui, 'noLyric')); return; }
      const form = new FormData(); form.set('chat_id', String(chatId)); form.set('document', new Blob([lyric], { type: 'text/plain' }), `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}.lrc`);
      await telegram('sendDocument', form);
    } else if (cmd === '/netease' || cmd === '/music' || cmd === '/musicid') {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args), message.message_id);
    } else if (cmd === '/search' || cmd === '/spotify' || cmd === '/ytm' || cmd === '/download') {
      if (!args) { await send(chatId, botText(ui, 'queryInput')); return; }
      await listTracks(chatId, userId, args, cmd === '/spotify' ? 'spotify' : cmd === '/ytm' ? 'ytm' : 'netease', message.message_id);
    } else if (/https?:\/\/|^spotify:/.test(text)) {
      await listTracks(chatId, userId, text, 'netease', message.message_id);
    }
  } catch (error) { await send(chatId, botError(ui, publicError(error).code)); }
}

async function main(): Promise<void> {
  const me = await telegram<{ username: string }>('getMe');
  const webhook = await telegram<{ url: string }>('getWebhookInfo');
  if (webhook.url) throw new Error('此 bot 已設定 webhook，請先確認其用途；輪詢模式沒有更改現有 webhook。');
  await telegram('setMyCommands', { commands: botCommands('zh-Hant') });
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
}
process.on('SIGINT', () => stopping = true); process.on('SIGTERM', () => stopping = true);
void main().catch((e) => { console.error(e instanceof ServiceError ? e.message : 'Bot 無法啟動，請检查設定或現有 webhook。'); process.exitCode = 1; });
