export interface LyricLine { time: number; text: string }
export interface Lyrics { lines: LyricLine[]; plain: string; source: 'netease' | 'lrclib' | 'qq' | 'kuwo' | 'kugou' | 'migu' | 'qianqian'; instrumental?: boolean }
export function parseLrc(value: string): LyricLine[] {
  const offset = Number(/\[offset:([+-]?\d+)\]/i.exec(value)?.[1] || 0) / 1000;
  const lines: LyricLine[] = [];
  for (const row of value.slice(0, 200_000).split(/\r?\n/)) {
    const tags = [...row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = row.replace(/\[[^\]]*\]/g, '').trim();
    for (const tag of tags) {
      const time = Number(tag[1]) * 60 + Number(tag[2]) + Number(`0.${tag[3] || '0'}`) + offset;
      if (Number(tag[2]) < 60 && Number.isFinite(time)) lines.push({ time: Math.max(0, time), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}
export function lyricIndex(lines: LyricLine[], elapsed: number): number {
  let low = 0, high = lines.length - 1, found = -1;
  while (low <= high) { const mid = (low + high) >>> 1; if (lines[mid]!.time <= elapsed) { found = mid; low = mid + 1; } else high = mid - 1; }
  return found;
}
