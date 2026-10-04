import { clientAddress } from './client-address.js';
import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { publicError, ServiceError } from './errors.js';

export function apiError(error: unknown): Response {
  const { status, ...body } = publicError(error);
  return json(body, { status });
}

export async function readInput<T>(request: Request, schema: ZodType<T>): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new ServiceError('INVALID_REQUEST', '請使用 JSON 格式提交。', 415);
  const body = await request.text();
  if (body.length > 16_384) throw new ServiceError('REQUEST_TOO_LARGE', '請求內容過大。', 413);
  try { return schema.parse(JSON.parse(body)); }
  catch { throw new ServiceError('INVALID_REQUEST', '請求格式無效，請重新選擇歌曲。'); }
}

const windows = new Map<string, { count: number; until: number }>();
export function rateLimit(event: RequestEvent): void {
  const key = clientAddress(event);
  const now = Date.now();
  for (const [ip, window] of windows) if (window.until < now) windows.delete(ip);
  const window = windows.get(key) || { count: 0, until: now + 60_000 };
  if (window.count >= 30 || windows.size > 10_000) throw new ServiceError('RATE_LIMIT', '操作過於頻繁，請稍後再試。', 429);
  window.count++; windows.set(key, window);
}
