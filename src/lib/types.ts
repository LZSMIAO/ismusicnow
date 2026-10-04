export type Provider = 'netease' | 'spotify' | 'ytm';
export type SearchSource = Provider | 'all';
export type DownloadFormat = 'original' | 'mp3' | 'flac';

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
  metadataLanguages?: { title?: string; album?: string; artists?: string[] };
}

export interface Collection {
  title: string;
  provider: Provider;
  kind: 'search' | 'track' | 'album' | 'playlist';
  tracks: Track[];
  total: number;
  warnings: string[];
  providers?: Provider[];
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
  audio?: { codec: string; bitrate?: number; sampleRate?: number; bitsPerSample?: number; lossless: boolean };
}

export interface ServiceStatus {
  netease: { ready: boolean; accountConfigured: boolean };
  spotify: { metadataConfigured: boolean; downloaderReady: boolean };
  ytm: { downloaderReady: boolean };
}
