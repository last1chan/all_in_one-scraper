import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from './anime.js';

export interface ProviderHealth {
  name: string;
  baseUrl: string;
  isOnline: boolean;
  latencyMs: number;
  lastChecked: Date;
  activeMirrors: string[];
}

export interface EverythingMoeSourceInfo {
  name: string;
  baseUrl: string;
  mediaType: 'anime' | 'manga';
  isSelfHosted: boolean;
  librarySize: string;
  serverType: 'self-hosted' | 'hybrid' | 'third-party';
  languages: string[];
  notes?: string;
  isOnline?: boolean;
}

export interface IAnimeProvider {
  readonly name: string;
  readonly defaultBaseUrl: string;
  readonly mirrorUrls: string[];
  readonly languages: string[];
  readonly isSelfHosted?: boolean;
  readonly librarySize?: string;
  readonly serverType?: 'self-hosted' | 'hybrid' | 'third-party';
  readonly notes?: string;

  getBaseUrl(): string;
  setBaseUrl(url: string): void;
  checkHealth(): Promise<ProviderHealth>;
  
  search(query: string): Promise<AnimeSearchResult[]>;
  getEpisodes(animeId: string): Promise<Episode[]>;
  getServers(animeId: string, episodeNumber: number): Promise<Server[]>;
  getSources(animeId: string, episodeNumber: number, serverId: string, subType: 'sub' | 'dub'): Promise<StreamResolutionResult>;
}
