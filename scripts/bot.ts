import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DownloadStore } from '../src/lib/server/downloads.js';
import { publicError, ServiceError } from '../src/lib/server/errors.js';
import { resolveMusic, getTrack } from '../src/lib/server/music.js';
import { neteaseLyrics } from '../src/lib/server/providers/netease.js';
import { safeFilename } from '../src/lib/server/links.js';
import { resolveNeteaseCommand } from '../src/lib/server/bot-input.js';
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
  const data = await response.json() as { ok: boolean; result: T };
  if (!data.ok) throw new ServiceError('TELEGRAM_ERROR', 'Telegram 暫時無法處理請求。', 502);
  return data.result;
}
const send = (chatId: number, text: string, extra: Record<string, unknown> = {}) => telegram('sendMessage', { chat_id: chatId, text: text.slice(0, 4000), ...extra });
function permitted(id: number): boolean { return !allowed.size || allowed.has(String(id)); }

async function sendTrack(chatId: number, userId: number, track: Track): Promise<void> {
  const owner = `tg:${chatId}:${userId}`;
  await send(chatId, `正在獲取「${track.title}」的 ${track.provider === 'ytm' ? 'YTM' : track.provider} 原始音源…`);
  const [created] = await store.create(owner, [track], 'original');
  const until = Date.now() + 360_000;
  while (Date.now() < until && !stopping) {
    const job = (await store.list(owner)).find((j) => j.id === created!.id)!;
    if (job.status === 'failed') { await send(chatId, job.error || '獲取失敗。'); return; }
    if (job.status === 'completed') {
      const { path } = await store.file(owner, job.id);
      if ((await stat(path)).size > 49 * 1024 * 1024) { await send(chatId, '音訊超過 Telegram 49 MB 發送限制，請使用網頁端重新獲取並保存。'); return; }
      const audio = /\.(mp3|m4a)$/i.test(path);
      const payload = new FormData();
      payload.set('chat_id', String(chatId));
      payload.set(audio ? 'audio' : 'document', new Blob([new Uint8Array(await readFile(path))]), job.filename!);
      payload.set('caption', `ismusicnow · 音樂主義\n來源：${job.audioSource}\n編碼：${job.audio?.codec || '原始音源'}${job.audio?.bitrate ? ` · ${Math.round(job.audio.bitrate / 1000)} kbps` : ''}`);
      if (audio) { payload.set('title', track.title); payload.set('performer', track.artists.join(' / ')); }
      await telegram(audio ? 'sendAudio' : 'sendDocument', payload);
      return;
    }
    await new Promise((done) => setTimeout(done, 1500));
  }
  if (!stopping) await send(chatId, '任務仍在佇列中，請稍後重試或使用網頁端。');
}

async function listTracks(chatId: number, userId: number, input: string, provider: Provider): Promise<void> {
  const collection = await resolveMusic(input, provider);
  await sendCollection(chatId, userId, collection);
}

