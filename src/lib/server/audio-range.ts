/** A single HTTP byte range, as used by browser audio seeking. */
export function audioRange(header: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  let start = 0, end = size - 1;
  if (match[1]) {
    start = Number(match[1]);
    if (match[2]) {
      const requestedEnd = Number(match[2]);
      if (!Number.isSafeInteger(requestedEnd)) return null;
      end = Math.min(requestedEnd, end);
    }
  } else {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
  }
  return Number.isSafeInteger(start) && start < size && end >= start ? { start, end } : null;
}
