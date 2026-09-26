import { IAnimeProvider, ProviderHealth } from '../types/provider.js';
import { AnimeSearchResult, Episode, Server, StreamResolutionResult } from '../types/anime.js';
import { domainManager } from '../core/domain-manager.js';
import { globalCache } from '../core/cache.js';

export abstract class BaseProvider implements IAnimeProvider {
  abstract readonly name: string;
  abstract readonly defaultBaseUrl: string;
  abstract readonly mirrorUrls: string[];
  readonly languages: string[] = ['en'];
  readonly isSelfHosted: boolean = false;
  readonly librarySize: string = 'Unknown';
  readonly serverType: 'self-hosted' | 'hybrid' | 'third-party' = 'third-party';
  readonly notes?: string;

  protected init(): void {
    domainManager.registerProvider(this.name, this.defaultBaseUrl, this.mirrorUrls);
  }

  getBaseUrl(): string {
    return domainManager.getActiveDomain(this.name) || this.defaultBaseUrl;
  }

  setBaseUrl(url: string): void {
    domainManager.setDomain(this.name, url);
  }

  async checkHealth(): Promise<ProviderHealth> {
    return domainManager.checkProviderHealth(this.name);
  }

  protected getCacheKey(prefix: string, ...parts: (string | number)[]): string {
    return `${this.name}:${prefix}:${parts.join(':')}`;
  }

  abstract search(query: string): Promise<AnimeSearchResult[]>;
  abstract getEpisodes(animeId: string): Promise<Episode[]>;
  abstract getServers(animeId: string, episodeNumber: number): Promise<Server[]>;
  abstract getSources(
    animeId: string,
    episodeNumber: number,
    serverId: string,
    subType: 'sub' | 'dub'
  ): Promise<StreamResolutionResult>;
}