async function sendCollection(chatId: number, userId: number, collection: Collection): Promise<void> {
  if (!collection.tracks.length) { await send(chatId, '沒有找到歌曲，請試試其他關鍵字。'); return; }
  if (collection.kind === 'track') return sendTrack(chatId, userId, collection.tracks[0]!);
  const rows = collection.tracks.slice(0, 8).map((track, i) => [{ text: `${i + 1}. ${track.title} — ${track.artists.join(' / ')}`.slice(0, 60), callback_data: `dl:${track.provider}:${track.id}` }]);
  await send(chatId, `${collection.title}\n來源：${collection.provider}\n選擇下方曲目獲取（顯示前 ${rows.length} 首）。`, { reply_markup: { inline_keyboard: rows } });
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
  try {
    if (update.callback_query) await telegram('answerCallbackQuery', { callback_query_id: update.callback_query.id });
    if (Date.now() - (lastRequest.get(userId) || 0) < 3000) { await send(chatId, '請稍候幾秒再發送下一個請求。'); return; }
    lastRequest.set(userId, Date.now());
    for (const [id, time] of lastRequest) if (Date.now() - time > 60_000) lastRequest.delete(id);
    if (update.callback_query) {
      const [, provider, id] = update.callback_query.data?.match(/^dl:(netease|spotify|ytm):([a-zA-Z0-9_-]+)$/) || [];
      if (provider && id) await sendTrack(chatId, userId, await getTrack(provider as Provider, id));
      return;
    }
    const text = message.text?.trim() || '';
    const [command, ...rest] = text.split(/\s+/); const args = rest.join(' ');
    const cmd = command?.split('@')[0];
    if (cmd === '/start' && /^\d{1,16}$/.test(args)) {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args));
    } else if (['/start', '/help', '/about'].includes(cmd || '')) {
      await send(chatId, 'ismusicnow · 音樂主義\n\n直接貼上網易雲、Spotify 或 YouTube Music 連結。\n/netease 歌名／歌曲ID／連結 — 直接獲取網易雲；關鍵字取第一個結果\n/music 或 /musicid — 同 /netease\n/search 歌名 — 搜尋網易雲並選曲\n/spotify 歌名 — 搜尋 Spotify\n/ytm 連結 — 獲取 YouTube Music\n/lyric 歌名／歌曲ID／連結 — 獲取網易雲 LRC 歌詞\n\nSpotify 只使用 Spotify 原始音源；YTM 是獨立適配器。\n開源授權 GPL-3.0，不附帶擔保。');
    } else if (cmd === '/lyric') {
      if (!args) { await send(chatId, '請輸入 /lyric 網易雲歌名、歌曲 ID 或連結。'); return; }
      const collection = await resolveNeteaseCommand(args);
      const track = collection.tracks[0]!;
      const lyric = await neteaseLyrics(track.id);
      if (!lyric) { await send(chatId, '這首歌暫時沒有 LRC 歌詞。'); return; }
      const form = new FormData(); form.set('chat_id', String(chatId)); form.set('document', new Blob([lyric], { type: 'text/plain' }), `${safeFilename(`${track.artists.join(' - ')} - ${track.title}`)}.lrc`);
      await telegram('sendDocument', form);
    } else if (cmd === '/netease' || cmd === '/music' || cmd === '/musicid') {
      await sendCollection(chatId, userId, await resolveNeteaseCommand(args));
    } else if (cmd === '/search' || cmd === '/spotify' || cmd === '/ytm' || cmd === '/download') {
      if (!args) { await send(chatId, '請在命令後輸入關鍵字或音樂連結。'); return; }
      await listTracks(chatId, userId, args, cmd === '/spotify' ? 'spotify' : cmd === '/ytm' ? 'ytm' : 'netease');
    } else if (/https?:\/\/|^spotify:/.test(text)) {
      await listTracks(chatId, userId, text, 'netease');
    }
  } catch (error) { await send(chatId, publicError(error).message); }
}

async function main(): Promise<void> {
  const me = await telegram<{ username: string }>('getMe');
  const webhook = await telegram<{ url: string }>('getWebhookInfo');
  if (webhook.url) throw new Error('此 bot 已設定 webhook，請先確認其用途；輪詢模式沒有更改現有 webhook。');
  await telegram('setMyCommands', { commands: [{ command: 'netease', description: '透過關鍵詞、歌曲 ID 或連結獲取網易雲' }, { command: 'music', description: '透過關鍵詞、歌曲 ID 或連結獲取網易雲' }, { command: 'search', description: '搜尋網易雲音樂並選曲' }, { command: 'spotify', description: '搜尋 Spotify' }, { command: 'ytm', description: '獲取 YouTube Music 連結' }, { command: 'download', description: '解析音樂連結並獲取' }, { command: 'lyric', description: '透過歌名、ID 或連結獲取網易雲 LRC 歌詞' }, { command: 'about', description: '關於音樂主義' }] });
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
