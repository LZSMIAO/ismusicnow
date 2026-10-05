import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BotGroupReplies, GroupReplyRequest } from './bot-group-replies.js';

// The HTTP Bot API has no ordinary deletion update. This connection is
// authenticated as the same bot; it never signs in to a personal account.
export class BotDeleteEvents {
  private close?: () => Promise<void>;
  private stopped = false;
  async start(token: string, replies: BotGroupReplies, request: GroupReplyRequest): Promise<void> {
    const apiId = Number(process.env.TELEGRAM_API_ID), apiHash = process.env.TELEGRAM_API_HASH;
    if (process.env.BOT_DELETE_EVENTS === '0' || !Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash || !/^[a-f0-9]{32}$/i.test(apiHash)) return;
    try {
      const [{ TelegramClient, Api }, { StringSession }, { Raw }, { Logger, LogLevel }] = await Promise.all([
        import('teleproto'), import('teleproto/sessions'), import('teleproto/events'), import('teleproto/extensions/Logger.js')
      ]);
      const botId = token.split(':')[0]!;
      const root = resolve(process.env.DATA_DIR || '.data', 'bot-delete-events');
      await mkdir(root, { recursive: true, mode: 0o700 });
      const path = resolve(root, `${botId}.session`);
      let session = '';
      try { session = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
        connectionRetries: 3, requestRetries: 3, timeout: 10,
        baseLogger: new Logger(LogLevel.NONE), autoReconnect: true
      });
      client._errorHandler = async () => { console.error('Telegram deletion event processing will retry.'); };
      this.close = () => client.destroy();
      if (this.stopped) { await client.destroy(); return; }
      await client.start({ botAuthToken: token });
      const me = await client.getMe();
      if (!me.bot || String(me.id) !== botId) throw new Error('Deletion listener identity mismatch');
      await writeFile(path, String(client.session.save()), { mode: 0o600 }); await chmod(path, 0o600);
      client.addEventHandler(async update => {
        if (this.stopped) return;
        if (update instanceof Api.UpdateDeleteChannelMessages) {
          const chat = Number(-1000000000000n - BigInt(String(update.channelId)));
          await replies.deleted(chat, update.messages, request);
        } else if (update instanceof Api.UpdateDeleteMessages) await replies.deleted(undefined, update.messages, request);
      }, new Raw({ types: [Api.UpdateDeleteChannelMessages, Api.UpdateDeleteMessages] }));
      await client.invoke(new Api.updates.GetState());
      if (this.stopped) { await this.stop(); return; }
      console.log('MUISM same-bot deletion events connected.');
    } catch {
      await this.close?.().catch(() => {}); this.close = undefined;
      console.error('Telegram deletion events unavailable; reply and callback fallback remains active.');
    }
  }
  async stop(): Promise<void> { this.stopped = true; await this.close?.().catch(() => {}); }
}
