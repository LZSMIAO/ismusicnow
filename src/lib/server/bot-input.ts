import type { Collection } from '../types.js';
import { ServiceError } from './errors.js';
import { getTrack, resolveMusic } from './music.js';

// The original /netease and /music commands download the first search result.
// /search remains the command for choosing from a list of matches.
export async function resolveNeteaseCommand(input: string, lookup = { getTrack, resolveMusic }): Promise<Collection> {
  const text = input.trim();
  if (!text) throw new ServiceError('INVALID_INPUT', '請提供網易雲歌名、歌曲 ID 或連結。');
  if (/^\d{1,16}$/.test(text)) {
    const track = await lookup.getTrack('netease', text);
    return { title: track.title, provider: 'netease', kind: 'track', tracks: [track], total: 1, warnings: [] };
  }
  const collection = await lookup.resolveMusic(text, 'netease');
  if (collection.provider !== 'netease') throw new ServiceError('WRONG_PROVIDER', '此命令用於網易雲，其他平台請直接貼上連結或使用對應命令。');
  if (!collection.tracks.length) throw new ServiceError('NOT_FOUND', '沒有找到歌曲，請試試其他關鍵字。', 404);
  if (collection.kind === 'search') return { ...collection, kind: 'track', tracks: collection.tracks.slice(0, 1), total: 1 };
  return collection;
}
