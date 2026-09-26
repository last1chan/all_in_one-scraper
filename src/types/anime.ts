export interface AnimeSearchResult {
  id: string;
  title: string;
  japaneseTitle?: string;
  poster?: string;
  type?: string;
  episodesCount?: number;
  provider: string;
  url?: string;
}

export interface Episode {
  id: string;
  number: number;
  title: string;
  sourceNumber?: string;
  duration?: number | null;
  filler?: boolean;
  recap?: boolean;
  hasSub: boolean;
  hasDub: boolean;
  airDate?: string | null;
  description?: string | null;
  image?: string | null;
}

export interface Server {
  id: string;
  name: string;
  serverId?: string | null;
  subType: 'sub' | 'dub' | 'raw';
}

export interface SubtitleTrack {
  url: string;
  label: string;
  srclang?: string;
  kind?: 'subtitles' | 'captions';
  isDefault?: boolean;
}

export interface VideoSource {
  url: string;
  type: 'hls' | 'mp4' | 'embed' | 'dash';
  quality?: string;
  isM3U8: boolean;
  isBackup?: boolean;
}

export interface TimeRange {
  start: number;
  end: number;
}

export interface StreamResolutionResult {
  provider: string;
  animeId: string;
  episodeNumber: number;
  subType: 'sub' | 'dub';
  server: string;
  sources: VideoSource[];
  subtitles: SubtitleTrack[];
  intro?: TimeRange | null;
  outro?: TimeRange | null;
  headers?: Record<string, string>;
  isDub?: boolean;
  isHardSub?: boolean;
  isSoftSub?: boolean;
  mp4Sources?: VideoSource[];
}
