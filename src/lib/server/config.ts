import { dirname, resolve } from 'node:path';

const executable = (value: string) => value.includes('/') ? resolve(value) : value;

export const config = {
  dataDir: resolve(process.env.DATA_DIR || '.data'),
  myhkApiKey: process.env.MYHK_API_KEY || '',
  neteaseApiUrl: process.env.NETEASE_API_URL || '',
  neteaseCookie: process.env.NETEASE_COOKIE || (process.env.MUSIC_U ? `MUSIC_U=${process.env.MUSIC_U};` : ''),
  spotifyClientId: process.env.SPOTIFY_CLIENT_ID || '',
  spotifyClientSecret: process.env.SPOTIFY_CLIENT_SECRET || '',
  votifyBin: executable(process.env.VOTIFY_BIN || 'votify'),
  spotifyCookiesPath: process.env.SPOTIFY_COOKIES_PATH || '',
  votifyConfigPath: process.env.VOTIFY_CONFIG_PATH || '',
  spotifyAudioQuality: process.env.SPOTIFY_AUDIO_QUALITY || 'vorbis-high',
  ytdlpBin: executable(process.env.YTDLP_BIN || 'yt-dlp'),
  ytmPythonBin: executable(process.env.YTM_PYTHON_BIN || (process.env.YTDLP_BIN?.includes('/') ? `${dirname(process.env.YTDLP_BIN)}/python` : 'python3')),
  ytmCookiesPath: process.env.YTM_COOKIES_PATH || '',
  maxFileBytes: 256 * 1024 * 1024,
  jobRetentionMs: 24 * 60 * 60 * 1000,
  maxCollectionTracks: 100,
};
