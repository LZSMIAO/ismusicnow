export interface LyricLine { time: number; text: string }
export interface Lyrics { lines: LyricLine[]; plain: string; source: 'netease' | 'lrclib' | 'qq' | 'kuwo' | 'kugou' | 'migu' | 'qianqian'; instrumental?: boolean }
export function displayLyricLines(lines: LyricLine[], title: string, artists: string[]): LyricLine[] {
  const normalize = (value: string) => value.replace(/\s+/g, '').toLocaleLowerCase();
  const headings = new Set(artists.map(artist => normalize(`${title}-${artist}`)));
  headings.add(normalize(`${title}-${artists.join('/')}`));
  const credit = /^(?:詞|词|曲|作詞|作词|作曲|編曲|编曲|和聲|和声|製作人|制作人|製作|制作|混音|錄音|录音|母帶|母带|演唱|吉他|貝斯|贝斯|鼓|監製|监制|出品|發行|发行)(?:工程師|工程师)?\s*[:：]/;
  return lines.filter(item => !credit.test(item.text) && !(item.time <= 5 && headings.has(normalize(item.text))));
}
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
