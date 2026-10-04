import { createHmac, timingSafeEqual } from 'node:crypto';

interface Target { id: string; chatId: number; userId: number; messageThreadId?: number }
interface CloseMessage {
  from?: { id: number }; message_thread_id?: number;
  chat: { id: number; type?: string };
  entities?: { type: string; offset: number; url?: string; user?: { id: number } }[];
}
function signature(target: Target, secret: string) {
  return createHmac('sha256', secret).update(JSON.stringify([target.id, target.chatId, target.messageThreadId ?? null, target.userId])).digest('hex').slice(0, 16);
}
export function selectionCloseData(target: Target, secret = process.env.BOT_TOKEN || ''): string {
  return secret ? `close:${target.id}:${target.userId}:${signature(target, secret)}` : `close:${target.id}`;
}
// Closing does not depend on the short-lived search data. Actor, chat and forum
// topic stay bound to a signed button even after a restart or selection expiry.
export function canCloseSelection(message: CloseMessage, userId: number, data: string, botId: number, secret: string): boolean {
  if (message.from?.id !== botId) return false;
  const signed = /^close:([a-f0-9]{16}):(\d{1,16}):([a-f0-9]{16})$/.exec(data);
  if (signed) {
    if (Number(signed[2]) !== userId || !secret) return false;
    const expected = signature({ id: signed[1]!, chatId: message.chat.id, userId, messageThreadId: message.message_thread_id }, secret);
    return timingSafeEqual(Buffer.from(signed[3]!, 'hex'), Buffer.from(expected, 'hex'));
  }
  if (!/^close:[a-f0-9]{16}$/.test(data)) return false;
  // Existing private menus have only one recipient. Legacy group HTML menus
  // put their owner mention at offset zero; never guess from display names.
  if (message.chat.id === userId && (message.chat.type === 'private' || message.chat.type === undefined)) return true;
  const owner = message.entities?.find(entity => entity.offset === 0 && (entity.type === 'text_mention' || entity.type === 'text_link' && /^tg:\/\/user\?id=\d+$/.test(entity.url || '')));
  return !!owner && (owner.type === 'text_mention' ? owner.user?.id === userId : owner.url === `tg://user?id=${userId}`);
}
