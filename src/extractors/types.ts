import { VideoSource, SubtitleTrack, TimeRange } from '../types/anime.js';

export interface ExtractedDetails {
  origin: string;
  sources: VideoSource[];
  subtitles: SubtitleTrack[];
  intro?: TimeRange | null;
  outro?: TimeRange | null;
}

export interface IVideoExtractor {
  readonly name: string;
  matches(url: string): boolean;
  extract(embedUrl: string, referer?: string): Promise<ExtractedDetails>;
}
