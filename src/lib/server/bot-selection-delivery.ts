import { TelegramRequestError } from './bot-media.js';
import { selectionMessage, type MusicSelection } from './bot-selection.js';
import type { BotLanguage } from './bot-i18n.js';
import type { AlbumLanguage } from './bot-settings.js';

type Telegram = <T>(method: string, body: Record<string, unknown>) => Promise<T>;
// A rejected request is safe to retry in the compatibility format. A timeout or
// network interruption may already have delivered a message, so never resend it.
const unsupported = (error: unknown) => error instanceof TelegramRequestError && (
  error.errorCode === 404 && /not found|unknown method/i.test(error.description) ||
  error.errorCode === 400 && /rich.*(unsupported|not supported)|unsupported.*rich/i.test(error.description));
export class BotSelectionDelivery {
  constructor(private telegram: Telegram, private enabled = process.env.BOT_RICH_SEARCH !== '0') {}
  async show(session: MusicSelection, ui: BotLanguage, names: AlbumLanguage, edit = false): Promise<{ message_id: number }> {
    const presentation = selectionMessage(session, ui, names);
    const target = { chat_id: session.chatId, ...(edit ? { message_id: session.menuId } : { message_thread_id: session.messageThreadId,
      ...(session.chatId < 0 ? { reply_parameters: { message_id: session.requestId, allow_sending_without_reply: false } } : {}) }) };
    const rich = session.rich ?? this.enabled;
    try {
      const result = await this.telegram<{ message_id: number }>(edit ? 'editMessageText' : rich ? 'sendRichMessage' : 'sendMessage', {
        ...target, ...(rich ? { rich_message: presentation.rich_message, reply_markup: presentation.rich_keyboard } : {
          text: presentation.text, parse_mode: presentation.parse_mode, link_preview_options: presentation.link_preview_options, reply_markup: presentation.reply_markup,
        }),
      });
      session.rich = rich;
      return edit ? { message_id: session.menuId! } : result;
    } catch (error) {
      if (edit && error instanceof TelegramRequestError && /message is not modified/i.test(error.description)) return { message_id: session.menuId! };
      if (!rich || !unsupported(error)) throw error;
      this.enabled = false; session.rich = false;
      return this.show(session, ui, names, edit);
    }
  }
}
