import { onlinePlayback, startOnlinePlayback } from './online-playback.js';
// Preserve existing player URLs while removing the old daily song quota.
export const startSpotifyListen = (ip: string, id: string, origin: string) => startOnlinePlayback(ip, 'spotify', id, origin);
export const spotifyListenStatus = (ip: string, id: string, origin: string) => onlinePlayback.status(ip, 'spotify', id, origin);
export const spotifyListenFile = (ip: string, track: string, job: string, grant: string) => onlinePlayback.file(ip, 'spotify', track, job, grant);
