import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { botText, type BotLanguage } from './bot-i18n.js';

type Markup = { inline_keyboard: Record<string, unknown>[][] };
interface Saved { collapsed: string; expanded: string; markup: Markup; language: BotLanguage }
type Body = Record<string, unknown>;
type Address = { chat_id: number; message_id: number } | { inline_message_id: string };

// New cards use Telegram's native expandable quote. Keep this compatibility
// reader only to restore cards whose previous Details button hid metadata.
export class BotCaptionDetails {
  private root: string;
  constructor(botId: string, root = process.env.DATA_DIR || '.data') {
    if (!/^\d+$/.test(botId)) throw new Error('Invalid Telegram bot ID');
    this.root = resolve(root, 'caption-details', botId);
  }
  async prepare(method: string, body: Body | FormData): Promise<Body | FormData> {
    if (body instanceof FormData) { body.delete('muism_caption_language'); return body; }
    const visible = ({ muism_caption_language: _language, ...item }: Body) => item;
    if (method === 'answerInlineQuery' && Array.isArray(body.results)) return { ...body, results: body.results.map(item => visible(item as Body)) };
    if (method === 'editMessageMedia' && body.media && typeof body.media === 'object') return { ...body, media: visible(body.media as Body) };
    return body;
  }
  async toggle(data: string): Promise<{ caption: string; parse_mode: 'HTML'; reply_markup: Markup } | undefined> {
    const match = /^md:([a-f0-9]{32}):([01])$/.exec(data); if (!match) return;
    let saved: Saved;
    try { saved = JSON.parse(await readFile(resolve(this.root, `${match[1]}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const quote = /<blockquote(?: expandable)?>([^]*?)<\/blockquote>/.exec(saved.expanded);
    const lines = quote?.[1]?.split('\n');
    let caption = saved.expanded.replace('<blockquote>', '<blockquote expandable>');
    if (lines && /^#\S+ #\S+/.test(lines[1]!) && /^via @/.test(lines.at(-1)!)) {
      const [source, ...technical] = lines[1]!.split(' ');
      const details = [lines[0], `${botText(saved.language, 'source')}：${source!.slice(1)}`, lines.at(-1), technical.join(' ')];
      const notices = lines.slice(2, -1);
      caption = saved.expanded.replace(quote![0], `${notices.length ? notices.join('\n') + '\n' : ''}<blockquote expandable>${details.join('\n')}</blockquote>`);
    }
    return { caption, parse_mode: 'HTML', reply_markup: saved.markup };
  }
  async remember(data: string, address: Address): Promise<void> {
    if (!/^md:[a-f0-9]{32}:[01]$/.test(data)) return;
    const root = resolve(this.root, 'deliveries');
    await mkdir(root, { recursive:true, mode:0o700 });
    const path = resolve(root, `${createHash('sha256').update(JSON.stringify(address)).digest('hex')}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify({ ...address, data }), { mode:0o600 }); await rename(temporary, path); }
    finally { await rm(temporary, { force:true }); }
  }
}
