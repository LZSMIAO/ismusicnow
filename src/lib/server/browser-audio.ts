import { stat, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runCommand } from './process.js';
const encoding = new Map<string, Promise<string>>();
/** Call only with a source path already authorized by DownloadStore.file. */
export async function browserAudio(source: string): Promise<string> {
  if (!encoding.has(source)) encoding.set(source, (async () => {
    const target = join(dirname(source), 'online-player.m4a');
    try { if ((await stat(target)).size > 0) return target; } catch { /* Build the browser copy. */ }
    const temp = target + '.tmp.m4a';
    await runCommand('ffmpeg', ['-nostdin', '-y', '-i', source, '-map', '0:a:0', '-vn', '-map_metadata', '-1', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', temp], { timeout: 120000 });
    await rename(temp, target); return target;
  })().finally(() => encoding.delete(source)));
  return encoding.get(source)!;
}
