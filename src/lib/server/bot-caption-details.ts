import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { botText, type BotLanguage } from './bot-i18n.js';

type Markup = { inline_keyboard: Record<string, unknown>[][] };
interface Saved { collapsed: string; expanded: string; markup: Markup; language: BotLanguage }
type Body = Record<string, unknown>;

// Caption controls survive restarts and need neither provider requests nor a
// download. Only presentation text is stored, never credentials or audio.
export class BotCaptionDetails {
  private root: string;
  constructor(botId: string, root = process.env.DATA_DIR || '.data') {
    if (!/^\d+$/.test(botId)) throw new Error('Invalid Telegram bot ID');
    this.root = resolve(root, 'caption-details', botId);
  }
  private markup(saved: Saved, id: string, expanded: boolean): Markup {
    const rows = saved.markup.inline_keyboard.map(row => row.map(button => ({ ...button })));
    const button = { text: `${botText(saved.language, expanded ? 'collapse' : 'details')} ${expanded ? '▴' : '▾'}`, callback_data: `md:${id}:${expanded ? 0 : 1}` };
    if (rows.length > 1 && rows[0]!.length < 3) rows[0]!.push(button);
    else rows.unshift([button]);
    return { inline_keyboard: rows };
  }
  private async caption(caption: unknown, markup: unknown, language: BotLanguage = 'en') {
    if (typeof caption !== 'string' || !caption.includes('<blockquote expandable>')) return;
    const match = /<blockquote expandable>([^]*?)<\/blockquote>/.exec(caption);
    const lines = match?.[1]?.split('\n');
    if (!lines || lines.length < 3 || !/^#\S+ #\S+/.test(lines[1]!) || !/^via @/.test(lines.at(-1)!)) return;
    const original = markup && typeof markup === 'object' && 'inline_keyboard' in markup ? markup as Markup : { inline_keyboard: [] };
    if (original.inline_keyboard.some(row => row.some(button => String(button.callback_data || '').startsWith('md:')))) return;
    const collapsed = caption.replace(match![0], `<blockquote>${[lines[0], lines[1]!.split(' ')[0], ...lines.slice(2, -1), lines.at(-1)].join('\n')}</blockquote>`);
    const expanded = caption.replace('<blockquote expandable>', '<blockquote>');
    const saved: Saved = { collapsed, expanded, markup: original, language };
    const id = createHash('sha256').update(JSON.stringify(saved)).digest('hex').slice(0, 32);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = resolve(this.root, `${id}.json`), temporary = `${path}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, JSON.stringify(saved), { mode: 0o600 }); await rename(temporary, path); }
    finally { await rm(temporary, { force: true }); }
    return { caption: collapsed, reply_markup: this.markup(saved, id, false) };
  }
  async prepare(method: string, body: Body | FormData): Promise<Body | FormData> {
    if (body instanceof FormData) {
      const language = body.get('muism_caption_language') as BotLanguage || 'en';
      body.delete('muism_caption_language');
      if (!['sendAudio', 'sendDocument'].includes(method)) return body;
      const raw = body.get('reply_markup');
      const prepared = await this.caption(body.get('caption'), typeof raw === 'string' ? JSON.parse(raw) : undefined, language);
      if (prepared) { body.set('caption', prepared.caption); body.set('reply_markup', JSON.stringify(prepared.reply_markup)); }
      return body;
    }
    const transform = async (item: Body, markup: unknown = item.reply_markup) => {
      const { muism_caption_language, ...visible } = item;
      return { ...visible, ...await this.caption(item.caption, markup, muism_caption_language as BotLanguage) };
    };
    if (method === 'answerInlineQuery' && Array.isArray(body.results)) return { ...body, results: await Promise.all(body.results.map(item => transform(item as Body))) };
    if (method === 'editMessageMedia' && body.media && typeof body.media === 'object') {
      const { reply_markup, ...media } = await transform(body.media as Body, body.reply_markup);
      return { ...body, media, ...(reply_markup ? { reply_markup } : {}) };
    }
    return body;
  }
  async toggle(data: string): Promise<{ caption: string; parse_mode: 'HTML'; reply_markup: Markup } | undefined> {
    const match = /^md:([a-f0-9]{32}):([01])$/.exec(data); if (!match) return;
    let saved: Saved;
    try { saved = JSON.parse(await readFile(resolve(this.root, `${match[1]}.json`), 'utf8')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    const expanded = match[2] === '1';
    return { caption: expanded ? saved.expanded : saved.collapsed, parse_mode: 'HTML', reply_markup: this.markup(saved, match[1]!, expanded) };
  }
}
