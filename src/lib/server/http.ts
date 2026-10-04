import { ServiceError } from './errors.js';

export async function fetchJson<T>(url: string | URL, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ServiceError('NETWORK_ERROR', '無法連接音樂服務，請確認網路後重試。', 502); }
  if (!response.ok) {
    if (response.status === 429) throw new ServiceError('RATE_LIMIT', '平台請求過於頻繁，請稍後再試。', 429);
    if ([401, 403].includes(response.status)) throw new ServiceError('ACCOUNT_REQUIRED', '平台拒絕存取，請檢查服務端帳號設定或曲目權限。', 403);
    if (response.status === 404) throw new ServiceError('NOT_FOUND', '這首歌曲或歌單已不存在，或目前無法存取。', 404);
    throw new ServiceError('UPSTREAM_ERROR', '音樂服務暫時無法回應，請稍後再試。', 502);
  }
  return response.json() as Promise<T>;
}
