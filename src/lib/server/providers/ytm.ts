import { resolve } from 'node:path';
import type { Collection, Track } from '../../types.js';
import { config } from '../config.js';
import { runCommand } from '../process.js';
import type { MusicLink } from '../links.js';

interface YtmEntry { id: string; title: string; artist?: string; uploader?: string; album?: string; thumbnail?: string; thumbnails?: { url: string }[]; duration?: number; entries?: YtmEntry[]; playlist_count?: number }

function cookieArgs(): string[] { return config.ytmCookiesPath ? ['--cookies', resolve(config.ytmCookiesPath)] : []; }
function mapYtm(entry: YtmEntry): Track {
  return { id: entry.id, provider: 'ytm', title: entry.title, artists: [entry.artist || entry.uploader || ''].filter(Boolean),
    album: entry.album || '', cover: entry.thumbnail || entry.thumbnails?.at(-1)?.url || '', durationMs: (entry.duration || 0) * 1000,
    sourceUrl: `https://music.youtube.com/watch?v=${entry.id}` };
}

export async function resolveYtm(link: MusicLink): Promise<Collection> {
  const output = await runCommand(config.ytdlpBin, ['--ignore-config', ...cookieArgs(), '--dump-single-json', '--skip-download',
    '--flat-playlist', '--playlist-end', String(config.maxCollectionTracks), '--', link.url], { timeout: 45_000 });
  const info = JSON.parse(output) as YtmEntry;
  const tracks = (info.entries || [info]).filter((t) => /^[a-zA-Z0-9_-]{11}$/.test(t.id)).map(mapYtm);
  const total = info.playlist_count || tracks.length;
  return { title: info.title, kind: link.kind, provider: 'ytm', total, tracks,
    warnings: total > tracks.length ? [`共有 ${total} 首，本次載入前 ${tracks.length} 首。`] : [] };
}

export async function downloadYtm(track: Track, directory: string): Promise<void> {
  await runCommand(config.ytdlpBin, ['--ignore-config', ...cookieArgs(), '--no-playlist', '--no-progress',
    '--max-filesize', '256M', '--format', 'bestaudio', '--output', resolve(directory, 'audio.%(ext)s'), '--', track.sourceUrl], { cwd: directory, timeout: 300_000 });
}
