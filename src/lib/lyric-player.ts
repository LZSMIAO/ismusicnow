import type { LyricLine as PlayerLine } from '@applemusic-like-lyrics/core';
import type { LyricLine } from './lyrics.js';
/** LRC only has sentence times: retain each sentence as one unit, never invent word timing. */
export function toPlayerLines(lines: LyricLine[], duration: number): PlayerLine[] {
  return lines.filter(line => line.text.trim()).map(line => {
    const next = lines.find(item => item.time > line.time);
    const startTime = Math.round(line.time * 1000);
    const endTime = Math.max(startTime + 1, Math.round((next?.time ?? (duration > line.time ? duration : line.time + 5)) * 1000));
    return { words: [{ word: line.text, startTime, endTime }], startTime, endTime, translatedLyric: '', romanLyric: '', isBG: false, isDuet: false };
  });
}
