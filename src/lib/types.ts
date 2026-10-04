export type Provider = 'netease' | 'spotify' | 'ytm' | 'soundcloud' | 'bandcamp' | 'bilibili';
export type SearchSource = Provider | 'all';
export type DownloadFormat = 'original' | 'mp3' | 'flac';
export type MusicSearchKind = 'track' | 'album' | 'artist' | 'playlist';
export interface MusicEntity {
  id: string; provider: Provider; kind: Exclude<MusicSearchKind, 'track'>;
  title: string; artists: string[]; sourceUrl: string; cover: string;
  year?: string; count?: number;
}

export interface Track {
  id: string;
  provider: Provider;
  title: string;
  artists: string[];
  album: string;
  albumUrl?: string;
  cover: string;
  durationMs: number;
  sourceUrl: string;
  artistIds?: string[];
  isrc?: string;
  metadataLanguages?: { title?: string; album?: string; artists?: string[] };
}

export interface Collection {
  title: string;
  provider: Provider;
  kind: 'search' | MusicSearchKind;
  tracks: Track[];
  total: number;
  warnings: string[];
  providers?: Provider[];
  entities?: MusicEntity[];
  searchType?: MusicSearchKind;
  searchScope?: Provider | 'all';
  query?: string;
  sourceUrl?: string;
}

export interface DownloadJob {
  id: string;
  track: Track;
  format: DownloadFormat;
  status: 'queued' | 'downloading' | 'completed' | 'failed';
  stage: string;
  createdAt: string;
  updatedAt: string;
  filename?: string;
  bytes?: number;
  error?: string;
  errorCode?: string;
  audioSource: Provider;
  presentation?: 'original' | 'telegram-playback';
  audio?: { codec: string; bitrate?: number; sampleRate?: number; bitsPerSample?: number; lossless: boolean };
}

export interface ServiceStatus {
  soundcloud: { downloaderReady: boolean };
  bandcamp: { downloaderReady: boolean };
  bilibili: { downloaderReady: boolean };
  netease: { ready: boolean; accountConfigured: boolean };
  spotify: { metadataConfigured: boolean; downloaderReady: boolean };
  ytm: { downloaderReady: boolean };
}
