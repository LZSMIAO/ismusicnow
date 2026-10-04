import { isIP } from 'node:net';
import { ServiceError } from './errors.js';
/** The configured header must be overwritten by the private reverse proxy. */
export function clientAddress(event: { request: Request; getClientAddress(): string }, header = process.env.SPOTIFY_LISTEN_IP_HEADER || ''): string {
  let address = header ? event.request.headers.get(header) || '' : event.getClientAddress();
  address = address.trim().replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
  if (!isIP(address)) throw new ServiceError('CLIENT_IP', '無法確認播放額度，請稍後再試。', 503);
  return isIP(address) === 6 ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
}
